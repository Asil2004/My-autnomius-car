/**
 * MARKAZIY NAVIGATSIYA HOLATI (sensor fusion): joylashuv + tezlik + yo'nalish bitta, bir-biriga zid bo'lmagan holatda.
 *
 * Kirishlar:
 *   - GPS fix (lat, lon, aniqlik, tezlik, kurs): planshet geolokatsiyasi yoki Pi telemetriyasi
 *   - yo'nalish: headingService (robot IMU -> planshet giroskopi -> GPS kursi)
 *   - harakat belgisi: robotga "to'xta" buyrug'i berilganmi (tezlikni 0 ga tushirish uchun)
 *
 * Model (mahalliy ENU koordinatalarida, metr): har 100 ms da
 *   BASHORAT (dead reckoning):  x += v*sin(h)*dt,  y += v*cos(h)*dt,  P += q*dt   (noaniqlik o'sadi)
 *   TUZATISH (GPS kelganda):     K = P / (P + R),  x += K*(gps_x - x),  P *= (1 - K)   (R = aniqlik^2)
 * Shu sabab GPS kechiksa yoki uzilsa ham joylashuv uzluksiz siljiydi; GPS qaytganda sakramasdan, aniqligiga
 * qarab asta tuzatiladi. Noaniq GPS (masalan 60 m) kam ta'sir qiladi, aniq GPS (4 m) tez tortadi.
 */
import { headingService } from './headingService';

export type PositionSource = 'gps' | 'dead-reckoning' | 'stale' | 'none';

export interface NavState {
  lat: number;
  lon: number;
  /** m/s */
  speed: number;
  /** 0..360, shimoldan soat yo'nalishida */
  heading: number;
  headingSource: 'imu' | 'device' | 'gps' | 'course' | 'none';
  positionSource: PositionSource;
  /** Joylashuv noaniqligi (1 sigma, metr) */
  accuracy: number;
  /** Oxirgi GPS dan beri o'tgan vaqt, ms (GPS umuman bo'lmasa Infinity) */
  gpsAgeMs: number;
  /** Holat vaqti (Date.now) */
  t: number;
  initialized: boolean;
}

const TICK_MS = 100;
/** GPS shuncha vaqt kelmasa dead reckoning rejimi */
const GPS_TIMEOUT_MS = 2500;
/** Dead reckoning shu vaqtdan oshsa joylashuv "eskirgan" deb belgilanadi (siljish to'xtaydi) */
const DR_MAX_MS = 60_000;
/** Jarayon shovqini: harakatda noaniqlik qanchalik tez o'sadi (m^2 / s) */
const Q_MOVING = 1.5;
const Q_STILL = 0.05;
const MIN_GPS_ACC = 3;

const R_EARTH = 6378137;
const toRad = (d: number) => (d * Math.PI) / 180;

class NavigationService {
  private origin: { lat: number; lon: number } | null = null;
  private x = 0; // sharq, m
  private y = 0; // shimol, m
  private P = 25; // joylashuv dispersiyasi, m^2
  private speed = 0; // m/s
  private courseHeading: number | null = null;
  private lastFix: { lat: number; lon: number; t: number } | null = null;
  private lastGpsAt = 0;
  private lastTick = 0;
  private moving = true;
  private timer: number | null = null;
  private listeners = new Set<(s: NavState) => void>();
  private state: NavState = {
    lat: 0,
    lon: 0,
    speed: 0,
    heading: 0,
    headingSource: 'none',
    positionSource: 'none',
    accuracy: Infinity,
    gpsAgeMs: Infinity,
    t: 0,
    initialized: false
  };

  // --- koordinata o'girish (kichik masofalar uchun ekvirektangulyar proyeksiya) ---
  private toLocal(lat: number, lon: number) {
    const o = this.origin!;
    return {
      x: toRad(lon - o.lon) * R_EARTH * Math.cos(toRad(o.lat)),
      y: toRad(lat - o.lat) * R_EARTH
    };
  }

  private toGeo(x: number, y: number) {
    const o = this.origin!;
    return {
      lat: o.lat + (y / R_EARTH) * (180 / Math.PI),
      lon: o.lon + (x / (R_EARTH * Math.cos(toRad(o.lat)))) * (180 / Math.PI)
    };
  }

  /**
   * GPS o'lchovi. speedKmh / courseDeg bo'lmasligi mumkin. accuracyM: qurilma bergan aniqlik (metr).
   */
  pushGps(fix: { lat: number; lon: number; accuracyM?: number | null; speedKmh?: number | null; courseDeg?: number | null }) {
    if (!isFinite(fix.lat) || !isFinite(fix.lon)) return;
    const now = Date.now();
    const acc = Math.max(MIN_GPS_ACC, fix.accuracyM && isFinite(fix.accuracyM) ? fix.accuracyM : 10);
    if (!this.origin) {
      this.origin = { lat: fix.lat, lon: fix.lon };
      this.x = 0;
      this.y = 0;
      this.P = acc * acc;
    } else {
      // Kelib chiqish nuqtasidan juda uzoqlashsa (proyeksiya xatosi), yangi nuqtaga ko'chiramiz
      const cur = this.toGeo(this.x, this.y);
      if (Math.hypot(this.x, this.y) > 20_000) {
        this.origin = { lat: cur.lat, lon: cur.lon };
        this.x = 0;
        this.y = 0;
      }
      this.advance(now); // tuzatishdan oldin hozirgi vaqtgacha bashorat
      const m = this.toLocal(fix.lat, fix.lon);
      const R = acc * acc;
      // Uzoq uzilishdan keyin yoki juda katta farq bo'lsa (masalan sakrash 200 m), GPS ga to'g'ridan-to'g'ri o'tamiz
      const innovation = Math.hypot(m.x - this.x, m.y - this.y);
      const K = now - this.lastGpsAt > DR_MAX_MS || innovation > 150 ? 1 : this.P / (this.P + R);
      this.x += K * (m.x - this.x);
      this.y += K * (m.y - this.y);
      this.P = (1 - K) * this.P + (K === 1 ? R : 0);
    }
    // Ko'p brauzerlar tezlik/kursni bermaydi (null): ketma-ket GPS nuqtalaridan hisoblaymiz
    let derivedSpeed: number | null = null;
    let derivedCourse: number | null = null;
    const prev = this.lastFix;
    if (prev && this.origin) {
      const dt = (now - prev.t) / 1000;
      const a = this.toLocal(prev.lat, prev.lon);
      const b = this.toLocal(fix.lat, fix.lon);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      // Siljish GPS shovqinidan kattaroq bo'lsagina hisobga olinadi (turgan robot "yurib" ketmasin)
      if (dt >= 0.5 && dt <= 10) {
        derivedSpeed = dist > Math.max(1.5, acc * 0.5) ? dist / dt : 0;
        if (dist > Math.max(2, acc * 0.5)) derivedCourse = ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
      }
    }
    // Taqqoslash nuqtasi ~1 s da bir yangilanadi (GPS tez-tez kelsa ham siljish shovqindan ajralib turadi)
    if (!prev || now - prev.t >= 1000) this.lastFix = { lat: fix.lat, lon: fix.lon, t: now };
    const reported = fix.speedKmh !== null && fix.speedKmh !== undefined && isFinite(fix.speedKmh) ? Math.max(0, fix.speedKmh / 3.6) : null;
    const v = reported !== null && (reported > 0 || derivedSpeed === null) ? reported : derivedSpeed;
    if (v !== null) this.speed += (v - this.speed) * 0.5; // tezlikni ham silliqlash
    const course = fix.courseDeg !== null && fix.courseDeg !== undefined && isFinite(fix.courseDeg) && fix.courseDeg !== 0 ? fix.courseDeg : derivedCourse;
    if (course !== null && this.speed > 0.3) this.courseHeading = ((course % 360) + 360) % 360;
    this.lastGpsAt = now;
    this.lastTick = now;
    this.publish(now);
  }

  /** Robot harakat buyrug'i: "S" (to'xta) bo'lsa dead reckoning siljimaydi va tezlik 0 ga tushadi */
  setMoving(moving: boolean) {
    this.moving = moving;
    if (!moving) this.speed = 0;
  }

  /** Odometriya / g'ildirak tezligi bo'lsa (m/s), GPS tezligidan ustun */
  pushSpeed(mps: number) {
    if (isFinite(mps) && mps >= 0) this.speed += (mps - this.speed) * 0.6;
  }

  private headingNow(): { h: number; src: NavState['headingSource'] } {
    const g = headingService.getState();
    if (g) return { h: g.heading, src: g.source === 'none' ? 'none' : g.source };
    if (this.courseHeading !== null) return { h: this.courseHeading, src: 'course' };
    return { h: this.state.heading, src: 'none' };
  }

  /** Bashorat: oxirgi holatdan `now` gacha dead reckoning */
  private advance(now: number) {
    if (!this.origin) return;
    const dt = Math.min(1, Math.max(0, (now - (this.lastTick || now)) / 1000));
    this.lastTick = now;
    if (dt <= 0) return;
    const gpsAge = now - this.lastGpsAt;
    const v = this.moving && gpsAge < DR_MAX_MS ? this.speed : 0;
    if (v > 0.02) {
      const { h } = this.headingNow();
      this.x += v * Math.sin(toRad(h)) * dt;
      this.y += v * Math.cos(toRad(h)) * dt;
    }
    this.P += (v > 0.02 ? Q_MOVING : Q_STILL) * dt;
  }

  private publish(now: number) {
    if (!this.origin) return;
    const geo = this.toGeo(this.x, this.y);
    const gpsAge = this.lastGpsAt ? now - this.lastGpsAt : Infinity;
    const { h, src } = this.headingNow();
    this.state = {
      lat: geo.lat,
      lon: geo.lon,
      speed: this.moving ? +this.speed.toFixed(2) : 0,
      heading: h,
      headingSource: src,
      positionSource: gpsAge < GPS_TIMEOUT_MS ? 'gps' : gpsAge < DR_MAX_MS ? 'dead-reckoning' : 'stale',
      accuracy: +Math.sqrt(this.P).toFixed(1),
      gpsAgeMs: gpsAge,
      t: now,
      initialized: true
    };
    this.listeners.forEach((l) => l(this.state));
  }

  private tick = () => {
    const now = Date.now();
    this.advance(now);
    this.publish(now);
  };

  getState(): NavState {
    return this.state;
  }

  subscribe(cb: (s: NavState) => void): () => void {
    this.listeners.add(cb);
    if (!this.timer) this.timer = window.setInterval(this.tick, TICK_MS);
    if (this.state.initialized) cb(this.state);
    return () => {
      this.listeners.delete(cb);
      if (!this.listeners.size && this.timer) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** Test va simulyatsiya uchun: holatni boshidan boshlash */
  reset() {
    this.origin = null;
    this.speed = 0;
    this.courseHeading = null;
    this.lastFix = null;
    this.lastGpsAt = 0;
    this.lastTick = 0;
    this.P = 25;
    this.state = { ...this.state, initialized: false, positionSource: 'none' };
  }
}

export const navigationService = new NavigationService();
