/**
 * PTZ KAMERA MODULI (camera_server/, CP-159-1 uch linzali kamera) bilan aloqa.
 *
 *   lens 0 -> PTZ (buriladi), lens 1 -> o'ngga qaragan, lens 2 -> chapga qaragan
 *
 * Video: MJPEG (<img src=streamUrl(lens)>). Burish: POST /ptz/move {pan, tilt, duration} — joystik bosilib turganda
 * qayta-qayta yuboriladi; duration tufayli aloqa uzilsa ham kamera o'zi to'xtaydi. Qo'yib yuborilsa POST /ptz/stop.
 */

export type PtzLens = 0 | 1 | 2;
export const LENS = { ptz: 0, right: 1, left: 2 } as const;

const BASE_KEY = 'qalqon.ptzCameraBase.v1';
export const DEFAULT_PTZ_BASE = 'http://localhost:8090/camera';

export interface PtzCameraStatus {
  reachable: boolean;
  video: boolean;
  ptz: boolean;
  lenses: number;
  error?: string;
  t: number;
}

const normalizeBase = (v: string) => {
  let s = v.trim().replace(/\/+$/, '');
  if (!s) return DEFAULT_PTZ_BASE;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  if (!/\/camera$/i.test(s)) s = `${s}/camera`;
  return s;
};

class PtzCameraService {
  private base: string;
  private listeners = new Set<(s: PtzCameraStatus) => void>();
  private status: PtzCameraStatus = { reachable: false, video: false, ptz: false, lenses: 0, t: 0 };
  private poll: number | null = null;
  private baseListeners = new Set<(b: string) => void>();
  private lastMove = { pan: 0, tilt: 0, t: 0 };
  private moving = false;

  constructor() {
    let saved = '';
    try {
      saved = localStorage.getItem(BASE_KEY) || '';
    } catch {
      /* standart manzil */
    }
    this.base = saved ? normalizeBase(saved) : DEFAULT_PTZ_BASE;
  }

  getBase() {
    return this.base;
  }

  setBase(v: string) {
    this.base = normalizeBase(v);
    try {
      localStorage.setItem(BASE_KEY, this.base);
    } catch {
      /* saqlanmasa ham ishlaydi */
    }
    this.baseListeners.forEach((l) => l(this.base));
    void this.refresh();
  }

  onBaseChange(cb: (b: string) => void) {
    this.baseListeners.add(cb);
    return () => {
      this.baseListeners.delete(cb);
    };
  }

  /** MJPEG jonli video manzili. nonce o'zgarsa brauzer qayta ulanadi */
  streamUrl(lens: PtzLens, nonce = 0) {
    return `${this.base}/stream?lens=${lens}&r=${nonce}`;
  }

  // ---------------------------------------------------------------------------
  // Holat (har 5 s)
  // ---------------------------------------------------------------------------
  getStatus() {
    return this.status;
  }

  subscribe(cb: (s: PtzCameraStatus) => void) {
    this.listeners.add(cb);
    cb(this.status);
    if (!this.poll) {
      void this.refresh();
      this.poll = window.setInterval(() => void this.refresh(), 5000);
    }
    return () => {
      this.listeners.delete(cb);
      if (!this.listeners.size && this.poll) {
        window.clearInterval(this.poll);
        this.poll = null;
      }
    };
  }

  async refresh() {
    try {
      const res = await fetch(`${this.base}/status`, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { video?: { connected?: boolean; lenses?: number; error?: string | null }; ptz?: boolean };
      this.set({
        reachable: true,
        video: !!j.video?.connected,
        ptz: !!j.ptz,
        lenses: j.video?.lenses ?? 0,
        error: j.video?.error ?? undefined
      });
    } catch (e) {
      this.set({ reachable: false, video: false, ptz: false, lenses: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private set(p: Omit<PtzCameraStatus, 't'>) {
    this.status = { ...p, t: Date.now() };
    this.listeners.forEach((l) => l(this.status));
  }

  // ---------------------------------------------------------------------------
  // PTZ boshqaruvi
  // ---------------------------------------------------------------------------
  /**
   * Joystik vektori: pan/tilt -1..1 (o'ng/yuqori musbat). Har chaqiriqda emas: yo'nalish sezilarli o'zgarganda yoki
   * 300 ms o'tganda yuboriladi (kamera duration=0.8 s dan keyin o'zi to'xtaydi, shuning uchun bosib turganda yangilanadi)
   */
  move(pan: number, tilt: number) {
    const p = Math.max(-1, Math.min(1, pan));
    const t = Math.max(-1, Math.min(1, tilt));
    const now = Date.now();
    const changed = Math.abs(p - this.lastMove.pan) > 0.15 || Math.abs(t - this.lastMove.tilt) > 0.15;
    if (!changed && now - this.lastMove.t < 300) return;
    this.lastMove = { pan: p, tilt: t, t: now };
    this.moving = true;
    void this.post('/ptz/move', { pan: +p.toFixed(2), tilt: +t.toFixed(2), zoom: 0, duration: 0.8 });
  }

  stop() {
    if (!this.moving) return;
    this.moving = false;
    this.lastMove = { pan: 0, tilt: 0, t: 0 };
    void this.post('/ptz/stop', {});
  }

  async gotoPreset(token: string) {
    return this.post(`/ptz/presets/${encodeURIComponent(token)}/goto`, {});
  }

  async presets(): Promise<{ token: string; name: string }[]> {
    try {
      const res = await fetch(`${this.base}/ptz/presets`, { signal: AbortSignal.timeout(4000) });
      return res.ok ? ((await res.json()) as { token: string; name: string }[]) : [];
    } catch {
      return [];
    }
  }

  private async post(path: string, body: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const ptzCameraService = new PtzCameraService();
