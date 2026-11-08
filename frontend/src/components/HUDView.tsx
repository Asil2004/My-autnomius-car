import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRobot } from '../context/RobotContext';
import type { DetectedObject } from '../types/robot';
import { faceRecognitionService, type KnownPerson } from '../services/faceRecognitionService';
import { distanceEstimator } from '../services/distanceService';
import type * as cocoSsd from '@tensorflow-models/coco-ssd';
import { loadCocoModel } from '../services/aiPreload';
import { createAnnotatedStream, type AnnotatedStream } from '../services/nvrOverlayCompositor';
import { nvrRecordingService, type TimelineRange, type NvrChunk, type NvrStorageStats, type NvrDiskStatus, NVR_MAX_STORAGE_BYTES } from '../services/nvrRecordingService';
import { FloatingPanel } from './FloatingPanel';
import { PtzLensView } from './PtzLensView';
import { ptzCameraService, LENS, type PtzLens } from '../services/ptzCameraService';
import { camLinkSettings } from '../services/camLinkSettings';
import {
  robotCamBroadcaster,
  watchRobotCamera,
  fleetWatcher,
  selectedRobotStore,
  type FleetState,
  type RobotTelemetry,
  type BroadcastStatus,
  type ViewerState,
  type WireBox
} from '../services/robotCamLink';
import {
  Activity,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Compass,
  Gauge,
  SlidersHorizontal,
  ShieldAlert,
  ShieldCheck,
  ScrollText,
  VideoOff,
  ChevronsUp,
  ChevronsDown,
  Camera,
  MapPin,
  User,
  RefreshCw,
  Eye,
  AlertTriangle,
  Users,
  Plus,
  X,
  CheckCircle2,
  Ruler,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  FastForward,
  Rewind,
  Calendar,
  Radio,
  Film,
  Volume2,
  Lightbulb,
  Square
} from 'lucide-react';

type PanelId = 'control' | 'sensors' | 'ai' | 'ptz' | 'log';
type CamId = 'face' | 'ptz' | 'front' | 'rear' | 'right' | 'left';
// Kamera moduli (camera_server, CP-159-1) linzalari: PTZ, o'ngga va chapga qaragan
const MODULE_LENS: Partial<Record<CamId, PtzLens>> = { ptz: LENS.ptz, right: LENS.right, left: LENS.left };

// Robotdagi jami 5 ta kamera (1 tasi 360° PTZ). Qaysi biri kattalashtirilsa, qolgan 4 tasi chap tomonda kichik ko'rinadi
// Kursorga bog'langan zoom chegaralari
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

const ALL_CAMERAS: { id: CamId; short: string; long: string }[] = [
  { id: 'face', short: 'Face ID', long: 'Face ID (Planshet)' },
  { id: 'ptz', short: 'PTZ', long: 'PTZ kamera' },
  { id: 'right', short: "O'ng", long: "O'ng kamera" },
  { id: 'left', short: 'Chap', long: 'Chap kamera' },
  { id: 'front', short: 'Old', long: 'Old kamera (RPi)' },
  { id: 'rear', short: 'Orqa', long: 'Orqa kamera' }
];

const OPEN_KEY = 'qalqon.hud.open.v1';

const REMOTE_CMD_NAMES: Record<string, string> = {
  F: 'Oldinga',
  B: 'Orqaga',
  L: 'Chapga burilish',
  R: "O'ngga burilish",
  Q: 'Chapga siljish',
  E: "O'ngga siljish",
  S: "To'xtatish",
  U: 'Minora yuqoriga',
  D: 'Minora pastga'
};

// COCO-SSD klasslari uchun o'zbekcha nomlar. Odam va transport alohida ishlanadi, qolgan hamma jism robot uchun "to'siq"
const UZ_OBSTACLE_NAMES: Record<string, string> = {
  chair: "Stul (To'siq)",
  couch: "Divan (To'siq)",
  'dining table': "Stol (To'siq)",
  bed: "Karovot (To'siq)",
  'potted plant': "Gultuvak (To'siq)",
  tv: 'Monitor / TV',
  laptop: 'Noutbuk',
  'cell phone': 'Telefon (Obyekt)',
  bottle: 'Idish / Butilka',
  cup: 'Chashka / Finka',
  backpack: 'Ryukzak (Yuk)',
  handbag: 'Sumka',
  suitcase: 'Chemodan (Yuk)',
  book: 'Kitob / Blok',
  umbrella: 'Soyabon',
  box: "Quti (To'siq)",
  dog: 'It (Hayvon)',
  cat: 'Mushuk (Hayvon)'
};
// COCO-SSD ni odam bo'lmagan jismlar uchun past baho bilan qidiramiz (to'siqlarni ko'proq ushlash), odam uchun esa qat'iy chegara
const OBSTACLE_MIN_SCORE = 0.28;
const PERSON_MIN_SCORE = 0.4;
const VEHICLE_CLASSES = ['car', 'truck', 'bus', 'motorcycle', 'bicycle'];

// Kalibrovka kamera turi bo'yicha alohida saqlanadi (hozir faqat frontal kamera aniqlanadi)
const CAMERA_KEY = 'FRONTAL';

// Sonar masofasiga (sm) qarab rang: <=22 xavf (avtotormoz), <=45 ogohlantirish, qolgani xavfsiz
const getSonarColor = (distance: number, isCritical = false) => {
  if (isCritical || distance <= 22) return 'text-police-red bg-police-red/10 border-police-red/60';
  if (distance <= 45) return 'text-police-amber bg-police-amber/10 border-police-amber/50';
  return 'text-police-green bg-tactical-850 border-tactical-700';
};

const SONAR_ARROW = { front: ArrowUp, rear: ArrowDown, left: ArrowLeft, right: ArrowRight } as const;

// Video ostidagi qatorda turuvchi sonar chipi: yo'nalish o'qi, nomi va masofasi
const SonarChip: React.FC<{
  side: 'front' | 'rear' | 'left' | 'right';
  label: string;
  value: number;
  pins?: string;
  critical?: boolean;
}> = ({ side, label, value, pins, critical = false }) => {
  const danger = critical || value <= 22;
  const Arrow = SONAR_ARROW[side];
  const title = `${label} sonar${pins ? ` (${pins})` : ''}: ${value} sm. Chegara: <22 sm = avtotormoz`;
  return (
    <div
      className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${getSonarColor(value, critical)}`}
      title={title}
      data-sonar={side}
    >
      {danger ? <ShieldAlert className="w-3 h-3 shrink-0" /> : <Arrow className="w-3 h-3 shrink-0" />}
      <span className="text-[10px] font-medium text-slate-300">{label}</span>
      <span className="ml-auto">{value} sm</span>
    </div>
  );
};

// Kalibrovka uchun yuz kadrlari shu oraliqda yig'iladi. Sekin qurilmada aniqlash sikli ~1 kadr/0.7 s bo'lishi mumkin
const CALIB_WINDOW_MS = 4000;
const CALIB_MIN_SAMPLES = 3;
// Yuz kengligi shu oraliqda (medianaga nisbatan) o'zgarmasa, odam qimirlamayapti deb hisoblanadi
const CALIB_MAX_SPREAD = 0.12;

type FaceSample = { width: number; eyePx: number; frameH: number; t: number };

// Kalibrovka ma'lumoti yetarlimi: kadrlar soni va yuz kengligining barqarorligi
const evaluateCalibSamples = (samples: FaceSample[]) => {
  const widths = samples.map((s) => s.width).sort((a, b) => a - b);
  const median = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
  const spread = widths.length > 1 && median > 0 ? (widths[widths.length - 1] - widths[0]) / median : 0;
  return { count: samples.length, median, stable: spread <= CALIB_MAX_SPREAD };
};

export const HUDView: React.FC = () => {
  const {
    lastCommand,
    sendMecanumCommand,
    sonars,
    isFrontBlocked,
    cameraObstacle,
    updateCameraObstacle,
    ptz,
    setPTZ,
    detectedObjects,
    setDetectedObjects,
    system,
    logs,
    gps,
    startRealGPS,
    toggleGPSMode,
    addLog,
    remote,
    setRemoteAllowed,
    speedLevel,
    setSpeedLevel,
    esp32Status,
    esp32Connected,
    hornActive,
    lightActive,
    toggleHorn,
    toggleLight
  } = useRobot();

  const stageRef = useRef<HTMLDivElement | null>(null);
  // Asosiy oyna: 'face' = Face ID (planshetning frontal kamerasi). Qolganlari robotning 4 tomonidagi kameralar
  // =========================================================================
  // NVR TIZIMI: ZOOM, FULLSCREEN, SANA-VAQT (DIFFERENCE), LIVE / PLAYBACK, 5S AUTO-HIDE
  // =========================================================================
  const [nowTime, setNowTime] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNowTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const formatNvrTimestamp = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const formatSecToTime = (totalSec: number) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const h = Math.floor(totalSec / 3600) % 24;
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  // Zoom va Fullscreen holati
  // Zoom: s - masshtab (1x..8x), x/y - kadr siljishi (piksel)
  const [zoom, setZoom] = useState<{ s: number; x: number; y: number }>({ s: 1, x: 0, y: 0 });
  const zoomLevel = zoom.s;
  const [activeCam, setActiveCam] = useState<CamId>('face');
  const zoomFrameRef = useRef<HTMLDivElement | null>(null);
  const cameraAreaRef = useRef<HTMLDivElement | null>(null);
  const cameraOverlayRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Live vs Playback (Qayta ko'rish) rejimi
  const [viewMode, setViewMode] = useState<'live' | 'playback'>('live');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [playbackDate, setPlaybackDate] = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [playbackSec, setPlaybackSec] = useState<number>(14400); // 04:00:00
  const [timelineRanges, setTimelineRanges] = useState<TimelineRange[]>([]);
  const [storageStats, setStorageStats] = useState<NvrStorageStats>({
    usedBytes: 0,
    maxBytes: NVR_MAX_STORAGE_BYTES,
    percentUsed: 0,
    chunkCount: 0
  });
  const [currentPlaybackChunk, setCurrentPlaybackChunk] = useState<NvrChunk | null>(null);
  const [nvrDisk, setNvrDisk] = useState<NvrDiskStatus>(() => nvrRecordingService.getDiskStatus());
  const playbackVideoRef = useRef<HTMLVideoElement | null>(null);

  // NVR timeline oralig'i va 100MB xotira statistikasini yuklash
  useEffect(() => {
    let active = true;
    const refreshData = async () => {
      const ranges = await nvrRecordingService.getTimelineRanges(playbackDate);
      const stats = await nvrRecordingService.getStorageStats();
      if (!active) return;
      setTimelineRanges(ranges);
      setStorageStats(stats);
    };

    refreshData();
    const unsub = nvrRecordingService.subscribe(() => {
      setNvrDisk(nvrRecordingService.getDiskStatus());
      void refreshData();
    });
    return () => {
      active = false;
      unsub();
    };
  }, [playbackDate, viewMode]);

  // Qayta ko'rish rejimida playbackSec ga mos keluvchi haqiqiy video bo'lagini ulash
  useEffect(() => {
    if (viewMode !== 'playback') return;
    let cancelled = false;

    nvrRecordingService.findChunkAt(playbackDate, playbackSec).then((found) => {
      if (cancelled) return;
      if (found && found.chunk.blobUrl) {
        setCurrentPlaybackChunk(found.chunk);
        if (playbackVideoRef.current) {
          if (playbackVideoRef.current.src !== found.chunk.blobUrl) {
            playbackVideoRef.current.src = found.chunk.blobUrl;
          }
          if (Math.abs(playbackVideoRef.current.currentTime - found.offsetSec) > 1) {
            playbackVideoRef.current.currentTime = found.offsetSec;
          }
          if (isPlaying) {
            playbackVideoRef.current.play().catch(() => {});
          }
        }
      } else {
        setCurrentPlaybackChunk(null);
        if (playbackVideoRef.current) {
          playbackVideoRef.current.pause();
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [playbackDate, playbackSec, viewMode, isPlaying]);

  // Playback video tezligi
  useEffect(() => {
    if (playbackVideoRef.current) {
      playbackVideoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Playback timer (sekundma-sekund oldinga siljish)
  useEffect(() => {
    if (viewMode !== 'playback' || !isPlaying) return;
    const intervalTime = Math.max(100, Math.round(1000 / playbackSpeed));
    const timer = window.setInterval(() => {
      setPlaybackSec((prev) => (prev >= 86399 ? 0 : prev + 1));
    }, intervalTime);
    return () => clearInterval(timer);
  }, [viewMode, isPlaying, playbackSpeed]);

  // 5 sekundlik Auto-Hide (Mishka harakatida chiqish, 5s qimirlamasa yashirinish, telefonda tap bilan almashtirish)
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const overlayTimerRef = useRef<number | null>(null);

  const resetOverlayTimer = useCallback(() => {
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    setShowOverlay(true);
    overlayTimerRef.current = window.setTimeout(() => {
      setShowOverlay(false);
    }, 5000);
  }, []);

  // ---------------------------------------------------------------------------
  // KURSORGA BOG'LANGAN ZOOM: g'ildirak va ikki marta bosish kursor turgan nuqtani kattalashtiradi.
  // Kadr: transform-origin 0 0, transform = translate(x, y) scale(s). Kursor ostidagi nuqta joyida qoladi:
  //   p = (q - t) / s  ->  t' = q - s' * p   (q: kursor, kadr chap-yuqori burchagiga nisbatan)
  // Siljish kadr chetidan chiqib ketmasligi uchun cheklanadi; o'zgarish CSS transition bilan silliq.
  // ---------------------------------------------------------------------------
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /** Hozir ko'rinib turgan (zoom qilinadigan) kadr ramkasi */
  const getZoomFrame = useCallback((): HTMLElement | null => {
    return activeCam === 'face' ? zoomFrameRef.current : cameraAreaRef.current;
  }, [activeCam]);

  const clampZoom = (s: number, x: number, y: number, w: number, h: number) => {
    const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));
    // Kadr ramkani to'liq qoplab tursin: x  [w - s*w, 0]
    return {
      s: scale,
      x: Math.min(0, Math.max(w - scale * w, x)),
      y: Math.min(0, Math.max(h - scale * h, y))
    };
  };

  /** Kursor (clientX, clientY) atrofida zoom; nuqta berilmasa kadr markazi */
  const zoomAt = useCallback(
    (nextScale: number, clientX?: number, clientY?: number) => {
      const frame = getZoomFrame();
      const z = zoomRef.current;
      if (!frame) return;
      const r = frame.getBoundingClientRect();
      const qx = clientX === undefined ? r.width / 2 : Math.min(r.width, Math.max(0, clientX - r.left));
      const qy = clientY === undefined ? r.height / 2 : Math.min(r.height, Math.max(0, clientY - r.top));
      const s2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextScale));
      const px = (qx - z.x) / z.s;
      const py = (qy - z.y) / z.s;
      setZoom(clampZoom(s2, qx - s2 * px, qy - s2 * py, r.width, r.height));
    },
    [getZoomFrame]
  );

  const resetZoom = useCallback(() => setZoom({ s: 1, x: 0, y: 0 }), []);

  const handleZoomIn = () => {
    zoomAt(zoomRef.current.s * 1.5);
    resetOverlayTimer();
  };

  const handleZoomOut = () => {
    zoomAt(zoomRef.current.s / 1.5);
    resetOverlayTimer();
  };

  // Sichqoncha g'ildiragi: kursor ostidagi nuqtaga yaqinlashish/uzoqlashish (native listener: preventDefault uchun passive emas)
  useEffect(() => {
    const el = cameraOverlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Tugmalar paneli ustida g'ildirak sahifani aylantirsin
      if ((e.target as HTMLElement).closest('button, input, [data-no-zoom]')) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      zoomAt(zoomRef.current.s * Math.exp(-dy * 0.0015), e.clientX, e.clientY);
      resetOverlayTimer();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, resetOverlayTimer]);

  // Ikki marta bosish: kursor nuqtasini 2 barobar yaqinlashtirish; maksimal zoomda esa 1x ga qaytish
  const handleCameraDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, [data-no-zoom]')) return;
      const s = zoomRef.current.s;
      if (s >= ZOOM_MAX - 0.01) resetZoom();
      else zoomAt(s * 2, e.clientX, e.clientY);
    },
    [zoomAt, resetZoom]
  );

  // Kattalashtirilgan kadrni sichqoncha bilan sudrab surish (bosish emas, sudrash bo'lsa panel ochilmaydi)
  const dragRef = useRef<{ x: number; y: number; zx: number; zy: number; moved: boolean } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const handleCameraPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || zoomRef.current.s <= 1) return;
    if ((e.target as HTMLElement).closest('button, input, [data-no-zoom]')) return;
    dragRef.current = { x: e.clientX, y: e.clientY, zx: zoomRef.current.x, zy: zoomRef.current.y, moved: false };
  }, []);
  const handleCameraPanMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      const frame = getZoomFrame();
      if (!d || !frame || (e.buttons & 1) === 0) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) {
        d.moved = true;
        setIsPanning(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
      const r = frame.getBoundingClientRect();
      setZoom(clampZoom(zoomRef.current.s, d.zx + dx, d.zy + dy, r.width, r.height));
    },
    [getZoomFrame]
  );
  const handleCameraPointerUp = useCallback(() => {
    setIsPanning(false);
    // Sudrash tugagach keladigan "click" panelni ochib-yopmasin
    if (dragRef.current?.moved) suppressClickRef.current = true;
    dragRef.current = null;
  }, []);
  const suppressClickRef = useRef(false);

  // Kamera almashganda zoom 1x ga qaytadi
  useEffect(() => {
    resetZoom();
  }, [activeCam, resetZoom]);

  /** Kadr va undagi ramkalar uchun umumiy transform */
  const zoomTransform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
  const zoomStyle: React.CSSProperties = {
    transform: zoomTransform,
    transformOrigin: '0 0',
    transition: isPanning ? 'none' : 'transform 160ms ease-out'
  };

  // FULLSCREEN: kamera konteyneri butun ekranni (100vw x 100vh) egallaydi.
  // 1) Brauzerning Fullscreen API si (element "top layer" ga chiqadi, boshqa UI umuman ko'rinmaydi);
  // 2) API ishlamasa (Android WebView / APK) yoki rad etilsa: fixed + eng yuqori z-index + qolgan UI yashiriladi.
  const fullscreenRef = useRef<HTMLDivElement | null>(null);
  const handleToggleFullscreen = () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      const el = fullscreenRef.current;
      if (el?.requestFullscreen && !document.fullscreenElement) {
        el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
          // Ruxsat berilmadi: CSS (fixed) rejimi baribir butun ekranni egallaydi
        });
      }
    } else {
      setIsFullscreen(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    }
    resetOverlayTimer();
  };

  // Brauzer fullscreen dan Esc / orqaga tugmasi bilan chiqilsa, holat ham yangilanadi
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Fullscreen paytida sahifadagi boshqa panellar (navbar, pastki menyu, yon panellar) yashiriladi va sahifa aylanmaydi
  useEffect(() => {
    if (!isFullscreen) return;
    document.body.classList.add('qalqon-cam-fullscreen');
    return () => {
      document.body.classList.remove('qalqon-cam-fullscreen');
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [isFullscreen]);

  const handleCameraClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setShowOverlay((prev) => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      if (!prev) {
        overlayTimerRef.current = window.setTimeout(() => {
          setShowOverlay(false);
        }, 5000);
        return true;
      } else {
        return false;
      }
    });
  }, []);

  const handleCameraPointerMove = useCallback(() => {
    resetOverlayTimer();
  }, [resetOverlayTimer]);

  useEffect(() => {
    resetOverlayTimer();
    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, [resetOverlayTimer]);

  // Esc bosilganda fullscreen rejimdan chiqish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // Old kamera = robotning RPi oqimi. Ulanmagan bo'lsa "Signal yo'q" ko'rsatiladi va vaqti-vaqti bilan qayta uriniladi
  const [rpiOk, setRpiOk] = useState(false);
  const [rpiRetry, setRpiRetry] = useState(0);
  useEffect(() => {
    if (rpiOk) return;
    const t = window.setInterval(() => setRpiRetry((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, [rpiOk]);
  // Ochiq suzuvchi panellar (oxirgisi eng ustida). Hech narsa ochiq bo'lmasa, kadr toza qoladi
  const [openPanels, setOpenPanels] = useState<PanelId[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]') as PanelId[];
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(openPanels));
    } catch {
      // saqlab bo'lmasa, panellar shu sessiyada ishlayveradi
    }
  }, [openPanels]);
  const openOnly = (id: PanelId) => setOpenPanels((prev) => (prev.includes(id) ? prev : [...prev, id]));

  // Esc: eng ustidagi panelni yopadi (kiritish maydonida yozilayotganda tegmaydi)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      setOpenPanels((prev) => (prev.length ? prev.slice(0, -1) : prev));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Videoning haqiqiy eni/bo'yi nisbati (kamera 16:9 yoki 4:3 bo'lishi mumkin)
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  // Video qutisi eni: panelning bo'sh joyiga nisbatni saqlagan holda sig'adigan eng katta o'lcham
  const viewportWrapRef = useRef<HTMLDivElement | null>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = viewportWrapRef.current;
    if (!el) return;
    const update = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw) return;
      // Balandlik aniq bo'lmasa (ustunli ko'rinish), faqat eniga qarab
      setFitWidth(Math.floor(ch > 0 ? Math.min(cw, ch * videoAspect) : cw));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [videoAspect]);
  // Face ID doim planshetning frontal kamerasidan. RPi oqimi Old kamera oynasida ko'rsatiladi
  const [cameraSource] = useState<'FRONTAL' | 'RPI' | 'SIMULATION'>('FRONTAL');
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Qurilma roli: robot planshet (kamera shu yerda) yoki operator (robot tasvirini masofadan ko'radi)
  const [camRole, setCamRole] = useState(() => camLinkSettings.get().role);
  useEffect(() => camLinkSettings.subscribe((s) => setCamRole(s.role)), []);
  const isViewer = camRole === 'operator';
  const [remoteState, setRemoteState] = useState<{ state: ViewerState; detail?: string }>({ state: 'connecting' });
  const [remoteBoxes, setRemoteBoxes] = useState<WireBox[]>([]);
  const [broadcast, setBroadcast] = useState<BroadcastStatus>(() => robotCamBroadcaster.getStatus());
  useEffect(() => robotCamBroadcaster.subscribe(setBroadcast), []);

  // OPERATOR: park (barcha robotlar) va tanlangan robot. Tanlanmagan bo'lsa birinchi onlayn robot
  const [fleet, setFleet] = useState<FleetState>(() => fleetWatcher.getState());
  useEffect(() => fleetWatcher.subscribe(setFleet), []);
  const [chosenRobot, setChosenRobot] = useState(() => selectedRobotStore.get());
  useEffect(() => selectedRobotStore.subscribe(setChosenRobot), []);
  const watchedRobot =
    (chosenRobot && fleet.robots.some((r) => r.id === chosenRobot) ? chosenRobot : '') ||
    fleet.robots.find((r) => r.online)?.id ||
    chosenRobot ||
    '';
  // Tanlangan robotning tezkor telemetriyasi (data kanal, 10 Hz) yoki park telemetriyasi (MQTT, 1 Hz)
  const [liveTel, setLiveTel] = useState<RobotTelemetry | null>(null);
  const liveTelAtRef = useRef(0);
  const onLiveTelemetry = useCallback((t: RobotTelemetry) => {
    const now = Date.now();
    if (now - liveTelAtRef.current < 250) return; // ekran 4 marta/s yangilanadi
    liveTelAtRef.current = now;
    setLiveTel(t);
  }, []);
  const fleetTel = fleet.robots.find((r) => r.id === watchedRobot)?.tel ?? null;
  const watchedTel = liveTel && liveTel.id === watchedRobot && Date.now() - liveTel.t < 5000 ? liveTel : fleetTel;
  // Old kamera planshetda "oyna" ko'rinishida qulay; operator esa robot ko'rayotganini to'g'ri ko'radi
  const [mirrorVideo, setMirrorVideo] = useState(() => camLinkSettings.get().role === 'robot');

  // AI Detektor holatlari
  const [aiModelLoaded, setAiModelLoaded] = useState(false);
  const [aiModelLoading, setAiModelLoading] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);

  // NVR yozuviga odam ramkalari ham tushishi uchun: kompozitor har kadrda shu ref'dan o'qiydi
  const overlayStateRef = useRef({ objects: detectedObjects, ai: aiEnabled, mirror: mirrorVideo });
  overlayStateRef.current = { objects: detectedObjects, ai: aiEnabled, mirror: mirrorVideo };
  const annotatedRef = useRef<AnnotatedStream | null>(null);
  const [detectedCounts, setDetectedCounts] = useState({ people: 0, cars: 0, obstacles: 0, total: 0 });

  // Yuzlar bazasi modali va ro'yxati
  const [showFaceDbModal, setShowFaceDbModal] = useState(false);
  const [knownPersons, setKnownPersons] = useState<KnownPerson[]>(faceRecognitionService.getPersons());
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonRole, setNewPersonRole] = useState('');
  const [newPersonPhoto, setNewPersonPhoto] = useState<string | null>(null);
  const [addPersonError, setAddPersonError] = useState<string | null>(null);
  const [isAddingPerson, setIsAddingPerson] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);

  // ESLATMA: sonar bilan masofani tuzatish o'chirilgan. Kamera "robot ko'zi" sifatida o'z masofasini sonars.front ga yozadi
  // (RobotContext.updateCameraObstacle), shuning uchun sonars.front ni qaytib kameraga berish o'z-o'zini kuchaytiruvchi sikl bo'lardi.

  // Kalibrovka uchun oxirgi yuz o'lchamlari (eng yaqin yuz, piksel)
  const faceSamplesRef = useRef<FaceSample[]>([]);
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibDistance, setCalibDistance] = useState('0.5');
  const [calibrated, setCalibrated] = useState(distanceEstimator.isCalibrated(CAMERA_KEY));

  // Yuz modeli holati va oxirgi kadr natijasi (ekranda ko'rsatiladi: nima uchun yuz topilmayotganini ko'rish uchun)
  const [faceStatus, setFaceStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [faceInfo, setFaceInfo] = useState<{
    count: number;
    widthPx: number;
    cycleMs: number;
    calibCount: number;
    calibStable: boolean;
    eyePx: number;
    faceDistM: number; // yuz ramkasi bo'yicha masofa (m), 0 = yuz yo'q
    eyeDistM: number; // ko'zlar orasidagi masofa bo'yicha (m). Faqat tizim uchun, ekranda ko'rsatilmaydi
  }>({ count: 0, widthPx: 0, cycleMs: 0, calibCount: 0, calibStable: true, eyePx: 0, faceDistM: 0, eyeDistM: 0 });
  const cocoModelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const isDetectingRef = useRef<boolean>(false);
  const lastObjectsSigRef = useRef('');
  const proximityCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Kontekstga oxirgi yuborilgan to'siq holati: bir xil qiymatni har kadrda yuborib, butun ilovani qayta chizdirmaslik uchun
  const lastObstacleRef = useRef({ key: '', t: 0 });

  // =========================================================================
  // 1. TENSORFLOW COCO-SSD VA YUZ BAZASINI YUKLASH
  // =========================================================================
  useEffect(() => {
    let isMounted = true;
    const loadAiServices = async () => {
      try {
        // Kontekstdagi namuna (soxta) ramkalar jonli kamera ustida ko'rinib qolmasin
        setDetectedObjects([]);
        setAiModelLoading(true);
        addLog('AI', 'info', "Neyron tarmoq va yuzlar bazasi yuklanmoqda...");
        
        // Yuz modeli va bazani yuklash. Xato bo'lsa ham COCO ishlayveradi, odamlar "Piyoda" bo'ladi
        let faceReady = true;
        const faceInit = faceRecognitionService.prepare().catch((faceErr: unknown) => {
          faceReady = false;
          if (isMounted) setFaceStatus('error');
          const msg = faceErr instanceof Error ? faceErr.message : String(faceErr);
          addLog('AI', 'error', `Yuz tanish modeli yuklanmadi, barcha odamlar "Piyoda": ${msg}`);
        });

        // COCO-SSD va yuz modeli parallel yuklanadi. Har birining vaqti jurnalga yoziladi (sekinlikni topish uchun)
        const tStart = performance.now();
        const ms = () => Math.round(performance.now() - tStart);
        const cocoLoad = loadCocoModel().then((m) => {
          addLog('AI', 'info', `COCO-SSD tayyor: ${ms()} ms`);
          return m;
        });
        faceInit.then(() => {
          if (faceReady) {
            const t = faceRecognitionService.timings;
            addLog('AI', 'info', `Yuz modeli tayyor: ${ms()} ms (modellar ${t.modellar} ms, isitish ${t.isitish} ms)`);
          }
        });
        const [model] = await Promise.all([cocoLoad, faceInit]);
        if (isMounted) {
          cocoModelRef.current = model;
          setAiModelLoaded(true);
          setAiModelLoading(false);
          setKnownPersons([...faceRecognitionService.getPersons()]);
          if (faceReady) {
            setFaceStatus('ready');
            const n = faceRecognitionService.getPersons().filter((p) => p.descriptor).length;
            addLog('AI', 'success', `Yuzni tanish va COCO-SSD tayyor: bazada ${n} ta shaxs`);
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          setAiModelLoading(false);
          const msg = err instanceof Error ? err.message : String(err);
          addLog('AI', 'warn', `AI yuklashda ogohlantirish: ${msg}`);
        }
      }
    };

    loadAiServices();
    return () => {
      isMounted = false;
    };
  }, [addLog, setDetectedObjects]);

  // =========================================================================
  // 2. FRONTAL KAMERA (WEBCAM) OQIMINI BOSHQARISH
  // =========================================================================
  const stopCameraStream = useCallback(() => {
    nvrRecordingService.stopRecording();
    annotatedRef.current?.stop();
    annotatedRef.current = null;
    robotCamBroadcaster.clearSource(streamRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startFrontalCamera = useCallback(async () => {
    // Har chaqiruvga raqam beriladi: effekt qayta ishlaganda (StrictMode, rejim almashishi) eski
    // chaqiruv yangisining oqimini uzib qo'ymasligi va xato ko'rsatmasligi uchun
    const requestId = ++cameraRequestRef.current;
    const isStale = () => requestId !== cameraRequestRef.current;

    stopCameraStream();
    setCameraLoading(true);
    setCameraError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      if (isStale()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      // Robot planshet: tasvir dispetcher markazidagi operatorlarga ham uzatiladi
      robotCamBroadcaster.setSource(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (isStale()) return;
      setCameraLoading(false);
      // Kamera tasviri avtomatik yoziladi (disk papkasi 1 GB yoki brauzer 100 MB, eng eskisi o'chadi).
      // Yozuvga kadr bilan birga odam identifikatsiya ramkalari, ism, masofa va sana-vaqt ham chiziladi
      const annotated = videoRef.current
        ? createAnnotatedStream(videoRef.current, {
            title: 'QALQON HUD',
            mirror: () => overlayStateRef.current.mirror,
            getBoxes: () => {
              const s = overlayStateRef.current;
              if (!s.ai) return [];
              return s.objects
                .filter((o) => o.category === 'person')
                .map((o) => ({
                  x: o.box.x / 100,
                  y: o.box.y / 100,
                  w: o.box.width / 100,
                  h: o.box.height / 100,
                  color: o.color,
                  label: o.isIdentifiedPerson ? `${o.label} ${(o.confidence * 100).toFixed(0)}%` : o.label,
                  note: `${o.distanceUpperBound ? '<' : o.distanceApprox ? '~' : ''}${o.distance} m`
                }));
            }
          })
        : null;
      annotatedRef.current = annotated;
      nvrRecordingService.startRecording(annotated?.stream ?? stream);
      addLog('SYSTEM', 'success', "Frontal kamera oqimi tiniq rejimda ulandi.");
    } catch (err: unknown) {
      if (isStale()) return;
      setCameraLoading(false);
      const errorMsg = err instanceof Error ? err.message : 'Kameraga ruxsat berilmadi yoki kamera topilmadi';
      setCameraError(errorMsg);
      addLog('SYSTEM', 'error', `Frontal kamera xatosi: ${errorMsg}`);
    }
  }, [addLog, stopCameraStream]);

  // OPERATOR: o'z kamerasi ochilmaydi, robot planshetining tasviri WebRTC orqali keladi
  const startRemoteCamera = useCallback((robotId: string) => {
    stopCameraStream();
    setCameraError(null);
    setCameraLoading(true);
    let annotated: AnnotatedStream | null = null;
    const stop = watchRobotCamera(robotId, {
      onTelemetry: onLiveTelemetry,
      onStream: (stream) => {
        const v = videoRef.current;
        nvrRecordingService.stopRecording();
        annotated?.stop();
        annotated = null;
        annotatedRef.current = null;
        if (!stream || !v) {
          if (v) v.srcObject = null;
          setCameraLoading(true);
          return;
        }
        v.srcObject = stream;
        v.onresize = () => {
          if (v.videoWidth && v.videoHeight) {
            const a = v.videoWidth / v.videoHeight;
            setVideoAspect((prev) => (Math.abs(prev - a) > 0.01 ? a : prev));
          }
        };
        void v.play().catch(() => {});
        setCameraLoading(false);
        setCameraError(null);
        // Operator kompyuterida ham robot tasviri (ramkalar bilan) NVR ga yoziladi
        annotated = createAnnotatedStream(v, {
          title: 'QALQON ROBOT (masofaviy)',
          mirror: () => overlayStateRef.current.mirror,
          getBoxes: () => {
            const s = overlayStateRef.current;
            if (!s.ai) return [];
            return s.objects.map((o) => ({
              x: o.box.x / 100,
              y: o.box.y / 100,
              w: o.box.width / 100,
              h: o.box.height / 100,
              color: o.color,
              label: o.isIdentifiedPerson ? `${o.label} ${(o.confidence * 100).toFixed(0)}%` : o.label,
              note: o.distance > 0 ? `${o.distanceUpperBound ? '<' : o.distanceApprox ? '~' : ''}${o.distance} m` : undefined
            }));
          }
        });
        annotatedRef.current = annotated;
        nvrRecordingService.startRecording(annotated?.stream ?? stream);
      },
      onBoxes: setRemoteBoxes,
      onState: (state, detail) => {
        setRemoteState((prev) => (prev.state === state && prev.detail === detail ? prev : { state, detail }));
        if (state !== 'live') setCameraLoading(true);
      }
    });
    addLog('SYSTEM', 'info', `${robotId} robot kamerasiga masofadan ulanilmoqda...`);
    return () => {
      stop();
      annotated?.stop();
    };
  }, [addLog, stopCameraStream, onLiveTelemetry]);

  // Kamera rejimi o'zgarganda ishga tushirish
  useEffect(() => {
    if (cameraSource !== 'FRONTAL') {
      stopCameraStream();
      return;
    }
    if (isViewer) {
      if (!watchedRobot) {
        setRemoteState({ state: 'robot-offline' });
        setCameraLoading(true);
        return;
      }
      const stop = startRemoteCamera(watchedRobot);
      return () => {
        stop();
        stopCameraStream();
        setRemoteBoxes([]);
        setLiveTel(null);
      };
    }
    startFrontalCamera();
    return () => {
      cameraRequestRef.current++;
      stopCameraStream();
    };
  }, [cameraSource, isViewer, watchedRobot, startFrontalCamera, startRemoteCamera, stopCameraStream]);

  // ROBOT: aniqlangan obyektlar operatorlarga ham uzatiladi (kadrning o'z koordinatalarida, oynalanmagan)
  useEffect(() => {
    if (isViewer) return;
    robotCamBroadcaster.setBoxes(
      aiEnabled
        ? detectedObjects.map((o) => ({
            x: (mirrorVideo ? 100 - (o.box.x + o.box.width) : o.box.x) / 100,
            y: o.box.y / 100,
            w: o.box.width / 100,
            h: o.box.height / 100,
            color: o.color,
            label: o.label,
            kind: o.category,
            identified: o.isIdentifiedPerson,
            conf: o.confidence,
            dist: o.distance,
            distApprox: o.distanceApprox,
            distUpper: o.distanceUpperBound
          }))
        : []
    );
  }, [isViewer, aiEnabled, detectedObjects, mirrorVideo]);
  useEffect(() => () => robotCamBroadcaster.setBoxes([]), []);

  // OPERATOR: robotdan kelgan ramkalar HUD dagi odatiy obyektlar ro'yxatiga aylantiriladi
  useEffect(() => {
    if (!isViewer) return;
    const objs: DetectedObject[] = aiEnabled
      ? remoteBoxes.map((b, i) => {
          const x = (mirrorVideo ? 1 - (b.x + b.w) : b.x) * 100;
          const label = b.identified ? b.label.replace(/\s+\d+%$/, '') : b.label;
          return {
            id: `remote-${i}`,
            label,
            confidence: b.conf ?? 0.9,
            distance: b.dist ?? 0,
            distanceApprox: b.distApprox,
            distanceUpperBound: b.distUpper,
            box: { x, y: b.y * 100, width: b.w * 100, height: b.h * 100 },
            color: b.color,
            category: b.kind ?? 'person',
            isIdentifiedPerson: !!b.identified,
            personName: b.identified ? label : undefined
          };
        })
      : [];
    setDetectedObjects(objs);
    setDetectedCounts({
      people: objs.filter((o) => o.category === 'person').length,
      cars: objs.filter((o) => o.category === 'car').length,
      obstacles: objs.filter((o) => o.category === 'other').length,
      total: objs.length
    });
  }, [isViewer, aiEnabled, remoteBoxes, mirrorVideo, setDetectedObjects]);

  // =========================================================================
  // 3. TASVIRDAN ODAM VA MASHINALARNI HAMDA SHAXSNI ANIQLASH
  // =========================================================================
  const detectFrame = useCallback(async () => {
    if (
      !aiEnabled ||
      !videoRef.current ||
      videoRef.current.readyState < 2 ||
      cameraSource !== 'FRONTAL' ||
      isDetectingRef.current
    ) {
      return;
    }

    const video = videoRef.current;
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    if (!vW || !vH) return;
    setVideoAspect((prev) => (Math.abs(prev - vW / vH) > 0.01 ? vW / vH : prev));

    if (cocoModelRef.current) {
      try {
        isDetectingRef.current = true;
        const cycleStart = performance.now();
        const predictions = await cocoModelRef.current.detect(video, 12, OBSTACLE_MIN_SCORE);

        let personCount = 0;
        let carCount = 0;
        let obstacleCount = 0;

        const vehiclePreds = predictions.filter((pred) => VEHICLE_CLASSES.includes(pred.class.toLowerCase()));
        // Odam uchun chegara qat'iyroq: past baholi "odam" soxta bo'lishi mumkin
        const personPreds = predictions.filter(
          (pred) => pred.class.toLowerCase() === 'person' && pred.score >= PERSON_MIN_SCORE
        );
        // Odam ustidagi/ichidagi kichik jismlar (galstuk, sumka, telefon...) robot uchun to'siq emas: odamning o'zi hisobga olinadi
        const insidePerson = (b: number[]) =>
          personPreds.some((pp) => {
            const [px, py, pw, ph] = pp.bbox;
            const cx = b[0] + b[2] / 2;
            const cy = b[1] + b[3] / 2;
            return cx >= px && cx <= px + pw && cy >= py && cy <= py + ph && b[2] * b[3] < pw * ph * 0.25;
          });
        const otherPreds = predictions.filter((pred) => {
          const cls = pred.class.toLowerCase();
          return cls !== 'person' && cls !== 'tie' && !VEHICLE_CLASSES.includes(cls) && !insidePerson(pred.bbox);
        });

        // Odamlar: yuz orqali tanish. Bazada yo'q yoki yuzi ko'rinmagan odam — "Piyoda"
        const identities = await faceRecognitionService.identifyPeople(
          video,
          personPreds.map((p) => ({ x: p.bbox[0], y: p.bbox[1], width: p.bbox[2], height: p.bbox[3] }))
        );

        // Yuz dvigateli hali tayyor bo'lmasa (qayta yuklanmoqda), "topilmadi" emas, "yuklanmoqda" ko'rsatiladi
        setFaceStatus((prev) => (prev === 'error' ? prev : faceRecognitionService.isWarm() ? 'ready' : 'loading'));

        // Eng katta (eng yaqin) yuz: kalibrovka ma'lumoti va ko'z masofasini ko'rsatish uchun
        const withFace = identities.filter((i) => i.faceBox);
        const closest = withFace.length
          ? withFace.reduce((a, b) => (a.faceBox!.width >= b.faceBox!.width ? a : b))
          : null;
        const now = Date.now();
        const eyePx = closest?.eyes
          ? Math.hypot(closest.eyes.x2 - closest.eyes.x1, closest.eyes.y2 - closest.eyes.y1)
          : 0;
        if (closest?.faceBox) {
          faceSamplesRef.current = [
            ...faceSamplesRef.current,
            { width: closest.faceBox.width, eyePx, frameH: vH, t: now }
          ];
        }
        // Eskirgan kadrlar ham tozalanadi, shunda yuz yo'qolsa indikator yana sariqqa qaytadi
        faceSamplesRef.current = faceSamplesRef.current.filter((s) => now - s.t < CALIB_WINDOW_MS);
        const calib = evaluateCalibSamples(faceSamplesRef.current);

        // Har kadrda emas, faqat ko'rinadigan qiymat o'zgarganda qayta chizamiz (butun HUD qayta chizilishi qimmat)
        const nextFaceInfo = {
          count: withFace.length,
          widthPx: closest?.faceBox ? Math.round(closest.faceBox.width / 4) * 4 : 0,
          cycleMs: Math.round((performance.now() - cycleStart) / 50) * 50,
          calibCount: calib.count,
          calibStable: calib.stable,
          eyePx: Math.round(eyePx),
          faceDistM: closest?.faceBox
            ? Math.round(distanceEstimator.rawFaceDistance(CAMERA_KEY, closest.faceBox.width, vH) * 100) / 100
            : 0,
          eyeDistM: eyePx > 0 ? Math.round(distanceEstimator.rawEyeDistance(CAMERA_KEY, eyePx, vH) * 100) / 100 : 0
        };
        setFaceInfo((prev) => (JSON.stringify(prev) === JSON.stringify(nextFaceInfo) ? prev : nextFaceInfo));

        const items = [
          ...identities.map((identity, i) => ({
            class: 'person',
            bbox: [identity.box.x, identity.box.y, identity.box.width, identity.box.height] as [number, number, number, number],
            score: personPreds[i]?.score ?? identity.faceScore ?? 0.5,
            identity
          })),
          ...vehiclePreds.map((pred) => ({ class: pred.class, bbox: pred.bbox, score: pred.score, identity: undefined })),
          // Odam ham, transport ham bo'lmagan har qanday jism robot uchun to'siq
          ...otherPreds.map((pred) => ({ class: pred.class, bbox: pred.bbox, score: pred.score, identity: undefined }))
        ];

        const newObjects: DetectedObject[] = items
          .map((pred, idx) => {
            const cls = pred.class.toLowerCase();
            const [rawX, rawY, rawW, rawH] = pred.bbox;

            let label = "Noma'lum";
            let color = "#5ad1e6";
            let category: DetectedObject['category'] = 'other';
            let personName: string | undefined = undefined;
            let isIdentifiedPerson = false;
            let confidence = +pred.score.toFixed(2);

            if (cls === 'person') {
              personCount++;
              category = 'person';

              const match = pred.identity;
              if (match?.person) {
                label = match.person.fullName;
                personName = match.person.fullName;
                color = match.person.color || '#4ade80';
                isIdentifiedPerson = true;
                confidence = +(match.confidence ?? pred.score).toFixed(2);
              } else {
                label = "Piyoda";
                personName = undefined;
                color = "#5ad1e6";
                isIdentifiedPerson = false;
                confidence = +pred.score.toFixed(2);
              }
            } else if (cls === 'car') {
              carCount++;
              label = "Mashina (Avtomobil)";
              color = "#5ad1e6"; // Tsian / Moviy
              category = 'car';
            } else if (cls === 'truck') {
              carCount++;
              label = "Yuk mashinasi";
              color = "#5ad1e6";
              category = 'car';
            } else if (cls === 'bus') {
              carCount++;
              label = "Avtobus";
              color = "#5ad1e6";
              category = 'car';
            } else if (cls === 'motorcycle' || cls === 'bicycle') {
              label = cls === 'motorcycle' ? "Motosikl" : "Velosiped";
              color = "#f5b544"; // Sariq
              category = 'vehicle';
            } else {
              obstacleCount++;
              label = UZ_OBSTACLE_NAMES[cls] || `To'siq (${cls})`;
              color = "#f5b544";
              category = 'other';
            }

            // Foiz koordinatalar (0 - 100%)
            let boxX = (rawX / vW) * 100;
            const boxY = (rawY / vH) * 100;
            const boxW = (rawW / vW) * 100;
            const boxH = (rawH / vH) * 100;

            // Oyna (mirror) effekti bo'lsa gorizontal koordinatani moslash
            if (mirrorVideo) {
              boxX = 100 - (boxX + boxW);
            }

            // Masofa: pinhole modeli (yuz kengligi yoki obyekt balandligi) va silliqlash. Haqiqiy o'lchami noma'lum
            // to'siqlar (stul, quti...) uchun kadrdagi balandlikdan taxminiy qiymat (jamoaning dastlabki formulasi)
            const dist =
              category === 'other'
                ? {
                    meters: Math.min(18, Math.max(0.18, +(45 / Math.max(10, boxH)).toFixed(2))),
                    source: 'vehicle' as const,
                    approx: true,
                    upperBound: false
                  }
                : distanceEstimator.estimate(CAMERA_KEY, {
                    cls,
                    box: { x: rawX, y: rawY, width: rawW, height: rawH },
                    faceBox: pred.identity?.faceBox ?? undefined,
                    frameWidth: vW,
                    frameHeight: vH
                  });
            // Juda yaqin begona jism qizil xavf rangiga o'tadi
            if (dist.meters <= 0.4 && !isIdentifiedPerson) color = '#ef5b5b';

            return {
              // Barqaror kalit: React har kadrda ramkalarni o'chirib-qayta yaratmasin
              id: `real-obj-${idx}`,
              label,
              confidence,
              distance: dist.meters,
              distanceSource: dist.source,
              distanceApprox: dist.approx,
              distanceUpperBound: dist.upperBound,
              box: {
                x: Math.max(0, Math.min(100 - boxW, boxX)),
                y: Math.max(0, Math.min(100 - boxH, boxY)),
                width: Math.min(100, boxW),
                height: Math.min(100, boxH)
              },
              color,
              category,
              personName,
              isIdentifiedPerson
            };
          });

        // Optik yaqinlik: kamera oldi tekis jism (qo'l, devor, kitob) bilan to'silgan, lekin hech narsa tanilmagan bo'lsa
        try {
          if (!proximityCanvasRef.current) {
            proximityCanvasRef.current = document.createElement('canvas');
            proximityCanvasRef.current.width = 40;
            proximityCanvasRef.current.height = 30;
          }
          const pCtx = proximityCanvasRef.current.getContext('2d', { willReadFrequently: true });
          if (pCtx && newObjects.length === 0) {
            pCtx.drawImage(video, 0, 0, 40, 30);
            const px = pCtx.getImageData(10, 12, 20, 16).data;
            let totalLum = 0;
            let minLum = 255;
            let maxLum = 0;
            for (let i = 0; i < px.length; i += 4) {
              const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
              totalLum += lum;
              if (lum < minLum) minLum = lum;
              if (lum > maxLum) maxLum = lum;
            }
            const avgLum = totalLum / (px.length / 4);
            if (maxLum - minLum < 30 && (avgLum < 50 || avgLum > 200)) {
              obstacleCount++;
              newObjects.push({
                id: 'opt-barrier',
                label: "To'siq (Yaqin Jism)",
                confidence: 0.94,
                distance: 0.18,
                distanceApprox: true,
                box: { x: 20, y: 35, width: 60, height: 60 },
                color: '#ef5b5b',
                category: 'other'
              });
            }
          }
        } catch {
          // Offscreen canvas tahlili xatosi e'tiborga olinmaydi
        }

        // Xavfsizlik yo'lagi: robot oldidagi markaziy koridordagi eng yaqin jism va aylanib o'tish yo'nalishi
        let minCollisionCm = 200;
        let closestLabel = "Yo'l ochiq";
        let closestCenterX = 50;
        let closestWidth = 0;
        for (const obj of newObjects) {
          const centerX = obj.box.x + obj.box.width / 2;
          const bottomY = obj.box.y + obj.box.height;
          const distCm = Math.round(obj.distance * 100);
          if (centerX >= 18 && centerX <= 82 && bottomY >= 25 && distCm < minCollisionCm) {
            minCollisionCm = distCm;
            closestLabel = obj.label;
            closestCenterX = centerX;
            closestWidth = obj.box.width;
          }
        }
        let evasion: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE' = 'CLEAR';
        if (minCollisionCm <= 80) {
          if (closestWidth >= 55) evasion = 'REVERSE';
          else if (closestCenterX < 48) evasion = 'RIGHT'; // to'siq chapda: o'ngga burilish
          else evasion = 'LEFT'; // to'siq o'ngda: chapga burilish
        }
        // Robot miyasiga (RobotContext) uzatish. Holat o'zgarmasa ~1 s da bir marta (kontekst "jonli" deb bilishi uchun)
        const obstacleKey = `${Math.round(minCollisionCm / 2)}|${closestLabel}|${evasion}`;
        const nowMs = Date.now();
        if (obstacleKey !== lastObstacleRef.current.key || nowMs - lastObstacleRef.current.t > 1000) {
          lastObstacleRef.current = { key: obstacleKey, t: nowMs };
          updateCameraObstacle(minCollisionCm, closestLabel, evasion);
        }

        // Ramkalar ~0.6% (bir necha piksel) dan kam siljisa, qayta chizmaymiz: kamera shovqini tufayli har kadrda o'zgarmasin
        const sig = newObjects
          .map((o) => {
            const q = (v: number) => Math.round(v / 0.6);
            return `${o.label}|${o.isIdentifiedPerson ? 1 : 0}|${q(o.box.x)}|${q(o.box.y)}|${q(o.box.width)}|${q(o.box.height)}|${o.distance}|${o.distanceApprox ? 1 : 0}${o.distanceUpperBound ? 1 : 0}`;
          })
          .join(';');
        if (sig !== lastObjectsSigRef.current) {
          lastObjectsSigRef.current = sig;
          setDetectedObjects(newObjects);
          setDetectedCounts({
            people: personCount,
            cars: carCount,
            obstacles: obstacleCount,
            total: newObjects.length
          });
        }
      } catch {
        // AI detection pass
      } finally {
        isDetectingRef.current = false;
      }
    }
  }, [aiEnabled, cameraSource, mirrorVideo, setDetectedObjects, updateCameraObstacle]);

  // Deteksiya sikli (har ~120ms da bir kadr tekshiriladi)
  useEffect(() => {
    let intervalId: number | null = null;
    // Operator kompyuterida aniqlash ishlamaydi: ramkalar robot planshetidan tayyor holda keladi
    if (cameraSource === 'FRONTAL' && aiEnabled && !isViewer) {
      intervalId = window.setInterval(() => {
        detectFrame();
      }, 120);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [cameraSource, aiEnabled, detectFrame, isViewer]);

  // Yangi shaxsni bazaga qo'shish (yuz tekshiruvi, xatolik xabari va aksessuar variantlari jarayoni bilan)
  const handleAddNewPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPersonName.trim()) {
      setAddPersonError("Iltimos, shaxsning to'liq ism-familiyasini kiriting.");
      return;
    }
    if (!newPersonPhoto) {
      setAddPersonError("Iltimos, shaxsning yuzi aniq ko'ringan fotosuratini yuklang.");
      return;
    }

    setIsAddingPerson(true);
    setAddPersonError(null);
    const name = newPersonName.trim();
    try {
      addLog('AI', 'info', `${name}: aksessuar variantlari hisoblanmoqda (ko'zoynak, bosh kiyim, niqob...), bir necha soniya...`);
      const added = await faceRecognitionService.addPerson(
        { fullName: name, role: newPersonRole.trim(), photoDataUrl: newPersonPhoto, color: '#5ad1e6' },
        (done, total) => {
          if (done === total || done % 5 === 0) addLog('AI', 'info', `${name}: variantlar ${done}/${total}`);
        }
      );
      setKnownPersons([...faceRecognitionService.getPersons()]);
      addLog('AI', 'success', `Yuzlar bazasiga yangi shaxs muvaffaqiyatli qo'shildi: ${added.fullName}`);
      setNewPersonName('');
      setNewPersonRole('');
      setNewPersonPhoto(null);
      setShowFaceDbModal(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Yuzni tanishda xatolik yuz berdi.";
      setAddPersonError(msg);
      addLog('AI', 'error', `Yangi shaxs qo'shilmadi: ${msg}`);
    } finally {
      setIsAddingPerson(false);
    }
  };

  // Kalibrovka datchigi holati: yashil bo'lishi uchun yuz yetarli kadrda topilib, o'lchami barqaror bo'lishi kerak
  const calibReady = faceStatus === 'ready' && faceInfo.calibCount >= CALIB_MIN_SAMPLES && faceInfo.calibStable;
  const calibHint =
    faceStatus === 'loading'
      ? 'Yuz modeli yuklanmoqda...'
      : faceStatus === 'error'
      ? 'Yuz modeli xato: kalibrovka mumkin emas (jurnalga qarang).'
      : faceInfo.calibCount === 0
      ? "Yuz topilmadi: kameraga qarang, yuzga yorug'lik tushsin, kameradan taxminan 50 sm da turing."
      : faceInfo.calibCount < CALIB_MIN_SAMPLES
      ? `Yuz kadrlari yig'ilmoqda: ${faceInfo.calibCount}/${CALIB_MIN_SAMPLES}. Kamerada qimirlamay turing.`
      : !faceInfo.calibStable
      ? "Yuz o'lchami o'zgaryapti: qimirlamang va kameraga to'g'ri qarang."
      : `Ma'lumot yetarli (${faceInfo.calibCount} kadr, barqaror). "Kalibrovka qilish"ni bosing.`;

  // Kalibrovka: odam kameradan ma'lum masofada turganda yuz kengligidan fokus uzunligi hisoblanadi
  const handleCalibrate = () => {
    const dist = parseFloat(calibDistance.replace(',', '.'));
    if (!(dist >= 0.3 && dist <= 10)) {
      addLog('AI', 'warn', "Kalibrovka masofasi 0.3 dan 10 metrgacha bo'lishi kerak.");
      return;
    }
    if (faceStatus !== 'ready') {
      addLog('AI', 'warn', "Yuz modeli tayyor emas (yuqori chapdagi 'YUZ' holatiga qarang). Kalibrovka mumkin emas.");
      return;
    }
    const now = Date.now();
    const samples = faceSamplesRef.current.filter((s) => now - s.t < CALIB_WINDOW_MS);
    const calib = evaluateCalibSamples(samples);
    if (calib.count < CALIB_MIN_SAMPLES || !calib.stable) {
      addLog('AI', 'warn', "Kalibrovka ma'lumoti hali yetarli emas: indikator yashil bo'lishini kuting.");
      return;
    }
    const medianWidth = calib.median;
    const result = distanceEstimator.calibrate(CAMERA_KEY, dist, medianWidth, samples[samples.length - 1].frameH);
    if (!result.saved) {
      addLog(
        'AI',
        'error',
        `Kalibrovka rad etildi: natija ishonchsiz (kamera ko'rish burchagi ~${result.vFovDeg}°, odatda 40-60°). Haqiqiy masofa ${dist} m ekanini va yuz ${Math.round(medianWidth)} px bo'lganini tekshiring.`
      );
      return;
    }
    // Ko'z masofasi ham xuddi shu ma'lumotdan kalibrovka qilinadi (solishtirish uchun)
    const eyeWidths = samples.map((s) => s.eyePx).filter((v) => v > 0).sort((a, b) => a - b);
    if (eyeWidths.length > 0) {
      distanceEstimator.calibrateEye(CAMERA_KEY, dist, eyeWidths[Math.floor(eyeWidths.length / 2)], samples[samples.length - 1].frameH);
    }
    setCalibrated(true);
    setShowCalibration(false);
    addLog(
      'AI',
      'success',
      `Masofa kalibrovkasi saqlandi: ${dist} m, yuz ${Math.round(medianWidth)} px, ko'rish burchagi ~${result.vFovDeg}°.`
    );
  };

  const handleResetCalibration = () => {
    distanceEstimator.resetCalibration(CAMERA_KEY);
    setCalibrated(false);
    addLog('AI', 'info', "Kalibrovka tiklandi: standart ko'rish burchagi (45°) ishlatiladi.");
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setNewPersonPhoto(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // PTZ adjustments
  const adjustPTZ = (dPan: number, dTilt: number) => {
    setPTZ((prev) => ({
      ...prev,
      pan: Math.max(-180, Math.min(180, prev.pan + dPan)),
      tilt: Math.max(-30, Math.min(60, prev.tilt + dTilt)),
    }));
  };

  const togglePanel = (id: PanelId) =>
    setOpenPanels((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const closePanel = (id: PanelId) => setOpenPanels((prev) => prev.filter((x) => x !== id));
  const isOpen = (id: PanelId) => openPanels.includes(id);

  // Xavfsizlik belgisi: panel yopiq bo'lsa ham to'siq/avtotormoz holati doim ko'rinib turadi
  const safetyTone = cameraObstacle.isBlocked ? 'danger' : cameraObstacle.distanceCm < 80 ? 'warn' : 'ok';
  const safetyLabel = cameraObstacle.isBlocked
    ? `Avtotormoz: ${cameraObstacle.label}, ${cameraObstacle.distanceCm} sm`
    : cameraObstacle.distanceCm < 80
    ? `${cameraObstacle.label}, ${cameraObstacle.distanceCm} sm`
    : "Yo'l ochiq";

  const DOCK: { id: PanelId; label: string; icon: React.ReactNode }[] = [
    { id: 'sensors', label: 'Sensorlar', icon: <Activity className="w-4 h-4" /> },
    { id: 'ai', label: 'AI', icon: <Eye className="w-4 h-4" /> },
    { id: 'log', label: 'Jurnal', icon: <ScrollText className="w-4 h-4" /> }
  ];

  // =========================================================================
  // VIRTUAL JOYSTIKLAR (O'ngda robot harakati, chapda PTZ kamera)
  // =========================================================================
  // 1. Robot Harakat Joystigi
  const [driveKnob, setDriveKnob] = useState({ x: 0, y: 0 });
  const [isDriving, setIsDriving] = useState(false);
  const driveBaseRef = useRef<HTMLDivElement | null>(null);

  const updateDrive = (e: React.PointerEvent<HTMLDivElement>) => {
    const base = driveBaseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const maxR = 48;
    const clampedDist = Math.min(dist, maxR);
    const angle = Math.atan2(dy, dx);
    const clampedX = Math.cos(angle) * clampedDist;
    const clampedY = Math.sin(angle) * clampedDist;
    setDriveKnob({ x: clampedX, y: clampedY });

    if (clampedDist < 12) {
      sendMecanumCommand('S');
      return;
    }

    const deg = (angle * 180) / Math.PI;
    if (deg >= -115 && deg <= -65) {
      sendMecanumCommand('F'); // To'g'ri oldinga
    } else if (deg > -155 && deg < -115) {
      sendMecanumCommand('G'); // Oldinga-chapga silliq burilish
    } else if (deg > -65 && deg < -25) {
      sendMecanumCommand('I'); // Oldinga-o'ngga silliq burilish
    } else if (deg >= -25 && deg <= 35) {
      sendMecanumCommand('R'); // O'ngga tank-burilish
    } else if (deg >= 65 && deg <= 115) {
      sendMecanumCommand('B'); // To'g'ri orqaga
    } else if (deg > 35 && deg < 65) {
      sendMecanumCommand('J'); // Orqaga-o'ngga burilish
    } else if (deg > 115 && deg < 145) {
      sendMecanumCommand('H'); // Orqaga-chapga burilish
    } else if (deg >= 145 || deg <= -155) {
      sendMecanumCommand('L'); // Chapga tank-burilish
    }
  };

  const handleDriveDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDriving(true);
    updateDrive(e);
  };
  const handleDriveMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDriving) updateDrive(e);
  };
  const handleDriveUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    setIsDriving(false);
    setDriveKnob({ x: 0, y: 0 });
    sendMecanumCommand('S');
  };

  // 2. PTZ Kamera Joystigi (faqat PTZ kamera kattalashtirilganda chiqadi)
  const [ptzKnob, setPtzKnob] = useState({ x: 0, y: 0 });
  const [isPtzDragging, setIsPtzDragging] = useState(false);
  const ptzBaseRef = useRef<HTMLDivElement | null>(null);
  const ptzIntervalRef = useRef<number | null>(null);
  const ptzVecRef = useRef({ dx: 0, dy: 0 });

  const updatePtzVec = (e: React.PointerEvent<HTMLDivElement>) => {
    const base = ptzBaseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const maxR = 50;
    const clampedDist = Math.min(dist, maxR);
    const angle = Math.atan2(dy, dx);
    const clampedX = Math.cos(angle) * clampedDist;
    const clampedY = Math.sin(angle) * clampedDist;
    setPtzKnob({ x: clampedX, y: clampedY });
    ptzVecRef.current = { dx: clampedX, dy: clampedY };
  };

  const handlePtzDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ba'zi qurilmalarda capture bo'lmasa ham joystik ishlayveradi */
    }
    setIsPtzDragging(true);
    updatePtzVec(e);
    if (ptzIntervalRef.current) clearInterval(ptzIntervalRef.current);
    ptzIntervalRef.current = window.setInterval(() => {
      const { dx, dy } = ptzVecRef.current;
      if (Math.hypot(dx, dy) > 8) {
        const dPan = Math.round((dx / 50) * 8);
        const dTilt = Math.round((-dy / 50) * 5);
        if (dPan !== 0 || dTilt !== 0) adjustPTZ(dPan, dTilt);
        // Haqiqiy PTZ kamera (camera_server): yo'nalish va tezlik = joystik og'ishi (markazdan uzoqroq = tezroq)
        ptzCameraService.move(dx / 50, -dy / 50);
      } else {
        ptzCameraService.stop(); // o'lik zona: kamera turadi
      }
    }, 90);
  };
  const handlePtzMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPtzDragging) updatePtzVec(e);
  };
  const handlePtzUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    setIsPtzDragging(false);
    setPtzKnob({ x: 0, y: 0 });
    ptzVecRef.current = { dx: 0, dy: 0 };
    if (ptzIntervalRef.current) {
      clearInterval(ptzIntervalRef.current);
      ptzIntervalRef.current = null;
    }
    ptzCameraService.stop();
  };

  useEffect(() => {
    return () => {
      if (ptzIntervalRef.current) clearInterval(ptzIntervalRef.current);
      ptzCameraService.stop();
    };
  }, []);

  const smallCameras = ALL_CAMERAS.filter((c) => c.id !== activeCam);
  // PTZ aktiv bo'lganda kameralarning yarmi chapda, qolgani o'ng tomondagi joystik tepasiga o'tadi
  const half = Math.ceil(smallCameras.length / 2);
  const leftCameras = activeCam === 'ptz' ? smallCameras.slice(0, half) : smallCameras;
  const rightCameras = activeCam === 'ptz' ? smallCameras.slice(half) : [];

  const renderCameraTile = (cam: (typeof ALL_CAMERAS)[0], extraClass = '') => (
    <button
      key={cam.id}
      onClick={() => setActiveCam(cam.id)}
      title={`${cam.long} (kattalashtirish uchun bosing)`}
      className={`relative flex-none rounded-lg overflow-hidden bg-tactical-950 border-2 border-tactical-700 hover:border-police-cyan transition-all shadow-md group ${extraClass}`}
      style={{ aspectRatio: '16 / 9' }}
    >
      {cam.id === 'front' ? (
        <>
          <img
            src={`http://${system.rpiIp}:${system.rpiPort}/stream.mjpg?r=${rpiRetry}`}
            alt=""
            onLoad={() => setRpiOk(true)}
            onError={() => setRpiOk(false)}
            className={`absolute inset-0 w-full h-full object-cover ${rpiOk ? '' : 'hidden'}`}
          />
          {!rpiOk && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-500">
              <VideoOff className="w-4 h-4" />
              <span className="text-[10px]">Signal yo'q</span>
            </span>
          )}
        </>
      ) : MODULE_LENS[cam.id] !== undefined ? (
        // Kamera moduli linzalari (PTZ / o'ng / chap): jonli video
        <PtzLensView lens={MODULE_LENS[cam.id]!} variant="tile" label={cam.long} className="absolute inset-0" />
      ) : cam.id === 'face' ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-police-blue/15 text-police-blue">
          <Camera className="w-5 h-5 text-police-cyan" />
          <span className="text-[10px] font-semibold text-slate-200">Face ID</span>
        </span>
      ) : (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-500">
          <VideoOff className="w-4 h-4" />
          <span className="text-[10px]">Signal yo'q</span>
        </span>
      )}
      <span className="absolute left-1.5 top-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-semibold text-white group-hover:bg-police-blue">
        {cam.short}
      </span>
    </button>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      {/* ===== Yuqori satr: manba, xavfsizlik holati, panellar doki ===== */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-tactical-900 border-b border-tactical-700">
        <button
          onClick={() => setActiveCam('face')}
          aria-pressed={activeCam === 'face'}
          title="Face ID: planshetning frontal kamerasi"
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
            activeCam === 'face' ? 'bg-police-blue text-white' : 'text-slate-300 hover:bg-tactical-800'
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          Face ID
          <span className={`text-[10px] ${faceStatus === 'ready' ? 'text-police-green' : faceStatus === 'error' ? 'text-police-red' : 'text-police-amber'}`}>
            {faceStatus === 'ready' ? 'tayyor' : faceStatus === 'error' ? 'xato' : 'yuklanmoqda'}
          </span>
        </button>

        {/* Kamera translyatsiyasi holati: robotda nechta operator kuzatyapti, operatorda robot bilan aloqa */}
        <div
          data-cam-link
          title={isViewer ? 'Tasvir robot planshetidan keladi' : "Bu qurilma robot planshet: tasvir operatorlarga uzatiladi"}
          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 border ${
            (isViewer ? remoteState.state === 'live' : broadcast.state === 'online')
              ? 'bg-police-green/10 text-police-green border-police-green/40'
              : 'bg-tactical-850 text-police-amber border-tactical-700'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          {isViewer
            ? remoteState.state === 'live'
              ? 'Robot kamerasi: jonli'
              : remoteState.state === 'robot-offline'
              ? 'Robot oflayn'
              : remoteState.state === 'error'
              ? 'Aloqa xatosi'
              : 'Robotga ulanmoqda'
            : broadcast.duplicate
            ? `${broadcast.robotId}: ID takrorlangan!`
            : broadcast.state === 'online'
            ? `${broadcast.robotId} efirda: ${broadcast.viewers} operator`
            : broadcast.state === 'error'
            ? 'Translyatsiya xatosi'
            : 'Translyatsiya ulanmoqda'}
        </div>

        {/* OPERATOR: qaysi robotni kuzatish + uning navigatsiya telemetriyasi (bir manbadan, sinxron) */}
        {isViewer && (
          <div className="flex items-center gap-1.5" data-fleet>
            <select
              value={watchedRobot}
              onChange={(e) => selectedRobotStore.set(e.target.value)}
              title="Kuzatiladigan robot"
              className="px-2 py-1.5 rounded-lg bg-tactical-850 border border-tactical-700 text-[11px] font-semibold text-slate-100"
            >
              {fleet.robots.length === 0 && <option value="">Robotlar topilmadi</option>}
              {fleet.robots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.online ? '●' : '○'} {r.id}
                  {r.online ? '' : ' (oflayn)'}
                </option>
              ))}
            </select>
            {watchedTel?.nav && (
              <div
                data-robot-tel
                title={`Joylashuv: ${watchedTel.nav.lat.toFixed(6)}, ${watchedTel.nav.lon.toFixed(6)} (±${Math.round(watchedTel.nav.acc)} m)`}
                className={`px-2 py-1.5 rounded-lg border text-[11px] font-mono flex items-center gap-2 ${
                  watchedTel.nav.psrc === 'gps'
                    ? 'border-police-green/40 text-police-green'
                    : watchedTel.nav.psrc === 'dead-reckoning'
                    ? 'border-police-amber/50 text-police-amber'
                    : 'border-police-red/50 text-police-red'
                }`}
              >
                <span>{(watchedTel.nav.speed * 3.6).toFixed(1)} km/soat</span>
                <span>{Math.round(watchedTel.nav.heading)}°</span>
                <span>{watchedTel.nav.psrc === 'gps' ? 'GPS' : watchedTel.nav.psrc === 'dead-reckoning' ? 'DR' : 'eski'}</span>
                {watchedTel.battery?.pct !== undefined && <span className="text-slate-300">{Math.round(watchedTel.battery.pct)}%</span>}
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => openOnly('sensors')}
          title="Sensorlar panelini ochish"
          data-safety={safetyTone}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 border transition-colors ${
            safetyTone === 'danger'
              ? 'bg-police-red/15 text-police-red border-police-red/60'
              : safetyTone === 'warn'
              ? 'bg-police-amber/15 text-police-amber border-police-amber/50'
              : 'bg-tactical-850 text-police-green border-tactical-700'
          }`}
        >
          {safetyTone === 'ok' ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          <span>{safetyLabel}</span>
        </button>

        {/* Masofaviy admin: buyruq kelayotganda monitorda ko'rinadi (kim, nima buyruq berdi) */}
        {remote?.admin_active && remote.last && (
          <div
            data-remote-admin
            role="status"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 border bg-police-blue/20 text-police-cyan border-police-blue/60"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Masofaviy admin: {REMOTE_CMD_NAMES[remote.last.cmd] ?? remote.last.cmd}</span>
          </div>
        )}

        <div className="flex items-center gap-1" role="group" aria-label="Panellar">
          {DOCK.map((d) => (
            <button
              key={d.id}
              onClick={() => togglePanel(d.id)}
              aria-pressed={isOpen(d.id)}
              title={`${d.label} paneli`}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors ${
                isOpen(d.id)
                  ? 'bg-tactical-700 text-white border-tactical-600'
                  : 'text-slate-300 border-transparent hover:bg-tactical-800'
              }`}
            >
              {d.icon}
              <span className="hidden md:inline">{d.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ===== Sahna: Chap (4 ta kamera + PTZ joystik) | O'rta (Katta kamera chapga taqalgan) | O'ng (Virtual Joystik) ===== */}
      <div ref={stageRef} className="relative flex-1 min-h-0 flex flex-row bg-black overflow-hidden select-none">
        
        {/* ========================================================================= */}
        {/* CHAP TOMON: Kichik kameralar + Katta PTZ Joystigi (PTZ faol bo'lsa)        */}
        {/* ========================================================================= */}
        <div
          className={`flex flex-col ${
            activeCam === 'ptz' ? 'justify-start' : 'justify-center'
          } gap-2.5 p-2.5 bg-tactical-900/95 border-r border-tactical-700 z-10 shrink-0 overflow-y-auto transition-all`}
          role="group"
          aria-label="Kichik kameralar"
          style={{ width: activeCam === 'ptz' ? 'clamp(180px, 22vw, 260px)' : 'clamp(130px, 18vw, 210px)' }}
        >
          {leftCameras.map((cam) => renderCameraTile(cam, 'w-full max-w-[210px]'))}

          {/* PTZ KAMERA JOYSTIGI (Iloji boricha katta, o'ta qulay) */}
          {activeCam === 'ptz' && (
            <div className="mt-auto pt-3 border-t border-tactical-700/80 flex flex-col items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
              <div className="w-full flex items-center justify-between text-xs font-mono text-police-cyan px-1">
                <span className="font-bold flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5" /> PTZ JOYSTIK
                </span>
                <span className="bg-police-blue/20 px-1.5 py-0.5 rounded border border-police-cyan/30 text-[11px] font-bold">
                  {ptz.pan}° / {ptz.tilt}°
                </span>
              </div>

              {/* Katta Aylana PTZ Joystigi */}
              <div
                ref={ptzBaseRef}
                onPointerDown={handlePtzDown}
                onPointerMove={handlePtzMove}
                onPointerUp={handlePtzUp}
                onPointerCancel={handlePtzUp}
                className="relative w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-tactical-950 border-2 border-police-cyan/50 shadow-[0_0_25px_rgba(0,229,255,0.2)] flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none my-1"
              >
                {/* Yo'nalish ko'rsatkichlari */}
                <ArrowUp className="w-4 h-4 text-police-cyan/70 absolute top-2" />
                <ArrowDown className="w-4 h-4 text-police-cyan/70 absolute bottom-2" />
                <ArrowLeft className="w-4 h-4 text-police-cyan/70 absolute left-2" />
                <ArrowRight className="w-4 h-4 text-police-cyan/70 absolute right-2" />
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border border-police-cyan/25 absolute" />
                <div className="w-10 h-10 rounded-full border border-dashed border-police-cyan/30 absolute" />

                {/* Katta Joystik tutqichi (Knob) */}
                <div
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-police-blue to-police-blue/80 border-2 border-police-cyan shadow-lg shadow-police-cyan/50 flex items-center justify-center pointer-events-none transition-transform duration-75"
                  style={{
                    transform: `translate3d(${ptzKnob.x}px, ${ptzKnob.y}px, 0)`
                  }}
                >
                  <div className="w-4 h-4 rounded-full bg-police-cyan shadow-[0_0_10px_#00e5ff]" />
                </div>
              </div>

              {/* Markazga qaytarish tugmasi */}
              <button
                onClick={() => setPTZ((p) => ({ ...p, pan: 0, tilt: 15 }))}
                className="w-full py-1.5 rounded-lg bg-tactical-800 hover:bg-tactical-700 text-police-cyan text-xs font-mono font-semibold border border-tactical-600 transition-colors flex items-center justify-center gap-1.5"
                title="PTZ kamerani 0°, 15° markazga qaytarish"
              >
                <RefreshCw className="w-3 h-3" /> Markazga (0°, 15°)
              </button>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* O'RTA: Katta ekranli kamera - NVR OSD, ZOOM, FULLSCREEN, LIVE / PLAYBACK, 5S AUTO-HIDE */}
        {/* ========================================================================= */}
        <div
          ref={fullscreenRef}
          data-cam-fullscreen={isFullscreen ? 'on' : undefined}
          // relative va fixed bir vaqtda berilmaydi (aks holda Tailwind tartibida relative yutib, fullscreen ishlamaydi)
          className={`${
            isFullscreen
              ? 'fixed inset-0 m-0 p-0 border-0 rounded-none'
              : 'relative flex-1 min-h-0 h-full'
          } flex flex-col bg-black overflow-hidden`}
          style={
            isFullscreen
              ? { width: '100vw', height: '100dvh', zIndex: 2147483647, margin: 0, padding: 0, border: 0 }
              : undefined
          }
        >
          <div className={`flex-1 min-h-0 w-full h-full flex flex-col ${activeCam === 'face' ? '' : 'invisible'}`}>
            {/* Viewport: oddiy rejimda kadr chapga taqalgan, fullscreen da markazda */}
            <div
              ref={viewportWrapRef}
              className={`bg-black flex-1 min-h-0 w-full h-full flex items-center overflow-hidden relative ${
                isFullscreen ? 'justify-center' : 'justify-start'
              }`}
            >
              <div
                ref={zoomFrameRef}
                className="relative bg-black flex items-center justify-center overflow-hidden"
                style={{
                  aspectRatio: String(videoAspect),
                  width: fitWidth ?? '100%',
                  maxWidth: '100%',
                  maxHeight: '100%'
                }}
              >
                {/* 2-REJIM: QAYTA KO'RISH (PLAYBACK) - HAQIQIY ARXIV VIDEO IJROSI */}
                {viewMode === 'playback' && (
                  <div className="absolute inset-0 bg-black flex items-center justify-center overflow-hidden z-20">
                    <video
                      ref={playbackVideoRef}
                      playsInline
                      className={`w-full h-full object-contain ${currentPlaybackChunk ? 'block' : 'hidden'}`}
                      style={zoomStyle}
                    />
                    
                    {!currentPlaybackChunk && (
                      <div className="absolute inset-0 bg-tactical-950 flex flex-col items-center justify-center p-6 text-center z-10">
                        <div className="p-4 rounded-full bg-slate-800/80 border border-slate-700 text-slate-400 mb-3 shadow-lg">
                          <Film className="w-10 h-10" />
                        </div>
                        <div className="font-mono text-sm font-bold text-slate-200">
                          Ushbu vaqtda ({formatSecToTime(playbackSec)}) video yozuv mavjud emas
                        </div>
                        <div className="text-xs text-slate-400 max-w-md mt-1.5 leading-relaxed">
                          Scrollbarda faqat <span className="text-blue-400 font-bold">KO'K</span> rangli sohalarda NVR arxiv yozuvlari saqlangan. <span className="text-slate-400 font-bold">KULRANG</span> joylar esa zapis bo'lmagan oraliqlar.
                        </div>
                        {timelineRanges.length > 0 && (
                          <button
                            onClick={() => {
                              setPlaybackSec(timelineRanges[0].startSec);
                              setIsPlaying(true);
                              resetOverlayTimer();
                            }}
                            className="mt-4 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-police-blue hover:from-blue-500 hover:to-blue-600 text-white font-mono text-xs font-bold shadow-lg shadow-blue-500/30 transition-all flex items-center gap-2 active:scale-95"
                          >
                            <Play className="w-4 h-4 fill-current" /> Eng yaqin yozuvga o'tish ({formatSecToTime(timelineRanges[0].startSec)})
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 1-REJIM: FRONTAL WEBCAM (FACE ID) */}
                {cameraSource === 'FRONTAL' && (
                  <div className="absolute inset-0 bg-black" style={zoomStyle}>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-contain transition-transform ${mirrorVideo ? 'scale-x-[-1]' : ''}`}
                    />

                    {cameraLoading && !isViewer && (
                      <div className="absolute inset-0 bg-tactical-950/80 flex flex-col items-center justify-center space-y-2 z-10">
                        <RefreshCw className="w-8 h-8 text-police-cyan animate-spin" />
                        <span className="font-mono text-xs text-white">Frontal kamera ochilmoqda...</span>
                      </div>
                    )}

                    {/* OPERATOR: robot kamerasiga ulanish holati */}
                    {cameraLoading && isViewer && (
                      <div className="absolute inset-0 bg-tactical-950/90 flex flex-col items-center justify-center gap-2 p-4 text-center z-10">
                        {remoteState.state === 'robot-offline' ? (
                          <VideoOff className="w-9 h-9 text-slate-500" />
                        ) : remoteState.state === 'error' ? (
                          <AlertTriangle className="w-9 h-9 text-police-red" />
                        ) : (
                          <RefreshCw className="w-8 h-8 text-police-cyan animate-spin" />
                        )}
                        <span className="font-mono text-sm font-bold text-white">
                          {remoteState.state === 'robot-offline'
                            ? 'Robot planshet oflayn'
                            : remoteState.state === 'error'
                            ? "Robot kamerasiga ulanib bo'lmadi"
                            : 'Robot kamerasiga ulanilmoqda...'}
                        </span>
                        <span className="font-mono text-xs text-slate-400 max-w-md">
                          {remoteState.state === 'robot-offline'
                            ? "Robot planshetida Qalqon ochiq va Sozlamalar > Robotlar parkida \"Robot planshet\" tanlangan bo'lishi kerak. Park kodi barcha qurilmalarda bir xil bo'lsin."
                            : remoteState.detail ?? 'Tasvir faqat robot planshetidan keladi, bu qurilmaning kamerasi ishlatilmaydi.'}
                        </span>
                      </div>
                    )}

                    {cameraError && (
                      <div className="absolute inset-0 bg-tactical-950/90 flex flex-col items-center justify-center p-4 text-center z-10">
                        <AlertTriangle className="w-10 h-10 text-police-red mb-2" />
                        <span className="font-mono text-sm font-bold text-white">Frontal kameraga ulanib bo'lmadi</span>
                        <span className="font-mono text-xs text-slate-400 mt-1 max-w-sm">{cameraError}</span>
                        <button
                          onClick={startFrontalCamera}
                          className="mt-3 px-3 py-1.5 bg-police-blue text-white rounded font-mono text-xs hover:bg-police-blue/80"
                        >
                          Kamerani qayta yuklash
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* AI DETECTED OBJECTS OVERLAY: faqat jonli rejimda. Qayta ko'rishda ramkalar yozuvning o'zida bor */}
                {aiEnabled && viewMode === 'live' &&
                  detectedObjects
                    .filter((obj) => obj.category === 'person')
                    .map((obj) => (
                      <div
                        key={obj.id}
                        className="absolute border-2 rounded-sm transition-all duration-150 pointer-events-none z-20"
                        style={{
                          borderColor: obj.color,
                          // Zoom qilinganda ramka kadr bilan birga siljiydi (yozuv o'lchami kattalashmaydi)
                          left: `calc(${zoom.x}px + ${obj.box.x * zoom.s}%)`,
                          top: `calc(${zoom.y}px + ${obj.box.y * zoom.s}%)`,
                          width: `${obj.box.width * zoom.s}%`,
                          height: `${obj.box.height * zoom.s}%`
                        }}
                      >
                        <div
                          className={`absolute -left-0.5 flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-tactical-950 whitespace-nowrap max-w-[90%] ${
                            obj.box.y < 8 ? 'top-0 rounded-br-md' : '-top-6 rounded-t-md'
                          }`}
                          style={{ backgroundColor: obj.color }}
                        >
                          {obj.isIdentifiedPerson ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <User className="w-3 h-3 shrink-0" />}
                          <span className="truncate">{obj.label}</span>
                          {obj.isIdentifiedPerson && <span className="opacity-70 text-[10px]">{(obj.confidence * 100).toFixed(0)}%</span>}
                        </div>
                        {obj.distance > 0 && (
                          <div className="absolute right-1 bottom-1 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-semibold text-white">
                            {obj.distanceUpperBound ? '<' : obj.distanceApprox ? '~' : ''}
                            {obj.distance} m
                          </div>
                        )}
                      </div>
                    ))}
              </div>
            </div>
          </div>

          {/* AGAR ASOSIY OYNA FACE ID BO'LMASA */}
          {activeCam !== 'face' && (
            <div
              ref={cameraAreaRef}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-tactical-950 text-center overflow-hidden"
            >
              <div className="w-full h-full flex items-center justify-center px-6" style={zoomStyle}>
                {activeCam === 'front' && rpiOk ? (
                  <img
                    src={`http://${system.rpiIp}:${system.rpiPort}/stream.mjpg?r=${rpiRetry}`}
                    alt="Old kamera (RPi)"
                    className="w-full h-full object-contain bg-black"
                  />
                ) : MODULE_LENS[activeCam] !== undefined ? (
                  // Kamera moduli linzasi katta oynada (PTZ da nishon chiziqlari va joystik holati ustida)
                  <div className="relative w-full h-full">
                    <PtzLensView
                      lens={MODULE_LENS[activeCam]!}
                      variant="main"
                      label={ALL_CAMERAS.find((c) => c.id === activeCam)?.long ?? 'Kamera'}
                    />
                    {activeCam === 'ptz' && (
                      <div className="absolute inset-4 flex items-center justify-center pointer-events-none">
                        <div className="w-16 h-0.5 bg-police-cyan/40" />
                        <div className="h-16 w-0.5 bg-police-cyan/40 absolute" />
                        <div className="w-32 h-32 rounded-full border border-police-cyan/20 absolute" />
                        {isPtzDragging && (
                          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] font-mono font-bold text-police-cyan bg-black/60 px-2 py-0.5 rounded">
                            PTZ: {ptzKnob.x > 8 ? "O'ngga" : ptzKnob.x < -8 ? 'Chapga' : ''} {ptzKnob.y < -8 ? 'Yuqoriga' : ptzKnob.y > 8 ? 'Pastga' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <VideoOff className="w-10 h-10 text-slate-500" />
                    <div className="text-sm font-semibold text-slate-200">{ALL_CAMERAS.find((c) => c.id === activeCam)?.long} ulanmagan</div>
                    <div className="text-xs text-slate-400 max-w-xs">
                      Raspberry Pi dan shu tomonning oqimi ulanganda kadr shu yerda ko'rinadi.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* NVR KAMERA EKRANI ICHIDAGI HUD OVERLAY (5S AUTO-HIDE, TAP/MOVE BILAN BOSHQARILADI) */}
          {/* ========================================================================= */}
          <div
            ref={cameraOverlayRef}
            onPointerMove={(e) => {
              handleCameraPointerMove();
              handleCameraPanMove(e);
            }}
            onPointerDown={handleCameraPointerDown}
            onPointerUp={handleCameraPointerUp}
            onPointerCancel={handleCameraPointerUp}
            onClick={handleCameraClick}
            onDoubleClick={handleCameraDoubleClick}
            title="G'ildirak yoki ikki marta bosish: kursor nuqtasini yaqinlashtirish. Kattalashtirilganda sudrab suring"
            className={`absolute inset-0 z-30 flex flex-col justify-between p-3 pointer-events-auto select-none ${
              zoom.s > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
            }`}
          >
            {/* YUQORI QATOR: NVR SANA-VAQT (DIFFERENCE REJIMI) + REJIMLAR + ZOOM + FULLSCREEN */}
            <div
              onClick={(e) => { e.stopPropagation(); resetOverlayTimer(); }}
              className={`flex flex-wrap items-center justify-between gap-2 transition-all duration-300 ${
                showOverlay ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none'
              }`}
            >
              {/* NVR SANA VA VAQT: Orqasidagi rangga qarab har bir harf avtomatik oq yoki qoraga o'zgaradi */}
              <div
                className="font-mono text-xs sm:text-sm font-black tracking-widest uppercase select-none px-2 py-1 rounded bg-black/30 backdrop-blur-xs border border-white/20"
                style={{
                  mixBlendMode: 'difference',
                  color: '#ffffff',
                  textShadow: '0 0 2px rgba(0,0,0,0.9)'
                }}
              >
                CAM-{activeCam.toUpperCase()} • {formatNvrTimestamp(nowTime)}
              </div>

              {/* REJIM TANLASH: LIVE (Jonli) vs QAYTA KO'RISH (Playback) */}
              <div className="flex items-center gap-1 bg-tactical-900/90 p-0.5 rounded-lg border border-tactical-700 shadow-lg backdrop-blur-md">
                <button
                  onClick={() => { setViewMode('live'); setIsPlaying(false); resetOverlayTimer(); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    viewMode === 'live'
                      ? 'bg-police-red text-white shadow-[0_0_12px_rgba(255,42,42,0.4)]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5 animate-pulse" /> JONLI (LIVE)
                </button>
                <button
                  onClick={() => { setViewMode('playback'); resetOverlayTimer(); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    viewMode === 'playback'
                      ? 'bg-police-blue text-white shadow-[0_0_12px_rgba(0,102,255,0.4)]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Film className="w-3.5 h-3.5" /> QAYTA KO'RISH
                </button>
              </div>

              {/* ZOOM VA FULLSCREEN BUTTONLARI */}
              <div className="flex items-center gap-1 bg-tactical-900/90 p-1 rounded-lg border border-tactical-700 shadow-lg backdrop-blur-md">
                {/* Zoom Out */}
                <button
                  onClick={handleZoomOut}
                  title="Kichraytirish (-)"
                  className="p-1.5 rounded hover:bg-tactical-800 text-slate-300 hover:text-white transition-colors"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                {/* Zoom darajasi */}
                <span className="font-mono text-xs text-police-cyan px-1 font-bold">
                  {zoomLevel.toFixed(1)}x
                </span>
                {/* Zoom In */}
                <button
                  onClick={handleZoomIn}
                  title="Kattalashtirish (+)"
                  className="p-1.5 rounded hover:bg-tactical-800 text-slate-300 hover:text-white transition-colors"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                {/* Reset Zoom */}
                {zoomLevel > 1 && (
                  <button
                    onClick={() => { resetZoom(); resetOverlayTimer(); }}
                    title="1x ga qaytarish"
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-tactical-800 text-police-cyan hover:bg-tactical-700"
                  >
                    1x
                  </button>
                )}

                <div className="w-[1px] h-4 bg-tactical-700 mx-1" />

                {/* Butun ekranga kattalashtirish (Fullscreen) */}
                <button
                  onClick={handleToggleFullscreen}
                  title={isFullscreen ? "Fullscreen rejimidan chiqish" : "Butun ekranga kattalashtirish"}
                  className="p-1.5 rounded bg-police-blue/20 hover:bg-police-blue/40 text-police-cyan transition-colors"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* QAYTA KO'RISH (PLAYBACK) REJIMI: VIDEONI TO'XTATISH, 10S OLDINGA/ORQAGA, TEZLIK, SCROLLBAR, KALENDAR */}
            {viewMode === 'playback' && (
              <div
                onClick={(e) => { e.stopPropagation(); resetOverlayTimer(); }}
                className={`flex flex-col gap-2 p-2.5 rounded-xl bg-tactical-950/90 border border-tactical-700 shadow-2xl backdrop-blur-md transition-all duration-300 ${
                  showOverlay ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'
                }`}
              >
                {/* 1-qator: Kalendar, Vaqt ko'rsatkichi, Tezlik */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Kalendar orqali kunni tanlash */}
                  <div className="flex items-center gap-1.5 bg-tactical-900 px-2.5 py-1 rounded-lg border border-tactical-700 text-xs">
                    <Calendar className="w-3.5 h-3.5 text-police-cyan" />
                    <span className="text-[11px] text-slate-400">Kun:</span>
                    <input
                      type="date"
                      value={playbackDate}
                      onChange={(e) => { setPlaybackDate(e.target.value); resetOverlayTimer(); }}
                      className="bg-transparent text-white font-mono text-xs focus:outline-none cursor-pointer"
                    />
                  </div>

                  {/* Vaqt ko'rsatkichi va NVR holati */}
                  <div className="text-xs font-mono font-bold text-police-cyan flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5" />
                    ARXIV: <span>{playbackDate} {formatSecToTime(playbackSec)}</span>
                  </div>

                  {/* Video tezligini tanlash (0.5x, 1x, 2x, 4x, 8x) */}
                  <div className="flex items-center gap-1 bg-tactical-900 p-1 rounded-lg border border-tactical-700">
                    <span className="text-[10px] text-slate-400 pl-1">Tezlik:</span>
                    {([0.5, 1, 2, 4, 8] as const).map((spd) => (
                      <button
                        key={spd}
                        onClick={() => { setPlaybackSpeed(spd); resetOverlayTimer(); }}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors ${
                          playbackSpeed === spd
                            ? 'bg-police-blue text-white shadow-xs'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2-qator: Scrollbar (Vaqt chizig'i / Timeline scrubber) */}
                <div className="relative w-full flex flex-col gap-1 py-1">
                  <div className="relative w-full flex items-center h-6">
                    {/* Fon: KULRANG (Zapis bo'lmagan barcha vaqtlar) */}
                    <div className="absolute inset-x-0 h-3 bg-slate-700/90 rounded overflow-hidden border border-slate-600/60 shadow-inner">
                      {/* KO'K BLOKLAR: Faqat yozib olingan (zapis bo'lgan) vaqt oraliqlari */}
                      {timelineRanges.map((rng, idx) => {
                        const leftPercent = (rng.startSec / 86400) * 100;
                        const widthPercent = Math.max(0.6, ((rng.endSec - rng.startSec) / 86400) * 100);
                        return (
                          <div
                            key={idx}
                            className="absolute top-0 bottom-0 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] cursor-pointer hover:bg-blue-400 transition-colors"
                            style={{
                              left: `${leftPercent}%`,
                              width: `${widthPercent}%`
                            }}
                            title={`Zapis bor: ${formatSecToTime(rng.startSec)} - ${formatSecToTime(rng.endSec)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPlaybackSec(rng.startSec);
                              resetOverlayTimer();
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* Interaktiv scrollbar slider */}
                    <input
                      type="range"
                      min={0}
                      max={86400}
                      step={1}
                      value={playbackSec}
                      onChange={(e) => {
                        setPlaybackSec(Number(e.target.value));
                        resetOverlayTimer();
                      }}
                      className="relative w-full h-4 bg-transparent appearance-none cursor-pointer accent-police-cyan z-20"
                    />
                  </div>

                  {/* 24 soatlik belgilar */}
                  <div className="flex justify-between text-[9px] font-mono text-slate-400 px-0.5">
                    <span>00:00</span>
                    <span>04:00</span>
                    <span>08:00</span>
                    <span>12:00 (Tush)</span>
                    <span>16:00</span>
                    <span>20:00</span>
                    <span>23:59</span>
                  </div>

                  {/* Legend va 100 MB xotira statistikasi */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1 pt-0.5">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1.5 text-slate-200">
                        <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 shadow-[0_0_6px_#3b82f6] inline-block" /> Zapis bor (Ko'k)
                      </span>
                      <span className="flex items-center gap-1.5 text-slate-400">
                        <span className="w-2.5 h-2.5 rounded-sm bg-slate-700 border border-slate-600 inline-block" /> Zapis yo'q (Kulrang)
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-police-cyan font-semibold">
                      {nvrDisk.recording && (
                        <span className="flex items-center gap-1 text-rose-400">
                          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse inline-block" /> REC
                        </span>
                      )}
                      <span>
                        {nvrDisk.mode === 'disk' ? `Disk (${nvrDisk.folderName})` : 'Brauzer xotirasi'}:{' '}
                        {(storageStats.usedBytes / (1024 * 1024)).toFixed(1)} MB / {Math.round(storageStats.maxBytes / (1024 * 1024))} MB
                      </span>
                      <span className="text-slate-500">({storageStats.percentUsed}%)</span>
                      {nvrDisk.supported && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (nvrDisk.needsPermission) await nvrRecordingService.resumeDiskAccess();
                            else await nvrRecordingService.chooseDiskFolder();
                            resetOverlayTimer();
                          }}
                          title="Yozuvlar saqlanadigan papkani tanlang, masalan D:\QALQON_NVR (1 GB, eng eski yozuv avtomatik o'chadi)"
                          className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold transition-colors ${
                            nvrDisk.needsPermission
                              ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 animate-pulse'
                              : 'bg-tactical-850 border-tactical-700 text-slate-200 hover:bg-tactical-800'
                          }`}
                        >
                          {nvrDisk.needsPermission ? 'Diskka yozishni tiklash' : nvrDisk.mode === 'disk' ? 'Papkani almashtirish' : 'D diskka saqlash (1 GB)'}
                        </button>
                      )}
                    </div>
                    {nvrDisk.lastError && <span className="text-rose-400">{nvrDisk.lastError}</span>}
                  </div>
                </div>

                {/* 3-qator: Ijro boshqaruvi (Play/Pause, 10s orqaga, 10s oldinga) */}
                <div className="flex items-center justify-center gap-3 pt-1 border-t border-tactical-800">
                  {/* 10 soniya orqaga */}
                  <button
                    onClick={() => { setPlaybackSec((s) => Math.max(0, s - 10)); resetOverlayTimer(); }}
                    title="10 soniya orqaga"
                    className="px-3 py-1.5 rounded-lg bg-tactical-850 hover:bg-tactical-800 border border-tactical-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Rewind className="w-4 h-4 text-police-cyan" /> -10s
                  </button>

                  {/* Videoni to'xtatish / boshlash (Play/Pause) */}
                  <button
                    onClick={() => { setIsPlaying((p) => !p); resetOverlayTimer(); }}
                    title={isPlaying ? "To'xtatish" : "Ijro etish"}
                    className={`px-5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all active:scale-95 ${
                      isPlaying
                        ? 'bg-police-amber text-tactical-950 shadow-[0_0_15px_rgba(255,170,0,0.3)]'
                        : 'bg-police-blue text-white shadow-[0_0_15px_rgba(0,102,255,0.4)]'
                    }`}
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                    {isPlaying ? "TO'XTATISH" : "DAVOM ETTIRISH"}
                  </button>

                  {/* 10 soniya oldinga */}
                  <button
                    onClick={() => { setPlaybackSec((s) => Math.min(86400, s + 10)); resetOverlayTimer(); }}
                    title="10 soniya oldinga"
                    className="px-3 py-1.5 rounded-lg bg-tactical-850 hover:bg-tactical-800 border border-tactical-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    +10s <FastForward className="w-4 h-4 text-police-cyan" />
                  </button>
                </div>
              </div>
            )}

            {/* LIVE REJIMDA: PASTKI STATISTIKA */}
            {viewMode === 'live' && (
              <div
                onClick={(e) => { e.stopPropagation(); resetOverlayTimer(); }}
                className={`flex items-center justify-between text-[11px] font-mono px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 transition-all duration-300 ${
                  showOverlay ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'
                }`}
              >
                <div className="flex items-center gap-2 text-police-cyan">
                  <span className="w-2 h-2 rounded-full bg-police-red animate-ping" />
                  <span className="font-bold">NVR LOCAL REC: 1080P 30FPS</span>
                  <span className="text-slate-400">| QALQON DISK: 128GB (94.2GB BO'SH)</span>
                </div>
                {activeCam !== 'face' && (
                  <button
                    onClick={() => setActiveCam('face')}
                    className="px-2 py-0.5 rounded bg-police-blue text-white text-[10px] font-bold"
                  >
                    Face ID ga qaytish
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* O'NG TOMON: PTZ aktiv bo'lganda 2 ta kamera vertikal + ROBOT HARAKAT JOYSTIGI */}
        {/* ========================================================================= */}
        <div className="flex-none w-64 sm:w-72 md:w-80 h-full flex flex-col items-center justify-between p-3 bg-tactical-900/95 border-l border-tactical-700 z-10 shrink-0 select-none overflow-y-auto">
          
          {/* PTZ KAMERA ISHGA TUSHGANDA: 2 ta kamera kengaytirilib vertikal qilib qo'yildi */}
          {rightCameras.length > 0 && (
            <div className="w-full flex flex-col gap-2 mb-2 pb-2 border-b border-tactical-700/80 animate-in fade-in zoom-in-95 duration-200">
              <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between px-0.5">
                <span className="font-semibold text-police-cyan">QO'SHIMCHA KAMERALAR</span>
                <span className="text-[9px] bg-tactical-800 px-1.5 py-0.5 rounded text-slate-300">2 ta</span>
              </div>
              <div className="flex flex-col gap-2 w-full">
                {rightCameras.map((cam) => renderCameraTile(cam, 'w-full shadow-md'))}
              </div>
            </div>
          )}

          {/* Sarlavha, ESP32 statusi va oxirgi komanda */}
          <div className="w-full flex flex-col gap-1.5 mb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-police-cyan" /> Robot Harakati
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border transition-colors ${
                  lastCommand === 'S'
                    ? 'bg-police-red/15 border-police-red/50 text-police-red'
                    : 'bg-police-blue/30 border-police-cyan/60 text-police-cyan animate-pulse'
                }`}
              >
                {lastCommand === 'S' ? 'STOP' : `CMD: ${lastCommand}`}
              </span>
            </div>

            {/* ESP32 Sim-siz aloqa statusi */}
            <div className="flex items-center justify-between text-[11px] bg-tactical-950/80 px-2 py-1 rounded border border-tactical-700 font-mono">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${esp32Connected ? 'bg-police-green animate-pulse' : 'bg-police-amber'}`} />
                <span className="text-slate-300">ESP32:</span>
              </div>
              <span className={`font-bold ${esp32Connected ? 'text-police-green' : 'text-police-amber'}`}>
                {esp32Status}
              </span>
            </div>

            {/* Tezlik darajalari: 1 (50%), 2 (75%), 3 (100%) */}
            <div className="grid grid-cols-3 gap-1 mt-0.5">
              {[
                { lvl: 1 as const, label: '1 (50%)' },
                { lvl: 2 as const, label: '2 (75%)' },
                { lvl: 3 as const, label: '3 (100%)' }
              ].map(({ lvl, label }) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setSpeedLevel(lvl)}
                  className={`py-1 rounded text-[10px] font-bold font-mono transition-colors border ${
                    speedLevel === lvl
                      ? 'bg-police-cyan/20 border-police-cyan text-police-cyan shadow-[0_0_8px_rgba(0,229,255,0.3)]'
                      : 'bg-tactical-850 border-tactical-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* VIRTUAL HARAKAT JOYSTIGI */}
          <div className="relative my-1 flex flex-col items-center">
            <div
              ref={driveBaseRef}
              onPointerDown={handleDriveDown}
              onPointerMove={handleDriveMove}
              onPointerUp={handleDriveUp}
              onPointerCancel={handleDriveUp}
              className="relative w-32 h-32 sm:w-36 sm:h-36 rounded-full bg-tactical-950 border-2 border-police-cyan/50 shadow-[0_0_20px_rgba(0,229,255,0.2)] flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none"
            >
              {/* Yo'nalish belgilari */}
              <div className="absolute top-1 text-[9px] font-bold text-slate-400 flex flex-col items-center">
                <ArrowUp className="w-3 h-3 text-police-cyan" />
                <span className="text-[7px] font-mono">F</span>
              </div>
              <div className="absolute bottom-1 text-[9px] font-bold text-slate-400 flex flex-col items-center">
                <span className="text-[7px] font-mono">B</span>
                <ArrowDown className="w-3 h-3 text-slate-400" />
              </div>
              <div className="absolute left-1 text-[9px] font-bold text-slate-400 flex items-center gap-0.5">
                <ArrowLeft className="w-3 h-3 text-slate-400" />
                <span className="text-[7px] font-mono">L</span>
              </div>
              <div className="absolute right-1 text-[9px] font-bold text-slate-400 flex items-center gap-0.5">
                <span className="text-[7px] font-mono">R</span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
              </div>

              {/* Diagonal ko'rsatkichlar */}
              <span className="absolute top-2 left-2 text-[8px] text-slate-500 font-mono font-bold">G</span>
              <span className="absolute top-2 right-2 text-[8px] text-slate-500 font-mono font-bold">I</span>
              <span className="absolute bottom-2 left-2 text-[8px] text-slate-500 font-mono font-bold">H</span>
              <span className="absolute bottom-2 right-2 text-[8px] text-slate-500 font-mono font-bold">J</span>

              {/* Ichki markaz halqalari */}
              <div className="w-20 h-20 rounded-full border border-police-cyan/20 absolute" />
              <div className="w-8 h-8 rounded-full border border-dashed border-police-cyan/35 absolute" />

              {/* Joystik tutqichi (Knob) */}
              <div
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-police-blue to-police-blue/80 border-2 border-police-cyan shadow-lg shadow-police-cyan/50 flex items-center justify-center pointer-events-none transition-transform duration-75"
                style={{
                  transform: `translate3d(${driveKnob.x}px, ${driveKnob.y}px, 0)`
                }}
              >
                <div className="w-3 h-3 rounded-full bg-police-cyan shadow-[0_0_8px_#00e5ff]" />
              </div>
            </div>

            <p className="text-[9px] text-slate-400 mt-0.5 text-center font-mono">
              Joystik yoki: <span className="text-police-cyan">W A S D Q E</span>
            </p>
          </div>

          {/* SENSORLI TUGMALAR (Tezkor bosish: Oldinga, Orqaga, Egri burilishlar va Katta STOP) */}
          <div className="w-full flex flex-col gap-1 my-1">
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendMecanumCommand('G'); }}
                onPointerUp={(e) => { e.preventDefault(); sendMecanumCommand('S'); }}
                onPointerLeave={() => sendMecanumCommand('S')}
                onPointerCancel={() => sendMecanumCommand('S')}
                title="Oldinga-chapga egri burilish (G)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-police-cyan text-xs font-bold font-mono flex flex-col items-center justify-center select-none touch-none"
              >
                <span>↖️ G</span>
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendMecanumCommand('F'); }}
                onPointerUp={(e) => { e.preventDefault(); sendMecanumCommand('S'); }}
                onPointerLeave={() => sendMecanumCommand('S')}
                onPointerCancel={() => sendMecanumCommand('S')}
                title="To'g'ri oldinga (W / F)"
                className="py-1.5 px-1 rounded-lg border border-police-cyan/40 bg-tactical-850 hover:bg-police-blue/40 active:bg-police-cyan/30 text-white text-xs font-bold font-mono flex flex-col items-center justify-center select-none touch-none shadow-[0_0_10px_rgba(0,229,255,0.15)]"
              >
                <ArrowUp className="w-4 h-4 text-police-cyan" />
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendMecanumCommand('I'); }}
                onPointerUp={(e) => { e.preventDefault(); sendMecanumCommand('S'); }}
                onPointerLeave={() => sendMecanumCommand('S')}
                onPointerCancel={() => sendMecanumCommand('S')}
                title="Oldinga-o'ngga egri burilish (I)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-police-cyan text-xs font-bold font-mono flex flex-col items-center justify-center select-none touch-none"
              >
                <span>I ↗️</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendMecanumCommand('L'); }}
                onPointerUp={(e) => { e.preventDefault(); sendMecanumCommand('S'); }}
                onPointerLeave={() => sendMecanumCommand('S')}
                onPointerCancel={() => sendMecanumCommand('S')}
                title="Joyida chapga burilish (A / L)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-white text-xs font-bold font-mono flex items-center justify-center select-none touch-none"
              >
                <ArrowLeft className="w-4 h-4 text-police-cyan" />
              </button>
              <button
                type="button"
                onClick={() => sendMecanumCommand('S')}
                title="Favqulodda to'xtash (STOP)"
                className="py-1.5 px-1 rounded-lg border border-police-red bg-police-red/20 hover:bg-police-red/35 active:bg-police-red text-police-red hover:text-white font-extrabold text-xs flex items-center justify-center gap-1 select-none shadow-[0_0_12px_rgba(255,23,68,0.3)] transition-all"
              >
                <Square className="w-3.5 h-3.5 fill-current" /> STOP
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendMecanumCommand('R'); }}
                onPointerUp={(e) => { e.preventDefault(); sendMecanumCommand('S'); }}
                onPointerLeave={() => sendMecanumCommand('S')}
                onPointerCancel={() => sendMecanumCommand('S')}
                title="Joyida o'ngga burilish (D / R)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-white text-xs font-bold font-mono flex items-center justify-center select-none touch-none"
              >
                <ArrowRight className="w-4 h-4 text-police-cyan" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendMecanumCommand('H'); }}
                onPointerUp={(e) => { e.preventDefault(); sendMecanumCommand('S'); }}
                onPointerLeave={() => sendMecanumCommand('S')}
                onPointerCancel={() => sendMecanumCommand('S')}
                title="Orqaga-chapga burilish (H)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-slate-300 text-xs font-bold font-mono flex flex-col items-center justify-center select-none touch-none"
              >
                <span>↙️ H</span>
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendMecanumCommand('B'); }}
                onPointerUp={(e) => { e.preventDefault(); sendMecanumCommand('S'); }}
                onPointerLeave={() => sendMecanumCommand('S')}
                onPointerCancel={() => sendMecanumCommand('S')}
                title="To'g'ri orqaga (S / B)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-white text-xs font-bold font-mono flex items-center justify-center select-none touch-none"
              >
                <ArrowDown className="w-4 h-4 text-police-cyan" />
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendMecanumCommand('J'); }}
                onPointerUp={(e) => { e.preventDefault(); sendMecanumCommand('S'); }}
                onPointerLeave={() => sendMecanumCommand('S')}
                onPointerCancel={() => sendMecanumCommand('S')}
                title="Orqaga-o'ngga burilish (J)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-slate-300 text-xs font-bold font-mono flex flex-col items-center justify-center select-none touch-none"
              >
                <span>J ↘️</span>
              </button>
            </div>
          </div>

          {/* Qo'shimcha tugmalar: Signal, Fara, Minora U/D */}
          <div className="w-full flex flex-col gap-1 mt-auto pt-1 border-t border-tactical-800">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={toggleHorn}
                title="Signal berish"
                className={`py-1.5 px-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  hornActive
                    ? 'bg-police-amber text-tactical-950 border-police-amber font-bold shadow-[0_0_8px_rgba(255,171,0,0.5)]'
                    : 'bg-tactical-850 border-tactical-700 hover:bg-tactical-800 text-slate-200'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" /> Signal
              </button>
              <button
                type="button"
                onClick={toggleLight}
                title="Fara chirog'ini yoqish/o'chirish"
                className={`py-1.5 px-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  lightActive
                    ? 'bg-police-cyan text-tactical-950 border-police-cyan font-bold shadow-[0_0_8px_rgba(0,229,255,0.5)]'
                    : 'bg-tactical-850 border-tactical-700 hover:bg-tactical-800 text-slate-200'
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5" /> Fara
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => sendMecanumCommand('U')}
                title="Teleskopik minorani ko'tarish (U)"
                className="py-1 px-2 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 text-slate-300 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors"
              >
                <ChevronsUp className="w-3.5 h-3.5 text-police-cyan" /> Minora (U)
              </button>
              <button
                type="button"
                onClick={() => sendMecanumCommand('D')}
                title="Teleskopik minorani tushirish (D)"
                className="py-1 px-2 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 text-slate-300 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors"
              >
                <ChevronsDown className="w-3.5 h-3.5 text-police-cyan" /> Minora (D)
              </button>
            </div>
          </div>
        </div>

        {/* ===== Suzuvchi panellar (video ustida, sudrab surish mumkin) ===== */}
        <div className="absolute inset-0 pointer-events-none">
          <FloatingPanel id="sensors" title="Sensorlar" icon={<Activity className="w-4 h-4" />} open={isOpen('sensors')} onClose={() => closePanel('sensors')} anchor="bl" width={320}>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <SonarChip side="front" label="OLD" pins="TRIG A0, ECHO A1" value={sonars.front} critical={isFrontBlocked} />
                <SonarChip side="rear" label="ORQA" pins="TRIG A2, ECHO A3" value={sonars.rear} />
                <SonarChip side="left" label="CHAP" value={sonars.left} />
                <SonarChip side="right" label="O'NG" value={sonars.right} />
              </div>

              {/* Masofaviy admin kaliti: robot yonidagi operator internet orqali boshqaruvni o'chira oladi (STOP baribir ishlaydi) */}
              <div className="rounded-lg border border-tactical-700 bg-tactical-850 px-3 py-2 text-xs flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-100">Masofaviy admin</div>
                  <div className="text-[11px] text-slate-400">
                    {!remote
                      ? 'Pi ga ulanilmagan'
                      : !remote.enabled
                      ? "Pi da token o'rnatilmagan, masofaviy kirish o'chiq"
                      : remote.allowed
                      ? 'Internet orqali boshqarishga ruxsat berilgan'
                      : 'Taqiqlangan, faqat STOP ishlaydi'}
                  </div>
                </div>
                <button
                  disabled={!remote || !remote.enabled}
                  onClick={() => setRemoteAllowed(!remote?.allowed)}
                  aria-pressed={!!remote?.allowed}
                  data-remote-toggle
                  className={`shrink-0 px-3 py-1.5 rounded-lg border font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    remote?.allowed
                      ? 'bg-police-blue border-police-blue text-white'
                      : 'bg-tactical-900 border-tactical-600 text-slate-300'
                  }`}
                >
                  {remote?.allowed ? 'Ruxsat' : 'Taqiq'}
                </button>
              </div>

              <div
                data-robot-eye
                className={`rounded-lg border px-3 py-2 text-xs ${
                  cameraObstacle.isBlocked
                    ? 'bg-police-red/10 border-police-red/50 text-police-red'
                    : cameraObstacle.distanceCm < 80
                    ? 'bg-police-amber/10 border-police-amber/40 text-police-amber'
                    : 'bg-tactical-850 border-tactical-700 text-police-green'
                }`}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />
                  Robot ko'zi: {cameraObstacle.active ? `${cameraObstacle.label}, ${cameraObstacle.distanceCm} sm` : 'kutilmoqda'}
                </div>
                {cameraObstacle.isBlocked && <div className="mt-1 font-semibold">Avtotormoz ishga tushdi</div>}
                {cameraObstacle.distanceCm <= 80 && cameraObstacle.evasionDirection !== 'CLEAR' && (
                  <div className="mt-1 text-police-cyan">
                    {cameraObstacle.evasionDirection === 'LEFT' && "Chapdan chetlab o'tish tavsiya etiladi (A)"}
                    {cameraObstacle.evasionDirection === 'RIGHT' && "O'ngdan chetlab o'tish tavsiya etiladi (D)"}
                    {cameraObstacle.evasionDirection === 'REVERSE' && 'Orqaga chekinish tavsiya etiladi (S)'}
                  </div>
                )}
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-slate-400 flex items-center gap-1"><Compass className="w-3 h-3" /> Azimut</dt>
                <dd className="text-right text-slate-100">{String(gps.heading || 42).padStart(3, '0')}°{gps.isReal ? ' (kompas)' : ''}</dd>
                <dt className="text-slate-400">Komanda</dt>
                <dd className="text-right text-police-cyan font-semibold">{lastCommand}</dd>
                <dt className="text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> GPS</dt>
                <dd className="text-right text-slate-100">{gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)}</dd>
                <dt className="text-slate-400">Aniqlik</dt>
                <dd className="text-right text-slate-100">±{gps.accuracy || 3.5} m</dd>
              </dl>

              <button
                onClick={gps.isReal ? toggleGPSMode : startRealGPS}
                className="w-full px-3 py-1.5 rounded-lg border border-tactical-700 bg-tactical-850 text-xs font-medium text-slate-200 hover:bg-tactical-800 flex items-center justify-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${gps.status === 'SEARCHING' ? 'animate-spin' : ''}`} />
                {gps.isReal ? 'Simulyatsiya GPS ga o\'tish' : 'Haqiqiy GPS ni yoqish'}
              </button>
            </div>
          </FloatingPanel>
          <FloatingPanel id="ai" title="AI va yuz tanish" icon={<Eye className="w-4 h-4" />} open={isOpen('ai')} onClose={() => closePanel('ai')} anchor="tl" width={320}>
            <div className="flex flex-col gap-3 text-xs">
              <div className="flex gap-2">
                <button
                  onClick={() => setAiEnabled(!aiEnabled)}
                  aria-pressed={aiEnabled}
                  className={`flex-1 px-2.5 py-1.5 rounded-lg border font-medium flex items-center justify-center gap-1.5 ${
                    aiEnabled ? 'bg-police-blue border-police-blue text-white' : 'bg-tactical-850 border-tactical-700 text-slate-300'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  AI {aiEnabled ? 'yoqilgan' : "o'chiq"}
                </button>
                {cameraSource === 'FRONTAL' && (
                  <button
                    onClick={() => setMirrorVideo(!mirrorVideo)}
                    aria-pressed={mirrorVideo}
                    className={`flex-1 px-2.5 py-1.5 rounded-lg border font-medium ${
                      mirrorVideo ? 'bg-tactical-700 border-tactical-600 text-white' : 'bg-tactical-850 border-tactical-700 text-slate-300'
                    }`}
                  >
                    Oyna {mirrorVideo ? 'yoqilgan' : "o'chiq"}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-tactical-850 py-2">
                  <div className="text-base font-semibold text-police-green">{detectedCounts.people}</div>
                  <div className="text-[10px] text-slate-400">Odam</div>
                </div>
                <div className="rounded-lg bg-tactical-850 py-2">
                  <div className="text-base font-semibold text-police-cyan">{detectedCounts.cars}</div>
                  <div className="text-[10px] text-slate-400">Mashina</div>
                </div>
                <div className="rounded-lg bg-tactical-850 py-2">
                  <div className={`text-base font-semibold ${detectedCounts.obstacles > 0 ? 'text-police-amber' : 'text-slate-300'}`}>
                    {detectedCounts.obstacles}
                  </div>
                  <div className="text-[10px] text-slate-400">To'siq</div>
                </div>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-slate-400">Model</dt>
                <dd className="text-right text-slate-100">
                  {aiModelLoaded ? 'COCO-SSD + yuz tayyor' : aiModelLoading ? 'Yuklanmoqda (birinchi marta 10-40 s)' : 'Detektor'}
                </dd>
                <dt className="text-slate-400">Yuz</dt>
                <dd className={`text-right ${faceStatus === 'error' ? 'text-police-red' : faceInfo.count > 0 ? 'text-police-green' : 'text-police-amber'}`}>
                  {faceStatus === 'loading'
                    ? 'yuklanmoqda'
                    : faceStatus === 'error'
                    ? 'model xato (jurnalga qarang)'
                    : faceInfo.count > 0
                    ? `${faceInfo.count} ta, ${faceInfo.widthPx}px`
                    : 'topilmadi'}
                  {faceStatus === 'ready' && faceInfo.cycleMs > 0 ? `, ${faceInfo.cycleMs} ms` : ''}
                </dd>
                <dt className="text-slate-400">Masofa (yuz)</dt>
                <dd className="text-right text-slate-100">{faceInfo.faceDistM > 0 ? `${Math.round(faceInfo.faceDistM * 100)} sm` : 'yo\'q'}</dd>
                <dt className="text-slate-400">Obyektlar</dt>
                <dd className="text-right text-slate-100">{detectedCounts.total}</dd>
              </dl>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowFaceDbModal(true)}
                  className="px-2.5 py-1.5 rounded-lg border border-tactical-700 bg-tactical-850 text-slate-200 hover:bg-tactical-800 font-medium flex items-center justify-center gap-1.5"
                >
                  <Users className="w-3.5 h-3.5 text-police-green" />
                  Yuzlar bazasi ({knownPersons.length})
                </button>
                <button
                  onClick={() => setShowCalibration(true)}
                  className={`px-2.5 py-1.5 rounded-lg border bg-tactical-850 hover:bg-tactical-800 font-medium flex items-center justify-center gap-1.5 ${
                    calibrated ? 'border-tactical-700 text-police-green' : 'border-police-amber/60 text-police-amber'
                  }`}
                >
                  <Ruler className="w-3.5 h-3.5" />
                  {calibrated ? 'Kalibrovka tayyor' : 'Kalibrovka'}
                </button>
              </div>
            </div>
          </FloatingPanel>
          <FloatingPanel id="log" title="Serial jurnal" icon={<ScrollText className="w-4 h-4" />} open={isOpen('log')} onClose={() => closePanel('log')} anchor="tr" width={380}>
            <div className="flex flex-col gap-2 text-[11px]">
              <div className="text-slate-400">{system.arduinoPort}</div>
              <div className="rounded-lg bg-tactical-950 border border-tactical-800 p-2 overflow-y-auto max-h-64 space-y-1">
                {logs.slice(0, 15).map((log) => (
                  <div key={log.id} className="flex items-start gap-1.5">
                    <span className="text-slate-500 shrink-0">{log.time}</span>
                    <span
                      className={`px-1 rounded text-[9px] font-semibold shrink-0 ${
                        log.level === 'error'
                          ? 'bg-police-red/15 text-police-red'
                          : log.level === 'warn'
                          ? 'bg-police-amber/15 text-police-amber'
                          : log.level === 'success'
                          ? 'bg-police-green/15 text-police-green'
                          : 'bg-tactical-800 text-slate-300'
                      }`}
                    >
                      {log.source}
                    </span>
                    <span
                      className={`break-words min-w-0 ${
                        log.level === 'error' ? 'text-police-red' : log.level === 'warn' ? 'text-police-amber' : log.level === 'success' ? 'text-police-green' : 'text-slate-300'
                      }`}
                    >
                      {log.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </FloatingPanel>
        </div>
      </div>

      {/* MASOFA KALIBROVKASI MODAL OYNASI */}
      {showCalibration && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-tactical-950 border border-tactical-700 rounded-xl max-w-md w-full p-4 flex flex-col gap-3 shadow-2xl font-mono text-xs">
            <div className="flex items-center justify-between border-b border-tactical-800 pb-3">
              <div className="flex items-center space-x-2">
                <Ruler className="w-5 h-5 text-police-cyan" />
                <h3 className="font-bold text-white text-sm">Masofa kalibrovkasi</h3>
              </div>
              <button
                onClick={() => setShowCalibration(false)}
                className="p-1 rounded text-slate-400 hover:text-white bg-tactical-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ol className="list-decimal list-inside text-slate-300 space-y-1">
              <li>Kameradan aniq 50 sm (0.5 m) o'lchab, yuzingiz shu masofada tursin.</li>
              <li>Yuzingiz kadrda to'liq va aniq ko'rinsin (ramka paydo bo'lsin).</li>
              <li>Pastdagi masofani kiriting va "Kalibrovka qilish"ni bosing.</li>
            </ol>

            <label className="flex items-center justify-between gap-2 text-slate-300">
              <span>Haqiqiy masofa (metr):</span>
              <input
                type="text"
                inputMode="decimal"
                value={calibDistance}
                onChange={(e) => setCalibDistance(e.target.value)}
                className="w-24 bg-tactical-900 border border-tactical-700 rounded px-2 py-1 text-white text-right focus:outline-none focus:border-police-cyan"
              />
            </label>

            {/* Kalibrovka datchigi: sariq = ma'lumot yig'ilmoqda, yashil = yetarli */}
            <div
              className={`rounded border p-2.5 flex flex-col gap-1.5 transition-colors ${
                calibReady ? 'border-emerald-500 bg-emerald-950/40' : 'border-amber-500 bg-amber-950/30'
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="relative flex h-3 w-3">
                  {!calibReady && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-3 w-3 ${calibReady ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  />
                </span>
                <span className={`font-bold ${calibReady ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {calibReady ? "DATCHIK TAYYOR: ma'lumot yetarli" : "DATCHIK: ma'lumot yig'ilmoqda"}
                </span>
              </div>
              <div className="h-1.5 rounded bg-tactical-900 overflow-hidden">
                <div
                  className={`h-full transition-all ${calibReady ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  style={{ width: `${Math.min(100, (faceInfo.calibCount / CALIB_MIN_SAMPLES) * 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-300">{calibHint}</div>
            </div>

            <div className="text-[10px] text-slate-500">
              Holat: {calibrated ? 'kalibrovka qilingan' : "kalibrovka yo'q, standart ko'rish burchagi (45°) ishlatilmoqda"}.
              Kamera yoki video o'lchami o'zgarsa, qayta kalibrovka qiling.
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                onClick={handleResetCalibration}
                className="px-3 py-1.5 rounded bg-tactical-900 border border-tactical-700 text-slate-300 hover:text-white"
              >
                Tiklash
              </button>
              <button
                onClick={handleCalibrate}
                disabled={!calibReady}
                className={`px-4 py-1.5 rounded font-bold shadow ${
                  calibReady
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-tactical-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                Kalibrovka qilish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* YUZLAR BAZASINI BOSHQARISH MODAL OYNASI */}
      {showFaceDbModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-tactical-950 border border-tactical-700 rounded-xl max-w-lg w-full p-4 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-tactical-800 pb-3">
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-emerald-400" />
                <h3 className="font-mono font-bold text-white text-sm">Yuzlar va Shaxslar Bazasi</h3>
              </div>
              <button
                onClick={() => setShowFaceDbModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white bg-tactical-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Hozirgi bazadagi shaxslar ro'yxati */}
            <div className="flex flex-col gap-2 max-h-52 overflow-y-auto">
              <span className="font-mono text-xs text-slate-400 font-semibold">Tizimda ro'yxatdan o'tgan shaxslar:</span>
              {knownPersons.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-2 rounded bg-tactical-900 border border-tactical-750 font-mono text-xs"
                >
                  <div className="flex items-center space-x-2.5">
                    {p.photoUrl ? (
                      <img src={p.photoUrl} alt={p.fullName} className="w-9 h-9 rounded-full object-cover border border-emerald-400" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-tactical-800 flex items-center justify-center text-slate-300">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                    <div>
                      <div className="font-bold text-white flex items-center space-x-1.5">
                        <span>{p.fullName}</span>
                        <span className="px-1 py-0.2 rounded text-[9px] bg-emerald-950 text-emerald-300 border border-emerald-600 font-extrabold">
                          {p.badge}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">{p.role}</div>
                    </div>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-bold">Faol</span>
                </div>
              ))}
            </div>

            {/* Yangi shaxs va rasm qo'shish formasi */}
            <form onSubmit={handleAddNewPerson} className="border-t border-tactical-800 pt-3 flex flex-col gap-2.5 font-mono text-xs">
              <span className="font-semibold text-slate-300 flex items-center space-x-1">
                <Plus className="w-3.5 h-3.5 text-police-cyan" />
                <span>Yangi shaxsni bazaga kiritish (face-api.js tekshiruvi bilan):</span>
              </span>

              {addPersonError && (
                <div className="p-2.5 bg-rose-950/70 border border-rose-500/60 rounded text-rose-300 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{addPersonError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Ism Familiya"
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  className="bg-tactical-900 border border-tactical-700 rounded px-2.5 py-1.5 text-white placeholder-slate-500 focus:outline-none focus:border-police-cyan text-xs"
                  required
                />
                <input
                  type="text"
                  placeholder="Lavozimi / Maqomi"
                  value={newPersonRole}
                  onChange={(e) => setNewPersonRole(e.target.value)}
                  className="bg-tactical-900 border border-tactical-700 rounded px-2.5 py-1.5 text-white placeholder-slate-500 focus:outline-none focus:border-police-cyan text-xs"
                />
              </div>

              <div className="flex items-center justify-between gap-2 mt-1">
                <label className="cursor-pointer px-2.5 py-1.5 rounded bg-tactical-900 border border-tactical-700 text-slate-300 hover:text-white flex items-center space-x-1.5 text-xs">
                  <Camera className="w-3.5 h-3.5 text-police-cyan" />
                  <span>{newPersonPhoto ? "Rasm tanlandi ✓" : "Rasm yuklash..."}</span>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                </label>

                <button
                  type="submit"
                  disabled={isAddingPerson}
                  className={`px-4 py-1.5 rounded font-bold shadow flex items-center space-x-1.5 text-white transition-all ${
                    isAddingPerson ? 'bg-tactical-700 cursor-not-allowed opacity-70' : 'bg-emerald-600 hover:bg-emerald-500'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isAddingPerson ? 'Tekshirilmoqda...' : 'Bazaga Saqlash'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
