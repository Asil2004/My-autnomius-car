/**
 * Face ID (yuz tanish) kamerasi manbai: planshetning frontal kamerasi yoki ulangan tashqi USB web-kamera.
 * Tanlov localStorage da saqlanadi; HUD va robot yuzi ekrani shu tanlov bo'yicha kamera ochadi va
 * tanlov o'zgarsa kamerani qayta ochadi.
 */
import { ptzCameraService } from './ptzCameraService';
import { usbWebcamHub } from './lensHub';

const KEY = 'qalqon_face_camera';
/** APK ichidagi USB web-kamera (Android tashqi kamerani bermaydigan planshetlar uchun) */
export const APK_WEBCAM = 'apk-usb-webcam';

export interface ApkWebcamStatus {
  connected: boolean;
  device: boolean;
  name: string;
  width: number;
  height: number;
  waitingPermission: boolean;
  error: string;
}

/**
 * APK web-kamerasining MJPEG oqimini oddiy MediaStream ga aylantirish (canvas.captureStream): Face ID, yozuv va
 * operatorlarga uzatish hech o'zgarishsiz ishlaydi. track.stop() chaqirilganda oqim ulanishi ham yopiladi.
 */
async function openApkWebcam(fps = 15): Promise<MediaStream> {
  // Asosiy yo'l: hamma ish fon oqimida (Worker + MediaStreamTrackGenerator), yuz aniqlash tasvirni qotirmaydi
  const Gen = (window as unknown as { MediaStreamTrackGenerator?: new (o: { kind: 'video' }) => MediaStreamTrack & { writable: WritableStream } })
    .MediaStreamTrackGenerator;
  if (Gen) {
    try {
      return await openApkWebcamWorker(Gen);
    } catch {
      /* quyidagi canvas usuliga qaytamiz */
    }
  }
  const release = usbWebcamHub.acquire();
  try {
    // Birinchi kadrni kutish (4 s)
    const t0 = performance.now();
    while (!usbWebcamHub.current()) {
      if (performance.now() - t0 > 4000) throw new Error("Web-kameradan kadr kelmadi");
      await new Promise((r) => setTimeout(r, 100));
    }
    const first = usbWebcamHub.current()!;
    const canvas = document.createElement('canvas');
    canvas.width = first.width;
    canvas.height = first.height;
    const ctx = canvas.getContext('2d')!;
    let lastT = 0;
    const draw = () => {
      const f = usbWebcamHub.current();
      if (!f || f.t === lastT) return;
      lastT = f.t;
      if (canvas.width !== f.width || canvas.height !== f.height) {
        canvas.width = f.width;
        canvas.height = f.height;
      }
      ctx.drawImage(f.src, 0, 0);
    };
    draw();
    const timer = window.setInterval(draw, Math.round(1000 / fps / 2));
    const stream = canvas.captureStream(fps);
    const track = stream.getVideoTracks()[0];
    const origStop = track.stop.bind(track);
    track.stop = () => {
      window.clearInterval(timer);
      release();
      origStop();
    };
    return stream;
  } catch (e) {
    release();
    throw e;
  }
}
/** 'auto' = tashqi (USB) kamera bo'lsa o'sha, bo'lmasa frontal kamera */
export type FaceCameraChoice = 'auto' | 'front' | string;

const listeners = new Set<(c: FaceCameraChoice) => void>();

function read(): FaceCameraChoice {
  try {
    return localStorage.getItem(KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * USB web-kamera planshetga ulanganda yoki uzilganda (avtomatik yoki APK tanlovida) Face ID kamerasi
 * o'zi qayta ochiladi: kamera to'g'ri tanlanishi uchun ilovani qayta ochish shart emas.
 */
let apkWatch: number | null = null;
let apkConnected: boolean | null = null;
function ensureApkWatch() {
  if (apkWatch !== null) return;
  apkWatch = window.setInterval(async () => {
    const c = read();
    if (c !== 'auto' && c !== APK_WEBCAM) return;
    const st = await faceCameraSettings.apkWebcamStatus();
    if (!st) return; // APK emas
    const now = !!st.connected;
    if (apkConnected !== null && now !== apkConnected) listeners.forEach((l) => l(c));
    apkConnected = now;
  }, 3000);
}

async function openApkWebcamWorker(
  Gen: new (o: { kind: 'video' }) => MediaStreamTrack & { writable: WritableStream }
): Promise<MediaStream> {
  const track = new Gen({ kind: 'video' });
  const worker = new Worker(new URL('./webcamWorker.ts', import.meta.url), { type: 'module' });
  const url = `${ptzCameraService.getBase()}/webcam/stream?_=${Date.now()}`;
  worker.postMessage({ url, writable: track.writable }, [track.writable as unknown as Transferable]);
  const cleanup = () => {
    worker.postMessage({ type: 'stop' });
    window.setTimeout(() => worker.terminate(), 500);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("Web-kameradan kadr kelmadi")), 4000);
      worker.onmessage = (e) => {
        if (e.data?.type === 'frame') {
          window.clearTimeout(t);
          resolve();
        }
      };
      worker.onerror = (e) => {
        window.clearTimeout(t);
        reject(new Error(e.message));
      };
    });
  } catch (e) {
    cleanup();
    track.stop();
    throw e;
  }
  const origStop = track.stop.bind(track);
  track.stop = () => {
    cleanup();
    origStop();
  };
  return new MediaStream([track]);
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
    ensureApkWatch();
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

  /** APK ichidagi USB web-kamera holati (APK bo'lmasa yoki kamera serveri yo'q bo'lsa null) */
  async apkWebcamStatus(): Promise<ApkWebcamStatus | null> {
    try {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${ptzCameraService.getBase()}/webcam/status`, { signal: ctrl.signal, cache: 'no-store' });
      window.clearTimeout(t);
      if (!res.ok) return null;
      return (await res.json()) as ApkWebcamStatus;
    } catch {
      return null;
    }
  },

  /** Tanlov bo'yicha Face ID kamerasini ochish (tanlangan kamera yo'qolgan bo'lsa frontal kameraga qaytadi) */
  async open(size: { width: number; height: number } = { width: 1280, height: 720 }): Promise<MediaStream> {
    const base = { width: { ideal: size.width }, height: { ideal: size.height } };
    const choice = read();
    // APK USB web-kamera: tanlangan bo'lsa yoki avtomatik rejimda ulangan bo'lsa
    if (choice === APK_WEBCAM || choice === 'auto') {
      const st = await this.apkWebcamStatus();
      if (st?.connected || (choice === APK_WEBCAM && st?.device)) {
        try {
          return await openApkWebcam();
        } catch {
          /* kadr kelmadi: oddiy kameraga qaytamiz */
        }
      }
    }
    let deviceId: string | null = null;
    if (choice !== 'auto' && choice !== 'front' && choice !== APK_WEBCAM) deviceId = choice;
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
