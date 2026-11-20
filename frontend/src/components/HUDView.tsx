import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRobot } from '../context/RobotContext';
import type { DetectedObject, MecanumCommand } from '../types/robot';
import { faceRecognitionService, type KnownPerson } from '../services/faceRecognitionService';
// Ultra-fast: COCO-SSD, NVR and Pinhole distance estimator removed for maximum performance
import { FloatingPanel } from './FloatingPanel';
import { PtzLensView } from './PtzLensView';
import { PanoramaLensView } from './PanoramaLensView';
import { remoteLens } from '../services/ptzRelay';
import { ptzCameraService, LENS, CAMERA_ROTATED_180, type PtzLens } from '../services/ptzCameraService';
import { lensHub } from '../services/lensHub';
import { lidarSerialService } from '../services/lidarSerialService';
import {
  analyzeLineFrame,
  drawLineFollowerOverlay,
  LineFollowerController,
  lineFollowerService,
  loadLineFollowerConfig,
  saveLineFollowerConfig,
  type LineColorPreset,
  type LineControlStep,
  type LineFollowerConfig
} from '../services/lineFollowerService';
import { faceCameraSettings, type PiWebcamStatus } from '../services/faceCameraSettings';
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
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Radio,
  Volume2,
  Lightbulb,
  Square
} from 'lucide-react';

type PanelId = 'control' | 'sensors' | 'ai' | 'ptz' | 'log';
type CamId = 'face' | 'ptz' | 'front' | 'rear' | 'right' | 'left' | 'panorama';
// Kamera moduli (camera_server, CP-159-1) linzalari: PTZ, o'ngga va chapga qaragan
const MODULE_LENS: Partial<Record<CamId, PtzLens>> = { ptz: LENS.ptz, right: LENS.right, left: LENS.left };

// Robotdagi jami 5 ta kamera (1 tasi 360° PTZ). Qaysi biri kattalashtirilsa, qolgan 4 tasi chap tomonda kichik ko'rinadi
// Kursorga bog'langan zoom chegaralari
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

const ALL_CAMERAS: { id: CamId; short: string; long: string }[] = [
  { id: 'face', short: 'Face ID', long: 'Face ID (Planshet)' },
  { id: 'panorama', short: '360°', long: "360° Panorama (chap + PTZ + o'ng)" },
  { id: 'ptz', short: 'PTZ', long: 'PTZ kamera' },
  { id: 'right', short: "O'ng", long: "O'ng kamera" },
  { id: 'left', short: 'Chap', long: 'Chap kamera' }
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

// LiDAR sektor masofasiga (sm) qarab rang: <=25 xavf (avtotormoz), <=50 ogohlantirish, qolgani xavfsiz
const getSonarColor = (distance: number, isCritical = false) => {
  if (isCritical || distance <= 25) return 'text-police-red bg-police-red/10 border-police-red/60';
  if (distance <= 50) return 'text-police-amber bg-police-amber/10 border-police-amber/50';
  return 'text-police-green bg-tactical-850 border-tactical-700';
};

const SONAR_ARROW = { front: ArrowUp, rear: ArrowDown, left: ArrowLeft, right: ArrowRight } as const;

// Video ostidagi qatorda turuvchi LiDAR sektor chipi: yo'nalish o'qi, nomi va masofasi
const SonarChip: React.FC<{
  side: 'front' | 'rear' | 'left' | 'right';
  label: string;
  /** null = datchik yo'q / ma'lumot kelmagan */
  value: number | null;
  pins?: string;
  critical?: boolean;
}> = ({ side, label, value, pins: _pins, critical = false }) => {
  const danger = critical || (value !== null && value <= 25);
  const Arrow = SONAR_ARROW[side];
  const title =
    value === null
      ? `${label}: to'siq yo'q / ochiq`
      : `${label} LiDAR masofasi: ${value} sm. Chegara: <30 sm = avtotormoz`;
  return (
    <div
      className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
        value === null ? 'border-tactical-700 text-slate-500 bg-tactical-900/60' : getSonarColor(value, critical)
      }`}
      title={title}
      data-sonar={side}
    >
      {danger ? <ShieldAlert className="w-3 h-3 shrink-0" /> : <Arrow className="w-3 h-3 shrink-0" />}
      <span className="text-[10px] font-medium text-slate-300">{label}</span>
      <span className="ml-auto">{value === null ? '—' : `${value} sm`}</span>
    </div>
  );
};

export const HUDView: React.FC = () => {
  const {
    lastCommand,
    sendMecanumCommand,
    sendJoystickCoordinates,
    sonars,
    isFrontBlocked,
    cameraObstacle,
    updateCameraObstacle,
    ptz,
    setPTZ,
    detectedObjects,
    setDetectedObjects,
    logs,
    gps,
    startRealGPS,
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


  // Zoom va Fullscreen holati
  // Zoom: s - masshtab (1x..8x), x/y - kadr siljishi (piksel)
  const [zoom, setZoom] = useState<{ s: number; x: number; y: number }>({ s: 1, x: 0, y: 0 });
  const zoomLevel = zoom.s;
  const [activeCam, setActiveCam] = useState<CamId>('face');
  const zoomFrameRef = useRef<HTMLDivElement | null>(null);
  const cameraAreaRef = useRef<HTMLDivElement | null>(null);
  const cameraOverlayRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Live rejim
  const viewMode = 'live';

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
  const [aiEnabled, setAiEnabled] = useState(false);

  // Taktil sariq yo'lak (ko'zi ojizlar yo'lagi) bo'ylab chiziqli yurish holatlari
  const [lineFollowEnabled, setLineFollowEnabled] = useState(false);
  const [lineFollowDrive, setLineFollowDrive] = useState(true);
  const [lineConfig, setLineConfig] = useState<LineFollowerConfig>(() => loadLineFollowerConfig());
  const [lineStep, setLineStep] = useState<LineControlStep | null>(null);
  const [linePhotoUrl, setLinePhotoUrl] = useState<string | null>(null);
  const lineOverlayFaceRef = useRef<HTMLCanvasElement | null>(null);
  const lineOverlayPtzRef = useRef<HTMLCanvasElement | null>(null);
  const lineOffscreenRef = useRef<HTMLCanvasElement | null>(null);
  const lineControllerRef = useRef<LineFollowerController>(new LineFollowerController());
  const linePhotoImgRef = useRef<HTMLImageElement | null>(null);
  const linePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const lastLineCmdRef = useRef<MecanumCommand | null>(null);
  const lastLineSentAtRef = useRef(0);
  const lastLineUiAtRef = useRef(0);
  // Raspberry Pi 5 ga ulangan USB web-kamera (Frontal / Face ID / Taktil Yo'lak)
  const [faceCamChoice, setFaceCamChoice] = useState(() => faceCameraSettings.get());
  const [piWebcamBase, setPiWebcamBase] = useState(() => faceCameraSettings.getPiWebcamBase());
  const [piWebcamStatus, setPiWebcamStatus] = useState<PiWebcamStatus>({ reachable: false, connected: false });
  const [piWebcamNonce, setPiWebcamNonce] = useState(0);
  const piWebcamImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => faceCameraSettings.subscribe(setFaceCamChoice), []);
  useEffect(() => faceCameraSettings.subscribePiBase(setPiWebcamBase), []);
  useEffect(() => {
    if (faceCamChoice !== 'auto' && faceCamChoice !== 'pi-webcam') {
      setPiWebcamStatus({ reachable: false, connected: false });
      return;
    }
    let alive = true;
    const poll = async () => {
      const s = await faceCameraSettings.checkPiWebcam();
      if (alive) setPiWebcamStatus(s);
    };
    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [faceCamChoice, piWebcamBase]);

  const piWebcamWanted =
    faceCamChoice === 'pi-webcam' ||
    (faceCamChoice === 'auto' &&
      piWebcamStatus.connected &&
      (isViewer ? remoteState.state !== 'live' : Boolean(cameraError || cameraLoading)));
  const piWebcamStreamUrl = piWebcamWanted && piWebcamBase ? faceCameraSettings.piWebcamStreamUrl(piWebcamNonce) : '';
  const piWebcamActive = Boolean(piWebcamWanted && piWebcamStatus.connected && piWebcamStreamUrl);

  const lineFollowRef = useRef({
    enabled: false,
    drive: true,
    config: lineConfig,
    isBlocked: false,
    mirror: false,
    activeCam: 'face' as CamId,
    isViewer: false,
    hasPhoto: false,
    piWebcamActive: false
  });
  lineFollowRef.current = {
    enabled: lineFollowEnabled,
    drive: lineFollowDrive,
    config: lineConfig,
    isBlocked: isFrontBlocked,
    mirror: mirrorVideo,
    activeCam,
    isViewer,
    hasPhoto: Boolean(linePhotoUrl),
    piWebcamActive
  };

  // NVR yozuviga odam ramkalari ham tushishi uchun: kompozitor har kadrda shu ref'dan o'qiydi
  const overlayStateRef = useRef({ objects: detectedObjects, ai: aiEnabled, mirror: mirrorVideo });
  overlayStateRef.current = { objects: detectedObjects, ai: aiEnabled, mirror: mirrorVideo };
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

  // Yuz modeli holati va oxirgi kadr natijasi (ekranda ko'rsatiladi: nima uchun yuz topilmayotganini ko'rish uchun)
  const [faceStatus, setFaceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [faceInfo, setFaceInfo] = useState<{
    count: number;
    widthPx: number;
    cycleMs: number;
    calibCount: number;
    calibStable: boolean;
    eyePx: number;
    faceDistM: number;
    eyeDistM: number;
  }>({ count: 0, widthPx: 0, cycleMs: 0, calibCount: 0, calibStable: true, eyePx: 0, faceDistM: 0, eyeDistM: 0 });
  const isDetectingRef = useRef<boolean>(false);
  const lastObjectsSigRef = useRef('');

  // =========================================================================
  // 1. YUZ BAZASINI YUKLASH (OPTIMALLASHTIRILGAN, COCO-SSD-SIZ)
  // =========================================================================
  useEffect(() => {
    let isMounted = true;
    const loadAiServices = async () => {
      try {
        setDetectedObjects([]);
        setAiModelLoading(true);
        addLog('AI', 'info', "Yuz tanish modeli yuklanmoqda...");

        let faceReady = true;
        await faceRecognitionService.prepare().catch((faceErr: unknown) => {
          faceReady = false;
          if (isMounted) setFaceStatus('error');
          const msg = faceErr instanceof Error ? faceErr.message : String(faceErr);
          addLog('AI', 'error', `Yuz tanish modeli yuklanmadi: ${msg}`);
        });

        if (isMounted) {
          setAiModelLoaded(true);
          setAiModelLoading(false);
          setKnownPersons([...faceRecognitionService.getPersons()]);
          if (faceReady) {
            setFaceStatus('ready');
            const n = faceRecognitionService.getPersons().filter((p) => p.descriptor).length;
            addLog('AI', 'success', `Yuzni tanish tayyor: bazada ${n} ta shaxs (tezkor rejim)`);
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
  }, [addLog]);

  // =========================================================================
  // 2. FRONTAL KAMERA (WEBCAM) OQIMINI BOSHQARISH
  // =========================================================================
  const stopCameraStream = useCallback(() => {
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
    if (faceCameraSettings.get() === 'pi-webcam') {
      setCameraLoading(false);
      setCameraError(null);
      return;
    }
    setCameraLoading(true);
    setCameraError(null);

    try {
      // Sozlamalarda tanlangan Face ID kamerasi (frontal yoki USB web-kamera)
      const stream = await faceCameraSettings.open();

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
    const stop = watchRobotCamera(robotId, {
      onTelemetry: onLiveTelemetry,
      // Robotga ulangan PTZ kamera moduli (PTZ / o'ng / chap) tasviri: kichik va katta oynalarda ko'rsatiladi
      onPtzStream: (stream) => remoteLens.setStream(stream),
      onStream: (stream) => {
        const v = videoRef.current;
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
    // Sozlamalarda Face ID kamera manbai almashtirilsa kamera qayta ochiladi
    const unsub = faceCameraSettings.subscribe(() => startFrontalCamera());
    return () => {
      unsub();
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
    if (!isViewer || piWebcamActive) return;
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
  }, [isViewer, piWebcamActive, aiEnabled, remoteBoxes, mirrorVideo, setDetectedObjects]);

  // =========================================================================
  // 3. TASVIRDAN ODAM VA MASHINALARNI HAMDA SHAXSNI ANIQLASH
  // =========================================================================
  const detectFrame = useCallback(async () => {
    const piImg = piWebcamActive ? piWebcamImgRef.current : null;
    const usePiImg = Boolean(piImg && piImg.complete && piImg.naturalWidth > 0 && piImg.naturalHeight > 0);
    const localVideo = videoRef.current;
    const useVideo = Boolean(
      !usePiImg && localVideo && localVideo.readyState >= 2 && localVideo.videoWidth > 0 && localVideo.videoHeight > 0
    );

    if (!aiEnabled || (!usePiImg && !useVideo) || cameraSource !== 'FRONTAL' || isDetectingRef.current) {
      return;
    }

    const video: HTMLVideoElement | HTMLImageElement = usePiImg ? piImg! : localVideo!;
    const vW = usePiImg ? piImg!.naturalWidth : localVideo!.videoWidth;
    const vH = usePiImg ? piImg!.naturalHeight : localVideo!.videoHeight;
    if (!vW || !vH) return;
    setVideoAspect((prev) => (Math.abs(prev - vW / vH) > 0.01 ? vW / vH : prev));

    if (faceRecognitionService.isReady()) {
      try {
        isDetectingRef.current = true;
        const cycleStart = performance.now();
        const identities = await faceRecognitionService.identifyPeople(video, []);

        setFaceStatus((prev) => (prev === 'error' ? prev : faceRecognitionService.isWarm() ? 'ready' : 'loading'));

        const withFace = identities.filter((i) => i.faceBox);
        const closest = withFace.length
          ? withFace.reduce((a, b) => (a.faceBox!.width >= b.faceBox!.width ? a : b))
          : null;
        const eyePx = closest?.eyes
          ? Math.hypot(closest.eyes.x2 - closest.eyes.x1, closest.eyes.y2 - closest.eyes.y1)
          : 0;

        const nextFaceInfo = {
          count: withFace.length,
          widthPx: closest?.faceBox ? Math.round(closest.faceBox.width / 4) * 4 : 0,
          cycleMs: Math.round((performance.now() - cycleStart) / 50) * 50,
          calibCount: 0,
          calibStable: true,
          eyePx: Math.round(eyePx),
          faceDistM: 0,
          eyeDistM: 0
        };
        setFaceInfo((prev) => (JSON.stringify(prev) === JSON.stringify(nextFaceInfo) ? prev : nextFaceInfo));

        const newObjects: DetectedObject[] = identities.map((identity, idx) => {
          const rawBox = identity.faceBox || identity.box;
          let boxX = (rawBox.x / vW) * 100;
          const boxY = (rawBox.y / vH) * 100;
          const boxW = (rawBox.width / vW) * 100;
          const boxH = (rawBox.height / vH) * 100;

          if (mirrorVideo) {
            boxX = 100 - (boxX + boxW);
          }

          const isIdentified = !!identity.person;
          const label = identity.person?.fullName || (identity.faceFound ? "Noma'lum" : "Piyoda");
          const color = identity.person?.color || (isIdentified ? '#4ade80' : '#38bdf8');
          const confidence = +(identity.confidence ?? identity.faceScore ?? 0.85).toFixed(2);

          return {
            id: `face-${idx}`,
            label,
            confidence,
            distance: 0,
            distanceSource: 'face' as const,
            distanceApprox: false,
            distanceUpperBound: false,
            box: {
              x: Math.max(0, Math.min(100 - boxW, boxX)),
              y: Math.max(0, Math.min(100 - boxH, boxY)),
              width: Math.min(100, boxW),
              height: Math.min(100, boxH)
            },
            color,
            category: 'person' as const,
            personName: identity.person?.fullName,
            isIdentifiedPerson: isIdentified
          };
        });

        const sig = newObjects
          .map((o) => `${o.label}|${o.isIdentifiedPerson ? 1 : 0}|${Math.round(o.box.x)}|${Math.round(o.box.y)}|${Math.round(o.box.width)}|${Math.round(o.box.height)}`)
          .join(';');
        if (sig !== lastObjectsSigRef.current) {
          lastObjectsSigRef.current = sig;
          setDetectedObjects(newObjects);
          overlayStateRef.current.objects = newObjects;
        }

        setDetectedCounts({
          people: identities.length,
          cars: 0,
          obstacles: 0,
          total: identities.length
        });
      } catch (err) {
        console.warn('[FaceID] xatolik:', err);
      } finally {
        isDetectingRef.current = false;
      }
    }
  }, [aiEnabled, cameraSource, mirrorVideo, piWebcamActive, setDetectedObjects, updateCameraObstacle]);

  // Deteksiya sikli. Har tekshiruvdan keyin kamida o'sha tekshiruv davomiyligicha (min 150 ms) dam beriladi:
  // planshetda bitta tekshiruv ~150 ms davom etadi va to'xtovsiz sikl interfeys va kamera tasvirini qotirardi
  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;
    // Operator kompyuterida faqat robot planshet oqimida aniqlash ishlamaydi; Pi USB kamerada esa ishlayveradi
    if (cameraSource === 'FRONTAL' && aiEnabled && (!isViewer || piWebcamActive)) {
      const loop = async () => {
        if (stopped) return;
        const t0 = performance.now();
        try {
          await detectFrame();
        } catch {
          /* bitta kadr xatosi siklni to'xtatmaydi */
        }
        if (stopped) return;
        const took = performance.now() - t0;
        timer = window.setTimeout(loop, Math.max(150, took));
      };
      timer = window.setTimeout(loop, 150);
    }
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [cameraSource, aiEnabled, detectFrame, isViewer, piWebcamActive]);

  // =========================================================================
  // 3B. SARIQ TAKTIL YO'LAK (KO'ZI OJIZLAR YO'LAGI) BO'YLAB CHIZIQLI YURISH (10 Hz)
  // =========================================================================
  const updateLineConfig = useCallback((patch: Partial<LineFollowerConfig>) => {
    setLineConfig((prev) => {
      const next = { ...prev, ...patch };
      saveLineFollowerConfig(next);
      lineFollowerService.updateConfig(next);
      return next;
    });
  }, []);

  const clearLinePhoto = useCallback(() => {
    setLinePhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const handleSelectLinePhoto = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    setLinePhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setActiveCam('face');
    setLineFollowEnabled(true);
    lineFollowRef.current.enabled = true;
    lineFollowerService.setEnabled(true);
    lineControllerRef.current.reset();
    addLog('AI', 'info', `Yo'lak rasmi test uchun yuklandi (${file.name}). Motorlar o'chirilgan (xavfsiz sinov).`);
  }, [addLog]);

  const stopLineFollow = useCallback((sendStop = true, reason?: string) => {
    if (!lineFollowRef.current.enabled) return;
    lineFollowRef.current.enabled = false;
    setLineFollowEnabled(false);
    lineFollowerService.setEnabled(false);
    if (sendStop) {
      sendMecanumCommand('S');
    }
    lastLineCmdRef.current = null;
    lineControllerRef.current.reset();
    setLineStep(null);
    lineFollowerService.setStep(null);
    addLog('AI', 'info', reason ?? "Taktil chiziq avtopiloti to'xtatildi.");
  }, [sendMecanumCommand, addLog]);

  const toggleLineFollow = useCallback(() => {
    if (lineFollowRef.current.enabled) {
      stopLineFollow(true);
      return;
    }
    lineControllerRef.current.reset();
    lastLineCmdRef.current = null;
    lastLineSentAtRef.current = 0;
    lineFollowRef.current.enabled = true;
    setLineFollowEnabled(true);
    lineFollowerService.setEnabled(true);
    lineFollowerService.updateConfig(lineConfig);
    const mode = lineConfig.driveMode ?? 'assisted';
    const modeLabel =
      mode === 'assisted'
        ? "YORDAMCHI REJIM (Oldingani bosganda yuradi, burilish himoyasi faol)"
        : mode === 'auto'
        ? "TO'LIQ AVTONOM (Doimiy harakat)"
        : "FAQAT SINOV (Motorsiz)";
    addLog(
      'AI',
      'success',
      `Taktil chiziq kuzatish yoqildi: ${modeLabel}.`
    );
  }, [stopLineFollow, addLog, lineConfig]);

  // Sahifadan chiqqanda yoki Space bosilganda chiziq avtopiloti darhol to'xtatiladi
  useEffect(() => {
    return () => {
      if (lineFollowRef.current.enabled) {
        sendMecanumCommand('S');
      }
    };
  }, [sendMecanumCommand]);

  useEffect(() => {
    if (!lineFollowEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      e.preventDefault();
      stopLineFollow(true, "Space tugmasi — chiziqli yurish to'xtatildi.");
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lineFollowEnabled, stopLineFollow]);

  useEffect(() => {
    const clearOverlays = () => {
      for (const cv of [lineOverlayFaceRef.current, lineOverlayPtzRef.current]) {
        if (!cv) continue;
        const c = cv.getContext('2d');
        c?.clearRect(0, 0, cv.width, cv.height);
      }
    };

    if (!lineFollowEnabled && !linePhotoUrl) {
      clearOverlays();
      return;
    }

    const ANALYSIS_W = 160;
    const ANALYSIS_H = 120;

    const tick = () => {
      const cur = lineFollowRef.current;
      if (!cur.enabled && !cur.hasPhoto) return;

      if (!lineOffscreenRef.current) {
        const off = document.createElement('canvas');
        off.width = ANALYSIS_W;
        off.height = ANALYSIS_H;
        lineOffscreenRef.current = off;
      }
      const off = lineOffscreenRef.current;
      const offCtx = off.getContext('2d', { willReadFrequently: true });
      if (!offCtx) return;

      let sourceReady = false;
      let targetCanvas: HTMLCanvasElement | null = null;
      let mirrorDisplay = false;
      let drawRect: { x: number; y: number; w: number; h: number } | null = null;

      if (cur.hasPhoto && linePhotoImgRef.current?.complete && linePhotoImgRef.current.naturalWidth > 0) {
        const img = linePhotoImgRef.current;
        offCtx.clearRect(0, 0, ANALYSIS_W, ANALYSIS_H);
        offCtx.drawImage(img, 0, 0, ANALYSIS_W, ANALYSIS_H);
        sourceReady = true;
        targetCanvas = lineOverlayFaceRef.current;
        mirrorDisplay = false;
        if (targetCanvas) {
          const cw = Math.max(1, targetCanvas.clientWidth);
          const ch = Math.max(1, targetCanvas.clientHeight);
          if (targetCanvas.width !== cw || targetCanvas.height !== ch) {
            targetCanvas.width = cw;
            targetCanvas.height = ch;
          }
          const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
          const dw = img.naturalWidth * scale;
          const dh = img.naturalHeight * scale;
          drawRect = { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh };
        }
      } else if (cur.activeCam === 'face') {
        const piImg = cur.piWebcamActive ? piWebcamImgRef.current : null;
        if (piImg && piImg.complete && piImg.naturalWidth > 0 && piImg.naturalHeight > 0) {
          try {
            offCtx.clearRect(0, 0, ANALYSIS_W, ANALYSIS_H);
            offCtx.drawImage(piImg, 0, 0, ANALYSIS_W, ANALYSIS_H);
            sourceReady = true;
            targetCanvas = lineOverlayFaceRef.current;
            mirrorDisplay = cur.mirror;
            if (targetCanvas) {
              const cw = Math.max(1, targetCanvas.clientWidth);
              const ch = Math.max(1, targetCanvas.clientHeight);
              if (targetCanvas.width !== cw || targetCanvas.height !== ch) {
                targetCanvas.width = cw;
                targetCanvas.height = ch;
              }
              const scale = Math.min(cw / piImg.naturalWidth, ch / piImg.naturalHeight);
              const dw = piImg.naturalWidth * scale;
              const dh = piImg.naturalHeight * scale;
              drawRect = { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh };
            }
          } catch {
            sourceReady = false;
          }
        } else {
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
            offCtx.clearRect(0, 0, ANALYSIS_W, ANALYSIS_H);
            offCtx.drawImage(v, 0, 0, ANALYSIS_W, ANALYSIS_H);
            sourceReady = true;
            targetCanvas = lineOverlayFaceRef.current;
            mirrorDisplay = cur.mirror;
            if (targetCanvas) {
              const cw = Math.max(1, targetCanvas.clientWidth);
              const ch = Math.max(1, targetCanvas.clientHeight);
              if (targetCanvas.width !== cw || targetCanvas.height !== ch) {
                targetCanvas.width = cw;
                targetCanvas.height = ch;
              }
              drawRect = { x: 0, y: 0, w: cw, h: ch };
            }
          }
        }
      } else if (MODULE_LENS[cur.activeCam] !== undefined) {
        const lens = MODULE_LENS[cur.activeCam]!;
        const frame = (cur.isViewer ? remoteLens : lensHub).current();
        if (frame && frame.width > 0 && frame.height > 0) {
          const lenses = Math.max(1, Math.round((frame.height * 16) / (frame.width * 9)));
          if (lens < lenses) {
            const sw = frame.width;
            const sh = frame.height / lenses;
            const sy = sh * lens;
            offCtx.save();
            offCtx.clearRect(0, 0, ANALYSIS_W, ANALYSIS_H);
            if (CAMERA_ROTATED_180) {
              offCtx.translate(ANALYSIS_W, ANALYSIS_H);
              offCtx.rotate(Math.PI);
            }
            try {
              offCtx.drawImage(frame.src, 0, sy, sw, sh, 0, 0, ANALYSIS_W, ANALYSIS_H);
              sourceReady = true;
            } catch {
              sourceReady = false;
            }
            offCtx.restore();

            targetCanvas = lineOverlayPtzRef.current;
            mirrorDisplay = false;
            if (targetCanvas && sourceReady) {
              const cw = Math.max(1, targetCanvas.clientWidth);
              const ch = Math.max(1, targetCanvas.clientHeight);
              if (targetCanvas.width !== cw || targetCanvas.height !== ch) {
                targetCanvas.width = cw;
                targetCanvas.height = ch;
              }
              const scale = Math.min(cw / sw, ch / sh);
              const dw = sw * scale;
              const dh = sh * scale;
              drawRect = { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh };
            }
          }
        }
      }

      if (!sourceReady) {
        clearOverlays();
        return;
      }

      const imgData = offCtx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H);
      const analysis = analyzeLineFrame(imgData.data, ANALYSIS_W, ANALYSIS_H, cur.config);
      const now = Date.now();
      const lidarInfo = lidarSerialService.getObstacleInfo();
      const blocked = cur.isBlocked || lidarInfo.isBlocked;
      const intent = lineFollowerService.getUserIntent();
      const step = lineControllerRef.current.step(analysis, cur.config, intent, now, blocked);
      lineFollowerService.setStep(step);

      if (targetCanvas && drawRect) {
        const ctx = targetCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
          ctx.save();
          ctx.translate(drawRect.x, drawRect.y);
          drawLineFollowerOverlay(ctx, drawRect.w, drawRect.h, step, mirrorDisplay, blocked);
          ctx.restore();
        }
      }

      const cmdChanged = step.command !== lastLineCmdRef.current;
      if (now - lastLineUiAtRef.current >= 120 || cmdChanged) {
        lastLineUiAtRef.current = now;
        setLineStep(step);
      }

      // Motor buyruqlari:
      // - auto: doimiy harakat qiladi
      // - assisted: foydalanuvchi oldinga bosib turganda chiziq bo'ylab yuradi,
      //             qo'yib yuborganda avtonom to'g'irlanadi,
      //             chapga/o'ngga chiziq bo'lmasa burilish bloklanadi
      // - test: faqat vizual kamera tahlili, motorlar o'chirilgan
      const canDrive = cur.enabled && cur.drive && !cur.hasPhoto && cur.config.driveMode !== 'test';
      if (canDrive) {
        if (cmdChanged || (step.command !== 'S' && now - lastLineSentAtRef.current >= 180)) {
          lastLineCmdRef.current = step.command;
          lastLineSentAtRef.current = now;
          lineFollowerService.setSending(true);
          sendMecanumCommand(step.command);
          lineFollowerService.setSending(false);
        } else if (step.command === 'S' && lastLineCmdRef.current !== 'S') {
          lastLineCmdRef.current = 'S';
          lastLineSentAtRef.current = now;
          lineFollowerService.setSending(true);
          sendMecanumCommand('S');
          lineFollowerService.setSending(false);
        }
      }
    };

    tick();
    const timer = window.setInterval(tick, 90);
    return () => {
      clearInterval(timer);
      clearOverlays();
    };
  }, [lineFollowEnabled, linePhotoUrl, sendMecanumCommand]);

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

    // ESP32 va RPi uchun 360° uzluksiz analog vektor (-100 dan +100 gacha)
    // Ekranda -y bu oldinga (yuqoriga), +y orqaga (pastga)
    const normX = Math.round((clampedX / maxR) * 100);
    const normY = Math.round((-clampedY / maxR) * 100);
    sendJoystickCoordinates(normX, normY);

    if (clampedDist < 12) {
      if (lineFollowRef.current.enabled && lineConfig.driveMode === 'assisted') {
        lineFollowerService.setUserIntent({
          forward: false,
          turnLeft: false,
          turnRight: false,
          reverse: false,
          emergencyStop: false
        });
      }
      sendMecanumCommand('S');
      return;
    }

    if (lineFollowRef.current.enabled && lineConfig.driveMode === 'assisted') {
      const fwd = normY > 20;
      const back = normY < -20;
      const left = normX < -30;
      const right = normX > 30;
      lineFollowerService.setUserIntent({
        forward: fwd,
        turnLeft: left,
        turnRight: right,
        reverse: back,
        emergencyStop: false
      });
    }

    const deg = (angle * 180) / Math.PI;
    // 360° uzluksiz differensial yo'nalishlar (burchakli harakatda motorlar teskari aylanmasdan quvvati kamaytiriladi)
    if (deg >= -112.5 && deg < -67.5) {
      sendMecanumCommand('F'); // Sof Oldinga (100% chap, 100% o'ng)
    } else if (deg >= -67.5 && deg < -22.5) {
      sendMecanumCommand('I'); // Oldinga + O'ngga Yoy (100% chap, 50% o'ng - o'ng motor teskari aylanmaydi!)
    } else if (deg >= -22.5 && deg < 22.5) {
      sendMecanumCommand('R'); // O'ngga burilish (Chap 100%, O'ng 50%)
    } else if (deg >= 22.5 && deg < 67.5) {
      sendMecanumCommand('J'); // Orqaga + O'ngga Yoy
    } else if (deg >= 67.5 && deg < 112.5) {
      sendMecanumCommand('B'); // Sof Orqaga
    } else if (deg >= 112.5 && deg < 157.5) {
      sendMecanumCommand('H'); // Orqaga + Chapga Yoy
    } else if (deg >= 157.5 || deg < -157.5) {
      sendMecanumCommand('L'); // Chapga burilish (Chap 50%, O'ng 100%)
    } else if (deg >= -157.5 && deg < -112.5) {
      sendMecanumCommand('G'); // Oldinga + Chapga Yoy (50% chap, 100% o'ng - chap motor teskari aylanmaydi!)
    }
  };

  const handleDriveDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lineFollowRef.current.enabled || lineConfig.driveMode !== 'assisted') {
      stopLineFollow(false, "Qo'lda joystik boshqaruvi olindi.");
    }
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
    sendJoystickCoordinates(0, 0);
    if (lineFollowRef.current.enabled && lineConfig.driveMode === 'assisted') {
      lineFollowerService.setUserIntent({
        forward: false,
        turnLeft: false,
        turnRight: false,
        reverse: false,
        emergencyStop: false
      });
    }
    sendMecanumCommand('S');
  };

  const sendManualMecanum = (cmd: MecanumCommand) => {
    if (lineFollowRef.current.enabled) {
      if (lineConfig.driveMode === 'assisted') {
        if (cmd === 'F') {
          lineFollowerService.setUserIntent({ forward: true, turnLeft: false, turnRight: false, reverse: false, emergencyStop: false });
        } else if (cmd === 'L') {
          lineFollowerService.setUserIntent({ turnLeft: true, forward: false, turnRight: false, reverse: false, emergencyStop: false });
        } else if (cmd === 'R') {
          lineFollowerService.setUserIntent({ turnRight: true, forward: false, turnLeft: false, reverse: false, emergencyStop: false });
        } else if (cmd === 'B') {
          lineFollowerService.setUserIntent({ reverse: true, forward: false, turnLeft: false, turnRight: false, emergencyStop: false });
        } else if (cmd === 'S') {
          lineFollowerService.setUserIntent({ forward: false, turnLeft: false, turnRight: false, reverse: false, emergencyStop: true });
        }
      } else {
        stopLineFollow(false, "Qo'lda tugma boshqaruvi olindi.");
      }
    }
    sendMecanumCommand(cmd);
  };

  const releaseManualMecanum = () => {
    if (lineFollowRef.current.enabled && lineConfig.driveMode === 'assisted') {
      lineFollowerService.setUserIntent({
        forward: false,
        turnLeft: false,
        turnRight: false,
        reverse: false,
        emergencyStop: false
      });
    }
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
        // Kamera teskari o'rnatilgan va tasvir 180° aylantirib ko'rsatiladi: joystik ekrandagi tasvir bo'yicha
        // ishlashi uchun ikkala o'q kameraning o'z koordinatasida teskari (o'ngga -> pan manfiy, yuqoriga -> tilt manfiy)
        ptzCameraService.move(CAMERA_ROTATED_180 ? -dx / 50 : dx / 50, dy / 50);
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

  // ============================================================================
  // VR & GAMEPAD BOSHQARUV TIZIMI (Meta Quest 2, VR Controller, Bluetooth Gamepad)
  // Chap joystik: Robot harakati (360° analog joystik)
  // O'ng joystik: PTZ kamera burilishi (Pan/Tilt)
  // ============================================================================
  useEffect(() => {
    let animId: number;
    let lastDriveSent = 0;
    let lastPtzSent = 0;
    let hadDrive = false;
    let hadPtz = false;

    const readStick = (gp: Gamepad, preferXrThumb: boolean): [number, number] => {
      if (preferXrThumb && gp.axes.length >= 4) {
        const ax2 = gp.axes[2] ?? 0;
        const ax3 = gp.axes[3] ?? 0;
        if (Math.abs(ax2) > 0.05 || Math.abs(ax3) > 0.05) return [ax2, ax3];
      }
      return [gp.axes[0] ?? 0, gp.axes[1] ?? 0];
    };

    const pollGamepads = () => {
      const list = typeof navigator.getGamepads === 'function' ? Array.from(navigator.getGamepads()).filter((g): g is Gamepad => Boolean(g && g.connected)) : [];

      if (list.length > 0) {
        const now = Date.now();
        const deadzone = 0.18;
        let rawX = 0;
        let rawY = 0;
        let ptzX = 0;
        let ptzY = 0;

        // Meta Quest 2 / ikki qo'lli VR kontrollerlari (har qo'l alohida gamepad)
        const leftGp = list.find((g) => /left/i.test(g.id));
        const rightGp = list.find((g) => /right/i.test(g.id));
        if (leftGp || rightGp) {
          if (leftGp) [rawX, rawY] = readStick(leftGp, true);
          if (rightGp) [ptzX, ptzY] = readStick(rightGp, true);
        } else {
          // Standart Xbox / PS / Bluetooth gamepad (1 ta pultda 2 ta stik)
          const gp = list[0];
          rawX = gp.axes[0] ?? 0;
          rawY = gp.axes[1] ?? 0;
          ptzX = gp.axes[2] ?? 0;
          ptzY = gp.axes[3] ?? 0;
        }

        // 1. Robot harakati
        const isDriveActive = Math.abs(rawX) > deadzone || Math.abs(rawY) > deadzone;
        if (isDriveActive) {
          hadDrive = true;
          if (now - lastDriveSent >= 50) {
            lastDriveSent = now;
            const x = Math.round(rawX * 100);
            const y = Math.round(-rawY * 100);
            sendJoystickCoordinates(x, y);
          }
        } else if (hadDrive) {
          hadDrive = false;
          sendJoystickCoordinates(0, 0);
        }

        // 2. PTZ kamera burilishi (180° teskari o'rnatish hisobga olingan)
        const isPtzActive = Math.abs(ptzX) > deadzone || Math.abs(ptzY) > deadzone;
        if (isPtzActive) {
          hadPtz = true;
          if (now - lastPtzSent >= 80) {
            lastPtzSent = now;
            ptzCameraService.move(CAMERA_ROTATED_180 ? -ptzX : ptzX, CAMERA_ROTATED_180 ? ptzY : -ptzY);
          }
        } else if (hadPtz) {
          hadPtz = false;
          ptzCameraService.stop();
        }
      }

      animId = requestAnimationFrame(pollGamepads);
    };

    animId = requestAnimationFrame(pollGamepads);
    return () => cancelAnimationFrame(animId);
  }, [sendJoystickCoordinates]);

  const smallCameras = ALL_CAMERAS.filter((c) => c.id !== activeCam);
  // PTZ aktiv bo'lganda (joystik chiqqanda) Face ID o'ng tomondagi bo'sh joyga o'tadi, O'ng va Chap chapda qoladi
  const leftCameras = activeCam === 'ptz' ? smallCameras.filter((c) => c.id !== 'face') : smallCameras;
  const rightCameras = activeCam === 'ptz' ? smallCameras.filter((c) => c.id === 'face') : [];

  const renderCameraTile = (cam: (typeof ALL_CAMERAS)[0], extraClass = '') => (
    <button
      key={cam.id}
      onClick={() => setActiveCam(cam.id)}
      title={`${cam.long} (kattalashtirish uchun bosing)`}
      className={`relative flex-none rounded-lg overflow-hidden bg-tactical-950 border-2 border-tactical-700 hover:border-police-cyan transition-all shadow-md group ${extraClass}`}
      style={{ aspectRatio: '16 / 9' }}
    >
      {cam.id === 'panorama' ? (
        // Uch linzani (chap/PTZ/o'ng) birlashtirgan keng ko'rinish
        <PanoramaLensView variant="tile" label={cam.long} className="absolute inset-0" />
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
          <span className={`text-[10px] ${faceStatus === 'ready' ? 'text-police-green' : faceStatus === 'error' ? 'text-police-red' : faceStatus === 'idle' ? 'text-slate-400' : 'text-police-amber'}`}>
            {faceStatus === 'ready' ? 'tayyor' : faceStatus === 'error' ? 'xato' : faceStatus === 'idle' ? "o'chiq" : 'yuklanmoqda'}
          </span>
        </button>

        {/* Taktil sariq yo'lak (ko'zi ojizlar yo'lagi) bo'ylab chiziqli avtoyurish */}
        <button
          onClick={toggleLineFollow}
          aria-pressed={lineFollowEnabled}
          title="Ko'zi ojizlar sariq taktil yo'lagi bo'ylab chiziqli yurishni yoqish/o'chirish"
          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
            lineFollowEnabled
              ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.25)]'
              : 'bg-tactical-850 border-tactical-700 text-slate-200 hover:bg-tactical-800'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${lineFollowEnabled ? 'bg-amber-400 animate-pulse' : 'bg-amber-500/60'}`} />
          <span>Taktil Chiziq</span>
          <span className={`text-[10px] font-mono ${lineFollowEnabled ? 'text-police-green' : 'text-slate-400'}`}>
            {lineFollowEnabled ? (lineFollowDrive && !linePhotoUrl ? 'AVTO' : 'TEST') : "o'chiq"}
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


                {/* 1-REJIM: FRONTAL WEBCAM (FACE ID / RASPBERRY PI USB KAMERA) */}
                {cameraSource === 'FRONTAL' && (
                  <div className="absolute inset-0 bg-black" style={zoomStyle}>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-contain transition-transform ${mirrorVideo ? 'scale-x-[-1]' : ''} ${piWebcamActive ? 'hidden' : ''}`}
                    />
                    {piWebcamActive && (
                      <img
                        ref={piWebcamImgRef}
                        src={piWebcamStreamUrl}
                        crossOrigin="anonymous"
                        alt="Raspberry Pi USB Frontal Kamera"
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          if (img.naturalWidth && img.naturalHeight) {
                            const a = img.naturalWidth / img.naturalHeight;
                            setVideoAspect((prev) => (Math.abs(prev - a) > 0.01 ? a : prev));
                          }
                        }}
                        onError={() => {
                          window.setTimeout(() => setPiWebcamNonce((n) => n + 1), 2000);
                        }}
                        className={`w-full h-full object-contain transition-transform ${mirrorVideo ? 'scale-x-[-1]' : ''}`}
                      />
                    )}
                    {piWebcamActive && !linePhotoUrl && (
                      <div className="absolute top-2 right-2 z-20 px-2 py-0.5 rounded bg-black/70 border border-police-green/50 text-police-green font-mono text-[10px] font-bold flex items-center gap-1.5 pointer-events-none">
                        <span className="w-1.5 h-1.5 rounded-full bg-police-green animate-pulse" />
                        Pi USB Frontal
                        {piWebcamStatus.width && piWebcamStatus.height ? ` · ${piWebcamStatus.width}×${piWebcamStatus.height}` : ''}
                      </div>
                    )}
                    {linePhotoUrl && (
                      <img
                        ref={linePhotoImgRef}
                        src={linePhotoUrl}
                        alt="Taktil yo'lak test rasmi"
                        className="absolute inset-0 w-full h-full object-contain bg-black z-20"
                      />
                    )}
                    <canvas
                      ref={lineOverlayFaceRef}
                      className="absolute inset-0 w-full h-full pointer-events-none z-[25]"
                    />

                    {faceCamChoice === 'pi-webcam' && !piWebcamActive && (
                      <div className="absolute inset-0 bg-tactical-950/90 flex flex-col items-center justify-center gap-2 p-4 text-center z-10">
                        <RefreshCw className="w-8 h-8 text-police-cyan animate-spin" />
                        <span className="font-mono text-sm font-bold text-white">Raspberry Pi USB web-kamera kutilmoqda...</span>
                        <span className="font-mono text-xs text-slate-400 max-w-md">
                          {piWebcamStatus.error
                            ? `Holat: ${piWebcamStatus.error}`
                            : `${piWebcamBase || 'Pi serveri'} /api/webcam/stream tekshirilmoqda.`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPiWebcamNonce((n) => n + 1)}
                          className="mt-2 px-3 py-1.5 bg-police-blue text-white rounded font-mono text-xs hover:bg-police-blue/80"
                        >
                          Qayta ulanish
                        </button>
                      </div>
                    )}

                    {!piWebcamActive && faceCamChoice !== 'pi-webcam' && cameraLoading && !isViewer && (
                      <div className="absolute inset-0 bg-tactical-950/80 flex flex-col items-center justify-center space-y-2 z-10">
                        <RefreshCw className="w-8 h-8 text-police-cyan animate-spin" />
                        <span className="font-mono text-xs text-white">Frontal kamera ochilmoqda...</span>
                      </div>
                    )}

                    {/* OPERATOR: robot kamerasiga ulanish holati */}
                    {!piWebcamActive && faceCamChoice !== 'pi-webcam' && cameraLoading && isViewer && (
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

                    {!piWebcamActive && faceCamChoice !== 'pi-webcam' && cameraError && (
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
                {activeCam === 'panorama' ? (
                  <PanoramaLensView variant="main" label={ALL_CAMERAS.find((c) => c.id === activeCam)?.long ?? '360° Panorama'} />
                ) : MODULE_LENS[activeCam] !== undefined ? (
                  // Kamera moduli linzasi katta oynada (PTZ da nishon chiziqlari va joystik holati ustida)
                  <div className="relative w-full h-full">
                    <PtzLensView
                      lens={MODULE_LENS[activeCam]!}
                      variant="main"
                      label={ALL_CAMERAS.find((c) => c.id === activeCam)?.long ?? 'Kamera'}
                    />
                    <canvas
                      ref={lineOverlayPtzRef}
                      className="absolute inset-0 w-full h-full pointer-events-none z-20"
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

              {/* LIVE INDIKATOR */}
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-police-red/20 border border-police-red/50 text-police-red text-xs font-bold font-mono">
                <span className="w-2 h-2 rounded-full bg-police-red animate-pulse" />
                JONLI (LIVE)
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

            {/* LIVE REJIMDA: PASTKI STATISTIKA */}
            <div
              onClick={(e) => { e.stopPropagation(); resetOverlayTimer(); }}
              className={`flex items-center justify-between text-[11px] font-mono px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 transition-all duration-300 ${
                showOverlay ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'
              }`}
            >
              <div className="flex items-center gap-2 text-police-cyan">
                <span className="w-2 h-2 rounded-full bg-police-green animate-pulse" />
                <span className="font-bold">JONLI OQIM: {activeCam.toUpperCase()}</span>
                <span className="text-slate-400">| QALQON IIV PATRUL</span>
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
          </div>

          {/* TAKTIL CHIZIQ AVTOPILOTINING DOIMIY KOMPAKT HOLAT PANELI */}
          {(lineFollowEnabled || linePhotoUrl) && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 rounded-xl bg-tactical-950/90 border border-amber-400/60 shadow-[0_0_20px_rgba(251,191,36,0.2)] backdrop-blur-md text-xs font-mono pointer-events-auto max-w-[95%]"
            >
              <span className="flex items-center gap-1.5 font-bold text-amber-300">
                <span className={`w-2 h-2 rounded-full ${lineStep?.detected ? 'bg-police-green animate-pulse' : 'bg-police-red animate-ping'}`} />
                TAKTIL YO&apos;LAK
              </span>
              <span className="px-1.5 py-0.5 rounded bg-tactical-800 text-[10px] text-slate-300 font-bold border border-tactical-700">
                {lineConfig.driveMode === 'assisted' ? '🛡️ YORDAMCHI' : lineConfig.driveMode === 'auto' ? '🤖 TO\'LIQ AVTO' : '🔬 SINOV'}
              </span>
              {lineStep?.guardBlocked && (
                <span className="px-2 py-0.5 rounded bg-police-red/35 border border-police-red text-white font-extrabold text-[11px] animate-pulse">
                  🚫 {lineStep.guardBlocked === 'left' ? "CHAPDA YO'LAK YO'Q (BLOK)" : "O'NGDA YO'LAK YO'Q (BLOK)"}
                </span>
              )}
              {lineStep?.autoAligning && (
                <span className="px-2 py-0.5 rounded bg-cyan-500/35 border border-cyan-400 text-cyan-200 font-extrabold text-[11px] animate-pulse">
                  🔄 AVTONOM BURILISH
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded bg-tactical-850 border border-tactical-700 text-slate-200">
                {lineStep ? lineStep.statusLabel : 'Kadr kutilmoqda...'}
              </span>
              {lineStep && (
                <span className="text-[11px] text-slate-300">
                  Ishonch: <strong className={lineStep.confidence >= 0.5 ? 'text-police-green' : 'text-police-amber'}>{Math.round(lineStep.confidence * 100)}%</strong>
                  {lineStep.bands.length > 0 && ` | Og'ish: ${lineStep.offsetNorm >= 0 ? '+' : ''}${Math.round(lineStep.offsetNorm * 100)}%`}
                </span>
              )}
              <button
                type="button"
                onClick={() => openOnly('ai')}
                title="Chiziq sezgirligi va sozlamalari"
                className="px-2 py-0.5 rounded border border-tactical-600 bg-tactical-850 hover:bg-tactical-800 text-police-cyan text-[11px] flex items-center gap-1"
              >
                <SlidersHorizontal className="w-3 h-3" /> Sozlash
              </button>
              {linePhotoUrl ? (
                <button
                  type="button"
                  onClick={clearLinePhoto}
                  className="px-2 py-0.5 rounded bg-police-amber/20 border border-amber-400/50 text-amber-200 hover:bg-amber-500/30 text-[11px] font-bold"
                >
                  Rasmdan chiqish
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => stopLineFollow(true, "Foydalanuvchi STOP tugmasini bosdi.")}
                  className="px-2.5 py-0.5 rounded bg-police-red/25 border border-police-red text-police-red hover:bg-police-red hover:text-white text-[11px] font-extrabold flex items-center gap-1"
                >
                  <Square className="w-3 h-3 fill-current" /> STOP
                </button>
              )}
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* O'NG TOMON: PTZ aktiv bo'lganda 2 ta kamera vertikal + ROBOT HARAKAT JOYSTIGI */}
        {/* ========================================================================= */}
        <div className="flex-none w-64 sm:w-72 md:w-80 h-full flex flex-col items-center justify-between p-3 bg-tactical-900/95 border-l border-tactical-700 z-10 shrink-0 select-none overflow-y-auto">
          
          {/* PTZ KAMERA ISHGA TUSHGANDA: 2 ta kamera kengaytirilib vertikal qilib qo'yildi */}
          {rightCameras.length > 0 && (
            <div className="w-full flex flex-col gap-2 mb-2 pb-2 border-b border-tactical-700/80 animate-in fade-in zoom-in-95 duration-200">
              <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between px-0.5">
                <span className="font-semibold text-police-cyan">FACE ID KAMERA</span>
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
                onPointerDown={(e) => { e.preventDefault(); sendManualMecanum('G'); }}
                onPointerUp={(e) => { e.preventDefault(); releaseManualMecanum(); }}
                onPointerLeave={releaseManualMecanum}
                onPointerCancel={releaseManualMecanum}
                title="Oldinga-chapga egri burilish (G)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-police-cyan text-xs font-bold font-mono flex flex-col items-center justify-center select-none touch-none"
              >
                <span>↖️ G</span>
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendManualMecanum('F'); }}
                onPointerUp={(e) => { e.preventDefault(); releaseManualMecanum(); }}
                onPointerLeave={releaseManualMecanum}
                onPointerCancel={releaseManualMecanum}
                title="To'g'ri oldinga (W / F)"
                className="py-1.5 px-1 rounded-lg border border-police-cyan/40 bg-tactical-850 hover:bg-police-blue/40 active:bg-police-cyan/30 text-white text-xs font-bold font-mono flex flex-col items-center justify-center select-none touch-none shadow-[0_0_10px_rgba(0,229,255,0.15)]"
              >
                <ArrowUp className="w-4 h-4 text-police-cyan" />
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendManualMecanum('I'); }}
                onPointerUp={(e) => { e.preventDefault(); releaseManualMecanum(); }}
                onPointerLeave={releaseManualMecanum}
                onPointerCancel={releaseManualMecanum}
                title="Oldinga-o'ngga egri burilish (I)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-police-cyan text-xs font-bold font-mono flex flex-col items-center justify-center select-none touch-none"
              >
                <span>I ↗️</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendManualMecanum('L'); }}
                onPointerUp={(e) => { e.preventDefault(); releaseManualMecanum(); }}
                onPointerLeave={releaseManualMecanum}
                onPointerCancel={releaseManualMecanum}
                title="Chapga burilish (Chap 50%, O'ng 100%) (A / L)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-white text-xs font-bold font-mono flex items-center justify-center select-none touch-none"
              >
                <ArrowLeft className="w-4 h-4 text-police-cyan" />
              </button>
              <button
                type="button"
                onClick={() => sendManualMecanum('S')}
                title="Favqulodda to'xtash (STOP)"
                className="py-1.5 px-1 rounded-lg border border-police-red bg-police-red/20 hover:bg-police-red/35 active:bg-police-red text-police-red hover:text-white font-extrabold text-xs flex items-center justify-center gap-1 select-none shadow-[0_0_12px_rgba(255,23,68,0.3)] transition-all"
              >
                <Square className="w-3.5 h-3.5 fill-current" /> STOP
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendManualMecanum('R'); }}
                onPointerUp={(e) => { e.preventDefault(); releaseManualMecanum(); }}
                onPointerLeave={releaseManualMecanum}
                onPointerCancel={releaseManualMecanum}
                title="O'ngga burilish (Chap 100%, O'ng 50%) (D / R)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-white text-xs font-bold font-mono flex items-center justify-center select-none touch-none"
              >
                <ArrowRight className="w-4 h-4 text-police-cyan" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendManualMecanum('H'); }}
                onPointerUp={(e) => { e.preventDefault(); releaseManualMecanum(); }}
                onPointerLeave={releaseManualMecanum}
                onPointerCancel={releaseManualMecanum}
                title="Orqaga-chapga burilish (H)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-slate-300 text-xs font-bold font-mono flex flex-col items-center justify-center select-none touch-none"
              >
                <span>↙️ H</span>
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendManualMecanum('B'); }}
                onPointerUp={(e) => { e.preventDefault(); releaseManualMecanum(); }}
                onPointerLeave={releaseManualMecanum}
                onPointerCancel={releaseManualMecanum}
                title="To'g'ri orqaga (S / B)"
                className="py-1.5 px-1 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 active:bg-police-cyan/30 text-white text-xs font-bold font-mono flex items-center justify-center select-none touch-none"
              >
                <ArrowDown className="w-4 h-4 text-police-cyan" />
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sendManualMecanum('J'); }}
                onPointerUp={(e) => { e.preventDefault(); releaseManualMecanum(); }}
                onPointerLeave={releaseManualMecanum}
                onPointerCancel={releaseManualMecanum}
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
                <dd className="text-right text-slate-100">{gps.isReal && gps.heading !== null ? `${String(gps.heading).padStart(3, '0')}°` : '—'}</dd>
                <dt className="text-slate-400">Komanda</dt>
                <dd className="text-right text-police-cyan font-semibold">{lastCommand}</dd>
                <dt className="text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> GPS</dt>
                <dd className="text-right text-slate-100">{gps.isReal ? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}` : gps.status === 'SEARCHING' ? 'qidirilmoqda…' : gps.error || "GPS yo'q"}</dd>
                <dt className="text-slate-400">Aniqlik</dt>
                <dd className="text-right text-slate-100">{gps.isReal && gps.accuracy ? `±${gps.accuracy} m` : '—'}</dd>
              </dl>

              <button
                onClick={startRealGPS}
                className="w-full px-3 py-1.5 rounded-lg border border-tactical-700 bg-tactical-850 text-xs font-medium text-slate-200 hover:bg-tactical-800 flex items-center justify-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${gps.status === 'SEARCHING' ? 'animate-spin' : ''}`} />
                GPS ni qayta ulash
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
                  {aiModelLoaded ? 'Yuz tanish tayyor' : aiModelLoading ? 'Yuklanmoqda...' : 'Detektor'}
                </dd>
                <dt className="text-slate-400">Yuz</dt>
                <dd className={`text-right ${faceStatus === 'error' ? 'text-police-red' : faceInfo.count > 0 ? 'text-police-green' : 'text-police-amber'}`}>
                  {faceStatus === 'idle'
                    ? "o'chiq"
                    : faceStatus === 'loading'
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

              <div>
                <button
                  onClick={() => setShowFaceDbModal(true)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-tactical-700 bg-tactical-850 text-slate-200 hover:bg-tactical-800 font-medium flex items-center justify-center gap-1.5"
                >
                  <Users className="w-3.5 h-3.5 text-police-green" />
                  Yuzlar bazasi ({knownPersons.length})
                </button>
              </div>

              {/* TAKTIL SARIQ YO'LAK (KO'ZI OJIZLAR YO'LAGI) AVTOPILOT SOZLAMALARI */}
              <div className="pt-2.5 mt-1 border-t border-tactical-700/80 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    Taktil Chiziq (Ko&apos;zi ojizlar yo&apos;lagi)
                  </span>
                  <button
                    type="button"
                    onClick={toggleLineFollow}
                    className={`px-2 py-0.5 rounded font-bold text-[11px] border ${
                      lineFollowEnabled
                        ? 'bg-police-red/20 border-police-red text-police-red hover:bg-police-red hover:text-white'
                        : 'bg-amber-500/20 border-amber-400 text-amber-300 hover:bg-amber-500/30'
                    }`}
                  >
                    {lineFollowEnabled ? "To'xtatish" : 'Boshlash'}
                  </button>
                </div>

                {/* REJIM TANLASH: Yordamchi (tavsiya) | To'liq avtonom | Sinov */}
                <label className="flex flex-col gap-1 text-[11px]">
                  <span className="text-slate-400 font-semibold">Boshqaruv rejimi:</span>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      type="button"
                      onClick={() => updateLineConfig({ driveMode: 'assisted' })}
                      className={`px-1.5 py-1 rounded border text-[10px] font-bold text-center leading-tight transition-colors ${
                        lineConfig.driveMode === 'assisted'
                          ? 'bg-police-green/25 border-police-green text-police-green shadow-[0_0_8px_rgba(34,197,94,0.3)]'
                          : 'bg-tactical-850 border-tactical-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      🛡️ Yordamchi<br /><span className="text-[8px] font-normal opacity-80">(Gaz + Himoya)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateLineConfig({ driveMode: 'auto' })}
                      className={`px-1.5 py-1 rounded border text-[10px] font-bold text-center leading-tight transition-colors ${
                        lineConfig.driveMode === 'auto'
                          ? 'bg-amber-500/25 border-amber-400 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                          : 'bg-tactical-850 border-tactical-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      🤖 Avto<br /><span className="text-[8px] font-normal opacity-80">(Doimiy)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateLineConfig({ driveMode: 'test' })}
                      className={`px-1.5 py-1 rounded border text-[10px] font-bold text-center leading-tight transition-colors ${
                        lineConfig.driveMode === 'test'
                          ? 'bg-police-cyan/25 border-police-cyan text-police-cyan shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                          : 'bg-tactical-850 border-tactical-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      🔬 Sinov<br /><span className="text-[8px] font-normal opacity-80">(Motorsiz)</span>
                    </button>
                  </div>
                </label>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLineFollowDrive((v) => !v)}
                    className={`px-2 py-1 rounded border text-[11px] font-semibold ${
                      lineFollowDrive
                        ? 'bg-police-green/15 border-police-green/60 text-police-green'
                        : 'bg-tactical-850 border-tactical-700 text-slate-300'
                    }`}
                  >
                    Motor: {lineFollowDrive ? 'Yoqilgan' : "O'chirilgan"}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateLineConfig({ invertSteering: !lineConfig.invertSteering })}
                    className={`px-2 py-1 rounded border text-[11px] font-medium ${
                      lineConfig.invertSteering
                        ? 'bg-police-blue/25 border-police-cyan/60 text-police-cyan'
                        : 'bg-tactical-850 border-tactical-700 text-slate-300'
                    }`}
                  >
                    Rul: {lineConfig.invertSteering ? 'Teskari' : 'Normal'}
                  </button>
                </div>

                <label className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-400">Yo&apos;lak turi</span>
                  <select
                    value={lineConfig.colorPreset}
                    onChange={(e) => updateLineConfig({ colorPreset: e.target.value as LineColorPreset })}
                    className="px-2 py-1 rounded bg-tactical-850 border border-tactical-700 text-slate-100 text-[11px]"
                  >
                    <option value="tactile_yellow">Sariq taktil yo&apos;lak (Qulay Makon)</option>
                    <option value="bright_yellow">Yorqin sariq lenta</option>
                    <option value="blue">Ko&apos;k lenta</option>
                    <option value="white">Oq chiziq</option>
                    <option value="black">Qora chiziq</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Sariqlik chegarasi (yellowness)</span>
                    <span className="font-mono text-amber-300">{lineConfig.yellownessMin}</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={40}
                    step={1}
                    value={lineConfig.yellownessMin}
                    onChange={(e) => updateLineConfig({ yellownessMin: Number(e.target.value) })}
                    className="w-full accent-amber-400"
                  />
                </label>

                <div className="flex items-center gap-1.5">
                  <input
                    ref={linePhotoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleSelectLinePhoto}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => linePhotoInputRef.current?.click()}
                    className="flex-1 px-2 py-1 rounded border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 text-slate-200 text-[11px] font-medium"
                  >
                    Rasmda sinab ko&apos;rish
                  </button>
                  {linePhotoUrl && (
                    <button
                      type="button"
                      onClick={clearLinePhoto}
                      className="px-2 py-1 rounded border border-amber-500/50 bg-amber-500/15 text-amber-200 text-[11px]"
                    >
                      Tozalash
                    </button>
                  )}
                </div>
              </div>
            </div>
          </FloatingPanel>
          <FloatingPanel id="log" title="Serial jurnal" icon={<ScrollText className="w-4 h-4" />} open={isOpen('log')} onClose={() => closePanel('log')} anchor="tr" width={380}>
            <div className="flex flex-col gap-2 text-[11px]">
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
