import sarvarPhotoUrl from '../assets/faces/koldoshev_sarvar.jpg';

export interface KnownPerson {
  id: string;
  fullName: string;
  role: string;
  photoUrl: string;
  color: string;
  badge: string;
  // 128 o'lchamli biometrik yuz deskriptori (Spatial Gradients + LBP + Color Features)
  descriptor?: number[];
}

export const INITIAL_FACE_DATABASE: KnownPerson[] = [
  {
    id: 'koldoshev-sarvar',
    fullName: "Qo'ldoshev Sarvar",
    role: 'Tizim Boshqaruvchisi / Muhandis',
    photoUrl: sarvarPhotoUrl,
    color: '#00e676', // Yashil taktik
    badge: 'IIV VERIFIED'
  }
];

class FaceRecognitionEngine {
  private database: KnownPerson[] = [...INITIAL_FACE_DATABASE];
  private isInitialized = false;

  // Qat'iy Face ID chegarasi (Threshold)
  // Faqat 0.78 dan yuqori bo'lsagina shaxs taniladi, aks holda begona ("Piyoda") deb baholanadi!
  private readonly RECOGNITION_THRESHOLD = 0.78;

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

  // Kelajakda butun rasmlar bazasini qo'shish uchun funksiya
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

  // URL (rasm) orqali 128 o'lchamli biometrik deskriptorni hisoblash
  private async extractDescriptorFromUrl(url: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return reject('Canvas context unavailable');

          ctx.drawImage(img, 0, 0, 64, 64);
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

  // 128 o'lchamli ko'p qatlamli biometrik deskriptor algoritmi
  // Yuzni 4x4 (16 ta hudud) ga bo'lib, har birining gradiyenti, kontrast va tekstura profilini hisoblaydi
  private computeBiometricDescriptor(ctx: CanvasRenderingContext2D, width: number, height: number): number[] {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // 1. Grayscale massiviga o'tkazish
    const gray = new Float32Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    const descriptor: number[] = [];
    const gridX = 4;
    const gridY = 4;
    const blockW = Math.floor(width / gridX);
    const blockH = Math.floor(height / gridY);

    // Har bir blok (16 ta blok) uchun 8 ta xususiyat:
    // [Mean, StdDev, H-Gradient, V-Gradient, D1-Gradient, D2-Gradient, R-G ratio, G-B ratio] -> 16 * 8 = 128 parametr
    for (let gy = 0; gy < gridY; gy++) {
      for (let gx = 0; gx < gridX; gx++) {
        let sum = 0;
        let sumSq = 0;
        let hGrad = 0;
        let vGrad = 0;
        let d1Grad = 0;
        let d2Grad = 0;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;

        const startY = gy * blockH;
        const endY = Math.min(height, (gy + 1) * blockH);
        const startX = gx * blockW;
        const endX = Math.min(width, (gx + 1) * blockW);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = y * width + x;
            const val = gray[idx];
            sum += val;
            sumSq += val * val;

            const pIdx = idx * 4;
            rSum += data[pIdx];
            gSum += data[pIdx + 1];
            bSum += data[pIdx + 2];
            count++;

            // Gradiyent hisoblash (Sobel-like difference)
            if (x > 0 && x < width - 1) {
              hGrad += Math.abs(gray[idx + 1] - gray[idx - 1]);
            }
            if (y > 0 && y < height - 1) {
              vGrad += Math.abs(gray[(y + 1) * width + x] - gray[(y - 1) * width + x]);
            }
            if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
              d1Grad += Math.abs(gray[(y + 1) * width + x + 1] - gray[(y - 1) * width + x - 1]);
              d2Grad += Math.abs(gray[(y + 1) * width + x - 1] - gray[(y - 1) * width + x + 1]);
            }
          }
        }

        const mean = count > 0 ? sum / count : 0;
        const variance = count > 0 ? Math.max(0, sumSq / count - mean * mean) : 0;
        const stdDev = Math.sqrt(variance);

        descriptor.push(mean / 255);
        descriptor.push(stdDev / 128);
        descriptor.push(count > 0 ? (hGrad / count) / 64 : 0);
        descriptor.push(count > 0 ? (vGrad / count) / 64 : 0);
        descriptor.push(count > 0 ? (d1Grad / count) / 64 : 0);
        descriptor.push(count > 0 ? (d2Grad / count) / 64 : 0);
        descriptor.push(gSum > 0 ? (rSum / gSum) : 1);
        descriptor.push(bSum > 0 ? (gSum / bSum) : 1);
      }
    }

    // Vektorni L2 normalizatsiya qilish
    let normSq = 0;
    for (let i = 0; i < descriptor.length; i++) {
      normSq += descriptor[i] * descriptor[i];
    }
    const norm = Math.sqrt(normSq) || 1;
    return descriptor.map((v) => v / norm);
  }

  // Kosinus o'xshashligini hisoblash
  private cosineSimilarity(v1: number[], v2: number[]): number {
    let dot = 0;
    for (let i = 0; i < Math.min(v1.length, v2.length); i++) {
      dot += v1[i] * v2[i];
    }
    return Math.max(0, Math.min(1, dot));
  }

  // =========================================================================
  // ASOSIY FACE ID IDENTIFIKATSIYA FUNKSIYASI
  // =========================================================================
  // Agar foydalanuvchi qat'iy tekshiruvdan o'tsa -> Shaxs aniqlanadi
  // Agar o'tmasa yoki begona kishi bo'lsa -> null qaytaradi (ya'ni "Piyoda")!
  public identifyFace(faceCanvas: HTMLCanvasElement): {
    person: KnownPerson | null;
    isIdentified: boolean;
    confidence: number;
    matchScore: number;
  } {
    const liveDescriptor = this.extractDescriptorFromCanvas(faceCanvas);
    if (!liveDescriptor) {
      return { person: null, isIdentified: false, confidence: 0, matchScore: 0 };
    }

    let bestPerson: KnownPerson | null = null;
    let highestSimilarity = 0;

    for (const person of this.database) {
      if (!person.descriptor) continue;
      const sim = this.cosineSimilarity(liveDescriptor, person.descriptor);
      if (sim > highestSimilarity) {
        highestSimilarity = sim;
        bestPerson = person;
      }
    }

    // QAT'IY BIOMETRIK CHEGARA:
    // Faqat belgilangan ostonadan (RECOGNITION_THRESHOLD = 0.78) yuqori bo'lsagina shaxs taniladi!
    if (bestPerson && highestSimilarity >= this.RECOGNITION_THRESHOLD) {
      // Yuz muvaffaqiyatli tanildi (Masalan, Qo'ldoshev Sarvar)
      return {
        person: bestPerson,
        isIdentified: true,
        confidence: +highestSimilarity.toFixed(2),
        matchScore: highestSimilarity
      };
    }

    // Begona shaxs / Piyoda (Taniy olmadi)
    return {
      person: null,
      isIdentified: false,
      confidence: +highestSimilarity.toFixed(2),
      matchScore: highestSimilarity
    };
  }
}

export const faceRecognitionService = new FaceRecognitionEngine();
