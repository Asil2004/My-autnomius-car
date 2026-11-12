/**
 * PTZ KAMERA MODULI TASVIRINI OPERATORLARGA UZATISH.
 *
 *   Robot planshet: kamera serveridan (lensHub) kelgan uch linzali kadr (PTZ / o'ng / chap, ustma-ust) kichraytirilib
 *   canvas ga chiziladi va WebRTC orqali Face ID kamerasidan tashqari IKKINCHI video oqim sifatida yuboriladi.
 *   Kadr tuzilishi kamera serveridagi bilan bir xil (3 ta 16:9 bo'lak ustma-ust, aylantirilmagan), shuning uchun
 *   operatorda ham o'sha PtzLensView har bir linzani shu kadrdan qirqib chizadi.
 *
 *   Operator: robotdan kelgan ikkinchi oqim (remoteLens) lensHub o'rniga ishlatiladi.
 */
import { lensHub, type LensFrame } from './lensHub';
import { ptzCameraService, type PtzCameraStatus } from './ptzCameraService';

const RELAY_FPS = 12;
const LENS_W = 640;
const LENS_H = 360;
const LENSES = 3;
const STALL_MS = 3000;

// =============================================================================
// ROBOT: PTZ kadrini video oqimga aylantirish (faqat kamera moduli ulanganda)
// =============================================================================
export function startPtzRelay(onTrack: (track: MediaStreamTrack | null) => void): () => void {
  let release: (() => void) | null = null;
  let timer: number | null = null;
  let track: MediaStreamTrack | null = null;
  let lastFrameT = -1;

  const off = () => {
    if (timer) window.clearInterval(timer);
    timer = null;
    release?.();
    release = null;
    if (track) {
      track.stop();
      track = null;
      onTrack(null);
    }
  };

  const on = () => {
    if (release) return;
    release = lensHub.acquire();
    const canvas = document.createElement('canvas');
    canvas.width = LENS_W;
    canvas.height = LENS_H * LENSES;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // rAF emas, setInterval: robot boshqa bo'limda bo'lsa ham kadr chizilaveradi
    timer = window.setInterval(() => {
      const f = lensHub.current();
      if (!f || f.t === lastFrameT) return;
      lastFrameT = f.t;
      try {
        ctx.drawImage(f.src, 0, 0, f.width, f.height, 0, 0, canvas.width, canvas.height);
      } catch {
        return;
      }
      if (!track) {
        track = canvas.captureStream(RELAY_FPS).getVideoTracks()[0] ?? null;
        if (track) {
          track.contentHint = 'detail';
          onTrack(track);
        }
      }
    }, 1000 / RELAY_FPS);
  };

  // Bitta holat so'rovi kechiksa oqim uzilmasin: ketma-ket 2 marta (≈10 s) "video yo'q" bo'lgandagina o'chiriladi
  let misses = 0;
  const unsub = ptzCameraService.subscribe((s) => {
    if (s.video) {
      misses = 0;
      on();
    } else if (++misses >= 2 || !s.t) off();
  });
  return () => {
    unsub();
    off();
  };
}

// =============================================================================
// OPERATOR: robotdan kelgan PTZ oqimi (lensHub bilan bir xil interfeys)
// =============================================================================
class RemoteLens {
  private video: HTMLVideoElement | null = null;
  private t = 0;
  private listeners = new Set<(s: PtzCameraStatus) => void>();
  private poll: number | null = null;
  private status: PtzCameraStatus = { reachable: true, video: false, ptz: false, lenses: 0, error: undefined, t: 0 };

  setStream(stream: MediaStream | null) {
    if (!stream) {
      if (this.video) this.video.srcObject = null;
      this.t = 0;
      this.refresh();
      return;
    }
    const v = this.video ?? document.createElement('video');
    this.video = v;
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    void v.play().catch(() => {});
    const mark = () => {
      this.t = performance.now();
      if (this.video === v && v.srcObject === stream) {
        if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(mark);
      }
    };
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(mark);
    else (v as HTMLVideoElement).ontimeupdate = () => (this.t = performance.now());
  }

  /** Ekrandagi oynalar ishlatadi (ulanishni robot bilan aloqa boshqaradi, bu yerda hech narsa ochilmaydi) */
  acquire(): () => void {
    return () => {};
  }

  current(): LensFrame | null {
    const v = this.video;
    if (!v || !v.videoWidth || v.readyState < 2 || performance.now() - this.t > STALL_MS) return null;
    return { src: v, width: v.videoWidth, height: v.videoHeight, t: this.t };
  }

  getStatus() {
    return this.status;
  }

  private refresh() {
    const live = !!this.current();
    if (live === this.status.video && this.status.t) return;
    this.status = {
      reachable: true,
      video: live,
      ptz: false,
      lenses: live ? LENSES : 0,
      error: live ? undefined : 'Robotdan PTZ kamera tasviri kelmayapti',
      t: Date.now()
    };
    this.listeners.forEach((l) => l(this.status));
  }

  subscribe(cb: (s: PtzCameraStatus) => void) {
    this.listeners.add(cb);
    cb(this.status);
    if (!this.poll) this.poll = window.setInterval(() => this.refresh(), 1000);
    return () => {
      this.listeners.delete(cb);
      if (!this.listeners.size && this.poll) {
        window.clearInterval(this.poll);
        this.poll = null;
      }
    };
  }
}

export const remoteLens = new RemoteLens();
