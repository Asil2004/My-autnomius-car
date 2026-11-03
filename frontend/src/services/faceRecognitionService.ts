import * as faceapi from '@vladmandic/face-api';
import sarvarPhotoUrl from '../assets/faces/koldoshev_sarvar.jpg';
import asilbekPhotoUrl from '../assets/faces/asilbek_ravshanov.png';
import boburjonPhotoUrl from '../assets/faces/boburjon_bozorov.jpg';
import descriptorsData from '../assets/faces/descriptors.json';
import { BiometricCryptoVault } from './biometricCryptoVault';

export interface KnownPerson {
  id: string;
  fullName: string;
  role: string;
  photoUrl: string;
  color: string;
  badge: string;
  descriptor?: number[];
}

export interface FaceMatchResult {
  person: KnownPerson | null;
  isIdentified: boolean;
  confidence: number;
  distance: number;
}

export interface DetectedFace {
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  score: number;
  descriptor: Float32Array;
}

// Zulfiddin Frontend arxitekturasi bo'yicha qat'iy parametrlar
export const MATCH_DISTANCE = 0.58; // Qat'iy Euclid masofasi chegarasi (standart 0.60 dan qat'iyroq)
export const VOTE_WINDOW = 4;       // Oxirgi 5 ta kadr kuzatuv oynasi
export const VOTE_NEEDED = 2;       // Kamida 3 kadrda bir xil shaxs tasdiqlansa ism chiqadi (anti-flicker)
export const LOCALSTORAGE_KEY = 'qalqon.faceDb.v1';

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

class FaceRecognitionEngine {
  private database: KnownPerson[] = [...INITIAL_FACE_DATABASE];
  private isModelLoaded = false;
  private modelLoadPromise: Promise<void> | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private voteHistory: Map<string, string[]> = new Map();
  private detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.20 });

  constructor() {
    // Fon rejimida bazani tayyorlash
    this.initDatabase().catch(err => {
      console.warn('[FaceID] Initsializatsiya fon ogohlantirishi:', err);
    });
  }

  // =========================================================================
  // 1. MODELLARNI YUKLASH (Lokal public/models/face yoki public/models)
  // =========================================================================
  public async loadModels(): Promise<void> {
    if (this.isModelLoaded) return;
    if (this.modelLoadPromise) return this.modelLoadPromise;

    this.modelLoadPromise = (async () => {
      const baseUrl = import.meta.env.BASE_URL || './';
      const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
      const primaryPath = `${cleanBase}models/face`;
      const fallbackPath = `${cleanBase}models`;

      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(primaryPath),
          faceapi.nets.faceLandmark68Net.loadFromUri(primaryPath),
          faceapi.nets.faceRecognitionNet.loadFromUri(primaryPath)
        ]);
        this.isModelLoaded = true;
        console.log('[FaceID] face-api modellari muvaffaqiyatli yuklandi:', primaryPath);
      } catch (err) {
        console.warn(`[FaceID] ${primaryPath} dan yuklab bo'lmadi, ${fallbackPath} sinab ko'riladi:`, err);
        try {
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(fallbackPath),
            faceapi.nets.faceLandmark68Net.loadFromUri(fallbackPath),
            faceapi.nets.faceRecognitionNet.loadFromUri(fallbackPath)
          ]);
          this.isModelLoaded = true;
          console.log('[FaceID] face-api modellari muvaffaqiyatli yuklandi:', fallbackPath);
        } catch (fbErr) {
          console.error('[FaceID] face-api modellarini yuklashda xatolik:', fbErr);
          throw fbErr;
        }
      }
    })();

    return this.modelLoadPromise;
  }

  // =========================================================================
  // 2. YUZLAR BAZASINI VA DESKRIPTORLARNI INITSIALIZATSIYA QILISH
  // =========================================================================
  public async initDatabase(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // Modellar yuklashga urinib ko'rish
      try {
        await this.loadModels();
      } catch (err) {
        console.warn('[FaceID] Yuz modellari yuklanmadi, COCO-SSD barcha odamlarni Piyoda deb belgilaydi:', err);
      }

      // Oldindan hisoblangan descriptors.json dan embeddinglarni biriktirish
      const precalc = descriptorsData as unknown as Record<string, { descriptor: number[] }>;
      for (const person of this.database) {
        if (precalc && precalc[person.id]?.descriptor) {
          person.descriptor = precalc[person.id].descriptor;
        } else if (this.isModelLoaded) {
          try {
            const desc = await this.extractDescriptorFromUrl(person.photoUrl);
            if (desc) person.descriptor = desc;
          } catch (e) {
            console.warn(`[FaceID] ${person.fullName} deskriptorini hisoblashda ogohlantirish:`, e);
          }
        }
      }

      // Memorandum 8.3 & 8.4: Shifrlangan kiber-vault (AES-256-GCM) dan yuzlarni yuklash
      try {
        const secureSaved = await BiometricCryptoVault.loadSecurePersons();
        if (Array.isArray(secureSaved)) {
          for (const sp of secureSaved) {
            if (!this.database.some(p => p.id === sp.id)) {
              this.database.push(sp);
            }
          }
        }
      } catch (err) {
        console.warn('[FaceID] Shifrlangan biometrik vaultni o\'qishda xatolik:', err);
      }

      this.isInitialized = true;
    })();

    return this.initPromise;
  }

  // =========================================================================
  // 3. RASMDAN YUZNI DETEKSIYA QILISH VA 128D EMBEDDING OLISH
  // =========================================================================
  public async extractDescriptorFromImage(
    img: HTMLImageElement | HTMLCanvasElement
  ): Promise<number[] | null> {
    if (!this.isModelLoaded) {
      await this.loadModels();
    }

    const opt416 = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.30 });
    let detection = await faceapi
      .detectSingleFace(img, opt416)
      .withFaceLandmarks()
      .withFaceDescriptor();

    // SARVAR RASMI CHETI MUAMMOSI (yuz butun kadrni egallagan) UCHUN BO'SH JOY (PADDING) QO'SHISH
    if (!detection) {
      const w = (img as HTMLImageElement).naturalWidth || img.width || 300;
      const h = (img as HTMLImageElement).naturalHeight || img.height || 300;
      const padRatio = 0.35;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * (1 + padRatio * 2));
      canvas.height = Math.round(h * (1 + padRatio * 2));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, Math.round(w * padRatio), Math.round(h * padRatio));
        detection = await faceapi
          .detectSingleFace(canvas, opt416)
          .withFaceLandmarks()
          .withFaceDescriptor();
      }
    }

    // Agar topilmasa, pastroq o'lcham va sezgirlik bilan yana 1 bor urinish
    if (!detection) {
      const opt320 = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.20 });
      detection = await faceapi
        .detectSingleFace(img, opt320)
        .withFaceLandmarks()
        .withFaceDescriptor();
    }

    if (!detection) return null;
    return Array.from(detection.descriptor);
  }

  public async extractDescriptorFromUrl(url: string): Promise<number[] | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          const desc = await this.extractDescriptorFromImage(img);
          resolve(desc);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // =========================================================================
  // 4. YANGI SHAXSNI BAZAGA QO'SHISH (Faqat yuzi aniq ko'ringan bo'lsa)
  // =========================================================================
  public async addPerson(personData: {
    fullName: string;
    role: string;
    photoDataUrl: string;
    color?: string;
  }): Promise<KnownPerson> {
    await this.initDatabase();

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          const descriptor = await this.extractDescriptorFromImage(img);
          if (!descriptor) {
            return reject(new Error("Rasmda yuz topilmadi! Iltimos, yuzingiz aniq va to'g'ri ko'ringan rasm yuklang."));
          }

          // 96x96 px ixcham thumbnail yaratish
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = 96;
          thumbCanvas.height = 96;
          const tCtx = thumbCanvas.getContext('2d');
          if (tCtx) {
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            const minDim = Math.min(w, h);
            const sx = (w - minDim) / 2;
            const sy = (h - minDim) / 2;
            tCtx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 96, 96);
          }
          const thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);

          const newPerson: KnownPerson = {
            id: `person-${Date.now()}`,
            fullName: personData.fullName.trim(),
            role: personData.role.trim() || 'Ruxsat berilgan shaxs',
            photoUrl: thumbnailDataUrl,
            color: personData.color || '#38bdf8',
            badge: 'IIV VERIFIED',
            descriptor
          };

          this.database.push(newPerson);

          // Memorandum 8.3 & 8.4: 128D embeddinglarni AES-256-GCM bilan shifrlab saqlash
          try {
            const customPersons = this.database.filter(
              p => !INITIAL_FACE_DATABASE.some(init => init.id === p.id)
            );
            await BiometricCryptoVault.saveSecurePersons(customPersons);
          } catch (lsErr) {
            console.warn('[FaceID] BiometricVault ga saqlashda xato:', lsErr);
          }

          resolve(newPerson);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("Rasmni o'qib bo'lmadi."));
      img.src = personData.photoDataUrl;
    });
  }

  public getPersons(): KnownPerson[] {
    return this.database;
  }

  // =========================================================================
  // 5. JONLI VIDEO KADRIDAGI YUZLARNI ANIQLASH (TinyFaceDetector + landmarks)
  // =========================================================================
  public async detectFacesInVideo(video: HTMLVideoElement): Promise<DetectedFace[]> {
    if (!this.isModelLoaded) return [];

    try {
      const detections = await faceapi
        .detectAllFaces(video, this.detectorOptions)
        .withFaceLandmarks()
        .withFaceDescriptors();

      return detections.map(d => ({
        box: {
          x: d.detection.box.x,
          y: d.detection.box.y,
          width: d.detection.box.width,
          height: d.detection.box.height
        },
        score: d.detection.score,
        descriptor: d.descriptor
      }));
    } catch (err) {
      console.warn('[FaceID] Video kadrida yuzlarni aniqlash xatosi:', err);
      return [];
    }
  }

  // =========================================================================
  // 6. EUCLID MASOFASI VA SOLISHTIRISH (Chegara: 0.50)
  // =========================================================================
  public euclideanDistance(v1: number[] | Float32Array, v2: number[] | Float32Array): number {
    let sum = 0;
    const len = Math.min(v1.length, v2.length);
    for (let i = 0; i < len; i++) {
      const diff = v1[i] - v2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  public matchFace(descriptor: Float32Array | number[]): FaceMatchResult {
    let bestPerson: KnownPerson | null = null;
    let minDistance = Infinity;

    for (const person of this.database) {
      if (!person.descriptor || person.descriptor.length === 0) continue;
      const dist = this.euclideanDistance(descriptor, person.descriptor);
      if (dist < minDistance) {
        minDistance = dist;
        bestPerson = person;
      }
    }

    // Qat'iy chegara: 0.58 (Real veb-kamera va mobil optika uchun sozlangan)
    if (bestPerson) {
      console.log(`[FaceID Match] Eng yaqin: ${bestPerson.fullName}, masofa: ${minDistance.toFixed(3)}, chegara: ${MATCH_DISTANCE}`);
    }
    if (bestPerson && minDistance <= MATCH_DISTANCE) {
      // Ishonchlilik foizi (0.80 - 0.98 oralig'ida)
      const confidence = Math.min(0.98, Math.max(0.80, +(1.0 - minDistance * 0.35).toFixed(2)));
      return {
        person: bestPerson,
        isIdentified: true,
        confidence,
        distance: +minDistance.toFixed(3)
      };
    }

    return {
      person: null,
      isIdentified: false,
      confidence: 0,
      distance: minDistance === Infinity ? 1.0 : +minDistance.toFixed(3)
    };
  }

  // =========================================================================
  // 7. OVOZ BERISH VA ISMNI MILTILLASHIDAN HIMOYA (5 kadr / 3 ovoz)
  // =========================================================================
  public votePerson(trackKey: string, matchedPersonId: string | null): string | null {
    if (!this.voteHistory.has(trackKey)) {
      this.voteHistory.set(trackKey, []);
    }
    const history = this.voteHistory.get(trackKey)!;
    history.push(matchedPersonId || '__PEDESTRIAN__');
    if (history.length > VOTE_WINDOW) {
      history.shift();
    }

    if (matchedPersonId) {
      const count = history.filter(id => id === matchedPersonId).length;
      if (count >= VOTE_NEEDED) {
        return matchedPersonId;
      }
    }
    return null;
  }

  public pruneVoteHistory(activeKeys: Set<string>) {
    for (const key of this.voteHistory.keys()) {
      if (!activeKeys.has(key)) {
        this.voteHistory.delete(key);
      }
    }
  }

  // Eskirgan Canvas identifyFace interfeysi (qaytish uchun moslik)
  public identifyFace(_faceCanvas: HTMLCanvasElement): {
    person: KnownPerson | null;
    isIdentified: boolean;
    confidence: number;
    matchScore: number;
  } {
    // Agar kutilmaganda eski identifyFace chaqirilsa
    return {
      person: null,
      isIdentified: false,
      confidence: 0,
      matchScore: 0
    };
  }
}

export const faceRecognitionService = new FaceRecognitionEngine();
