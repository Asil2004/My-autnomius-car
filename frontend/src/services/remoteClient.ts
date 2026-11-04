import type { MecanumCommand, RemoteStatus } from '../types/robot';

/**
 * Masofaviy admin ulanishi: internet orqali (Cloudflare Tunnel) Raspberry Pi ga.
 * Har so'rovda admin token yuboriladi (sarlavha yoki, img/WebSocket uchun, so'rov parametri). Haqiqiy himoya Pi tomonida
 * (raspberry_pi/remote_control.py): token bo'lmasa Pi hech narsa qilmaydi.
 */
const STORAGE_KEY = 'qalqon.remote.v1';

export interface RemoteConfig {
  baseUrl: string;
  token: string;
}

export interface RemoteTelemetry {
  sonars?: { front: number; rear: number; left: number; right: number };
  battery?: { voltage?: number; percentage?: number };
  motion?: { last_cmd?: string; speed_level?: number; is_moving?: boolean; obstacle_warning?: boolean };
  is_front_blocked?: boolean;
  watchdog?: { failsafe_active?: boolean; heartbeat_age_ms?: number };
  remote?: RemoteStatus;
}

/** "abc.trycloudflare.com/" -> "https://abc.trycloudflare.com". Yo'l va oxirgi slash olib tashlanadi */
export const normalizeBaseUrl = (input: string): string => {
  let v = input.trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
};

export const loadRemoteConfig = (): { baseUrl: string; token: string } => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<RemoteConfig>;
    return { baseUrl: raw.baseUrl || '', token: raw.token || '' };
  } catch {
    return { baseUrl: '', token: '' };
  }
};

/** Token faqat foydalanuvchi "eslab qolish" ni tanlagandagina saqlanadi */
export const saveRemoteConfig = (cfg: RemoteConfig, rememberToken: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl: cfg.baseUrl, token: rememberToken ? cfg.token : '' }));
  } catch {
    // saqlab bo'lmasa, ulanish shu sessiyada ishlayveradi
  }
};

export type SendResult =
  | { ok: true; status: string }
  | { ok: false; reason: 'locked' | 'local_override' | 'unauthorized' | 'network' | 'blocked' | 'error'; message: string };

export class RemoteLink {
  private cfg: RemoteConfig;

  constructor(cfg: RemoteConfig) {
    this.cfg = cfg;
  }

  get baseUrl() {
    return this.cfg.baseUrl;
  }

  videoUrl(nonce = 0) {
    return `${this.cfg.baseUrl}/stream.mjpg?token=${encodeURIComponent(this.cfg.token)}&r=${nonce}`;
  }

  private async request(path: string, timeoutMs = 4000): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(`${this.cfg.baseUrl}${path}`, { headers: { 'x-admin-token': this.cfg.token }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Token va manzilni tekshiradi. Natija: holat yoki xato sababi */
  async verify(): Promise<{ ok: true; status: RemoteStatus } | { ok: false; message: string }> {
    try {
      const res = await this.request('/api/remote/status');
      if (res.status === 401) return { ok: false, message: "Admin token noto'g'ri" };
      if (res.status === 429) return { ok: false, message: "Juda ko'p noto'g'ri urinish. Bir daqiqa kuting" };
      if (res.status === 503) return { ok: false, message: "Pi da masofaviy boshqaruv yoqilmagan (token o'rnatilmagan)" };
      if (!res.ok) return { ok: false, message: `Pi javobi: ${res.status}` };
      return { ok: true, status: (await res.json()) as RemoteStatus };
    } catch {
      return { ok: false, message: "Pi ga ulanib bo'lmadi. Tunnel manzili va internetni tekshiring" };
    }
  }

  /** Aloqa kechikishi (ms). Xato bo'lsa null */
  async ping(): Promise<number | null> {
    const t0 = performance.now();
    try {
      const res = await this.request('/api/health', 2500);
      return res.ok ? Math.round(performance.now() - t0) : null;
    } catch {
      return null;
    }
  }

  async sendCommand(cmd: MecanumCommand): Promise<SendResult> {
    try {
      const res = await this.request(`/cmd?c=${cmd}`, 1500);
      if (res.status === 401) return { ok: false, reason: 'unauthorized', message: "Admin token noto'g'ri" };
      if (res.status === 423) return { ok: false, reason: 'locked', message: "Masofaviy boshqaruv monitor tomonidan o'chirilgan" };
      if (res.status === 409) return { ok: false, reason: 'local_override', message: 'Robot yonidagi operator boshqaryapti' };
      if (!res.ok) return { ok: false, reason: 'error', message: `Pi javobi: ${res.status}` };
      const body = (await res.json()) as { status?: string; message?: string };
      if (body.status === 'blocked') return { ok: false, reason: 'blocked', message: body.message || "Oldinda to'siq bor" };
      return { ok: true, status: body.status || 'ok' };
    } catch {
      return { ok: false, reason: 'network', message: 'Aloqa yo\'q' };
    }
  }

  async setSpeed(level: number): Promise<void> {
    try {
      await this.request(`/cmd?speed=${level}`, 2000);
    } catch {
      // tezlik o'zgarmaydi, keyingi telemetriya haqiqiy qiymatni ko'rsatadi
    }
  }

  /** Telemetriya WebSocket (token so'rov parametrida). Uzilsa o'zi qayta ulanadi. Qaytgan funksiya ulanishni yopadi */
  openTelemetry(onData: (t: RemoteTelemetry) => void, onState: (connected: boolean) => void): () => void {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      const wsUrl = this.cfg.baseUrl.replace(/^http/i, 'ws') + `/ws?token=${encodeURIComponent(this.cfg.token)}`;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        attempt = 0;
        onState(true);
      };
      ws.onmessage = (ev) => {
        try {
          onData(JSON.parse(ev.data as string) as RemoteTelemetry);
        } catch {
          // buzilgan kadr e'tiborga olinmaydi
        }
      };
      ws.onclose = () => {
        onState(false);
        if (!closed) {
          attempt += 1;
          retry = setTimeout(connect, Math.min(5000, 800 * attempt));
        }
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }
}
