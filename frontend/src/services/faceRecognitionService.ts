import * as tf from '@tensorflow/tfjs';
import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js';
import sarvarPhotoUrl from '../assets/faces/koldoshev_sarvar.jpg';
import asilbekPhotoUrl from '../assets/faces/asilbek_ravshanov.png';
import boburjonPhotoUrl from '../assets/faces/boburjon_bozorov.jpg';
// Bazadagi 3 kishining oldindan hisoblangan embeddinglari. Rasm yoki modelni almashtirsangiz, faylni qayta hisoblang
// (yoki o'chiring: shunda ilova ishga tushganda rasmlardan o'zi hisoblaydi, lekin sekinroq).
import descriptorsJson from '../assets/faces/descriptors-cache.json';

const BUILTIN_DESCRIPTORS = descriptorsJson as Record<string, number[]>;

export interface KnownPerson {
  id: string;
  fullName: string;
  role: string;
  photoUrl: string;
  color: string;
  badge: string;
  /** 128 o'lchamli yuz embeddingi (face-api FaceRecognitionNet) */
  descriptor?: number[];
}

export interface PersonBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PersonIdentity {
  box: PersonBox;
  /** Bazadagi shaxs. null bo'lsa — "Piyoda" (begona yoki yuzi ko'rinmagan odam) */
  person: KnownPerson | null;
  /** Taniganda 0..1 (1 - yuz masofasi). Tanilmasa null */
  confidence: number | null;
  faceFound: boolean;
  /** Topilgan yuz ramkasi (video piksellarida). Masofani yuz kengligidan hisoblash uchun */
  faceBox: PersonBox | null;
  /** Ko'zlarning tashqi burchaklari (landmark 36 va 45), video piksellarida */
  eyes: { x1: number; y1: number; x2: number; y2: number } | null;
  /** Odam ramkasi detektordan emas, aynan yuzdan olingan (COCO odamni topmagan) */
  fromFaceOnly: boolean;
  faceScore: number | null;
}

export const INITIAL_FACE_DATABASE: KnownPerson[] = [
  {
    id: 'koldoshev-sarvar',
    fullName: "Qo'ldoshev Sarvar",
    role: 'Tizim Boshqaruvchisi / Muhandis',
    photoUrl: sarvarPhotoUrl,
    color: '#00e676', // Yashil neon
    badge: 'IIV VERIFIED'
  },
  {
    id: 'ravshanov-asilbek',
    fullName: 'Asilbek Ravshanov',
    role: 'Loyiha Muhandisi / Boshqaruvchi',
    photoUrl: asilbekPhotoUrl,
    color: '#38bdf8', // Tsian / Moviy neon
    badge: 'IIV VERIFIED'
  },
  {
    id: 'bozorov-boburjon',
    fullName: 'Bozorov Boburjon',
    role: 'Loyiha Muhandisi / Konstruktor',
    photoUrl: boburjonPhotoUrl,
    color: '#f59e0b', // Sariq / Oltin neon
    badge: 'IIV VERIFIED'
  }
];

const MODEL_URL = `${import.meta.env.BASE_URL}models/face`;
const STORAGE_KEY = 'qalqon.faceDb.v1';

// Yuz embeddinglari orasidagi Euclid masofasi. face-api standarti 0.6, 0.5 — qat'iyroq (begonani tanib yubormaslik uchun)
const MATCH_DISTANCE = 0.5;

// Ism ko'rsatilishi uchun oxirgi VOTE_WINDOW ta yuz kadridan kamida VOTE_NEEDED tasi bir xil shaxsni ko'rsatishi shart
const VOTE_WINDOW = 5;
const VOTE_NEEDED = 3;
const TRACK_TTL_MS = 1500;
const TRACK_MIN_IOU = 0.25;

const LIVE_OPTIONS = { inputSize: 416, scoreThreshold: 0.5 };
const PHOTO_OPTIONS = { inputSize: 608, scoreThreshold: 0.3 };

// Odam ramkasi kadr kengligi yoki balandligining shu ulushidan katta bo'lsa, odam kameraga yaqin deb hisoblanadi
const CLOSE_BOX_RATIO = 0.5;
// Yaqin yuzni topish uchun kadr shuncha marta kichraytiriladi
const PAD_SCALE = 0.5;

interface LiveFace {
  box: PersonBox;
  score: number;
  descriptor: Float32Array;
  eyes: { x1: number; y1: number; x2: number; y2: number };
}

function centerInside(inner: PersonBox, outer: PersonBox): boolean {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}

interface Track {
  box: PersonBox;
  votes: (string | null)[];
  lastSeen: number;
  lastDistance: number;
}

function iou(a: PersonBox, b: PersonBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function euclidean(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Rasmni yuklab bo\'lmadi'));
    img.src = url;
  });
}

class FaceRecognitionEngine {
  private database: KnownPerson[] = INITIAL_FACE_DATABASE.map((p) => ({ ...p }));
  private builtinIds = new Set(INITIAL_FACE_DATABASE.map((p) => p.id));
  private initPromise: Promise<void> | null = null;
  private ready = false;
  private tracks: Track[] = [];
  private padCanvas: HTMLCanvasElement | null = null;

  public isReady(): boolean {
    return this.ready;
  }

  public initDatabase(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadEverything().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async loadEverything(): Promise<void> {
    await tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);

    for (const person of this.database) {
      const cached = BUILTIN_DESCRIPTORS[person.id];
      if (cached?.length === 128) {
        person.descriptor = cached;
        continue;
      }
      try {
        person.descriptor = await this.descriptorFromUrl(person.photoUrl);
      } catch (err) {
        console.warn(`[FaceID] ${person.fullName} rasmidan yuz olinmadi:`, err);
      }
    }

    // WebGL shaderlarini birinchi jonli kadrdan oldin kompilyatsiya qilib qo'yish (aks holda 1-kadr bir necha soniya qotadi)
    try {
      await this.descriptorFromUrl(this.database[0].photoUrl);
    } catch {
      // isitish muvaffaqiyatsiz bo'lsa ham jonli ishlashga halaqit bermaydi
    }
    this.loadCustomPersons();
    this.ready = true;
  }

  public getPersons(): KnownPerson[] {
    return this.database;
  }

  public async addPerson(person: KnownPerson): Promise<void> {
    await this.initDatabase();
    if (!person.photoUrl) throw new Error('Rasm yuklanmagan');

    const img = await loadImage(person.photoUrl);
    const descriptor = await this.descriptorFromImage(img);
    person.descriptor = descriptor;
    person.photoUrl = this.makeThumbnail(img);
    this.database.push(person);
    this.saveCustomPersons();
  }

  // Rasmdagi eng katta yuzning embeddingini olish
  private async descriptorFromImage(img: HTMLImageElement): Promise<number[]> {
    const detect = (input: HTMLImageElement | HTMLCanvasElement) =>
      faceapi
        .detectAllFaces(input, new faceapi.TinyFaceDetectorOptions(PHOTO_OPTIONS))
        .withFaceLandmarks()
        .withFaceDescriptors();

    let results = await detect(img);
    if (results.length === 0) {
      // Yuz butun kadrni egallagan (pasport uslubidagi) rasmlarni detektor topmaydi: atrofiga bo'sh joy qo'shib qayta urinamiz
      results = await detect(this.padImage(img));
    }
    if (results.length === 0) throw new Error('Rasmda yuz topilmadi');

    const largest = results.reduce((a, b) =>
      a.detection.box.area >= b.detection.box.area ? a : b
    );
    return Array.from(largest.descriptor);
  }

  private padImage(img: HTMLImageElement): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * 2;
    canvas.height = img.naturalHeight * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, img.naturalWidth / 2, img.naturalHeight / 2);
    return canvas;
  }

  private async descriptorFromUrl(url: string): Promise<number[]> {
    return this.descriptorFromImage(await loadImage(url));
  }

  private makeThumbnail(img: HTMLImageElement): string {
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return img.src;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 4;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  private loadCustomPersons(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as KnownPerson[];
      for (const p of saved) {
        if (p.descriptor?.length === 128 && !this.builtinIds.has(p.id)) {
          this.database.push(p);
        }
      }
    } catch (err) {
      console.warn('[FaceID] Saqlangan bazani o\'qib bo\'lmadi:', err);
    }
  }

  private saveCustomPersons(): void {
    try {
      const custom = this.database.filter((p) => !this.builtinIds.has(p.id));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
    } catch (err) {
      console.warn('[FaceID] Bazani saqlab bo\'lmadi:', err);
    }
  }

  private nearest(descriptor: ArrayLike<number>): { person: KnownPerson | null; distance: number } {
    let best: KnownPerson | null = null;
    let bestDist = Infinity;
    for (const p of this.database) {
      if (!p.descriptor) continue;
      const d = euclidean(descriptor, p.descriptor);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return { person: best, distance: bestDist };
  }

  // Kadrlar orasida bir odamni kuzatib, ovoz berish orqali barqaror ism chiqarish
  private matchTrack(box: PersonBox, now: number): Track {
    let best: Track | null = null;
    let bestIou = TRACK_MIN_IOU;
    for (const t of this.tracks) {
      const v = iou(t.box, box);
      if (v > bestIou) {
        bestIou = v;
        best = t;
      }
    }
    if (!best) {
      best = { box, votes: [], lastSeen: now, lastDistance: 1 };
      this.tracks.push(best);
    }
    best.box = box;
    best.lastSeen = now;
    return best;
  }

  private resolveTrack(track: Track): string | null {
    const counts = new Map<string, number>();
    for (const v of track.votes) {
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let winner: string | null = null;
    let max = 0;
    for (const [id, c] of counts) {
      if (c > max) {
        max = c;
        winner = id;
      }
    }
    return max >= VOTE_NEEDED ? winner : null;
  }

  /**
   * Kadrdagi barcha odamlarni aniqlaydi.
   * personBoxes — COCO-SSD topgan odam ramkalari (video piksellarida).
   * Natija: har bir ramka uchun shaxs yoki null ("Piyoda"). COCO topmagan, lekin yuzi
   * ko'ringan odamlar ham oxirida qo'shiladi.
   */
  public async identifyPeople(
    video: HTMLVideoElement,
    personBoxes: PersonBox[]
  ): Promise<PersonIdentity[]> {
    const asPiyoda = (box: PersonBox): PersonIdentity => ({
      box, person: null, confidence: null, faceFound: false, faceBox: null, eyes: null, fromFaceOnly: false, faceScore: null
    });
    if (!this.ready) return personBoxes.map(asPiyoda);

    const now = performance.now();
    this.tracks = this.tracks.filter((t) => now - t.lastSeen < TRACK_TTL_MS);

    let faces = await this.detectLive(video, 1, 0, 0);

    // Yuz kadrni to'ldirib, kameraga yaqin turganda detektor uni topolmaydi (yuz juda katta).
    // Yaqin odam ramkasida yuz topilmagan bo'lsa, kadrni kichraytirib (atrofiga bo'sh joy qo'shib) qayta urinamiz.
    const vw = video.videoWidth || video.width;
    const vh = video.videoHeight || video.height;
    const closeWithoutFace = personBoxes.some(
      (pb) =>
        (pb.width >= vw * CLOSE_BOX_RATIO || pb.height >= vh * CLOSE_BOX_RATIO) &&
        !faces.some((f) => centerInside(f.box, pb))
    );
    if (closeWithoutFace && vw > 0 && vh > 0) {
      const found = await this.detectLive(
        this.padFrame(video, vw, vh),
        PAD_SCALE,
        (vw * (1 - PAD_SCALE)) / 2,
        (vh * (1 - PAD_SCALE)) / 2
      );
      // Allaqachon topilgan yuzlarni takrorlamaymiz
      faces = faces.concat(found.filter((pf) => !faces.some((f) => centerInside(pf.box, f.box))));
    }

    // Har bir yuzni o'zini o'z ichiga olgan eng kichik odam ramkasiga biriktirish
    const facePerBox = new Map<number, LiveFace>();
    const orphans: LiveFace[] = [];
    for (const face of faces) {
      const fb = face.box;
      let ownerIdx = -1;
      let ownerArea = Infinity;
      personBoxes.forEach((pb, i) => {
        const area = pb.width * pb.height;
        if (centerInside(fb, pb) && area < ownerArea) {
          ownerIdx = i;
          ownerArea = area;
        }
      });
      if (ownerIdx < 0) {
        orphans.push(face);
      } else {
        const prev = facePerBox.get(ownerIdx);
        if (!prev || fb.width * fb.height > prev.box.width * prev.box.height) facePerBox.set(ownerIdx, face);
      }
    }

    const identify = (box: PersonBox, face: LiveFace | undefined, fromFaceOnly: boolean): PersonIdentity => {
      const track = this.matchTrack(box, now);
      let faceScore: number | null = null;
      if (face) {
        faceScore = face.score;
        const { person, distance } = this.nearest(face.descriptor);
        track.votes.push(person && distance < MATCH_DISTANCE ? person.id : null);
        if (track.votes.length > VOTE_WINDOW) track.votes.shift();
        if (person && distance < MATCH_DISTANCE) track.lastDistance = distance;
      }
      const id = this.resolveTrack(track);
      const person = id ? this.database.find((p) => p.id === id) ?? null : null;
      return {
        box,
        person,
        confidence: person ? Math.max(0, 1 - track.lastDistance) : null,
        faceFound: !!face,
        faceBox: face ? face.box : null,
        eyes: face ? face.eyes : null,
        fromFaceOnly,
        faceScore
      };
    };

    const results = personBoxes.map((box, i) => identify(box, facePerBox.get(i), false));
    for (const face of orphans) {
      results.push(identify({ ...face.box }, face, true));
    }
    return results;
  }

  // Yuzlarni topadi va koordinatalarni asl video piksellariga qaytaradi (kichraytirilgan kadr uchun scale va offset)
  private async detectLive(
    input: HTMLVideoElement | HTMLCanvasElement,
    scale: number,
    offX: number,
    offY: number
  ): Promise<LiveFace[]> {
    const results = await faceapi
      .detectAllFaces(input, new faceapi.TinyFaceDetectorOptions(LIVE_OPTIONS))
      .withFaceLandmarks()
      .withFaceDescriptors();
    const mx = (x: number) => (x - offX) / scale;
    const my = (y: number) => (y - offY) / scale;
    return results.map((r) => {
      const b = r.detection.box;
      const p = r.landmarks.positions;
      return {
        box: { x: mx(b.x), y: my(b.y), width: b.width / scale, height: b.height / scale },
        score: r.detection.score,
        descriptor: r.descriptor,
        // 36 va 45 — ko'zlarning tashqi burchaklari
        eyes: { x1: mx(p[36].x), y1: my(p[36].y), x2: mx(p[45].x), y2: my(p[45].y) }
      };
    });
  }

  // Kadrni PAD_SCALE marta kichraytirib, kulrang fon ustiga markazga qo'yadi
  private padFrame(video: HTMLVideoElement, w: number, h: number): HTMLCanvasElement {
    if (!this.padCanvas) this.padCanvas = document.createElement('canvas');
    const canvas = this.padCanvas;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(video, (w * (1 - PAD_SCALE)) / 2, (h * (1 - PAD_SCALE)) / 2, w * PAD_SCALE, h * PAD_SCALE);
    return canvas;
  }
}

export const faceRecognitionService = new FaceRecognitionEngine();
