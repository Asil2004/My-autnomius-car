import type { MecanumCommand } from '../types/robot';

export type LineColorPreset = 'tactile_yellow' | 'bright_yellow' | 'blue' | 'white' | 'black';

export type LineDriveMode = 'assisted' | 'auto' | 'test';

export interface LineFollowerConfig {
  colorPreset: LineColorPreset;
  /**
   * assisted: Oldingani bosganda yuradi, qo'yib yuborganda avtonom buriladi,
   *           chiziq bo'lmagan tomonga burilish taqiqlanadi (tavsiya etiladi!).
   * auto: To'liq avtonom doimiy yurish.
   * test: Motorlar o'chirilgan, faqat vizual kamera sinovi.
   */
  driveMode: LineDriveMode;
  /** (R+G)/2 - B minimal farqi (10..42). Qulay Makon taktil sariq yo'lak uchun 20 optimal. */
  yellownessMin: number;
  /** Oldinga/egri burilish o'lik zonasi (0.05..0.35). */
  curveDeadband: number;
  /** Joyida burilish (L/R) chegarasi (0.35..0.85). */
  spinThreshold: number;
  /** Yo'lak ko'rinmay qolganda motorlarni to'xtatish vaqti (ms). */
  lostStopMs: number;
  /** Agar kamera apparat darajasida teskari (mirror) bo'lsa, chap/o'ng rulni almashtirish. */
  invertSteering: boolean;
}

export interface UserDriveIntent {
  /** Foydalanuvchi oldinga yurishni bosib turibdimi (W, ArrowUp, HUD F, joystik yuqoriga)? */
  forward: boolean;
  /** Foydalanuvchi chapga burilishni bosib turibdimi (A, ArrowLeft, HUD L, joystik chap)? */
  turnLeft: boolean;
  /** Foydalanuvchi o'ngga burilishni bosib turibdimi (D, ArrowRight, HUD R, joystik o'ng)? */
  turnRight: boolean;
  /** Foydalanuvchi orqaga yurishni bosib turibdimi (S, ArrowDown, HUD B, joystik pastga)? */
  reverse: boolean;
  /** Favqulodda to'xtash bosilganmi */
  emergencyStop?: boolean;
}

export const DEFAULT_DRIVE_INTENT: UserDriveIntent = {
  forward: false,
  turnLeft: false,
  turnRight: false,
  reverse: false,
  emergencyStop: false
};

export interface LineBandSample {
  /** Normalizatsiyalangan vertikal markaz (0..1). */
  y: number;
  /** Normalizatsiyalangan chap chegara (0..1). */
  x0: number;
  /** Normalizatsiyalangan o'ng chegara (0..1). */
  x1: number;
  /** Normalizatsiyalangan chiziq markazi (0..1). */
  cx: number;
  /** T-chorraha yon shoxi filtrlangan bo'lsa true. */
  clamped?: boolean;
}

export interface LineAnalysisResult {
  detected: boolean;
  confidence: number;
  /** Yaqin qism markazdan og'ishi: -1 (chap) .. 0 (markaz) .. +1 (o'ng). */
  offsetNorm: number;
  /** Uzoq vs yaqin qiyalik burchagi (gradus, manfiy = chapga buriladi). */
  angleDeg: number;
  /** Kombinatsiyalangan rul signali (-1..+1). */
  rawSteer: number;
  /** T-shaklidagi yon yo'lak shoxi aniqlanib filtrlandi. */
  tJunctionFiltered: boolean;
  /** T-chorraha qaysi tomonga shoxlangan: 'left' | 'right' | null */
  tJunctionSide?: 'left' | 'right' | null;
  /** Qancha foiz kadr maydoni chiziq piksellariga mos tushdi. */
  coverage: number;
  bands: LineBandSample[];
}

export interface LineControlStep extends LineAnalysisResult {
  smoothedSteer: number;
  /** Foydalanuvchi ko'rish oynasi uchun burilmagan (invertSteering siz) silliqlangan rul qiymati. */
  visualSteer: number;
  command: MecanumCommand;
  statusLabel: string;
  lostDurationMs: number;
  /** Chiziq yo'qligi sababli bloklangan yo'nalish */
  guardBlocked?: 'left' | 'right' | null;
  /** Qo'yib yuborilganda joyida avtonom burilish/to'g'irlanish holati */
  autoAligning?: boolean;
}

export const LINE_FOLLOWER_STORAGE_KEY = 'qalqon_line_follower_cfg_v2';

export const DEFAULT_LINE_CONFIG: LineFollowerConfig = {
  colorPreset: 'tactile_yellow',
  driveMode: 'assisted',
  yellownessMin: 12,
  curveDeadband: 0.05,
  spinThreshold: 0.38,
  lostStopMs: 1200,
  invertSteering: false
};

export function loadLineFollowerConfig(): LineFollowerConfig {
  try {
    const raw = localStorage.getItem(LINE_FOLLOWER_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LINE_CONFIG };
    const parsed = JSON.parse(raw) as Partial<LineFollowerConfig>;
    return {
      colorPreset:
        parsed.colorPreset && ['tactile_yellow', 'bright_yellow', 'blue', 'white', 'black'].includes(parsed.colorPreset)
          ? parsed.colorPreset
          : DEFAULT_LINE_CONFIG.colorPreset,
      driveMode:
        parsed.driveMode && ['assisted', 'auto', 'test'].includes(parsed.driveMode)
          ? parsed.driveMode
          : DEFAULT_LINE_CONFIG.driveMode,
      yellownessMin:
        typeof parsed.yellownessMin === 'number' ? clamp(parsed.yellownessMin, 10, 42) : DEFAULT_LINE_CONFIG.yellownessMin,
      curveDeadband:
        typeof parsed.curveDeadband === 'number' ? clamp(parsed.curveDeadband, 0.05, 0.35) : DEFAULT_LINE_CONFIG.curveDeadband,
      spinThreshold:
        typeof parsed.spinThreshold === 'number' ? clamp(parsed.spinThreshold, 0.35, 0.85) : DEFAULT_LINE_CONFIG.spinThreshold,
      lostStopMs:
        typeof parsed.lostStopMs === 'number' ? clamp(parsed.lostStopMs, 150, 1500) : DEFAULT_LINE_CONFIG.lostStopMs,
      invertSteering: Boolean(parsed.invertSteering)
    };
  } catch {
    return { ...DEFAULT_LINE_CONFIG };
  }
}

export function saveLineFollowerConfig(cfg: LineFollowerConfig): void {
  try {
    localStorage.setItem(LINE_FOLLOWER_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* localStorage yopiq bo'lsa ham sessiya ishlayveradi */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Bir pikselning tanlangan chiziq rangiga mosligini tekshiradi.
 * `tactile_yellow` rejimi ko'zi ojizlar yo'lagining xira/yaltiroq sariq PVC plitalari (QULAY MAKON)
 * hamda kulrang/oq pol fonidan kabel/soyani ajratish uchun kalibrlangan.
 */
export function isLinePixel(
  r: number,
  g: number,
  b: number,
  preset: LineColorPreset,
  yellownessMin: number
): boolean {
  if (preset === 'tactile_yellow') {
    const yellowness = ((r + g) >> 1) - b;
    const minChannelDiff = Math.max(12, yellownessMin - 2);
    return (
      yellowness >= yellownessMin &&
      r - b >= minChannelDiff &&
      g - b >= minChannelDiff &&
      Math.abs(r - g) <= 52 &&
      r + g >= 110
    );
  }

  if (preset === 'bright_yellow') {
    const yellowness = ((r + g) >> 1) - b;
    return yellowness >= Math.max(32, yellownessMin + 12) && r - b >= 28 && g - b >= 22 && Math.abs(r - g) <= 65;
  }

  if (preset === 'blue') {
    return b - r >= 26 && b - g >= 14 && b >= 65;
  }

  if (preset === 'white') {
    const brightness = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return brightness >= 185 && spread <= 28;
  }

  // black: oq/och polda to'q chiziq
  const brightness = (r + g + b) / 3;
  return brightness <= 72 && Math.abs(r - b) <= 35;
}

interface HorizontalRun {
  s: number;
  e: number;
}

function extractBandRuns(
  mask: Uint8Array,
  w: number,
  y0: number,
  y1: number,
  minRunCols: number
): HorizontalRun[] {
  const bandRows = Math.max(1, y1 - y0);
  const runs: HorizontalRun[] = [];
  let inRun = false;
  let start = 0;

  for (let x = 0; x < w; x++) {
    let hits = 0;
    for (let y = y0; y < y1; y++) {
      hits += mask[y * w + x];
    }
    const isHit = hits / bandRows > 0.35;
    if (isHit && !inRun) {
      inRun = true;
      start = x;
    } else if (!isHit && inRun) {
      inRun = false;
      if (x - start >= minRunCols) {
        runs.push({ s: start, e: x - 1 });
      }
    }
  }
  if (inRun && w - start >= minRunCols) {
    runs.push({ s: start, e: w - 1 });
  }

  if (runs.length <= 1) return runs;

  // Taktil qovurg'alar orasidagi mayda soya/chiziqlarni (<= 3 ustun) birlashtirish
  const merged: HorizontalRun[] = [{ ...runs[0] }];
  for (let i = 1; i < runs.length; i++) {
    const prev = merged[merged.length - 1];
    if (runs[i].s - prev.e <= 3) {
      prev.e = runs[i].e;
    } else {
      merged.push({ ...runs[i] });
    }
  }
  return merged;
}

/**
 * Downsampled (masalan 160x120) RGBA buferidan sariq taktil yo'lak yoki lenta koridorini aniqlaydi.
 * T-chorraha yon shoxlari va chetdagi mayda oq kabellarni inkor etadi.
 */
export function analyzeLineFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  cfg: Partial<LineFollowerConfig> = {}
): LineAnalysisResult {
  const preset = cfg.colorPreset ?? DEFAULT_LINE_CONFIG.colorPreset;
  const yellownessMin = cfg.yellownessMin ?? DEFAULT_LINE_CONFIG.yellownessMin;

  if (width < 16 || height < 16 || rgba.length < width * height * 4) {
    return {
      detected: false,
      confidence: 0,
      offsetNorm: 0,
      angleDeg: 0,
      rawSteer: 0,
      tJunctionFiltered: false,
      tJunctionSide: null,
      coverage: 0,
      bands: []
    };
  }

  const yStart = Math.floor(height * 0.22);
  const yEnd = Math.floor(height * 0.96);
  const roiPixels = Math.max(1, (yEnd - yStart) * width);
  const mask = new Uint8Array(width * height);
  let matchedCount = 0;

  for (let y = yStart; y < yEnd; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const idx = (rowOff + x) * 4;
      if (isLinePixel(rgba[idx], rgba[idx + 1], rgba[idx + 2], preset, yellownessMin)) {
        mask[rowOff + x] = 1;
        matchedCount++;
      }
    }
  }

  const nBands = 14;
  const minRunCols = Math.max(3, Math.round(width * 0.04));
  const halfW = width / 2;
  const bandsBottomToTop: LineBandSample[] = [];
  let prevCenter: number | null = null;
  let prevWidth: number | null = null;
  let tJunctionFiltered = false;
  let tJunctionSide: 'left' | 'right' | null = null;

  for (let i = nBands - 1; i >= 0; i--) {
    const y0 = Math.floor(yStart + ((yEnd - yStart) * i) / nBands);
    const y1 = Math.max(y0 + 1, Math.floor(yStart + ((yEnd - yStart) * (i + 1)) / nBands));
    const runs = extractBandRuns(mask, width, y0, y1, minRunCols);
    if (runs.length === 0) continue;

    let best: HorizontalRun;
    if (prevCenter === null) {
      // Pastki qismdan eng keng va markazga yaqin yo'lakni tanlash
      best = runs.reduce((acc, cur) => {
        const curMid = (cur.s + cur.e) / 2;
        const accMid = (acc.s + acc.e) / 2;
        const curScore = (cur.e - cur.s + 1) * (1 - 0.3 * Math.abs((curMid - halfW) / halfW));
        const accScore = (acc.e - acc.s + 1) * (1 - 0.3 * Math.abs((accMid - halfW) / halfW));
        return curScore > accScore ? cur : acc;
      });
    } else {
      best = runs.reduce((acc, cur) => {
        const curDist = Math.abs((cur.s + cur.e) / 2 - prevCenter!);
        const accDist = Math.abs((acc.s + acc.e) / 2 - prevCenter!);
        return curDist < accDist ? cur : acc;
      });
      const bestMid = (best.s + best.e) / 2;
      const bestW = best.e - best.s + 1;
      if (Math.abs(bestMid - prevCenter) > width * 0.35 && bestW < width * 0.4) {
        continue;
      }
    }

    let x0 = best.s;
    let x1 = best.e;
    let bw = x1 - x0 + 1;
    let cx = (x0 + x1) / 2;
    let clamped = false;

    // T-chorraha himoyasi: agar yuqori qatlam kengligi keskin yon shox hisobiga shishib ketsa,
    // robot yon koridorga burilib ketmasligi uchun asosiy yo'nalish o'qini saqlaymiz.
    if (prevWidth !== null && prevCenter !== null && bw > width * 0.45 && bw > prevWidth * 1.45) {
      tJunctionFiltered = true;
      clamped = true;
      const rightExpansion = x1 - prevCenter;
      const leftExpansion = prevCenter - x0;
      tJunctionSide = rightExpansion >= leftExpansion ? 'right' : 'left';

      const lo = x0 + prevWidth / 2;
      const hi = x1 - prevWidth / 2;
      cx = lo <= hi ? clamp(prevCenter, lo, hi) : prevCenter;
      x0 = Math.max(x0, Math.round(cx - prevWidth / 2));
      x1 = Math.min(x1, Math.round(cx + prevWidth / 2));
      bw = prevWidth;
    }

    prevCenter = cx;
    prevWidth = prevWidth === null ? bw : 0.7 * prevWidth + 0.3 * bw;

    bandsBottomToTop.push({
      y: (y0 + y1) / 2 / height,
      x0: x0 / width,
      x1: x1 / width,
      cx: cx / width,
      clamped
    });
  }

  const bands = bandsBottomToTop.reverse(); // yuqoridan pastga tartibda
  const confidence = bands.length / nBands;
  const detected = bands.length >= 3 && confidence >= 0.21;

  if (!detected) {
    return {
      detected: false,
      confidence,
      offsetNorm: 0,
      angleDeg: 0,
      rawSteer: 0,
      tJunctionFiltered,
      tJunctionSide,
      coverage: matchedCount / roiPixels,
      bands
    };
  }

  // Yaqin (pastki) polosalarga kattaroq og'irlik: robot g'ildiragi ostidagi siljish eng muhim
  const nearCount = Math.min(5, bands.length);
  const nearBands = bands.slice(bands.length - nearCount);
  let nearSum = 0;
  for (const b of nearBands) nearSum += b.cx;
  const offsetNorm = clamp((nearSum / nearCount - 0.5) * 2, -1, 1);

  let angleDeg = 0;
  let headingNorm = 0;
  if (bands.length >= 2) {
    const farCount = Math.min(4, bands.length);
    let farX = 0;
    let farY = 0;
    for (let i = 0; i < farCount; i++) {
      farX += bands[i].cx;
      farY += bands[i].y;
    }
    farX /= farCount;
    farY /= farCount;

    const nearX = nearSum / nearCount;
    let nearY = 0;
    for (const b of nearBands) nearY += b.y;
    nearY /= nearCount;

    const dx = farX - nearX;
    const dy = Math.max(0.05, nearY - farY);
    angleDeg = clamp((Math.atan2(dx, dy) * 180) / Math.PI, -60, 60);
    // Uzoq yo'lak oldinda qayerga og'ayotganini (-1..+1) hisobga olish
    headingNorm = clamp(dx * 2.4, -1, 1);
  }

  const rawSteer = clamp(0.85 * offsetNorm + 0.45 * headingNorm, -1, 1);

  return {
    detected: true,
    confidence,
    offsetNorm,
    angleDeg,
    rawSteer,
    tJunctionFiltered,
    tJunctionSide,
    coverage: matchedCount / roiPixels,
    bands
  };
}

/**
 * Foydalanuvchi chapga burila oladimi?
 * Chiziq chapda bo'lmasa, robotni polga/devorga burilib ketishining oldini oladi.
 */
export function canTurnLeftOnLine(analysis: LineAnalysisResult | null): boolean {
  if (!analysis || !analysis.detected) return false;
  return (
    analysis.offsetNorm <= -0.12 ||
    analysis.angleDeg <= -8 ||
    analysis.tJunctionSide === 'left'
  );
}

/**
 * Foydalanuvchi o'ngga burila oladimi?
 * Chiziq o'ngda bo'lmasa (yoki o'ng shox bo'lmasa), o'ngga burilish taqiqlanadi.
 */
export function canTurnRightOnLine(analysis: LineAnalysisResult | null): boolean {
  if (!analysis || !analysis.detected) return false;
  return (
    analysis.offsetNorm >= 0.12 ||
    analysis.angleDeg >= 8 ||
    analysis.tJunctionSide === 'right' ||
    analysis.tJunctionFiltered
  );
}

/**
 * Vaqt bo'yicha silliqlovchi va xavfsizlik taymeriga ega Chiziq Avtopilot nazoratchisi.
 */
export class LineFollowerController {
  private smoothedSteer = 0;
  private visualSteer = 0;
  private lastSeenAt = 0;
  private lastDetected = false;

  reset(nowMs = Date.now()): void {
    this.smoothedSteer = 0;
    this.visualSteer = 0;
    this.lastSeenAt = nowMs;
    this.lastDetected = false;
  }

  step(
    analysis: LineAnalysisResult,
    cfg: LineFollowerConfig,
    intentOrNow: UserDriveIntent | number = DEFAULT_DRIVE_INTENT,
    maybeNowOrBlocked: number | boolean = Date.now(),
    maybeBlocked = false
  ): LineControlStep {
    let intent: UserDriveIntent;
    let nowMs: number;
    let blockedBySensor: boolean;

    if (typeof intentOrNow === 'number') {
      intent = DEFAULT_DRIVE_INTENT;
      nowMs = intentOrNow;
      blockedBySensor = typeof maybeNowOrBlocked === 'boolean' ? maybeNowOrBlocked : false;
    } else {
      intent = intentOrNow;
      nowMs = typeof maybeNowOrBlocked === 'number' ? maybeNowOrBlocked : Date.now();
      blockedBySensor = maybeBlocked;
    }

    const mode = cfg.driveMode ?? 'assisted';

    // 1. SENSOR / LIDAR / SONAR TO'SIQ BLOKIROVKASI
    if (blockedBySensor) {
      this.smoothedSteer = 0;
      this.visualSteer = 0;
      return {
        ...analysis,
        smoothedSteer: 0,
        visualSteer: 0,
        command: 'S',
        statusLabel: "TO'SIQ ANIQLANDI — TO'XTATILDI",
        lostDurationMs: 0
      };
    }

    // 2. FAVQULODDA STOP
    if (intent.emergencyStop) {
      this.smoothedSteer = 0;
      this.visualSteer = 0;
      return {
        ...analysis,
        smoothedSteer: 0,
        visualSteer: 0,
        command: 'S',
        statusLabel: "STOP (TO'XTATILDI)",
        lostDurationMs: 0
      };
    }

    // 3. SINOV REJIMI (Motorlar aylanmaydi)
    if (mode === 'test') {
      return {
        ...analysis,
        smoothedSteer: 0,
        visualSteer: analysis.rawSteer,
        command: 'S',
        statusLabel: analysis.detected ? 'FAQAT SINOV (KUZATUV)' : "YO'LAK TOPILMADI",
        lostDurationMs: 0
      };
    }

    // Silliqlash hisobi
    if (analysis.detected) {
      this.lastSeenAt = nowMs;
      const orientedSteer = cfg.invertSteering ? -analysis.rawSteer : analysis.rawSteer;
      this.smoothedSteer = this.lastDetected
        ? 0.45 * orientedSteer + 0.55 * this.smoothedSteer
        : orientedSteer;
      this.visualSteer = this.lastDetected
        ? 0.45 * analysis.rawSteer + 0.55 * this.visualSteer
        : analysis.rawSteer;
      this.lastDetected = true;
    } else {
      this.smoothedSteer *= 0.6;
      this.visualSteer *= 0.6;
    }

    // =========================================================================
    // 4. YORDAMCHI REJIM (ASSISTED) — FOYDALANUVCHI SO'RAGAN TALAB BO'YICHA:
    //  - Oldingani bosganda chiziq bo'ylab harakatlanadi
    //  - Qo'yib yuborganda avtonom joyida burilib yo'lakka to'g'irlanadi
    //  - Chapga/O'ngga burilish bosilganda chiziqqa qaraydi, chiziq yo'q bo'lsa yurmaydi!
    // =========================================================================
    if (mode === 'assisted') {
      // 4A. Qo'lda orqaga harakat
      if (intent.reverse) {
        return {
          ...analysis,
          smoothedSteer: this.smoothedSteer,
          visualSteer: this.visualSteer,
          command: 'B',
          statusLabel: 'ORQAGA HARAKAT (B)',
          lostDurationMs: 0
        };
      }

      // 4B. Qo'lda chapga burilish: Chiziq tekshiruvi!
      if (intent.turnLeft && !intent.forward) {
        if (canTurnLeftOnLine(analysis)) {
          const steerCmd = cfg.invertSteering ? 'R' : 'L';
          return {
            ...analysis,
            smoothedSteer: this.smoothedSteer,
            visualSteer: this.visualSteer,
            command: steerCmd,
            statusLabel: `CHAPGA BURILISH (${steerCmd}) — RUXSAT ETILDI`,
            lostDurationMs: 0
          };
        } else {
          // Chapda chiziq yo'q -> BLOKLANADI!
          return {
            ...analysis,
            smoothedSteer: this.smoothedSteer,
            visualSteer: this.visualSteer,
            command: 'S',
            guardBlocked: 'left',
            statusLabel: "⚠️ CHAPDA YO'LAK YO'Q — BURILISH BLOKLANDI!",
            lostDurationMs: 0
          };
        }
      }

      // 4C. Qo'lda o'ngga burilish: Chiziq tekshiruvi!
      if (intent.turnRight && !intent.forward) {
        if (canTurnRightOnLine(analysis)) {
          const steerCmd = cfg.invertSteering ? 'L' : 'R';
          return {
            ...analysis,
            smoothedSteer: this.smoothedSteer,
            visualSteer: this.visualSteer,
            command: steerCmd,
            statusLabel: `O'NGGA BURILISH (${steerCmd}) — RUXSAT ETILDI`,
            lostDurationMs: 0
          };
        } else {
          // O'ngda chiziq yo'q -> BLOKLANADI!
          return {
            ...analysis,
            smoothedSteer: this.smoothedSteer,
            visualSteer: this.visualSteer,
            command: 'S',
            guardBlocked: 'right',
            statusLabel: "⚠️ O'NGDA YO'LAK YO'Q — BURILISH BLOKLANDI!",
            lostDurationMs: 0
          };
        }
      }

      // 4D. Oldinga bosilgan: Chiziq bo'ylab harakatlanish!
      if (intent.forward) {
        if (!analysis.detected) {
          return {
            ...analysis,
            smoothedSteer: 0,
            visualSteer: 0,
            command: 'S',
            statusLabel: "YO'LAK KO'RINMAYDI — TO'XTATILDI",
            lostDurationMs: nowMs - this.lastSeenAt
          };
        }

        const absS = Math.abs(this.smoothedSteer);
        let command: MecanumCommand = 'F';
        let statusLabel = "OLDINGA CHIZIQ BO'YLAB (F)";

        if (absS >= cfg.spinThreshold) {
          command = this.smoothedSteer < 0 ? 'L' : 'R';
          statusLabel = this.smoothedSteer < 0 ? "CHIZIQ: KESKIN CHAP (L)" : "CHIZIQ: KESKIN O'NG (R)";
        } else if (absS >= cfg.curveDeadband) {
          command = this.smoothedSteer < 0 ? 'G' : 'I';
          statusLabel = this.smoothedSteer < 0 ? "CHIZIQ: CHAPGA YOY (G)" : "CHIZIQ: O'NGGA YOY (I)";
        }

        if (analysis.tJunctionFiltered) {
          statusLabel += ' • T-FILTER';
        }

        return {
          ...analysis,
          smoothedSteer: this.smoothedSteer,
          visualSteer: this.visualSteer,
          command,
          statusLabel,
          lostDurationMs: 0
        };
      }

      // 4E. Oldinga qo'yib yuborildi: "qo'yib yuborganda avtonom burilsin"
      if (analysis.detected) {
        const absSteer = Math.abs(analysis.rawSteer);
        const absAngle = Math.abs(analysis.angleDeg);

        // Agar yo'lak burilgan bo'lsa, robot joyida avtonom ravishda chiziqqa yuzlanadi
        if (absSteer >= 0.16 || absAngle >= 8) {
          const steerLeft = (analysis.rawSteer < -0.16 || analysis.angleDeg < -8);
          const alignCmd: MecanumCommand = steerLeft
            ? (cfg.invertSteering ? 'R' : 'L')
            : (cfg.invertSteering ? 'L' : 'R');

          return {
            ...analysis,
            smoothedSteer: this.smoothedSteer,
            visualSteer: this.visualSteer,
            command: alignCmd,
            autoAligning: true,
            statusLabel: `AVTONOM BURILISH (${alignCmd}) — YO'LAKKA TO'G'IRLANMOQDA`,
            lostDurationMs: 0
          };
        }

        // Chiziqqa to'g'irlandi -> to'xtab turadi
        return {
          ...analysis,
          smoothedSteer: this.smoothedSteer,
          visualSteer: this.visualSteer,
          command: 'S',
          autoAligning: false,
          statusLabel: "YO'LAKKA TO'G'IRLANDI — TAYYOR (STOP)",
          lostDurationMs: 0
        };
      }

      return {
        ...analysis,
        smoothedSteer: 0,
        visualSteer: 0,
        command: 'S',
        statusLabel: "KUTILMOQDA (STOP)",
        lostDurationMs: nowMs - this.lastSeenAt
      };
    }

    // =========================================================================
    // 5. TO'LIQ AVTONOM REJIM (CONTINUOUS AUTO)
    // =========================================================================
    if (analysis.detected) {
      const absS = Math.abs(this.smoothedSteer);
      let command: MecanumCommand = 'F';
      let statusLabel = "TO'G'RIGA (F)";

      if (absS >= cfg.spinThreshold) {
        command = this.smoothedSteer < 0 ? 'L' : 'R';
        statusLabel = this.smoothedSteer < 0 ? 'CHAPGA KESKIN (L)' : "O'NGGA KESKIN (R)";
      } else if (absS >= cfg.curveDeadband) {
        command = this.smoothedSteer < 0 ? 'G' : 'I';
        statusLabel = this.smoothedSteer < 0 ? 'CHAPGA YOY (G)' : "O'NGGA YOY (I)";
      }

      if (analysis.tJunctionFiltered) {
        statusLabel += ' • T-FILTER';
      }

      return {
        ...analysis,
        smoothedSteer: this.smoothedSteer,
        visualSteer: this.visualSteer,
        command,
        statusLabel,
        lostDurationMs: 0
      };
    }

    const lostDurationMs = this.lastSeenAt > 0 ? Math.max(0, nowMs - this.lastSeenAt) : cfg.lostStopMs;
    if (lostDurationMs >= cfg.lostStopMs || !this.lastDetected) {
      this.lastDetected = false;
      this.smoothedSteer = 0;
      this.visualSteer = 0;
      return {
        ...analysis,
        smoothedSteer: 0,
        visualSteer: 0,
        command: 'S',
        statusLabel: "YO'LAK YO'QOLDI — STOP",
        lostDurationMs
      };
    }

    const absS = Math.abs(this.smoothedSteer);
    const holdCmd: MecanumCommand =
      absS >= cfg.spinThreshold ? (this.smoothedSteer < 0 ? 'L' : 'R') : absS >= cfg.curveDeadband ? (this.smoothedSteer < 0 ? 'G' : 'I') : 'F';

    return {
      ...analysis,
      smoothedSteer: this.smoothedSteer,
      visualSteer: this.visualSteer,
      command: holdCmd,
      statusLabel: `KUTILMOQDA (${Math.round(cfg.lostStopMs - lostDurationMs)} ms)`,
      lostDurationMs
    };
  }
}

/**
 * Singleton xizmat: butun ilovada Taktil Chiziq avtopilotining holatini sinxronlashtiradi.
 */
export class LineFollowerService {
  private enabled = false;
  private sending = false;
  private config: LineFollowerConfig = loadLineFollowerConfig();
  private intent: UserDriveIntent = { ...DEFAULT_DRIVE_INTENT };
  private lastStep: LineControlStep | null = null;
  private readonly listeners = new Set<(step: LineControlStep | null) => void>();

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
    if (!val) {
      this.intent = { ...DEFAULT_DRIVE_INTENT };
      this.lastStep = null;
    }
    this.notify();
  }

  isSending(): boolean {
    return this.sending;
  }

  setSending(val: boolean): void {
    this.sending = val;
  }

  getConfig(): LineFollowerConfig {
    return this.config;
  }

  updateConfig(patch: Partial<LineFollowerConfig>): void {
    this.config = { ...this.config, ...patch };
    saveLineFollowerConfig(this.config);
  }

  getUserIntent(): UserDriveIntent {
    return this.intent;
  }

  setUserIntent(patch: Partial<UserDriveIntent>): void {
    this.intent = { ...this.intent, ...patch };
  }

  getStep(): LineControlStep | null {
    return this.lastStep;
  }

  setStep(step: LineControlStep | null): void {
    this.lastStep = step;
    this.notify();
  }

  /**
   * Qo'lda kelgan buyruqni tekshiradi:
   * Agar chiziq bo'lmagan tomonga burilish bo'lsa -> bloklaydi!
   */
  filterUserCommand(cmd: MecanumCommand): {
    allowed: boolean;
    command: MecanumCommand;
    reason: string;
    guardBlocked?: 'left' | 'right' | null;
  } {
    if (!this.enabled || this.config.driveMode !== 'assisted') {
      return { allowed: true, command: cmd, reason: 'OK' };
    }

    if (cmd === 'L') {
      const allowed = canTurnLeftOnLine(this.lastStep);
      if (!allowed) {
        return {
          allowed: false,
          command: 'S',
          guardBlocked: 'left',
          reason: "⚠️ Chapda taktil yo'lak yo'q — burilish bloklandi!"
        };
      }
      return { allowed: true, command: 'L', reason: 'Chapda yo‘lak bor' };
    }

    if (cmd === 'R') {
      const allowed = canTurnRightOnLine(this.lastStep);
      if (!allowed) {
        return {
          allowed: false,
          command: 'S',
          guardBlocked: 'right',
          reason: "⚠️ O'ngda taktil yo'lak yo'q — burilish bloklandi!"
        };
      }
      return { allowed: true, command: 'R', reason: 'O‘ngda yo‘lak bor' };
    }

    if (cmd === 'F') {
      if (!this.lastStep || !this.lastStep.detected) {
        return {
          allowed: false,
          command: 'S',
          reason: "⚠️ Yo'lak aniqlanmadi — to'xtatildi!"
        };
      }
      const absS = Math.abs(this.lastStep.visualSteer || this.lastStep.rawSteer);
      let steerCmd: MecanumCommand = 'F';
      if (absS >= this.config.spinThreshold) {
        steerCmd = this.lastStep.rawSteer < 0
          ? (this.config.invertSteering ? 'R' : 'L')
          : (this.config.invertSteering ? 'L' : 'R');
      } else if (absS >= this.config.curveDeadband) {
        steerCmd = this.lastStep.rawSteer < 0
          ? (this.config.invertSteering ? 'I' : 'G')
          : (this.config.invertSteering ? 'G' : 'I');
      }
      return {
        allowed: true,
        command: steerCmd,
        reason: `Chiziq bo'ylab (${steerCmd})`
      };
    }

    return { allowed: true, command: cmd, reason: 'OK' };
  }

  subscribe(cb: (step: LineControlStep | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) {
      cb(this.lastStep);
    }
  }
}

export const lineFollowerService = new LineFollowerService();

/**
 * Kamera ustidagi shaffof canvas ga aniqlangan sariq yo'lak, o'q va rul vektorini chizadi.
 */
export function drawLineFollowerOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  step: LineControlStep,
  mirrorX = false,
  blocked = false
): void {
  ctx.clearRect(0, 0, width, height);

  const mapX = (nx: number) => (mirrorX ? 1 - nx : nx) * width;
  const centerX = width / 2;

  // Markaziy yo'nalish o'qi
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(centerX, height * 0.22);
  ctx.lineTo(centerX, height * 0.96);
  ctx.stroke();
  ctx.restore();

  if (step.bands.length >= 2) {
    // 1. Yo'lak koridori poligoni (chap va o'ng qirralar)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < step.bands.length; i++) {
      const b = step.bands[i];
      const lx = mapX(mirrorX ? b.x1 : b.x0);
      const py = b.y * height;
      if (i === 0) ctx.moveTo(lx, py);
      else ctx.lineTo(lx, py);
    }
    for (let i = step.bands.length - 1; i >= 0; i--) {
      const b = step.bands[i];
      const rx = mapX(mirrorX ? b.x0 : b.x1);
      const py = b.y * height;
      ctx.lineTo(rx, py);
    }
    ctx.closePath();
    ctx.fillStyle = blocked
      ? 'rgba(255, 42, 42, 0.22)'
      : step.guardBlocked
      ? 'rgba(239, 68, 68, 0.28)'
      : step.autoAligning
      ? 'rgba(6, 182, 212, 0.25)'
      : step.tJunctionFiltered
      ? 'rgba(168, 85, 247, 0.22)'
      : 'rgba(16, 185, 129, 0.20)';
    ctx.fill();
    ctx.strokeStyle = blocked ? '#ff4d4f' : step.guardBlocked ? '#ef4444' : '#22c55e';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 2. Yo'lak o'rta chizig'i va har bir qatlam nuqtalari
    ctx.beginPath();
    step.bands.forEach((b, idx) => {
      const x = mapX(b.cx);
      const y = b.y * height;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3;
    ctx.stroke();

    for (const b of step.bands) {
      ctx.fillStyle = b.clamped ? '#c084fc' : '#facc15';
      ctx.beginPath();
      ctx.arc(mapX(b.cx), b.y * height, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 3. Pastdan chiquvchi boshqaruv (Heading) vektori
  if (!blocked && step.detected) {
    const steerVisual = mirrorX ? -step.visualSteer : step.visualSteer;
    const rad = steerVisual * (Math.PI / 4);
    const len = height * 0.26;
    const sx = centerX;
    const sy = height * 0.94;
    const ex = sx + Math.sin(rad) * len;
    const ey = sy - Math.cos(rad) * len;

    ctx.save();
    ctx.strokeStyle = step.command === 'F' ? '#22d3ee' : '#f59e0b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(ex, ey, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 4. Burilish bloklanganda ogohlantirish belgisi
  if (step.guardBlocked) {
    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    const bx = step.guardBlocked === 'left' ? 20 : width - 140;
    const by = height * 0.5;
    ctx.fillRect(bx, by - 16, 120, 32);
    ctx.strokeRect(bx, by - 16, 120, 32);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(step.guardBlocked === 'left' ? "🚫 CHAP BLOK" : "🚫 O'NG BLOK", bx + 60, by);
    ctx.restore();
  }

  // 5. Avtonom to'g'irlanish belgisi
  if (step.autoAligning) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 182, 212, 0.85)';
    ctx.fillRect(centerX - 80, height * 0.12, 160, 24);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔄 AVTONOM BURILISH', centerX, height * 0.12 + 12);
    ctx.restore();
  }
}
