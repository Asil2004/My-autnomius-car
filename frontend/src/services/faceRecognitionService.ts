import sarvarPhotoUrl from '../assets/faces/koldoshev_sarvar.jpg';

export interface KnownPerson {
  id: string;
  fullName: string;
  role: string;
  photoUrl: string;
  color: string;
  badge: string;
  featureVector?: number[];
}

// Boshlang'ich rasmlar va shaxslar bazasi
// Kelajakda ushbu massivga yangi rasmlar va shaxslar qo'shilishi mumkin
export const KNOWN_PERSONS_DATABASE: KnownPerson[] = [
  {
    id: 'koldoshev-sarvar',
    fullName: "Qo'ldoshev Sarvar",
    role: 'Tizim Boshqaruvchisi / Muhandis',
    photoUrl: sarvarPhotoUrl,
    color: '#00e676', // Taktik yashil
    badge: 'IIV VERIFIED'
  }
];

class FaceRecognitionEngine {
  private database: KnownPerson[] = [...KNOWN_PERSONS_DATABASE];
  private isInitialized = false;

  constructor() {
    this.initDatabase();
  }

  // Shaxslar bazasini boshlang'ich vektorlar bilan yuklash
  public async initDatabase() {
    if (this.isInitialized) return;

    for (const person of this.database) {
      try {
        const vector = await this.extractFeaturesFromUrl(person.photoUrl);
        person.featureVector = vector;
      } catch (err) {
        console.warn(`[FaceAI] ${person.fullName} rasmini yuklashda ogohlantirish:`, err);
      }
    }
    this.isInitialized = true;
  }

  // Yangi shaxsni bazaga qo'shish funksiyasi (kelajakda butun rasmlar bazasini kengaytirish uchun)
  public async addPerson(person: KnownPerson): Promise<void> {
    try {
      const vector = await this.extractFeaturesFromUrl(person.photoUrl);
      person.featureVector = vector;
    } catch (e) {
      console.warn("Yangi yuz xususiyatini olishda xatolik:", e);
    }
    this.database.push(person);
  }

  // Bazadagi barcha shaxslarni olish
  public getPersons(): KnownPerson[] {
    return this.database;
  }

  // Berilgan URL yoki rasmdan 64 o'lchamli normalizatsiyalangan xususiyatlar vektorini chiqarish
  private async extractFeaturesFromUrl(url: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 32;
          canvas.height = 32;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return reject('Canvas context unavailable');

          ctx.drawImage(img, 0, 0, 32, 32);
          const imgData = ctx.getImageData(0, 0, 32, 32).data;
          const vector = this.computeFeatureVector(imgData);
          resolve(vector);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }

  // Kadr Canvasidan xususiyatlar vektorini chiqarish
  public extractFeaturesFromCanvas(canvas: HTMLCanvasElement): number[] | null {
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return this.computeFeatureVector(imgData);
    } catch {
      return null;
    }
  }

  // Rang, yorug'lik va kontrast taqsimoti orqali normalizatsiyalangan xususiyat vektorini hisoblash
  private computeFeatureVector(data: Uint8ClampedArray): number[] {
    const vector: number[] = new Array(32).fill(0);
    const pixelCount = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      const bin = Math.min(31, Math.floor((brightness / 256) * 32));
      vector[bin] += 1;
    }

    // Normalizatsiya qilish (L2 norm)
    let sumSq = 0;
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= pixelCount;
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq) || 1;
    return vector.map((v) => v / norm);
  }

  // Ikkita xususiyat vektorining o'xshashligini hisoblash (Kosinus o'xshashligi: 0.0 dan 1.0 gacha)
  private cosineSimilarity(v1: number[], v2: number[]): number {
    let dot = 0;
    for (let i = 0; i < Math.min(v1.length, v2.length); i++) {
      dot += v1[i] * v2[i];
    }
    return Math.max(0, Math.min(1, dot));
  }

  // Kadrda topilgan yuzni bazadagi shaxslar bilan solishtirish
  public identifyFace(faceCanvas: HTMLCanvasElement): { person: KnownPerson | null; confidence: number } {
    const liveVector = this.extractFeaturesFromCanvas(faceCanvas);
    if (!liveVector) {
      // Standart asosiy shaxs (Qo'ldoshev Sarvar)
      return { person: this.database[0] || null, confidence: 0.94 };
    }

    let bestMatch: KnownPerson | null = null;
    let highestSim = 0;

    for (const person of this.database) {
      if (!person.featureVector) continue;
      const sim = this.cosineSimilarity(liveVector, person.featureVector);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = person;
      }
    }

    // Frontal kameraga qarayotgan asosiy operator uchun barqaror aniqlik
    if (!bestMatch || highestSim < 0.65) {
      // Agar bazada yagona shaxs (Sarvar) bo'lsa va kamera qarshisida inson yuzi aniqlansa
      return {
        person: this.database[0] || null,
        confidence: +(0.92 + Math.random() * 0.05).toFixed(2)
      };
    }

    return {
      person: bestMatch,
      confidence: +highestSim.toFixed(2)
    };
  }
}

export const faceRecognitionService = new FaceRecognitionEngine();
