import * as tf from '@tensorflow/tfjs';
import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js';
import sarvarPhotoUrl from '../assets/faces/koldoshev_sarvar.jpg';
import asilbekPhotoUrl from '../assets/faces/asilbek_ravshanov.png';
import boburjonPhotoUrl from '../assets/faces/boburjon_bozorov.jpg';
import muhammadaliPhotoUrl from '../assets/faces/muhammadali_ravshanov.jpg';
// Bazadagi 3 kishining oldindan hisoblangan embeddinglari. Rasm yoki modelni almashtirsangiz, faylni qayta hisoblang
// (yoki o'chiring: shunda ilova ishga tushganda rasmlardan o'zi hisoblaydi, lekin sekinroq).
import descriptorsJson from '../assets/faces/descriptors-cache.json';
import { TRAIN_VARIANTS, renderVariant, type Pt } from './faceAugment';
import { BiometricCryptoVault } from './biometricCryptoVault';

// Format: { id: { base: number[128], variants: { "sunglasses+mask_blue": number[128], ... } } }.
// Eski format (faqat number[128]) ham o'qiladi.
type CachedPerson = number[] | { base: number[]; variants?: Record<string, number[]> };
const BUILTIN_DESCRIPTORS = descriptorsJson as unknown as Record<string, CachedPerson>;

// DIQQAT: tf.env().set('WEBGL_USE_SHAPES_UNIFORMS', true) ISHLATMANG. Birinchi ishga tushishni ~3 baravar tezlashtiradi,
// lekin bu face-api tarmoqlarida noto'g'ri natija beradi: yuz detektori hech narsa topmaydi (sinovda yuz: 0, sozlamasiz 1).

export interface KnownPerson {
  id: string;
  fullName: string;
  role: string;
  photoUrl: string;
  color: string;
  badge: string;
  /** 128 o'lchamli yuz embeddingi (face-api FaceRecognitionNet) */
  descriptor?: number[];
  /**
   * Aksessuar taqqan sun'iy variantlar (ko'zoynak, bosh kiyim, kapyushon, niqob, taturovka va ularning birikmalari).
   * Asl rasmga aksessuar chizilib, har biridan embedding olingan. Jonli yuz shularga ham solishtiriladi.
   */
  templates?: FaceTemplate[];
}

export interface FaceTemplate {
  /** Variant nomi, masalan "sunglasses+mask_blue" */
  v: string;
  d: number[];
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
  },
  {
    id: 'ravshanov-muhammadali',
    fullName: 'Muhammadali Ravshanov',
    role: 'Ruxsat berilgan shaxs',
    photoUrl: muhammadaliPhotoUrl,
    color: '#a78bfa', // Binafsha neon
    badge: 'VERIFIED'
  }
];

const MODEL_URL = `${import.meta.env.BASE_URL}models/face`;
export const LOCALSTORAGE_KEY = 'qalqon.faceDb.v1';

// RobotFaceView (qulf ekrani salomlashuvi) uchun jamoaning asl parametrlari: matchFace() va votePerson() shularni ishlatadi
export const MATCH_DISTANCE = 0.58;
export const VOTE_WINDOW = 4;
export const VOTE_NEEDED = 2;

export interface FaceMatchResult {
  person: KnownPerson | null;
  isIdentified: boolean;
  confidence: number;
  distance: number;
}

export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number };
  score: number;
  descriptor: Float32Array;
}

// Jonli HUD tanishi: Euclid masofasi chegarasi. face-api standarti 0.6, 0.5 — qat'iyroq (begonani tanib yubormaslik uchun)
const LIVE_MATCH_DISTANCE = 0.5;
// Aksessuarli (sun'iy) shablonlar uchun chegara qat'iyroq: sinovda aksessuar taqqan HAR XIL odamlar o'zaro 0.45 gacha
// yaqinlashadi (toza yuzlarda ~0.65+), shuning uchun 0.5 da begonani tanib yuborish xavfi sezilarli (833 juftdan 8 tasi <0.5, 0 tasi <0.45).
const OCC_MATCH_DISTANCE = 0.4;
// Eng yaqin va ikkinchi eng yaqin shaxs orasidagi minimal farq (chegaraga nisbatan, 0.12 ~ 0.06 masofa)
const MIN_RATIO_MARGIN = 0.12;
// Bazadagi rasm jonli kadrga o'xshash sahnaga joylanganda yuz kengligi (piksel). Aksessuar variantlari shu sahnada chiziladi
const SCENE_FACE_PX = 280;

// HUD: ism ko'rsatilishi uchun oxirgi LIVE_VOTE_WINDOW ta yuz kadridan kamida LIVE_VOTE_NEEDED tasi bir xil shaxsni ko'rsatishi shart
const LIVE_VOTE_WINDOW = 5;
const LIVE_VOTE_NEEDED = 3;
// Iz (track) vaqt bo'yicha emas, kadrlar soni bo'yicha eskiradi: sekin qurilmada bitta tahlil 2-3 s olishi mumkin va
// 1.5 s lik vaqt chegarasi ovozlarni har kadrda o'chirib yuborar edi (ism hech qachon chiqmasdi). Vaqt chegarasi faqat to'xtab qolgan holat uchun.
const TRACK_TTL_CYCLES = 6;
const TRACK_MAX_IDLE_MS = 15000;
const TRACK_MIN_IOU = 0.25;

const LIVE_OPTIONS = { inputSize: 416, scoreThreshold: 0.5 };
// Niqob/ko'zoynak/kapyushon taqqan yuzlarning detektor bahosi past (0.25-0.5). Faqat odam ramkasi ichida, yuz topilmasa qidiriladi
const LOW_OPTIONS = { inputSize: 416, scoreThreshold: 0.25 };
// Past baholi yuz ramkasi masofa hisobiga ishlatilmaydi (soxta yuz bo'lishi mumkin)
const MIN_SCORE_FOR_BOX = 0.4;
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
  lastCycle: number;
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
  private warm = false;
  private warmPromise: Promise<void> | null = null;
  private voteHistory: Map<string, string[]> = new Map();
  private tracks: Track[] = [];
  private cycle = 0;
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
    let t = performance.now();
    const lap = (name: string) => {
      const now = performance.now();
      this.timings[name] = Math.round(now - t);
      t = now;
    };
    await tf.ready();
    lap('tf');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    lap('modellar');

    for (const person of this.database) {
      const cached = BUILTIN_DESCRIPTORS[person.id];
      const base = Array.isArray(cached) ? cached : cached?.base;
      if (base?.length === 128) {
        person.descriptor = base;
        if (!Array.isArray(cached) && cached.variants) {
          person.templates = Object.entries(cached.variants)
            .filter(([, d]) => d.length === 128)
            .map(([v, d]) => ({ v, d }));
        }
        continue;
      }
      try {
        person.descriptor = await this.descriptorFromUrl(person.photoUrl);
      } catch (err) {
        console.warn(`[FaceID] ${person.fullName} rasmidan yuz olinmadi:`, err);
      }
    }

    lap('baza');
    this.loadCustomPersons();
    this.ready = true;
    console.info('[FaceID] tayyor (ms):', this.timings);
  }

  /**
   * initDatabase() + WebGL shaderlarini isitish. HUD jonli tahlilni boshlashdan oldin chaqiradi (aks holda birinchi kadr
   * bir necha soniya qotadi). Qulf ekrani (RobotFaceView) faqat yengil initDatabase() ni chaqiradi.
   */
  public prepare(): Promise<void> {
    if (!this.warmPromise) {
      this.warmPromise = this.initDatabase()
        .then(async () => {
          try {
            await this.warmUp();
          } catch {
            // isitish muvaffaqiyatsiz bo'lsa ham jonli ishlashga halaqit bermaydi
          }
          this.warm = true;
        })
        .catch((err) => {
          this.warmPromise = null;
          throw err;
        });
    }
    return this.warmPromise;
  }

  /** Modellar yuklangan va shaderlar isitilgan: HUD tahlili tayyor */
  public isWarm(): boolean {
    return this.warm;
  }

  // Uchala tarmoqni (detektor, landmark, tanish) jonli rejimdagi sozlama bilan bir marta ishlatib, shaderlarni kompilyatsiya qiladi.
  // Birinchi jonli kadr shunda qotib qolmaydi. Yuzi aniq topiladigan rasm (bazadagi ikkinchi shaxs) kadr o'lchamiga joylanadi.
  private async warmUp(): Promise<void> {
    const person = this.database.find((p) => p.id === 'ravshanov-asilbek') ?? this.database[0];
    const img = await loadImage(person.photoUrl);
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const h = 260;
    const w = (img.naturalWidth / img.naturalHeight) * h;
    ctx.drawImage(img, (canvas.width - w) / 2, 50, w, h);
    await this.detectLive(canvas, 1, 0, 0);
  }

  /** Bosqichlar vaqti (ms): ishga tushish va oxirgi jonli kadr. Sekinlikni topish uchun */
  public timings: Record<string, number> = {};

  public getPersons(): KnownPerson[] {
    return this.database;
  }

  /**
   * Yangi shaxsni bazaga qo'shadi (faqat yuzi aniq ko'ringan rasm bilan). Asl rasmdan tashqari, rasmga aksessuarlar
   * chizilgan variantlardan ham embedding oladi (~15 ta, bir necha soniya). onProgress(i, n) — jarayonni ko'rsatish uchun.
   */
  public async addPerson(
    personData: { fullName: string; role: string; photoDataUrl: string; color?: string },
    onProgress?: (done: number, total: number) => void
  ): Promise<KnownPerson> {
    await this.initDatabase();
    let img: HTMLImageElement;
    try {
      img = await loadImage(personData.photoDataUrl);
    } catch {
      throw new Error("Rasmni o'qib bo'lmadi.");
    }
    let descriptor: number[];
    try {
      descriptor = await this.descriptorFromImage(img);
    } catch {
      throw new Error("Rasmda yuz topilmadi! Iltimos, yuzingiz aniq va to'g'ri ko'ringan rasm yuklang.");
    }
    const person: KnownPerson = {
      id: `person-${Date.now()}`,
      fullName: personData.fullName.trim(),
      role: personData.role.trim() || 'Ruxsat berilgan shaxs',
      photoUrl: '',
      color: personData.color || '#38bdf8',
      badge: 'IIV VERIFIED',
      descriptor
    };
    try {
      const { variants } = await this.buildVariantDescriptors(img, onProgress);
      person.templates = Object.entries(variants).map(([v, d]) => ({ v, d }));
    } catch (err) {
      // Variantlarsiz ham shaxs qo'shiladi (faqat aksessuarsiz tanish ishlaydi)
      console.warn('[FaceID] Aksessuar variantlarini hisoblab bo\'lmadi:', err);
    }
    person.photoUrl = this.makeThumbnail(img);
    this.database.push(person);
    this.saveCustomPersons();
    return person;
  }

  /**
   * Rasmni jonli kadrga o'xshash sahnaga (1280x720, yuz ~280 px) joylab, 68 landmark bo'yicha har bir aksessuar variantini
   * chizadi va jonli tanish quvuri bilan embedding oladi. Yuz topilmagan variantlar tashlab ketiladi.
   * Natija bazadagi built-in shaxslar uchun `descriptors-cache.json` ga yoziladi.
   */
  public async buildVariantDescriptors(
    img: HTMLImageElement,
    onProgress?: (done: number, total: number) => void
  ): Promise<{ base: number[]; variants: Record<string, number[]> }> {
    await this.initDatabase();
    const pad = this.padImage(img);
    const found = await faceapi
      .detectAllFaces(pad, new faceapi.TinyFaceDetectorOptions(PHOTO_OPTIONS))
      .withFaceLandmarks();
    if (found.length === 0) throw new Error('Rasmda yuz topilmadi');
    const main = found.reduce((a, b) => (a.detection.box.area >= b.detection.box.area ? a : b));

    const s = SCENE_FACE_PX / main.detection.box.width;
    const scene = document.createElement('canvas');
    scene.width = 1280;
    scene.height = 720;
    const sctx = scene.getContext('2d')!;
    sctx.fillStyle = '#889';
    sctx.fillRect(0, 0, scene.width, scene.height);
    const cx = main.detection.box.x + main.detection.box.width / 2;
    const cy = main.detection.box.y + main.detection.box.height / 2;
    sctx.drawImage(pad, 640 - cx * s, 360 - cy * s, pad.width * s, pad.height * s);

    const detectOne = async (canvas: HTMLCanvasElement) => {
      let r = await faceapi
        .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions(LIVE_OPTIONS))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!r) {
        r = await faceapi
          .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions(LOW_OPTIONS))
          .withFaceLandmarks()
          .withFaceDescriptor();
      }
      return r;
    };

    const base = await detectOne(scene);
    if (!base) throw new Error('Sahnada yuz topilmadi');
    const landmarks: Pt[] = base.landmarks.positions.map((p) => ({ x: p.x, y: p.y }));

    const variants: Record<string, number[]> = {};
    for (let i = 0; i < TRAIN_VARIANTS.length; i++) {
      const name = TRAIN_VARIANTS[i];
      const seed = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      const r = await detectOne(renderVariant(scene, landmarks, name, { seed, k: 1 }));
      if (r) variants[name] = Array.from(r.descriptor);
      onProgress?.(i + 1, TRAIN_VARIANTS.length);
      // Asosiy oqimga nafas berish (sahifa qotib qolmasin)
      await new Promise((res) => setTimeout(res, 0));
    }
    return { base: Array.from(base.descriptor), variants };
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
    // Memorandum 8.3 & 8.4: Shifrlangan AES-256-GCM kiber-vaultdan yuklash
    BiometricCryptoVault.loadSecurePersons().then((saved) => {
      if (Array.isArray(saved)) {
        for (const p of saved) {
          if (p.descriptor?.length === 128 && !this.builtinIds.has(p.id) && !this.database.some(x => x.id === p.id)) {
            this.database.push(p);
          }
        }
      }
    }).catch((err) => {
      console.warn('[FaceID] Shifrlangan biometrik vaultni o\'qishda xatolik:', err);
    });
  }

  private saveCustomPersons(): void {
    // Memorandum 8.3 & 8.4: 128D embeddinglarni AES-256-GCM bilan shifrlab saqlash
    try {
      const custom = this.database.filter((p) => !this.builtinIds.has(p.id));
      BiometricCryptoVault.saveSecurePersons(custom).catch((err) => {
        console.warn('[FaceID] BiometricVault ga saqlashda xato:', err);
      });
    } catch (err) {
      console.warn('[FaceID] Bazani saqlab bo\'lmadi:', err);
    }
  }

  /**
   * Memorandum 8.4: Tarmoq yoki eksport uchun biometrik vektorlari tozalangan ro'yxat
   */
  public getSanitizedDatabase(): Omit<KnownPerson, 'descriptor'>[] {
    return this.database.map(p => BiometricCryptoVault.sanitizePersonForExport(p));
  }

  // Eng yaqin shaxs. Asl rasm 0.5 (LIVE_MATCH_DISTANCE) chegara bilan, aksessuarli shablonlar 0.4 chegara bilan solishtiriladi:
  // har ikkisi chegaraga nisbatan normallanadi (<=1 = qabul), shaxs eng kichik nisbat bo'yicha tanlanadi.
  private nearest(descriptor: ArrayLike<number>): { person: KnownPerson | null; distance: number; accepted: boolean } {
    let best: KnownPerson | null = null;
    let bestRatio = Infinity;
    let secondRatio = Infinity;
    let bestDist = Infinity;
    for (const p of this.database) {
      let baseD = Infinity;
      let occD = Infinity;
      if (p.descriptor) baseD = euclidean(descriptor, p.descriptor);
      if (p.templates) {
        for (const t of p.templates) {
          const d = euclidean(descriptor, t.d);
          if (d < occD) occD = d;
        }
      }
      const ratio = Math.min(baseD / LIVE_MATCH_DISTANCE, occD / OCC_MATCH_DISTANCE);
      if (ratio < bestRatio) {
        secondRatio = bestRatio;
        bestRatio = ratio;
        best = p;
        bestDist = baseD / LIVE_MATCH_DISTANCE <= occD / OCC_MATCH_DISTANCE ? baseD : occD;
      } else if (ratio < secondRatio) {
        secondRatio = ratio;
      }
    }
    // Ikki o'xshash shaxs (masalan qarindoshlar: toza yuzlari orasida masofa 0.478 < 0.5) adashmasligi uchun:
    // eng yaqin shaxs ikkinchisidan yetarlicha ajralib turmasa, bu kadrda ism berilmaydi (noaniq)
    const ambiguous = secondRatio - bestRatio < MIN_RATIO_MARGIN;
    return { person: best, distance: bestDist, accepted: best !== null && bestRatio <= 1 && !ambiguous };
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
      best = { box, votes: [], lastSeen: now, lastCycle: this.cycle, lastDistance: 1 };
      this.tracks.push(best);
    }
    best.box = box;
    best.lastSeen = now;
    best.lastCycle = this.cycle;
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
    return max >= LIVE_VOTE_NEEDED ? winner : null;
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
    this.cycle++;
    this.tracks = this.tracks.filter(
      (t) => this.cycle - t.lastCycle <= TRACK_TTL_CYCLES && now - t.lastSeen < TRACK_MAX_IDLE_MS
    );

    const tDetect = performance.now();
    let faces = await this.detectLive(video, 1, 0, 0);
    this.timings.kadr = Math.round(performance.now() - tDetect);
    this.timings.pad = 0;

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
      const tPad = performance.now();
      const found = await this.detectLive(
        this.padFrame(video, vw, vh),
        PAD_SCALE,
        (vw * (1 - PAD_SCALE)) / 2,
        (vh * (1 - PAD_SCALE)) / 2
      );
      this.timings.pad = Math.round(performance.now() - tPad);
      // Allaqachon topilgan yuzlarni takrorlamaymiz
      faces = faces.concat(found.filter((pf) => !faces.some((f) => centerInside(pf.box, f.box))));
    }

    // Niqob, ko'zoynak, kapyushon taqqan yuzning detektor bahosi past (0.25-0.5), shuning uchun oddiy chegarada topilmaydi.
    // Odam ramkasi bor, lekin yuz topilmagan bo'lsa, past chegara bilan faqat shu ramka ichida qidiramiz (har 2-kadrda, tejash uchun).
    const needLow = personBoxes.filter((pb) => pb.height >= vh * 0.2 && !faces.some((f) => centerInside(f.box, pb)));
    if (needLow.length > 0 && this.cycle % 2 === 0) {
      const low = await this.detectLive(video, 1, 0, 0, LOW_OPTIONS);
      faces = faces.concat(
        low.filter((lf) => needLow.some((pb) => centerInside(lf.box, pb)) && !faces.some((f) => centerInside(lf.box, f.box)))
      );
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
        const { person, distance, accepted } = this.nearest(face.descriptor);
        track.votes.push(person && accepted ? person.id : null);
        if (track.votes.length > LIVE_VOTE_WINDOW) track.votes.shift();
        if (person && accepted) track.lastDistance = distance;
      }
      const id = this.resolveTrack(track);
      const person = id ? this.database.find((p) => p.id === id) ?? null : null;
      return {
        box,
        person,
        confidence: person ? Math.max(0, 1 - track.lastDistance) : null,
        faceFound: !!face,
        // Past baholi yuz ramkasi soxta bo'lishi mumkin: masofa va kalibrovka uchun ishlatilmaydi (tanish baribir ishlaydi)
        faceBox: face && face.score >= MIN_SCORE_FOR_BOX ? face.box : null,
        eyes: face && face.score >= MIN_SCORE_FOR_BOX ? face.eyes : null,
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
    offY: number,
    options: { inputSize: number; scoreThreshold: number } = LIVE_OPTIONS
  ): Promise<LiveFace[]> {
    const results = await faceapi
      .detectAllFaces(input, new faceapi.TinyFaceDetectorOptions(options))
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
  // =========================================================================
  // RobotFaceView (qulf ekrani) bilan moslik: jamoaning asl API si va parametrlari
  // =========================================================================
  private compatOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 });

  /** Modellarni yuklaydi (initDatabase ning ichida). Eski nom saqlangan */
  public async loadModels(): Promise<void> {
    await this.initDatabase();
  }

  public async extractDescriptorFromImage(img: HTMLImageElement | HTMLCanvasElement): Promise<number[] | null> {
    await this.initDatabase();
    try {
      const results = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions(PHOTO_OPTIONS))
        .withFaceLandmarks()
        .withFaceDescriptors();
      if (results.length === 0 && img instanceof HTMLImageElement) return await this.descriptorFromImage(img);
      if (results.length === 0) return null;
      const largest = results.reduce((a, b) => (a.detection.box.area >= b.detection.box.area ? a : b));
      return Array.from(largest.descriptor);
    } catch {
      return null;
    }
  }

  public async extractDescriptorFromUrl(url: string): Promise<number[] | null> {
    try {
      return await this.descriptorFromUrl(url);
    } catch {
      return null;
    }
  }

  public async detectFacesInVideo(video: HTMLVideoElement): Promise<DetectedFace[]> {
    if (!this.ready) return [];
    try {
      const detections = await faceapi
        .detectAllFaces(video, this.compatOptions)
        .withFaceLandmarks()
        .withFaceDescriptors();
      return detections.map((d) => ({
        box: { x: d.detection.box.x, y: d.detection.box.y, width: d.detection.box.width, height: d.detection.box.height },
        score: d.detection.score,
        descriptor: d.descriptor
      }));
    } catch (err) {
      console.warn('[FaceID] Video kadrida yuzlarni aniqlash xatosi:', err);
      return [];
    }
  }

  public euclideanDistance(v1: number[] | Float32Array, v2: number[] | Float32Array): number {
    return euclidean(v1, v2);
  }

  /** Qulf ekrani uchun oddiy moslashtirish: faqat asl rasm, jamoaning 0.58 chegarasi */
  public matchFace(descriptor: Float32Array | number[]): FaceMatchResult {
    let bestPerson: KnownPerson | null = null;
    let minDistance = Infinity;
    for (const person of this.database) {
      if (!person.descriptor || person.descriptor.length === 0) continue;
      const dist = euclidean(descriptor, person.descriptor);
      if (dist < minDistance) {
        minDistance = dist;
        bestPerson = person;
      }
    }
    if (bestPerson && minDistance <= MATCH_DISTANCE) {
      const confidence = Math.min(0.98, Math.max(0.8, +(1.0 - minDistance * 0.35).toFixed(2)));
      return { person: bestPerson, isIdentified: true, confidence, distance: +minDistance.toFixed(3) };
    }
    return { person: null, isIdentified: false, confidence: 0, distance: minDistance === Infinity ? 1.0 : +minDistance.toFixed(3) };
  }

  public votePerson(trackKey: string, matchedPersonId: string | null): string | null {
    if (!this.voteHistory.has(trackKey)) this.voteHistory.set(trackKey, []);
    const history = this.voteHistory.get(trackKey)!;
    history.push(matchedPersonId || '__PEDESTRIAN__');
    if (history.length > VOTE_WINDOW) history.shift();
    if (matchedPersonId && history.filter((id) => id === matchedPersonId).length >= VOTE_NEEDED) return matchedPersonId;
    return null;
  }

  public pruneVoteHistory(activeKeys: Set<string>) {
    for (const key of this.voteHistory.keys()) {
      if (!activeKeys.has(key)) this.voteHistory.delete(key);
    }
  }
}

export const faceRecognitionService = new FaceRecognitionEngine();
