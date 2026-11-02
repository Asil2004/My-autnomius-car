export type DistanceSource = 'face' | 'body' | 'vehicle' | 'sonar';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DistanceInput {
  /** COCO klassi: person, car, truck, bus, motorcycle, bicycle */
  cls: string;
  /** Obyekt ramkasi, video piksellarida */
  box: Box;
  /** Odam yuzi ramkasi (face-api), video piksellarida. Yuz topilmagan bo'lsa undefined */
  faceBox?: Box;
  frameWidth: number;
  frameHeight: number;
  /** Oldingi sonar (sm). Faqat haqiqiy datchik ma'lumoti bo'lsagina beriladi */
  sonarFrontCm?: number;
}

export interface DistanceResult {
  meters: number;
  source: DistanceSource;
  /** Taxminiy: ramka kadr chetiga tegib kesilgan (odam gavdasi bo'yicha) */
  approx: boolean;
  /** Haqiqiy masofa ko'rsatilganidan KICHIK yoki teng (odam kadrni to'ldirgan, yuz topilmagan) */
  upperBound?: boolean;
}

// Haqiqiy o'lchamlar (metr). Pinhole modeli: masofa = haqiqiy_o'lcham * fokus_px / piksel_o'lcham
const REAL_HEIGHT_M: Record<string, number> = {
  person: 1.7,
  car: 1.5,
  truck: 3.0,
  bus: 3.2,
  motorcycle: 1.4,
  bicycle: 1.1
};
// face-api yuz ramkasi taxminan peshonadan iyakkacha, quloqdan quloqqacha qismni qamraydi
const FACE_WIDTH_M = 0.16;
// Ko'zlarning tashqi burchaklari orasidagi o'rtacha masofa (kattalarda ~9 sm, odamdan odamga kam farq qiladi)
const EYE_SPAN_M = 0.09;
const eyeKey = (camKey: string) => `${camKey}:eye`;

// Kamerasi kalibrovka qilinmagan holda: vertikal ko'rish burchagi ~45° (oddiy veb-kamera). fokus = (H/2) / tan(vFOV/2)
const DEFAULT_FOCAL_REL = 0.5 / Math.tan((45 * Math.PI) / 180 / 2);
const STORAGE_KEY = 'qalqon.camCalib.v1';
// Ruxsat etilgan fokus (kadr balandligiga nisbatan): vFOV 75° dan 25° gacha
const MIN_FOCAL_REL = 0.5 / Math.tan((75 * Math.PI) / 180 / 2);
const MAX_FOCAL_REL = 0.5 / Math.tan((25 * Math.PI) / 180 / 2);
// Yelkalar kengligi: odam kadrga sig'masdan yaqin turganda gavda balandligi o'rniga ishlatiladi
const SHOULDER_WIDTH_M = 0.45;

const MIN_M = 0.3;
const MAX_M = 30;

// Sonar faqat obyekt kadr markazida bo'lsa va kamera hisobiga mos kelsa ishlatiladi
const SONAR_MAX_CM = 400;
const SONAR_CENTER_BAND = 0.18; // kadr kengligining markazdan ±18%
const SONAR_AGREE_RATIO = 0.5; // kamera bahosidan ±50% ichida

const SMOOTH_WINDOW = 5;
const TRACK_TTL_MS = 1500;
const TRACK_MIN_IOU = 0.25;

interface Track {
  box: Box;
  values: number[];
  lastSeen: number;
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

class DistanceEstimator {
  private focalRel: Record<string, number> = {};
  private tracks: Track[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, number>;
        for (const [key, rel] of Object.entries(saved)) {
          if (rel >= MIN_FOCAL_REL && rel <= MAX_FOCAL_REL) this.focalRel[key] = rel;
        }
      }
    } catch {
      // saqlangan kalibrovka o'qilmadi, standart qiymat ishlatiladi
    }
  }

  public isCalibrated(camKey: string): boolean {
    return this.focalRel[camKey] !== undefined;
  }

  private focalPx(camKey: string, frameHeight: number): number {
    return (this.focalRel[camKey] ?? DEFAULT_FOCAL_REL) * frameHeight;
  }

  /**
   * Kalibrovka: odam kameradan knownDistanceM masofada turganda yuz ramkasi kengligi (piksel) beriladi.
   * Fokus kadr balandligiga nisbatan saqlanadi, shuning uchun video o'lchami o'zgarsa ham to'g'ri qoladi.
   */
  public calibrate(
    camKey: string,
    knownDistanceM: number,
    faceWidthPx: number,
    frameHeight: number
  ): { saved: boolean; vFovDeg: number } {
    const focalPx = (knownDistanceM * faceWidthPx) / FACE_WIDTH_M;
    const rel = focalPx / frameHeight;
    const vFovDeg = Math.round((2 * Math.atan(0.5 / rel) * 180) / Math.PI);
    // Oddiy kameralarning vertikal ko'rish burchagi 25-75° oralig'ida. Undan tashqari natija — noto'g'ri kiritilgan masofa yoki yuz
    if (rel < MIN_FOCAL_REL || rel > MAX_FOCAL_REL) return { saved: false, vFovDeg };
    this.focalRel[camKey] = rel;
    this.persist();
    return { saved: true, vFovDeg };
  }

  public resetCalibration(camKey: string): void {
    delete this.focalRel[camKey];
    delete this.focalRel[eyeKey(camKey)];
    this.persist();
  }

  /** Yuz ramkasi kengligidan masofa (silliqlashsiz, ko'rsatish va solishtirish uchun) */
  public rawFaceDistance(camKey: string, faceWidthPx: number, frameHeight: number): number {
    return (FACE_WIDTH_M * this.focalPx(camKey, frameHeight)) / Math.max(1, faceWidthPx);
  }

  /** Ko'zlarning tashqi burchaklari orasidagi masofadan masofa (silliqlashsiz) */
  public rawEyeDistance(camKey: string, eyeSpanPx: number, frameHeight: number): number {
    return (EYE_SPAN_M * this.focalPx(eyeKey(camKey), frameHeight)) / Math.max(1, eyeSpanPx);
  }

  /** Ko'z masofasi uchun alohida kalibrovka: yuz kalibrovkasi bilan bir vaqtda, bir xil ma'lumotdan */
  public calibrateEye(camKey: string, knownDistanceM: number, eyeSpanPx: number, frameHeight: number): boolean {
    const rel = (knownDistanceM * eyeSpanPx) / EYE_SPAN_M / frameHeight;
    if (rel < MIN_FOCAL_REL || rel > MAX_FOCAL_REL) return false;
    this.focalRel[eyeKey(camKey)] = rel;
    this.persist();
    return true;
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.focalRel));
    } catch {
      // saqlab bo'lmadi, joriy sessiyada ishlayveradi
    }
  }

  private raw(camKey: string, input: DistanceInput): DistanceResult {
    const { cls, box, faceBox, frameWidth, frameHeight } = input;
    const f = this.focalPx(camKey, frameHeight);

    // Yuz ko'ringan odam: yuz kengligi bo'yicha (yuz kadrdan kesilmaydi, yaqin masofada gavdadan aniqroq)
    if (cls === 'person' && faceBox && faceBox.width > 0) {
      return { meters: (FACE_WIDTH_M * f) / faceBox.width, source: 'face', approx: false };
    }

    const realH = REAL_HEIGHT_M[cls] ?? 1.5;
    const heightEst = (realH * f) / Math.max(1, box.height);
    if (cls !== 'person') return { meters: heightEst, source: 'vehicle', approx: false };

    // Odam kadr chetiga yaqin yoki kadrni deyarli to'ldirgan bo'lsa, gavdaning bir qismi ko'rinmaydi.
    // To'liq bo'y (1.7 m) kesilgan ramka balandligiga bo'linsa, masofa HAQIQIYDAN KATTA chiqadi (yuqori chegara).
    const edgeTol = frameHeight * 0.03;
    const truncated = box.y <= edgeTol || box.y + box.height >= frameHeight - edgeTol || box.height >= frameHeight * 0.85;
    if (!truncated) return { meters: heightEst, source: 'body', approx: false };

    // Kesilgan odam: yelka kengligi bo'yicha ham hisoblab, kichigini olamiz (haqiqatga yaqinrog'i)
    const widthEst = (SHOULDER_WIDTH_M * f) / Math.max(1, box.width);
    const sideTol = frameWidth * 0.02;
    const truncatedSides = box.x <= sideTol || box.x + box.width >= frameWidth - sideTol;
    // Ikki o'qda ham kesilgan (odam kadrni to'ldirgan): ikkala hisob ham yuqori chegara, haqiqiy masofa undan kichik
    return {
      meters: Math.min(heightEst, widthEst),
      source: 'body',
      approx: true,
      upperBound: truncatedSides
    };
  }

  /** Obyekt masofasini hisoblaydi: pinhole + yuz kengligi + sonar tuzatishi + silliqlash */
  public estimate(camKey: string, input: DistanceInput): DistanceResult {
    const base = this.raw(camKey, input);
    let meters = base.meters;
    let source = base.source;

    // Sonar: obyekt markazda bo'lsa va kamera bahosiga mos kelsa, sonar aniqroq
    const { sonarFrontCm, box, frameWidth } = input;
    if (sonarFrontCm !== undefined && sonarFrontCm <= SONAR_MAX_CM) {
      const cx = (box.x + box.width / 2) / frameWidth;
      const sonarM = sonarFrontCm / 100;
      const centered = Math.abs(cx - 0.5) <= SONAR_CENTER_BAND;
      const agrees = Math.abs(sonarM - meters) <= meters * SONAR_AGREE_RATIO;
      if (centered && agrees) {
        meters = sonarM;
        source = 'sonar';
      }
    }

    meters = this.smooth(box, meters);
    meters = Math.min(MAX_M, Math.max(MIN_M, meters));
    const bySonar = source === 'sonar';
    return {
      meters: +meters.toFixed(1),
      source,
      approx: base.approx && !bySonar,
      upperBound: !!base.upperBound && !bySonar
    };
  }

  // Bir obyektni kadrlar bo'ylab kuzatib, oxirgi qiymatlar medianasini qaytaradi (raqam sakramasligi uchun)
  private smooth(box: Box, value: number): number {
    const now = performance.now();
    this.tracks = this.tracks.filter((t) => now - t.lastSeen < TRACK_TTL_MS);

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
      best = { box, values: [], lastSeen: now };
      this.tracks.push(best);
    }
    best.box = box;
    best.lastSeen = now;
    best.values.push(value);
    if (best.values.length > SMOOTH_WINDOW) best.values.shift();
    return median(best.values);
  }
}

export const distanceEstimator = new DistanceEstimator();
