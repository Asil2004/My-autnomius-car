import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRobot } from '../context/RobotContext';
import type { DetectedObject } from '../types/robot';
import { faceRecognitionService, type KnownPerson } from '../services/faceRecognitionService';
import { distanceEstimator } from '../services/distanceService';
import type * as cocoSsd from '@tensorflow-models/coco-ssd';
import { loadCocoModel } from '../services/aiPreload';
import { FloatingPanel } from './FloatingPanel';
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
  Film
} from 'lucide-react';

type PanelId = 'control' | 'sensors' | 'ai' | 'ptz' | 'log';
type CamId = 'face' | 'ptz' | 'front' | 'rear' | 'right';

// Robotdagi jami 5 ta kamera (1 tasi 360° PTZ). Qaysi biri kattalashtirilsa, qolgan 4 tasi chap tomonda kichik ko'rinadi
const ALL_CAMERAS: { id: CamId; short: string; long: string }[] = [
  { id: 'face', short: 'Face ID', long: 'Face ID (Planshet)' },
  { id: 'ptz', short: 'PTZ', long: 'PTZ 360° kamera' },
  { id: 'front', short: 'Old', long: 'Old kamera (RPi)' },
  { id: 'rear', short: 'Orqa', long: 'Orqa kamera' },
  { id: 'right', short: "O'ng", long: "O'ng kamera" }
];

const OPEN_KEY = 'qalqon.hud.open.v1';

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
    addLog
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
  const [zoomLevel, setZoomLevel] = useState<number>(1);
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

  const handleZoomIn = () => {
    setZoomLevel((z) => Math.min(3, +(z + 0.25).toFixed(2)));
    resetOverlayTimer();
  };

  const handleZoomOut = () => {
    setZoomLevel((z) => Math.max(1, +(z - 0.25).toFixed(2)));
    resetOverlayTimer();
  };

  const handleToggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
    resetOverlayTimer();
  };

  const handleCameraClick = useCallback(() => {
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

  const [activeCam, setActiveCam] = useState<CamId>('face');
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
  const [mirrorVideo, setMirrorVideo] = useState(true);

  // AI Detektor holatlari
  const [aiModelLoaded, setAiModelLoaded] = useState(false);
  const [aiModelLoading, setAiModelLoading] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
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

  // Kamera rejimi o'zgarganda ishga tushirish
  useEffect(() => {
    if (cameraSource === 'FRONTAL') {
      startFrontalCamera();
    } else {
      stopCameraStream();
    }
    return () => {
      cameraRequestRef.current++;
      stopCameraStream();
    };
  }, [cameraSource, startFrontalCamera, stopCameraStream]);

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
    if (cameraSource === 'FRONTAL' && aiEnabled) {
      intervalId = window.setInterval(() => {
        detectFrame();
      }, 120);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [cameraSource, aiEnabled, detectFrame]);

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
    if (deg >= -120 && deg <= -60) {
      sendMecanumCommand('F'); // Oldinga
    } else if (deg > -160 && deg < -120) {
      sendMecanumCommand('Q'); // Chap-oldinga yonlama
    } else if (deg > -60 && deg < -20) {
      sendMecanumCommand('E'); // O'ng-oldinga yonlama
    } else if (deg >= -20 && deg <= 35) {
      sendMecanumCommand('R'); // O'ngga burilish
    } else if (deg >= 45 && deg <= 135) {
      sendMecanumCommand('B'); // Orqaga
    } else if (deg > 135 || deg < -160) {
      sendMecanumCommand('L'); // Chapga burilish
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
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsPtzDragging(true);
    updatePtzVec(e);
    if (ptzIntervalRef.current) clearInterval(ptzIntervalRef.current);
    ptzIntervalRef.current = window.setInterval(() => {
      const { dx, dy } = ptzVecRef.current;
      if (Math.hypot(dx, dy) > 8) {
        const dPan = Math.round((dx / 50) * 8);
        const dTilt = Math.round((-dy / 50) * 5);
        if (dPan !== 0 || dTilt !== 0) adjustPTZ(dPan, dTilt);
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
  };

  useEffect(() => {
    return () => {
      if (ptzIntervalRef.current) clearInterval(ptzIntervalRef.current);
    };
  }, []);

  const smallCameras = ALL_CAMERAS.filter((c) => c.id !== activeCam);
  // PTZ aktiv bo'lganda 2 ta kamera chapda, 2 ta kamera esa o'ng tomondagi joystik tepasiga o'tadi
  const leftCameras = activeCam === 'ptz' ? smallCameras.slice(0, 2) : smallCameras;
  const rightCameras = activeCam === 'ptz' ? smallCameras.slice(2, 4) : [];

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
      ) : cam.id === 'ptz' ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-tactical-900 text-police-cyan group-hover:bg-tactical-850">
          <SlidersHorizontal className="w-5 h-5 animate-pulse text-police-cyan" />
          <span className="text-[10px] font-mono text-slate-300 font-bold">{ptz.pan}° / {ptz.tilt}°</span>
        </span>
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
          {leftCameras.map((cam) => renderCameraTile(cam, 'w-full'))}

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
        <div className={`relative flex-1 min-h-0 h-full flex flex-col bg-black overflow-hidden ${
          isFullscreen ? 'fixed inset-0 z-50 w-screen h-screen' : ''
        }`}>
          <div className={`flex-1 min-h-0 w-full h-full flex flex-col ${activeCam === 'face' ? '' : 'invisible'}`}>
            {/* Viewport: justify-start orqali kadr chapga oxirigacha taqalgan */}
            <div ref={viewportWrapRef} className="bg-black flex-1 min-h-0 w-full h-full flex items-center justify-start overflow-hidden relative">
              <div
                className="relative bg-black flex items-center justify-center overflow-hidden"
                style={{
                  aspectRatio: String(videoAspect),
                  width: fitWidth ?? '100%',
                  maxWidth: '100%',
                  maxHeight: '100%'
                }}
              >
                {/* 1-REJIM: FRONTAL WEBCAM (FACE ID) */}
                {cameraSource === 'FRONTAL' && (
                  <div
                    className="absolute inset-0 bg-black transition-transform duration-200 origin-center"
                    style={{ transform: `scale(${zoomLevel})` }}
                  >
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-contain transition-transform ${mirrorVideo ? 'scale-x-[-1]' : ''}`}
                    />

                    {cameraLoading && (
                      <div className="absolute inset-0 bg-tactical-950/80 flex flex-col items-center justify-center space-y-2 z-10">
                        <RefreshCw className="w-8 h-8 text-police-cyan animate-spin" />
                        <span className="font-mono text-xs text-white">Frontal kamera ochilmoqda...</span>
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

                {/* AI DETECTED OBJECTS OVERLAY */}
                {aiEnabled &&
                  detectedObjects
                    .filter((obj) => obj.category === 'person')
                    .map((obj) => (
                      <div
                        key={obj.id}
                        className="absolute border-2 rounded-sm transition-all duration-150 pointer-events-none z-20"
                        style={{
                          borderColor: obj.color,
                          left: `${obj.box.x}%`,
                          top: `${obj.box.y}%`,
                          width: `${obj.box.width}%`,
                          height: `${obj.box.height}%`
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
                        <div className="absolute right-1 bottom-1 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-semibold text-white">
                          {obj.distanceUpperBound ? '<' : obj.distanceApprox ? '~' : ''}
                          {obj.distance} m
                        </div>
                      </div>
                    ))}
              </div>
            </div>
          </div>

          {/* AGAR ASOSIY OYNA FACE ID BO'LMASA */}
          {activeCam !== 'face' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-tactical-950 text-center px-6 overflow-hidden">
              <div
                className="w-full h-full flex items-center justify-center transition-transform duration-200 origin-center"
                style={{ transform: `scale(${zoomLevel})` }}
              >
                {activeCam === 'front' && rpiOk ? (
                  <img
                    src={`http://${system.rpiIp}:${system.rpiPort}/stream.mjpg?r=${rpiRetry}`}
                    alt="Old kamera (RPi)"
                    className="w-full h-full object-contain bg-black"
                  />
                ) : activeCam === 'ptz' ? (
                  <div className="relative w-full h-full flex flex-col items-center justify-center bg-tactical-950">
                    <div className="absolute inset-4 border border-police-cyan/25 rounded-lg flex items-center justify-center pointer-events-none">
                      <div className="w-16 h-0.5 bg-police-cyan/40" />
                      <div className="h-16 w-0.5 bg-police-cyan/40 absolute" />
                      <div className="w-32 h-32 rounded-full border border-police-cyan/20 absolute" />
                      <span className="absolute top-3 left-3 text-[11px] font-mono font-bold text-police-cyan flex items-center gap-1.5">
                        <SlidersHorizontal className="w-3.5 h-3.5" /> 360° PTZ KAMERA (JONLI)
                      </span>
                      <span className="absolute top-3 right-3 text-[11px] font-mono text-police-cyan bg-police-blue/20 px-2 py-0.5 rounded border border-police-cyan/30">
                        PAN: {ptz.pan}° | TILT: {ptz.tilt}°
                      </span>
                      <span className="absolute bottom-3 left-3 text-[10px] font-mono text-slate-400">
                        REJIM: {ptz.mode === 'AUTO_CAMERA' ? 'AVTOMATIK' : "QO'LDA BOSHQARUV"}
                      </span>
                      <span className="absolute bottom-3 right-3 text-[10px] font-mono text-slate-400">
                        ZOOM: {ptz.zoom}x
                      </span>
                    </div>

                    <div className="flex flex-col items-center gap-2 z-10">
                      <div className="p-4 rounded-full bg-police-cyan/10 border border-police-cyan/40 text-police-cyan shadow-lg shadow-police-cyan/20 animate-pulse">
                        <SlidersHorizontal className="w-10 h-10" />
                      </div>
                      <div className="text-base font-bold text-slate-100">PTZ Kamera Boshqaruv Rejimi</div>
                      <div className="text-xs text-slate-400 max-w-sm">
                        Chap pastdagi joystik orqali kamerani gorizontal va vertikal 360° burishingiz mumkin.
                      </div>
                    </div>
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
            onPointerMove={handleCameraPointerMove}
            onClick={handleCameraClick}
            className="absolute inset-0 z-30 flex flex-col justify-between p-3 pointer-events-auto cursor-pointer"
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
                    onClick={() => { setZoomLevel(1); resetOverlayTimer(); }}
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
                  <div className="relative w-full flex items-center h-4">
                    {/* Yozib olingan arxiv yashil chizig'i */}
                    <div className="absolute inset-x-0 h-2 bg-tactical-800 rounded overflow-hidden">
                      <div className="h-full bg-police-green/35 w-full" title="To'liq 24 soatlik NVR yozuvi saqlangan" />
                    </div>
                    {/* Interaktiv scrollbar slider */}
                    <input
                      type="range"
                      min={0}
                      max={86400}
                      step={1}
                      value={playbackSec}
                      onChange={(e) => { setPlaybackSec(Number(e.target.value)); resetOverlayTimer(); }}
                      className="relative w-full h-3 bg-transparent appearance-none cursor-pointer accent-police-cyan z-10"
                    />
                  </div>

                  {/* 24 soatlik belgilar */}
                  <div className="flex justify-between text-[9px] font-mono text-slate-500 px-0.5">
                    <span>00:00</span>
                    <span>04:00</span>
                    <span>08:00</span>
                    <span>12:00 (Tush)</span>
                    <span>16:00</span>
                    <span>20:00</span>
                    <span>23:59</span>
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

          {/* Sarlavha va oxirgi komanda holati */}
          <div className="w-full flex items-center justify-between mb-1">
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

          {/* VIRTUAL HARAKAT JOYSTIGI (Kameralarga joy ochish uchun ozgina ixchamlashtirilgan) */}
          <div className="relative my-auto flex flex-col items-center">
            <div
              ref={driveBaseRef}
              onPointerDown={handleDriveDown}
              onPointerMove={handleDriveMove}
              onPointerUp={handleDriveUp}
              onPointerCancel={handleDriveUp}
              className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-full bg-tactical-950 border-2 border-police-cyan/50 shadow-[0_0_25px_rgba(0,229,255,0.2)] flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none my-1"
            >
              {/* Yo'nalish belgilari */}
              <div className="absolute top-1.5 text-[10px] font-bold text-slate-400 flex flex-col items-center">
                <ArrowUp className="w-3.5 h-3.5 text-police-cyan" />
                <span className="text-[8px] font-mono">F</span>
              </div>
              <div className="absolute bottom-1.5 text-[10px] font-bold text-slate-400 flex flex-col items-center">
                <span className="text-[8px] font-mono">B</span>
                <ArrowDown className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="absolute left-1.5 text-[10px] font-bold text-slate-400 flex items-center gap-0.5">
                <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[8px] font-mono">L</span>
              </div>
              <div className="absolute right-1.5 text-[10px] font-bold text-slate-400 flex items-center gap-0.5">
                <span className="text-[8px] font-mono">R</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </div>
              
              {/* Diagonal ko'rsatkichlar */}
              <span className="absolute top-3 left-3 text-[9px] text-slate-500 font-mono font-bold">Q</span>
              <span className="absolute top-3 right-3 text-[9px] text-slate-500 font-mono font-bold">E</span>

              {/* Ichki markaz halqalari */}
              <div className="w-22 h-22 rounded-full border border-police-cyan/20 absolute" />
              <div className="w-8 h-8 rounded-full border border-dashed border-police-cyan/35 absolute" />

              {/* Joystik tutqichi (Knob) */}
              <div
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-police-blue to-police-blue/80 border-2 border-police-cyan shadow-lg shadow-police-cyan/50 flex items-center justify-center pointer-events-none transition-transform duration-75"
                style={{
                  transform: `translate3d(${driveKnob.x}px, ${driveKnob.y}px, 0)`
                }}
              >
                <div className="w-3.5 h-3.5 rounded-full bg-police-cyan shadow-[0_0_8px_#00e5ff]" />
              </div>
            </div>

            <p className="text-[10px] text-slate-400 mt-1 text-center font-mono">
              Surib boshqaring yoki: <span className="text-police-cyan">W A S D Q E</span>
            </p>
          </div>

          {/* Minora ko'tarish/tushirish */}
          <div className="w-full flex flex-col gap-1.5 mt-auto">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => sendMecanumCommand('U')}
                title="Teleskopik minorani ko'tarish (U)"
                className="py-1.5 px-2 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
              >
                <ChevronsUp className="w-4 h-4 text-police-cyan" /> Minora (U)
              </button>
              <button
                onClick={() => sendMecanumCommand('D')}
                title="Teleskopik minorani tushirish (D)"
                className="py-1.5 px-2 rounded-lg border border-tactical-700 bg-tactical-850 hover:bg-tactical-800 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
              >
                <ChevronsDown className="w-4 h-4 text-police-cyan" /> Minora (D)
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
