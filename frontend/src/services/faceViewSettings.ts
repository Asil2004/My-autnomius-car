/**
 * Bosh sahifa (robot yuzi) sozlamalari: AI & Avtonom bo'limidan boshqariladi, bosh sahifa faqat o'qiydi.
 * Brauzer xotirasida saqlanadi, o'zgarganda obunachilarga xabar beradi.
 */

export interface FaceViewSettings {
  /** Old kamera: yuz tanish va NVR yozuvi uchun */
  cameraEnabled: boolean;
  /** Kamera odamni ko'rganda avtomatik salom berish */
  autoGreet: boolean;
}

const KEY = 'qalqon.faceView.v1';
const DEFAULTS: FaceViewSettings = { cameraEnabled: true, autoGreet: true };

function load(): FaceViewSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<FaceViewSettings>) };
  } catch {
    /* xotira mavjud emas */
  }
  return { ...DEFAULTS };
}

let current = load();
const listeners = new Set<(s: FaceViewSettings) => void>();

export const faceViewSettings = {
  get(): FaceViewSettings {
    return current;
  },
  set(patch: Partial<FaceViewSettings>) {
    current = { ...current, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* xotira mavjud emas */
    }
    listeners.forEach((l) => l(current));
  },
  subscribe(cb: (s: FaceViewSettings) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }
};
