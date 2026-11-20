/**
 * Face ID (yuz tanish / frontal) kamerasi manbai:
 *  - 'auto': Raspberry Pi USB web-kamera faol bo'lsa o'sha, bo'lmasa qurilmaning USB / frontal kamerasi;
 *  - 'pi-webcam': Raspberry Pi 5 ga ulangan USB web-kamera (/api/webcam/stream, lidar_bridge_server.py);
 *  - 'front' yoki deviceId: qurilmaning o'zidagi kamera (brauzer getUserMedia).
 */
const KEY = 'qalqon_face_camera';
const PI_BASE_KEY = 'qalqon_pi_webcam_base';
/** 'auto' = Pi USB yoki tashqi (USB) kamera bo'lsa o'sha, bo'lmasa frontal kamera */
export type FaceCameraChoice = 'auto' | 'pi-webcam' | 'front' | string;

export interface PiWebcamStatus {
  reachable: boolean;
  connected: boolean;
  device?: string | null;
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  error?: string | null;
}

const listeners = new Set<(c: FaceCameraChoice) => void>();
const piBaseListeners = new Set<(b: string) => void>();

function read(): FaceCameraChoice {
  try {
    const v = localStorage.getItem(KEY) || 'auto';
    return v === 'apk-usb-webcam' ? 'auto' : v; // eski APK tanlovi
  } catch {
    return 'auto';
  }
}

export function getDefaultPiWebcamBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:8000';
  const { protocol, hostname, port, origin } = window.location;
  if (!hostname) return '';
  if (port === '5173' || port === '4173') {
    return `http://${hostname}:8000`;
  }
  // GitHub Pages statik host: backend yo'q, foydalanuvchi manzil kiritadi
  if (hostname.endsWith('.github.io')) {
    return '';
  }
  // VPS HTTPS domen (https://qalqon.uz) yoki Pi 5 lokal (:8000): xuddi shu origin!
  if (protocol === 'https:' || protocol === 'http:') {
    return origin;
  }
  return '';
}

function normalizePiBase(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (!s) return getDefaultPiWebcamBase();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/api\/webcam(\/.*)?$/i, '');
  return s;
}

function readPiBase(): string {
  try {
    const saved = localStorage.getItem(PI_BASE_KEY);
    if (saved && saved.trim()) {
      const norm = normalizePiBase(saved);
      // HTTPS VPS saytda eski lokal http:// IP saqlanib qolgan bo'lsa (Mixed Content), joriy HTTPS origin ga o'tamiz
      if (
        typeof window !== 'undefined' &&
        window.location.protocol === 'https:' &&
        !window.location.hostname.endsWith('.github.io') &&
        norm.startsWith('http://')
      ) {
        return getDefaultPiWebcamBase();
      }
      return norm;
    }
  } catch {
    /* xotira yo'q */
  }
  return getDefaultPiWebcamBase();
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

  getPiWebcamBase: readPiBase,
  setPiWebcamBase(url: string) {
    const clean = url.trim() ? normalizePiBase(url) : '';
    try {
      if (clean) localStorage.setItem(PI_BASE_KEY, clean);
      else localStorage.removeItem(PI_BASE_KEY);
    } catch {
      /* xotira yo'q */
    }
    const next = readPiBase();
    piBaseListeners.forEach((l) => l(next));
  },
  subscribePiBase(cb: (b: string) => void) {
    piBaseListeners.add(cb);
    return () => {
      piBaseListeners.delete(cb);
    };
  },
  piWebcamStreamUrl(nonce = 0): string {
    const base = readPiBase();
    return base ? `${base}/api/webcam/stream?r=${nonce}` : '';
  },
  async checkPiWebcam(): Promise<PiWebcamStatus> {
    const base = readPiBase();
    if (!base) {
      return { reachable: false, connected: false, error: 'Pi manzili kiritilmagan' };
    }
    try {
      const res = await fetch(`${base}/api/webcam/status`, {
        signal: AbortSignal.timeout(2500),
        cache: 'no-store'
      });
      if (!res.ok) {
        return { reachable: false, connected: false, error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as {
        connected?: boolean;
        device?: string | null;
        name?: string;
        width?: number;
        height?: number;
        fps?: number;
        error?: string | null;
      };
      return {
        reachable: true,
        connected: Boolean(data.connected),
        device: data.device ?? null,
        name: data.name ?? '',
        width: data.width ?? 0,
        height: data.height ?? 0,
        fps: data.fps ?? 0,
        error: data.error ?? null
      };
    } catch (err: unknown) {
      return {
        reachable: false,
        connected: false,
        error: err instanceof Error ? err.message : 'Ulanib bo‘lmadi'
      };
    }
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
    if (choice !== 'auto' && choice !== 'front' && choice !== 'pi-webcam') deviceId = choice;
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
