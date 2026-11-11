/**
 * Kamera translyatsiyasi sozlamalari (har bir qurilmada alohida saqlanadi).
 *
 *  - role 'robot'    : robot yuzidagi planshet. Kamerani faqat shu qurilma ochadi va tasvirni operatorlarga uzatadi.
 *  - role 'operator' : dispetcher markazidagi qurilma. O'z kamerasini ochmaydi, robot tasvirini ko'radi.
 *
 * Kanal kodi robotda tasodifiy yaratiladi; operatorlar shu kodni kiritadi. Signal almashinuvi ochiq MQTT brokeri orqali
 * o'tgani uchun kod kanalni begonalardan yashiradi (video oqimning o'zi WebRTC DTLS bilan shifrlangan).
 */

export type CamRole = 'robot' | 'operator';

export interface CamLinkSettings {
  role: CamRole;
  /** Park kodi: tashkilotdagi barcha robot va operatorlar uchun bitta (shifrlash kaliti) */
  key: string;
  /** Robot ID (faqat robot planshetda): masalan QALQON-01. Har bir robotda boshqacha bo'lishi shart */
  robotId: string;
  /** Operator ismi (ixtiyoriy, robotda kim kuzatayotgani ko'rinadi) */
  operatorName: string;
  /** Ixtiyoriy TURN server (turli tarmoqlarda, masalan mobil internetda to'g'ridan-to'g'ri ulanish bo'lmasa) */
  turnUrl: string;
  turnUser: string;
  turnPass: string;
}

const STORAGE_KEY = 'qalqon.camLink.v1';

const randomKey = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // o'xshash harflarsiz (0/O, 1/I)
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const s = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
};

export const normalizeKey = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Robot ID: katta harf, raqam va chiziqcha (MQTT mavzusida ishlatiladi) */
export const normalizeRobotId = (id: string) =>
  id.toUpperCase().replace(/[^A-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'QALQON-01';

const load = (): CamLinkSettings => {
  let raw: Partial<CamLinkSettings> = {};
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<CamLinkSettings>;
  } catch {
    /* buzilgan bo'lsa standart qiymatlar */
  }
  const s: CamLinkSettings = {
    role: raw.role === 'robot' ? 'robot' : 'operator',
    key: raw.key || randomKey(),
    robotId: normalizeRobotId(raw.robotId || 'QALQON-01'),
    operatorName: raw.operatorName || '',
    turnUrl: raw.turnUrl || '',
    turnUser: raw.turnUser || '',
    turnPass: raw.turnPass || ''
  };
  if (!raw.key) save(s);
  return s;
};

function save(s: CamLinkSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* saqlab bo'lmasa shu sessiyada ishlayveradi */
  }
}

let current: CamLinkSettings | null = null;
const listeners = new Set<(s: CamLinkSettings) => void>();

export const camLinkSettings = {
  get(): CamLinkSettings {
    if (!current) current = load();
    return current;
  },
  set(patch: Partial<CamLinkSettings>) {
    current = { ...this.get(), ...patch };
    save(current);
    listeners.forEach((l) => l(current!));
  },
  regenerateKey() {
    this.set({ key: randomKey() });
  },
  subscribe(cb: (s: CamLinkSettings) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  iceServers(): RTCIceServer[] {
    const s = this.get();
    const servers: RTCIceServer[] = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];
    if (s.turnUrl.trim()) {
      servers.push({
        urls: s.turnUrl.split(',').map((u) => u.trim()).filter(Boolean),
        username: s.turnUser || undefined,
        credential: s.turnPass || undefined
      });
    }
    return servers;
  }
};

/**
 * Kanal: MQTT mavzusi (kod xeshidan) va AES-GCM kaliti (koddan). Ochiq brokerda barcha xabarlarni ko'rish mumkin,
 * shuning uchun har bir signal xabari shifrlanadi: kodni bilmagan odam ulanish ma'lumotini o'qiy olmaydi va
 * robotga soxta so'rov yubora olmaydi. crypto.subtle faqat xavfsiz manzilda (https yoki localhost) ishlaydi.
 */
export interface CamChannel {
  topic: string;
  seal(obj: unknown): Promise<string>;
  open<T>(text: string): Promise<T | null>;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function camChannel(key: string): Promise<CamChannel> {
  if (!crypto?.subtle) throw new Error("Kamera translyatsiyasi uchun sayt https (yoki localhost) orqali ochilishi kerak");
  const norm = normalizeKey(key);
  const enc = new TextEncoder();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`qalqon-cam-topic:${norm}`)));
  // Park mavzusi: barcha robotlar shu ostida, har biri T/r/<ROBOT-ID>/...
  const topic = `qalqon/fleet/${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`qalqon-cam-key:${norm}`));
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    topic,
    async seal(obj) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(JSON.stringify(obj))));
      return `${b64(iv)}.${b64(data)}`;
    },
    async open<T>(text: string) {
      try {
        const [iv, data] = text.split('.');
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, aes, unb64(data));
        return JSON.parse(new TextDecoder().decode(plain)) as T;
      } catch {
        return null; // boshqa kod bilan shifrlangan yoki soxta xabar
      }
    }
  };
}
