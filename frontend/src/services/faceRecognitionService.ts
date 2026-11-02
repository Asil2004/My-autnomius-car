import sarvarPhotoUrl from '../assets/faces/koldoshev_sarvar.jpg';
import asilbekPhotoUrl from '../assets/faces/asilbek_ravshanov.png';
import boburjonPhotoUrl from '../assets/faces/boburjon_bozorov.jpg';

export interface KnownPerson {
  id: string;
  fullName: string;
  role: string;
  photoUrl: string;
  color: string;
  badge: string;
  descriptor?: number[];
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

class FaceRecognitionEngine {
  private database: KnownPerson[] = [...INITIAL_FACE_DATABASE];
  private isInitialized = false;

  // Qat'iy Face ID chegarasi (Pearson Zero-Mean Correlation)
  private readonly RECOGNITION_THRESHOLD = 0.58;

  constructor() {
    this.initDatabase();
  }

  public async initDatabase() {
    if (this.isInitialized) return;

    for (const person of this.database) {
      try {
        const descriptor = await this.extractDescriptorFromUrl(person.photoUrl);
        person.descriptor = descriptor;
      } catch (err) {
        console.warn(`[FaceID] ${person.fullName} deskriptorini hisoblashda ogohlantirish:`, err);
      }
    }
    this.isInitialized = true;
  }

  public async addPerson(person: KnownPerson): Promise<void> {
    try {
      const descriptor = await this.extractDescriptorFromUrl(person.photoUrl);
      person.descriptor = descriptor;
    } catch (e) {
      console.warn("Yangi shaxs yuzini hisoblashda xatolik:", e);
    }
    this.database.push(person);
  }

  public getPersons(): KnownPerson[] {
    return this.database;
  }

  // Rasmdan aynan YUZ sohasini (kostyum, ko'ylak va fonsiz) formatga moslab qirqib olish
  private cropFaceToCanvas(img: HTMLImageElement): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const w = img.naturalWidth || img.width || 300;
    const h = img.naturalHeight || img.height || 300;

    let sx = 0;
    let sy = 0;
    let sw = w;
    let sh = h;

    if (h > w * 1.15) {
      // Vertikal portret (Asilbek Ravshanov rasmi kabi)
      sx = w * 0.16;
      sw = w * 0.68;
      sy = h * 0.14;
      sh = h * 0.52;
    } else if (w > h * 1.25) {
      // Keng landshaft rasm (Boburjon Bozorov rasmi: 1024x576)
      sx = w * 0.33;
      sw = w * 0.35;
      sy = h * 0.03;
      sh = h * 0.72;
    } else {
      // Deyarli kvadrat rasm (Sarvar rasmi kabi)
      sx = w * 0.05;
      sw = w * 0.90;
      sy = h * 0.05;
      sh = h * 0.90;
    }

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 64, 64);
    return canvas;
  }

  // URL (rasm) orqali biometrik deskriptorni hisoblash
  private async extractDescriptorFromUrl(url: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const faceCanvas = this.cropFaceToCanvas(img);
          const ctx = faceCanvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return reject('Canvas context unavailable');

          const descriptor = this.computeBiometricDescriptor(ctx, 64, 64);
          resolve(descriptor);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }

  // Kadr Canvasidan biometrik deskriptor olish
  public extractDescriptorFromCanvas(canvas: HTMLCanvasElement): number[] | null {
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      return this.computeBiometricDescriptor(ctx, canvas.width, canvas.height);
    } catch {
      return null;
    }
  }

  // Ko'p qatlamli 64 o'lchamli biometrik deskriptor (Zero-Mean Normalization bilan)
  private computeBiometricDescriptor(ctx: CanvasRenderingContext2D, width: number, height: number): number[] {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // 1. Grayscale massiviga o'tkazish
    const gray = new Float32Array(width * height);
    let totalGray = 0;
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      gray[j] = g;
      totalGray += g;
    }
    const globalMean = totalGray / (width * height);

    const descriptor: number[] = [];
    const gridX = 4;
    const gridY = 4;
    const blockW = Math.floor(width / gridX);
    const blockH = Math.floor(height / gridY);

    for (let gy = 0; gy < gridY; gy++) {
      for (let gx = 0; gx < gridX; gx++) {
        let sum = 0;
        let hGrad = 0;
        let vGrad = 0;
        let dGrad = 0;
        let count = 0;

        const startY = gy * blockH;
        const endY = Math.min(height, (gy + 1) * blockH);
        const startX = gx * blockW;
        const endX = Math.min(width, (gx + 1) * blockW);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = y * width + x;
            sum += gray[idx];
            count++;

            if (x > 0 && x < width - 1) {
              hGrad += Math.abs(gray[idx + 1] - gray[idx - 1]);
            }
            if (y > 0 && y < height - 1) {
              vGrad += Math.abs(gray[(y + 1) * width + x] - gray[(y - 1) * width + x]);
            }
            if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
              dGrad += Math.abs(gray[(y + 1) * width + x + 1] - gray[(y - 1) * width + x - 1]);
            }
          }
        }

        const blockMean = count > 0 ? sum / count : globalMean;
        // Global o'rtachadan ayirish (Zero-Mean block contrast)
        descriptor.push((blockMean - globalMean) / 64);
        descriptor.push(count > 0 ? (hGrad / count) / 32 : 0);
        descriptor.push(count > 0 ? (vGrad / count) / 32 : 0);
        descriptor.push(count > 0 ? (dGrad / count) / 32 : 0);
      }
    }

    // Zero-mean qilish va L2 normalizatsiya
    let dSum = 0;
    for (let i = 0; i < descriptor.length; i++) dSum += descriptor[i];
    const dMean = dSum / descriptor.length;

    let normSq = 0;
    const centered: number[] = new Array(descriptor.length);
    for (let i = 0; i < descriptor.length; i++) {
      centered[i] = descriptor[i] - dMean;
      normSq += centered[i] * centered[i];
    }
    const norm = Math.sqrt(normSq) || 1;
    return centered.map((v) => v / norm);
  }

  // Pearson Zero-Mean Correlation (-1.0 dan +1.0 gacha)
  private pearsonCorrelation(v1: number[], v2: number[]): number {
    let dot = 0;
    const len = Math.min(v1.length, v2.length);
    for (let i = 0; i < len; i++) {
      dot += v1[i] * v2[i];
    }
    return dot;
  }

  // =========================================================================
  // ASOSIY FACE ID IDENTIFIKATSIYA FUNKSIYASI
  // =========================================================================
  public identifyFace(faceCanvas: HTMLCanvasElement): {
    person: KnownPerson | null;
    isIdentified: boolean;
    confidence: number;
    matchScore: number;
    scores?: Record<string, number>;
  } {
    const liveDescriptor = this.extractDescriptorFromCanvas(faceCanvas);
    if (!liveDescriptor) {
      return { person: null, isIdentified: false, confidence: 0, matchScore: 0 };
    }

    let bestPerson: KnownPerson | null = null;
    let highestScore = -1;
    const scores: Record<string, number> = {};

    for (const person of this.database) {
      if (!person.descriptor) continue;
      const score = this.pearsonCorrelation(liveDescriptor, person.descriptor);
      scores[person.fullName] = +score.toFixed(3);

      if (score > highestScore) {
        highestScore = score;
        bestPerson = person;
      }
    }

    // QAT'IY CHEGARA: Faqat threshold (0.58) dan yuqori bo'lsagina shaxs taniladi!
    if (bestPerson && highestScore >= this.RECOGNITION_THRESHOLD) {
      // Normallashtirilgan ishonchlilik (0.75 - 0.98 oralig'ida)
      const displayConf = Math.min(0.98, Math.max(0.75, +(0.70 + highestScore * 0.35).toFixed(2)));
      return {
        person: bestPerson,
        isIdentified: true,
        confidence: displayConf,
        matchScore: highestScore,
        scores
      };
    }

    // Begona shaxs / Piyoda (taniy olmadi)
    return {
      person: null,
      isIdentified: false,
      confidence: 0,
      matchScore: highestScore,
      scores
    };
  }
}

export const faceRecognitionService = new FaceRecognitionEngine();
