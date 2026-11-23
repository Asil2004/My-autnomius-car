/**
 * PTZ KAMERA MODULI (camera_server/, CP-159-1 uch linzali kamera) bilan aloqa.
 *
 *   lens 0 -> PTZ (buriladi), lens 1 -> o'ngga qaragan, lens 2 -> chapga qaragan
 *
 * Video: MJPEG (<img src=streamUrl(lens)>). Burish: POST /ptz/move {pan, tilt, duration} — joystik bosilib turganda
 * qayta-qayta yuboriladi; duration tufayli aloqa uzilsa ham kamera o'zi to'xtaydi. Qo'yib yuborilsa POST /ptz/stop.
 */

export type PtzLens = 0 | 1 | 2;

/**
 * Kamera robotga teskari (180°) o'rnatilgan: HUD da uchala linza tasviri 180° aylantirib chiziladi.
 * Shunda joystik yo'nalishlari ham ekrandagi (to'g'rilangan) tasvirga mos bo'lishi uchun pan teskari yuboriladi.
 */
export const CAMERA_ROTATED_180 = true;
export const LENS = { ptz: 0, right: 1, left: 2 } as const;

const BASE_KEY = 'qalqon.ptzCameraBase.v1';
export const DEFAULT_PTZ_BASE = (() => {
  if (typeof window === 'undefined' || !window.location.hostname) return 'http://localhost:8090/camera';
  const { protocol, hostname, port, origin } = window.location;
  if (port === '5173' || port === '4173') {
    return `http://${hostname}:8090/camera`;
  }
  if (hostname.endsWith('.github.io')) {
    const savedIp = typeof window !== 'undefined' ? (localStorage.getItem('qalqon_pi_ip') || '10.23.21.132') : '10.23.21.132';
    return `http://${savedIp}:8000/camera`;
  }
  // VPS HTTPS domen (https://qalqon.uz/camera) va Pi 5 Yagona Gateway (:8000/camera)
  if (protocol === 'https:' || protocol === 'http:') {
    return `${origin}/camera`;
  }
  return 'http://localhost:8090/camera';
})();

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
    const candidate = saved ? normalizeBase(saved) : DEFAULT_PTZ_BASE;
    // HTTPS VPS domenida eski lokal http:// IP saqlanib qolgan bo'lsa (Mixed Content), avtomatik joriy HTTPS /camera ga o'tadi
    if (
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      !window.location.hostname.endsWith('.github.io') &&
      candidate.startsWith('http://')
    ) {
      this.base = DEFAULT_PTZ_BASE;
    } else {
      this.base = candidate;
    }
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

  /** Bitta linzaning MJPEG manzili. nonce o'zgarsa brauzer qayta ulanadi */
  streamUrl(lens: PtzLens, nonce = 0) {
    return `${this.base}/stream?lens=${lens}&r=${nonce}`;
  }

  /** Butun kadr (barcha linzalar ustma-ust) MJPEG manzili: HUD barcha oynalar uchun bitta ulanish ishlatadi */
  fullStreamUrl(nonce = 0) {
    return `${this.base}/stream?r=${nonce}`;
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
    if (!changed && now - this.lastMove.t < 250) return;
    this.lastMove = { pan: p, tilt: t, t: now };
    this.moving = true;
    // VPS yoki Pi 5 Yagona Gateway (/camera) ochiq bo'lsa, to'g'ridan-to'g'ri yuboramiz (operator rejimida ham ishlaydi!)
    if (this.status.reachable || !this.remote) {
      this.moveLocal(p, t);
    }
    if (this.remote && !this.status.reachable) {
      this.remote({ op: 'move', pan: +p.toFixed(2), tilt: +t.toFixed(2) });
    }
  }

  stop() {
    if (!this.moving) return;
    this.moving = false;
    this.lastMove = { pan: 0, tilt: 0, t: 0 };
    if (this.status.reachable || !this.remote) {
      this.stopLocal();
    }
    if (this.remote && !this.status.reachable) {
      // To'xtash muhim: MQTT da bitta xabar yo'qolsa ham kamera to'xtashi uchun ikki marta
      this.remote({ op: 'stop' });
      window.setTimeout(() => this.remote?.({ op: 'stop' }), 250);
    }
  }

  /**
   * Operator qurilmasida: kamera moduli robotga ulangan, shuning uchun burish buyruqlari robotga yuboriladi
   * (robot ularni o'z kamera serveriga uzatadi). null: buyruqlar to'g'ridan-to'g'ri kamera serveriga
   */
  private remote: ((cmd: { op: 'move'; pan: number; tilt: number } | { op: 'stop' }) => void) | null = null;
  setRemote(fn: typeof this.remote) {
    this.remote = fn;
  }

  /** Kamera serveriga to'g'ridan-to'g'ri (robot planshetida; operatordan kelgan buyruqlar ham shu yerga) */
  moveLocal(pan: number, tilt: number) {
    const p = Math.max(-1, Math.min(1, pan));
    const t = Math.max(-1, Math.min(1, tilt));
    void this.post('/ptz/move', { pan: +p.toFixed(2), tilt: +t.toFixed(2), zoom: 0, duration: 0.8 });
  }

  stopLocal() {
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
