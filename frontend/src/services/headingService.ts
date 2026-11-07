/**
 * ROBOT YO'NALISHI (giroskop / IMU / kompas): xaritadagi robot markeri uchun yagona heading manbai.
 *
 * Manbalar (ustuvorlik tartibida, "avto" rejimda):
 *   1. 'imu'    : robotdan kelgan IMU/giroskop (Pi yoki ESP32 telemetriyasi: imu.yaw / yaw / heading / compass)
 *   2. 'device' : robot yuzidagi planshetning giroskop+kompasi (deviceorientationabsolute, sensor fusion)
 *   3. 'gps'    : GPS harakat yo'nalishi (faqat robot yurayotganda ishonchli)
 *
 * Kiruvchi qiymat shovqinli va 0/360 chegarasida sakraydi, shuning uchun:
 *   - aylanma o'rtacha (sin/cos EMA) bilan past chastotali filtr;
 *   - ekranda chizish uchun "o'ralmagan" (unwrapped) burchak: 359° -> 1° o'tish +2° bo'ladi, -358° emas.
 */

export type HeadingSource = 'imu' | 'device' | 'gps' | 'none';
export type HeadingMode = 'auto' | 'imu' | 'device' | 'gps' | 'off';

export interface HeadingState {
  /** 0..360, shimoldan soat yo'nalishida (filtrlangan) */
  heading: number;
  source: HeadingSource;
  /** Burilish tezligi, °/s (musbat = o'ngga) */
  rate: number;
  /** Oxirgi o'lchov vaqti (ms) */
  t: number;
}

const MODE_KEY = 'qalqon.headingMode.v1';
const FRESH_MS: Record<Exclude<HeadingSource, 'none'>, number> = { imu: 2000, device: 1500, gps: 5000 };
// Filtr vaqt doimiysi: kichik = tezroq javob, katta = silliqroq (IMU tezroq, kompas shovqinliroq)
const TAU_MS: Record<Exclude<HeadingSource, 'none'>, number> = { imu: 80, device: 180, gps: 600 };

const norm = (d: number) => ((d % 360) + 360) % 360;
/** a dan b ga eng qisqa yo'l (-180..180) */
export const angleDelta = (a: number, b: number) => ((b - a + 540) % 360) - 180;

interface Channel {
  sin: number;
  cos: number;
  t: number;
  init: boolean;
  last: number;
  rate: number;
}

const newChannel = (): Channel => ({ sin: 0, cos: 1, t: 0, init: false, last: 0, rate: 0 });

class HeadingService {
  private ch: Record<Exclude<HeadingSource, 'none'>, Channel> = { imu: newChannel(), device: newChannel(), gps: newChannel() };
  private listeners = new Set<(s: HeadingState) => void>();
  private mode: HeadingMode = 'auto';
  private deviceListening = false;
  private deviceHandler: ((e: DeviceOrientationEvent) => void) | null = null;

  constructor() {
    try {
      const m = localStorage.getItem(MODE_KEY) as HeadingMode | null;
      if (m && ['auto', 'imu', 'device', 'gps', 'off'].includes(m)) this.mode = m;
    } catch {
      /* standart: auto */
    }
  }

  getMode() {
    return this.mode;
  }

  setMode(m: HeadingMode) {
    this.mode = m;
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* saqlanmasa ham ishlaydi */
    }
    this.syncDeviceListener();
    this.emit();
  }

  /** Robot IMU / giroskop qiymati (gradus, shimoldan soat yo'nalishida) */
  pushImu(deg: number) {
    this.push('imu', deg);
  }

  /** GPS harakat yo'nalishi. Robot deyarli turgan bo'lsa (tezlik < ~1 km/soat) e'tiborga olinmaydi */
  pushGps(deg: number | null | undefined, speedKmh: number | null | undefined) {
    if (deg === null || deg === undefined || !isFinite(deg)) return;
    if ((speedKmh ?? 0) < 1) return;
    this.push('gps', deg);
  }

  /**
   * Telemetriya JSON idan IMU yo'nalishini topish (Pi / ESP32 turli nomlar bilan yuborishi mumkin).
   * Topilsa true qaytaradi.
   */
  ingestTelemetry(d: unknown): boolean {
    if (!d || typeof d !== 'object') return false;
    const o = d as Record<string, unknown>;
    const imu = (o.imu ?? o.gyro ?? o.orientation) as Record<string, unknown> | undefined;
    const candidates = [imu?.yaw, imu?.heading, imu?.azimuth, o.yaw, o.compass, o.azimuth, (o.motion as Record<string, unknown> | undefined)?.heading];
    for (const v of candidates) {
      const n = typeof v === 'string' ? parseFloat(v) : (v as number);
      if (typeof n === 'number' && isFinite(n)) {
        this.pushImu(n);
        return true;
      }
    }
    return false;
  }

  private push(src: Exclude<HeadingSource, 'none'>, deg: number) {
    if (!isFinite(deg)) return;
    const c = this.ch[src];
    const now = performance.now();
    const rad = (norm(deg) * Math.PI) / 180;
    if (!c.init || now - c.t > 3000) {
      c.sin = Math.sin(rad);
      c.cos = Math.cos(rad);
      c.init = true;
      c.rate = 0;
      c.last = norm(deg);
    } else {
      // Aylanma EMA: sin/cos alohida silliqlanadi, 0/360 chegarasida sakrash bo'lmaydi
      const dt = Math.max(1, now - c.t);
      const a = 1 - Math.exp(-dt / TAU_MS[src]);
      c.sin += (Math.sin(rad) - c.sin) * a;
      c.cos += (Math.cos(rad) - c.cos) * a;
      const filtered = norm((Math.atan2(c.sin, c.cos) * 180) / Math.PI);
      const instRate = (angleDelta(c.last, filtered) * 1000) / dt;
      c.rate += (instRate - c.rate) * Math.min(1, dt / 250);
      c.last = filtered;
    }
    c.t = now;
    this.emit();
  }

  private pick(): HeadingSource {
    const now = performance.now();
    const fresh = (s: Exclude<HeadingSource, 'none'>) => this.ch[s].init && now - this.ch[s].t < FRESH_MS[s];
    if (this.mode === 'off') return 'none';
    if (this.mode !== 'auto') return fresh(this.mode) ? this.mode : 'none';
    if (fresh('imu')) return 'imu';
    if (fresh('device')) return 'device';
    if (fresh('gps')) return 'gps';
    return 'none';
  }

  getState(): HeadingState | null {
    const src = this.pick();
    if (src === 'none') return null;
    const c = this.ch[src];
    return { heading: c.last, source: src, rate: c.rate, t: c.t };
  }

  subscribe(cb: (s: HeadingState | null) => void): () => void {
    this.listeners.add(cb as (s: HeadingState) => void);
    this.syncDeviceListener();
    cb(this.getState());
    return () => {
      this.listeners.delete(cb as (s: HeadingState) => void);
      this.syncDeviceListener();
    };
  }

  private emit() {
    const s = this.getState();
    this.listeners.forEach((l) => l(s as HeadingState));
  }

  // ---------------------------------------------------------------------------
  // Qurilma sensori: giroskop + magnitometr (brauzer sensor fusion qilib, absolyut azimut beradi)
  // ---------------------------------------------------------------------------
  private syncDeviceListener() {
    const want = this.listeners.size > 0 && (this.mode === 'auto' || this.mode === 'device');
    if (want === this.deviceListening || typeof window === 'undefined') return;
    if (want) {
      this.deviceHandler = (e: DeviceOrientationEvent) => {
        const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
        let heading: number | null = null;
        if (typeof ios === 'number' && isFinite(ios)) {
          heading = ios; // iOS: allaqachon shimoldan soat yo'nalishida
        } else if (e.alpha !== null && (e.absolute || e.type === 'deviceorientationabsolute')) {
          // alpha: soat yo'nalishiga TESKARI. Ekran burilgan bo'lsa (planshet yotiq) burchak qo'shiladi
          const screenAngle = (screen.orientation?.angle ?? 0) as number;
          heading = norm(360 - e.alpha + screenAngle);
        }
        if (heading !== null) this.push('device', heading);
      };
      // Android Chrome: absolyut (magnitometr bilan) hodisa; boshqalarda oddiy deviceorientation
      window.addEventListener('deviceorientationabsolute', this.deviceHandler as EventListener);
      window.addEventListener('deviceorientation', this.deviceHandler as EventListener);
    } else if (this.deviceHandler) {
      window.removeEventListener('deviceorientationabsolute', this.deviceHandler as EventListener);
      window.removeEventListener('deviceorientation', this.deviceHandler as EventListener);
      this.deviceHandler = null;
    }
    this.deviceListening = want;
  }

  /** iOS 13+ da sensor ruxsatini so'rash (foydalanuvchi bosganda chaqiriladi) */
  async requestDevicePermission(): Promise<boolean> {
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (DOE?.requestPermission) {
      try {
        return (await DOE.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }
}

export const headingService = new HeadingService();

/**
 * Ekranda chizish uchun silliq burchak: har kadrda (requestAnimationFrame) maqsadga eng qisqa yo'l bilan yaqinlashadi
 * va o'ralmagan (unwrapped) qiymat qaytaradi: CSS rotate 359°->1° da orqaga to'liq aylanmaydi.
 */
export class SmoothAngle {
  private value: number | null = null;
  private tauMs: number;
  private maxDegPerSec: number;
  /**
   * tauMs: yaqinlashish vaqt doimiysi; maxDegPerSec: ekrandagi burilish tezligi chegarasi
   * (katta burilish ham bir kadrda "sakramasdan", bir tekis aylanib bajariladi)
   */
  constructor(tauMs = 140, maxDegPerSec = 300) {
    this.tauMs = tauMs;
    this.maxDegPerSec = maxDegPerSec;
  }

  step(target: number, dtMs: number): number {
    if (this.value === null) {
      this.value = target;
      return target;
    }
    const d = angleDelta(norm(this.value), norm(target));
    // Juda katta sakrash (masalan manba almashdi) ham birdaniga emas, tez lekin silliq bajariladi
    const dt = Math.min(Math.max(0, dtMs), 100); // fon tabidan qaytganda katta dt bitta sakrash bermasin
    const a = 1 - Math.exp(-dt / this.tauMs);
    const maxStep = (this.maxDegPerSec * dt) / 1000;
    this.value += Math.max(-maxStep, Math.min(maxStep, d * a));
    return this.value;
  }

  get(): number | null {
    return this.value;
  }
}
