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

export interface AutopilotWaypoint {
  lat: number;
  lon: number;
}

export interface ObstacleInfo {
  /** Oldingi eng yaqin to'siq, sm */
  distanceCm: number;
  label: string;
  evasion: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE';
  /** Oxirgi kamera tahlili vaqti (Date.now), 0 = hech qachon */
  cameraT: number;
  /** Sonar oldi, sm */
  sonarFrontCm: number;
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
  distanceToTargetM: number;
  distanceToEndM: number;
  bearingErrorDeg: number;
  command: MecanumCommand;
  bypassAttempts: number;
}

export const AUTOPILOT_CONFIG = {
  tickMs: 200,
  /** Nuqtaga yetdi deb hisoblash radiusi, m (GPS aniqligi yomon bo'lsa biroz kattalashadi) */
  arriveMinM: 2.5,
  arriveMaxM: 6,
  /** Joylashuv aniqligi shundan yomon bo'lsa yurmaydi, m */
  maxAccuracyM: 15,
  /** Yo'nalish xatosi: shundan katta -> joyida burilish */
  spinDeg: 40,
  /** shundan katta -> egri yurish */
  curveDeg: 12,
  /** Avtopilotda to'siqqa ruxsat etilgan eng yaqin masofa, sm */
  stopCm: 60,
  /** Kamera tahlili shuncha vaqt kelmasa -> kutish */
  cameraTimeoutMs: 3000,
  /** To'siq oldida to'xtab kutish (o'tib ketuvchi odam/mashina uchun) */
  obstacleWaitMs: 2000,
  /** Chetlab o'tishda: yo'l ochilgandan keyin yana shuncha burilish (robot kengligi uchun zaxira) */
  extraTurnMs: 600,
  maxTurnMs: 4000,
  /** Chetlab o'tish oldinga bo'lagi */
  bypassForwardMs: 3000,
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
  private state: AutopilotState = {
    active: false,
    phase: 'idle',
    message: 'Avtopilot o‘chiq',
    targetIndex: 0,
    total: 0,
    distanceToTargetM: 0,
    distanceToEndM: 0,
    bearingErrorDeg: 0,
    command: 'S',
    bypassAttempts: 0
  };

  /** RobotContext: haqiqiy ESP32 buyrug'ini yuboruvchi funksiya */
  setDriver(d: Driver | null) {
    this.driver = d;
  }

  /** RobotContext: kamera + sonar to'siq ma'lumoti */
  setObstacleProvider(p: ObstacleProvider | null) {
    this.obstacles = p;
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

  start(route: AutopilotWaypoint[]) {
    if (route.length < 1) return;
    this.route = route.map((p) => ({ ...p }));
    // Robotga eng yaqin nuqtadan emas, birinchi (yashil) nuqtadan boshlanadi; agar robot allaqachon unda bo'lsa keyingisiga
    this.set({ active: true, targetIndex: 0, total: this.route.length, bypassAttempts: 0, phase: 'driving', message: 'Avtopilot yoqildi' });
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
    this.set({ active: false, phase: this.state.phase === 'arrived' ? 'arrived' : 'idle', message: reason });
    if (wasActive) this.drive('S', true);
  }

  private set(p: Partial<AutopilotState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l(this.state));
  }

  private drive(cmd: MecanumCommand, force = false) {
    const now = Date.now();
    // Bir xil buyruq qayta yuborilmaydi (RobotContext o'zi har 250 ms keep-alive yuboradi); faqat 3 s da bir marta tasdiq
    if (!force && cmd === this.lastSent && now - this.lastSentAt < 3000) return;
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

    // 1) Joylashuv ishonchli emas -> turib kutadi
    if (!nav.initialized || nav.positionSource === 'stale' || nav.positionSource === 'none' || nav.accuracy > cfg.maxAccuracyM) {
      this.drive('S');
      this.enter('waiting-gps', `GPS kutilmoqda (aniqlik ${Number.isFinite(nav.accuracy) ? Math.round(nav.accuracy) : '—'} m)`);
      return;
    }

    // 2) Marshrut hisobi
    let idx = this.state.targetIndex;
    const arriveR = Math.min(cfg.arriveMaxM, Math.max(cfg.arriveMinM, nav.accuracy * 0.8));
    let target = this.route[idx];
    let dist = distanceM(nav.lat, nav.lon, target.lat, target.lon);
    while (dist <= arriveR) {
      if (idx >= this.route.length - 1) {
        this.drive('S', true);
        this.set({ distanceToTargetM: dist, distanceToEndM: dist });
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.set({ active: false, phase: 'arrived', message: '✅ Manzilga yetib keldi' });
        return;
      }
      idx++;
      target = this.route[idx];
      dist = distanceM(nav.lat, nav.lon, target.lat, target.lon);
    }
    let rest = dist;
    for (let i = idx + 1; i < this.route.length; i++) {
      rest += distanceM(this.route[i - 1].lat, this.route[i - 1].lon, this.route[i].lat, this.route[i].lon);
    }
    const err = wrap180(bearingDeg(nav.lat, nav.lon, target.lat, target.lon) - nav.heading);
    this.set({ targetIndex: idx, distanceToTargetM: dist, distanceToEndM: rest, bearingErrorDeg: Math.round(err) });

    // 3) Kamera ishlamasa ko'r yurmaydi
    const cameraFresh = !!obs && obs.cameraT > 0 && now - obs.cameraT < cfg.cameraTimeoutMs;
    if (!cameraFresh) {
      this.drive('S');
      this.enter('waiting-camera', 'Kamera to‘siq tahlili kutilmoqda (kamera yoki HUD dagi AI yoqilmagan)');
      return;
    }
    const frontCm = Math.min(obs!.distanceCm, obs!.sonarFrontCm);
    const blocked = frontCm <= cfg.stopCm;
    if (!blocked) this.clearSince = this.clearSince || now;
    else this.clearSince = 0;

    const phase = this.state.phase;
    const inPhase = now - this.phaseSince;

    // 4) To'siqni chetlab o'tish holat mashinasi
    if (phase === 'obstacle-stop') {
      this.drive('S');
      if (!blocked && now - this.clearSince > 800) {
        this.enter('driving', 'Yo‘l ochildi, davom etmoqda');
      } else if (inPhase > cfg.obstacleWaitMs) {
        if (this.state.bypassAttempts >= cfg.maxBypassAttempts) {
          this.stop(`⚠️ To‘siqni chetlab o‘tib bo‘lmadi (${obs!.label}). Operator aralashuvi kerak`);
          this.set({ phase: 'failed' });
          return;
        }
        // Bo'sh tomon: kamera tavsiyasi, bo'lmasa marshrut tomoni; har urinishda tomon almashadi
        const attempt = this.state.bypassAttempts;
        let dir: 'L' | 'R' = obs!.evasion === 'RIGHT' ? 'R' : obs!.evasion === 'LEFT' ? 'L' : err >= 0 ? 'R' : 'L';
        if (attempt % 2 === 1) dir = dir === 'L' ? 'R' : 'L';
        this.turnDir = dir;
        this.set({ bypassAttempts: attempt + 1 });
        this.enter('bypass-turn', `To‘siqni chetlab o‘tish: ${dir === 'L' ? 'chapga' : 'o‘ngga'} burilmoqda`);
      }
      return;
    }

    if (phase === 'bypass-turn') {
      if (obs!.evasion === 'REVERSE' && inPhase < 1000) {
        this.drive('B');
        return;
      }
      this.drive(this.turnDir);
      const clearFor = this.clearSince ? now - this.clearSince : 0;
      if (clearFor > cfg.extraTurnMs) {
        this.enter('bypass-forward', 'Chetlab o‘tish: oldinga');
      } else if (inPhase > cfg.maxTurnMs) {
        this.enter('obstacle-stop', 'Bu tomonda ham to‘siq, boshqa tomon sinanadi');
      }
      return;
    }

    if (blocked) {
      this.drive('S', true);
      this.enter('obstacle-stop', `🛑 To‘siq: ${obs!.label}, ${Math.round(frontCm)} sm. Kutilmoqda`);
      return;
    }

    if (phase === 'bypass-forward') {
      this.drive('F');
      if (inPhase > cfg.bypassForwardMs) this.enter('driving', 'Marshrutga qaytmoqda');
      return;
    }

    // 5) Oddiy yurish: yo'nalish xatosiga qarab
    let cmd: MecanumCommand;
    if (Math.abs(err) > cfg.spinDeg) cmd = err > 0 ? 'R' : 'L';
    else if (Math.abs(err) > cfg.curveDeg) cmd = err > 0 ? 'I' : 'G';
    else cmd = 'F';
    // To'siqsiz uzoq yurilsa chetlab o'tish hisobi nolga qaytadi
    if (this.state.bypassAttempts && phase === 'driving' && inPhase > 10_000) this.set({ bypassAttempts: 0 });
    this.drive(cmd);
    this.enter('driving', `${idx + 1}/${this.route.length}-nuqtaga: ${dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(2)} km`}`);
  }
}

export const autopilotService = new AutopilotService();
