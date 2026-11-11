/**
 * Face ID (yuz tanish) kamerasi manbai: qurilmaning frontal kamerasi yoki ulangan tashqi USB web-kamera
 * (brauzer ko'radigan istalgan kamera). Tanlov localStorage da saqlanadi; HUD va robot yuzi ekrani shu tanlov
 * bo'yicha kamera ochadi va tanlov o'zgarsa kamerani qayta ochadi.
 */
const KEY = 'qalqon_face_camera';
/** 'auto' = tashqi (USB) kamera bo'lsa o'sha, bo'lmasa frontal kamera */
export type FaceCameraChoice = 'auto' | 'front' | string;

const listeners = new Set<(c: FaceCameraChoice) => void>();

function read(): FaceCameraChoice {
  try {
    const v = localStorage.getItem(KEY) || 'auto';
    return v === 'apk-usb-webcam' ? 'auto' : v; // eski APK tanlovi
  } catch {
    return 'auto';
  }
}

export interface CameraOption {
  deviceId: string;
  label: string;
  external: boolean;
}

/** Tashqi kamera belgilari: Android "facing external", USB/UVC web-kameralar nomi */
const isExternalLabel = (label: string) =>
  /external|usb|uvc|webcam|web cam|hd pro|logitech|c270|c920|a4tech|defender|genius/i.test(label) &&
  !/facing front|facing back|integrated|built-in/i.test(label);

export const faceCameraSettings = {
  get: read,
  set(c: FaceCameraChoice) {
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* xotira yo'q: faqat shu sessiya */
    }
    listeners.forEach((l) => l(c));
  },
  subscribe(cb: (c: FaceCameraChoice) => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },

  /** Mavjud kameralar ro'yxati (nomlar faqat kameraga ruxsat berilgandan keyin ko'rinadi) */
  async list(): Promise<CameraOption[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Kamera ${i + 1}`,
        external: isExternalLabel(d.label)
      }));
  },

  /** Tanlov bo'yicha Face ID kamerasini ochish (tanlangan kamera yo'qolgan bo'lsa frontal kameraga qaytadi) */
  async open(size: { width: number; height: number } = { width: 1280, height: 720 }): Promise<MediaStream> {
    const base = { width: { ideal: size.width }, height: { ideal: size.height } };
    const choice = read();
    let deviceId: string | null = null;
    if (choice !== 'auto' && choice !== 'front') deviceId = choice;
    else if (choice === 'auto') {
      try {
        const ext = (await this.list()).find((c) => c.external);
        if (ext?.deviceId) deviceId = ext.deviceId;
      } catch {
        /* ro'yxat olinmadi: frontal */
      }
    }
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: { ...base, deviceId: { exact: deviceId } }, audio: false });
      } catch {
        /* kamera uzilgan: frontalga qaytamiz */
      }
    }
    return navigator.mediaDevices.getUserMedia({ video: { ...base, facingMode: 'user' }, audio: false });
  }
};
