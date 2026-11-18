/**
 * GPS AVTOPILOT: robot (planshet) o'z joylashuvi va yo'nalishiga qarab ESP32'ga buyruq berib, operator chizgan
 * marshrut nuqtalari bo'ylab manzilga yetguncha yuradi.
 *
 *  - Joylashuv/yo'nalish: navigationService (GPS + giroskop + dead reckoning).
 *  - Boshqaruv: yo'nalish xatosi katta -> joyida burilish (L/R), o'rtacha -> egri yurish (G/I), kichik -> oldinga (F).
 *  - To'siq: kamera (HUD dagi aniqlash) yoki sonar to'siq ko'rsa -> to'xtash (S), kutish, so'ng bo'sh tomonga burilib
 *    chetlab o'tish va yana marshrutga qaytish. Kamera ma'lumoti kelmasa robot KO'R yurmaydi (kutadi).
 *  - Har qanday qo'lda buyruq (joystik, klaviatura) avtopilotni darhol bekor qiladi.
 *
 * Xizmat React komponentidan tashqarida yashaydi: xarita yopilib, HUD (kamera) ochilsa ham ishlashda davom etadi.
 */
import type { MecanumCommand } from '../types/robot';
import { navigationService, type NavState } from './navigationService';
import { lidarSerialService } from './lidarSerialService';

export interface AutopilotWaypoint {
  lat: number;
  lon: number;
}

export interface ObstacleInfo {
  /** Oldingi eng yaqin to'siq (LiDAR yoki Sonar), sm */
  distanceCm: number;
  label: string;
  evasion: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE';
  sonarFrontCm?: number;
  lidarFrontCm?: number;
  lidarActive?: boolean;
  cameraT?: number;
}

export type AutopilotPhase =
  | 'idle'
  | 'waiting-gps'
  | 'waiting-camera'
  | 'driving'
  | 'obstacle-stop'
  | 'bypass-turn'
  | 'bypass-forward'
  | 'arrived'
  | 'failed';

export interface AutopilotState {
  active: boolean;
  phase: AutopilotPhase;
  message: string;
  targetIndex: number;
  total: number;
  routeDir: 1 | -1;
  distanceToTargetM: number;
  distanceToEndM: number;
  bearingErrorDeg: number;
  crossTrackM: number;
  carrot: AutopilotWaypoint | null;
  command: MecanumCommand;
  bypassAttempts: number;
}

export const AUTOPILOT_CONFIG = {
  tickMs: 200,
  /** Nuqtaga yetdi deb hisoblash radiusi, m */
  arriveMinM: 2.5,
  arriveMaxM: 7.0,
  /** Joylashuv aniqligi shundan yomon bo'lsa yurmaydi, m (planshet/noutbuk GPS uchun moslashuvchan) */
  maxAccuracyM: 100,
  /** Yo'nalish xatosi: shundan katta -> joyida burilish */
  spinDeg: 35,
  /** shundan katta -> egri yurish */
  curveDeg: 10,
  /** Avtopilotda to'siqqa ruxsat etilgan standart masofa, sm (LiDAR/Sonar) */
  stopCm: 50,
  /** Chizilgan chiziq bo'yicha oldinga qarash (Lookahead / Carrot) masofasi, m */
  lookaheadM: 3.5,
  /** To'siq oldida to'xtab kutish (o'tib ketuvchi odam/mashina uchun) */
  obstacleWaitMs: 2000,
  /** Chetlab o'tishda: yo'l ochilgandan keyin yana shuncha burilish (robot kengligi uchun zaxira) */
  extraTurnMs: 550,
  maxTurnMs: 4000,
  /** Chetlab o'tish oldinga bo'lagi */
  bypassForwardMs: 2400,
  maxBypassAttempts: 4
};

type Driver = (cmd: MecanumCommand) => void;
type ObstacleProvider = () => ObstacleInfo;

const R_EARTH = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) - Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Chizilgan A -> B chiziq kesmasi bo'ylab robot uchun "Carrot" (oldindagi maqsad nuqta)
 * va chiziqdan chetga chiqish (cross-track) masofasini hisoblash
 */
function computeLineLookahead(
  robotLat: number,
  robotLon: number,
  a: AutopilotWaypoint,
  b: AutopilotWaypoint,
  lookaheadM: number
): { carrot: AutopilotWaypoint; crossTrackM: number } {
  const cosLat = Math.cos(toRad(a.lat)) || 1;
  const toX = (lon: number) => toRad(lon - a.lon) * R_EARTH * cosLat;
  const toY = (lat: number) => toRad(lat - a.lat) * R_EARTH;

  const bx = toX(b.lon);
  const by = toY(b.lat);
  const segLen = Math.hypot(bx, by);
  if (segLen < 0.2) {
    return { carrot: b, crossTrackM: distanceM(robotLat, robotLon, b.lat, b.lon) };
  }

  const rx = toX(robotLon);
  const ry = toY(robotLat);
  const ux = bx / segLen;
  const uy = by / segLen;

  // Chiziq bo'ylab proyeksiya va perpendikulyar chetga chiqish
  const proj = Math.max(0, Math.min(segLen, rx * ux + ry * uy));
  const cx = proj * ux;
  const cy = proj * uy;
  const crossTrackM = Math.hypot(rx - cx, ry - cy);

  const carrotDist = Math.min(segLen, proj + lookaheadM);
  const kx = carrotDist * ux;
  const ky = carrotDist * uy;

  return {
    carrot: {
      lat: a.lat + (ky / R_EARTH) * (180 / Math.PI),
      lon: a.lon + (kx / (R_EARTH * cosLat)) * (180 / Math.PI)
    },
    crossTrackM: +crossTrackM.toFixed(1)
  };
}

class AutopilotService {
  private driver: Driver | null = null;
  private obstacles: ObstacleProvider | null = null;
  private route: AutopilotWaypoint[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(s: AutopilotState) => void>();
  private lastSent: MecanumCommand = 'S';
  private lastSentAt = 0;
  /** Avtopilot o'zi buyruq yuborayotganda true (qo'lda buyruqni ajratish uchun) */
  private sending = false;
  private phaseSince = 0;
  private clearSince = 0;
  private turnDir: 'L' | 'R' = 'L';
  private roundTrip = true;
  private routeDir: 1 | -1 = 1;
  private state: AutopilotState = {
    active: false,
    phase: 'idle',
    message: 'Avtopilot o‘chiq',
    targetIndex: 0,
    total: 0,
    routeDir: 1,
    distanceToTargetM: 0,
    distanceToEndM: 0,
    bearingErrorDeg: 0,
    crossTrackM: 0,
    carrot: null,
    command: 'S',
    bypassAttempts: 0
  };

  getStopCm(): number {
    return lidarSerialService.getStopCm() || AUTOPILOT_CONFIG.stopCm;
  }

  /** RobotContext: haqiqiy ESP32 buyrug'ini yuboruvchi funksiya */
  setDriver(d: Driver | null) {
    this.driver = d;
  }

  /** RobotContext: LiDAR + sonar + kamera to'siq ma'lumoti */
  setObstacleProvider(p: ObstacleProvider | null) {
    this.obstacles = p;
  }

  setRoundTrip(enabled: boolean) {
    this.roundTrip = enabled;
  }

  isRoundTrip(): boolean {
    return this.roundTrip;
  }

  isSending() {
    return this.sending;
  }

  getState() {
    return this.state;
  }

  getRoute() {
    return this.route;
  }

  subscribe(cb: (s: AutopilotState) => void) {
    this.listeners.add(cb);
    cb(this.state);
    return () => {
      this.listeners.delete(cb);
    };
  }

  start(route: AutopilotWaypoint[], roundTrip = true) {
    if (route.length < 1) return;
    this.roundTrip = roundTrip;
    this.route = route.map((p) => ({ ...p }));
    this.routeDir = 1;
    this.clearSince = 0;
    this.set({
      active: true,
      targetIndex: 0,
      total: this.route.length,
      routeDir: 1,
      crossTrackM: 0,
      carrot: this.route[0],
      bypassAttempts: 0,
      phase: 'driving',
      message: roundTrip ? 'Avtopilot yoqildi (Chiziq bo‘ylab borib-qaytish)' : 'Avtopilot yoqildi (Chiziq bo‘ylab)'
    });
    this.phaseSince = Date.now();
    this.lastSent = 'S';
    this.lastSentAt = 0;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), AUTOPILOT_CONFIG.tickMs);
    this.tick();
  }

  /** Operator to'xtatdi yoki qo'lda buyruq berildi */
  stop(reason = 'Avtopilot to‘xtatildi') {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasActive = this.state.active;
    this.set({ active: false, carrot: null, phase: this.state.phase === 'arrived' ? 'arrived' : 'idle', message: reason });
    if (wasActive) this.drive('S', true);
  }

  private set(p: Partial<AutopilotState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l(this.state));
  }

  private drive(cmd: MecanumCommand, force = false) {
    const now = Date.now();
    // Bir xil buyruq qayta yuborilmaydi (RobotContext o'zi har 250 ms keep-alive yuboradi); faqat 2 s da bir marta tasdiq
    if (!force && cmd === this.lastSent && now - this.lastSentAt < 2000) return;
    this.lastSent = cmd;
    this.lastSentAt = now;
    this.set({ command: cmd });
    if (!this.driver) return;
    this.sending = true;
    try {
      this.driver(cmd);
    } finally {
      this.sending = false;
    }
  }

  private enter(phase: AutopilotPhase, message: string) {
    if (this.state.phase !== phase) this.phaseSince = Date.now();
    this.set({ phase, message });
  }

  private tick() {
    if (!this.state.active) return;
    const cfg = AUTOPILOT_CONFIG;
    const now = Date.now();
    const nav: NavState = navigationService.getState();
    const obs = this.obstacles?.();

    // 1) Planshet/qurilma GPS tayyor emas -> turib kutadi
    if (!nav.initialized || nav.positionSource === 'stale' || nav.positionSource === 'none' || nav.accuracy > cfg.maxAccuracyM) {
      this.drive('S');
      this.enter('waiting-gps', `GPS kutilmoqda (aniqlik ${Number.isFinite(nav.accuracy) ? Math.round(nav.accuracy) : '—'} m)`);
      return;
    }

    // 2) Chizilgan marshrut hisobi va borib-qaytish mantiqi
    let idx = this.state.targetIndex;
    const arriveR = Math.min(cfg.arriveMaxM, Math.max(cfg.arriveMinM, Math.min(nav.accuracy, 20) * 0.4));
    let target = this.route[idx];
    let dist = distanceM(nav.lat, nav.lon, target.lat, target.lon);

    while (dist <= arriveR) {
      if (this.routeDir === 1 && idx >= this.route.length - 1) {
        // Oxirgi nuqtaga yetdi
        if (this.roundTrip && this.route.length > 1) {
          this.routeDir = -1;
          idx = this.route.length - 2;
          target = this.route[idx];
          dist = distanceM(nav.lat, nav.lon, target.lat, target.lon);
          this.set({ routeDir: -1 });
          break;
        } else {
          this.drive('S', true);
          this.set({ distanceToTargetM: dist, distanceToEndM: dist, carrot: null });
          if (this.timer) clearInterval(this.timer);
          this.timer = null;
          this.set({ active: false, phase: 'arrived', message: '✅ Manzilga yetib keldi' });
          return;
        }
      } else if (this.routeDir === -1 && idx <= 0) {
        // Boshlang'ich nuqtaga qaytib keldi
        this.drive('S', true);
        this.set({ distanceToTargetM: dist, distanceToEndM: dist, carrot: null });
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.set({ active: false, phase: 'arrived', message: '✅ Boshlang‘ich nuqtaga to‘liq qaytib keldi' });
        return;
      }

      idx += this.routeDir;
      if (idx < 0 || idx >= this.route.length) break;
      target = this.route[idx];
      dist = distanceM(nav.lat, nav.lon, target.lat, target.lon);
    }

    let rest = dist;
    if (this.routeDir === 1) {
      for (let i = idx + 1; i < this.route.length; i++) {
        rest += distanceM(this.route[i - 1].lat, this.route[i - 1].lon, this.route[i].lat, this.route[i].lon);
      }
      if (this.roundTrip) {
        for (let i = this.route.length - 1; i > 0; i--) {
          rest += distanceM(this.route[i].lat, this.route[i].lon, this.route[i - 1].lat, this.route[i - 1].lon);
        }
      }
    } else {
      for (let i = idx; i > 0; i--) {
        rest += distanceM(this.route[i].lat, this.route[i].lon, this.route[i - 1].lat, this.route[i - 1].lon);
      }
    }

    // Chizilgan chiziq kesmasi bo'ylab Lookahead ("Carrot") nuqtasini topish
    const prevIdx = idx - this.routeDir;
    let aimPoint: AutopilotWaypoint = target;
    let crossTrackM = 0;
    if (prevIdx >= 0 && prevIdx < this.route.length) {
      const la = computeLineLookahead(nav.lat, nav.lon, this.route[prevIdx], target, cfg.lookaheadM);
      aimPoint = la.carrot;
      crossTrackM = la.crossTrackM;
    }

    const err = wrap180(bearingDeg(nav.lat, nav.lon, aimPoint.lat, aimPoint.lon) - nav.heading);
    this.set({
      targetIndex: idx,
      routeDir: this.routeDir,
      distanceToTargetM: dist,
      distanceToEndM: rest,
      bearingErrorDeg: Math.round(err),
      crossTrackM,
      carrot: aimPoint
    });

    // 3) To'siq tekshiruvi (LiDAR va Sonar orqali, gisterezis bilan)
    let frontCm = Infinity;
    if (obs) {
      if (Number.isFinite(obs.lidarFrontCm) && obs.lidarFrontCm! > 0) {
        frontCm = Math.min(frontCm, obs.lidarFrontCm!);
      }
      if (Number.isFinite(obs.sonarFrontCm) && obs.sonarFrontCm! > 0) {
        frontCm = Math.min(frontCm, obs.sonarFrontCm!);
      }
      if (Number.isFinite(obs.distanceCm) && obs.distanceCm > 0 && obs.distanceCm < frontCm) {
        frontCm = obs.distanceCm;
      }
    }
    const stopCm = this.getStopCm();
    const blocked = Number.isFinite(frontCm) && frontCm <= stopCm;
    const clearMargin = !Number.isFinite(frontCm) || frontCm > stopCm + 15;
    if (clearMargin) this.clearSince = this.clearSince || now;
    else this.clearSince = 0;

    const phase = this.state.phase;
    const inPhase = now - this.phaseSince;

    // 4) To'siqni chetlab o'tish holat mashinasi
    if (phase === 'obstacle-stop') {
      if (!blocked && clearMargin && now - this.clearSince > 700) {
        this.enter('driving', 'Yo‘l ochildi, chiziq bo‘ylab davom etmoqda');
      } else if (inPhase > cfg.obstacleWaitMs) {
        if (this.state.bypassAttempts >= cfg.maxBypassAttempts) {
          this.stop(`⚠️ To‘siqni chetlab o‘tib bo‘lmadi (${obs?.label ?? 'to‘siq'}). Operator aralashuvi kerak`);
          this.set({ phase: 'failed' });
          return;
        }
        const attempt = this.state.bypassAttempts;
        let dir: 'L' | 'R' = obs?.evasion === 'RIGHT' ? 'R' : obs?.evasion === 'LEFT' ? 'L' : err >= 0 ? 'R' : 'L';
        if (attempt % 2 === 1) dir = dir === 'L' ? 'R' : 'L';
        this.turnDir = dir;
        this.set({ bypassAttempts: attempt + 1 });
        this.drive(obs?.evasion === 'REVERSE' ? 'B' : dir, true);
        this.enter('bypass-turn', `🛑 To‘siqni aylanib o‘tish: ${dir === 'L' ? 'chapga' : 'o‘ngga'} burilmoqda`);
      } else {
        this.drive('S');
      }
      return;
    }

    if (phase === 'bypass-turn') {
      if (obs?.evasion === 'REVERSE' && inPhase < 900) {
        this.drive('B');
        return;
      }
      const clearFor = this.clearSince ? now - this.clearSince : 0;
      if (clearFor > cfg.extraTurnMs) {
        this.drive('F', true);
        this.enter('bypass-forward', 'To‘siq yonidan o‘tmoqda (oldinga)');
      } else if (inPhase > cfg.maxTurnMs) {
        this.drive('S', true);
        this.enter('obstacle-stop', 'Bu tomonda ham to‘siq, boshqa tomon sinanadi');
      } else {
        this.drive(this.turnDir);
      }
      return;
    }

    if (blocked) {
      this.drive('S', true);
      this.enter('obstacle-stop', `🛑 To‘siq: ${obs?.label ?? 'Aniqlangan'}, ${Math.round(frontCm)} sm. Kutilmoqda`);
      return;
    }

    if (phase === 'bypass-forward') {
      if (inPhase > cfg.bypassForwardMs) {
        this.enter('driving', 'Chizilgan chiziqqa qaytmoqda');
      } else {
        this.drive('F');
      }
      return;
    }

    // 5) Chizilgan chiziq bo'yicha silliq yurish
    let cmd: MecanumCommand;
    if (Math.abs(err) > cfg.spinDeg) cmd = err > 0 ? 'R' : 'L';
    else if (Math.abs(err) > cfg.curveDeg) cmd = err > 0 ? 'I' : 'G';
    else cmd = 'F';
    if (this.state.bypassAttempts && phase === 'driving' && inPhase > 10_000) this.set({ bypassAttempts: 0 });
    this.drive(cmd);
    const dirText = this.routeDir === 1 ? 'Borish' : 'Qaytish';
    this.enter('driving', `${dirText} (${idx + 1}/${this.route.length}-nuqta): ${dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(2)} km`}`);
  }
}

export const autopilotService = new AutopilotService();
