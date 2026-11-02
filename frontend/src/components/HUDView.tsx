import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRobot } from '../context/RobotContext';
import type { SpeedLevel, DetectedObject } from '../types/robot';
import { faceRecognitionService, type KnownPerson } from '../services/faceRecognitionService';
import { distanceEstimator } from '../services/distanceService';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs';
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  RotateCw,
  Square,
  Compass,
  Gauge,
  SlidersHorizontal,
  ShieldAlert,
  Maximize2,
  Camera,
  Radio,
  MapPin,
  Car,
  User,
  UserCheck,
  RefreshCw,
  Eye,
  AlertTriangle,
  Users,
  Plus,
  X,
  CheckCircle2,
  Ruler
} from 'lucide-react';

// COCO-SSD loyiha ichidan (public/models/coco-ssd) yuklanadi: internetsiz ham ishlaydi, APK ichida ham.
// Promise keshlanadi, shunda effekt qayta ishga tushsa (StrictMode) model ikki marta yuklanmaydi.
let cocoModelPromise: Promise<cocoSsd.ObjectDetection> | null = null;
const loadCocoModel = () => {
  if (!cocoModelPromise) {
    cocoModelPromise = cocoSsd
      .load({ base: 'lite_mobilenet_v2', modelUrl: `${import.meta.env.BASE_URL}models/coco-ssd/model.json` })
      .catch((err) => {
        cocoModelPromise = null;
        throw err;
      });
  }
  return cocoModelPromise;
};

// Kalibrovka kamera turi bo'yicha alohida saqlanadi (hozir faqat frontal kamera aniqlanadi)
const CAMERA_KEY = 'FRONTAL';

// Sonar masofasiga (sm) qarab rang: <=22 xavf (avtotormoz), <=45 ogohlantirish, qolgani xavfsiz
const getSonarColor = (distance: number, isCritical = false) => {
  if (isCritical || distance <= 22) return 'text-rose-400 bg-rose-950/80 border-rose-500 shadow-[0_0_10px_rgba(255,34,56,0.6)] animate-pulse';
  if (distance <= 45) return 'text-amber-300 bg-amber-950/70 border-amber-500/70';
  return 'text-emerald-300 bg-emerald-950/60 border-emerald-500/60';
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
      className={`px-2 py-0.5 rounded border font-bold flex items-center space-x-1.5 whitespace-nowrap transition-colors ${getSonarColor(value, critical)}`}
      title={title}
      data-sonar={side}
    >
      {danger ? <ShieldAlert className="w-3 h-3 shrink-0" /> : <Arrow className="w-3 h-3 shrink-0" />}
      <span className="text-[9px] font-semibold text-slate-300">{label}</span>
      <span>{value} sm</span>
      {side === 'front' && danger && <span className="text-[9px]">TO'SIQ</span>}
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
    speedLevel,
    sendMecanumCommand,
    setSpeedLevel,
    sonars,
    isFrontBlocked,
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
    isSimulationMode
  } = useRobot();

  const [cameraFullscreen, setCameraFullscreen] = useState(false);
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
  }, [videoAspect, cameraFullscreen]);
  const [cameraSource, setCameraSource] = useState<'FRONTAL' | 'RPI' | 'SIMULATION'>('FRONTAL');
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [mirrorVideo, setMirrorVideo] = useState(true);

  // AI Detektor holatlari
  const [aiModelLoaded, setAiModelLoaded] = useState(false);
  const [aiModelLoading, setAiModelLoading] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [detectedCounts, setDetectedCounts] = useState({ people: 0, cars: 0, total: 0 });

  // Yuzlar bazasi modali va ro'yxati
  const [showFaceDbModal, setShowFaceDbModal] = useState(false);
  const [knownPersons, setKnownPersons] = useState<KnownPerson[]>(faceRecognitionService.getPersons());
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonRole, setNewPersonRole] = useState('');
  const [newPersonPhoto, setNewPersonPhoto] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);

  // Sonar masofaga faqat haqiqiy robot ulanganda ishoniladi (simulyatsiyada qiymatlar tasodifiy)
  const sonarRealRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    sonarRealRef.current = !isSimulationMode && system.rpiConnected ? sonars.front : undefined;
  }, [isSimulationMode, system.rpiConnected, sonars.front]);

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
        const faceInit = faceRecognitionService.initDatabase().catch((faceErr: unknown) => {
          faceReady = false;
          if (isMounted) setFaceStatus('error');
          const msg = faceErr instanceof Error ? faceErr.message : String(faceErr);
          addLog('AI', 'error', `Yuz tanish modeli yuklanmadi, barcha odamlar "Piyoda": ${msg}`);
        });

        // COCO-SSD va yuz modeli parallel yuklanadi
        const [model] = await Promise.all([loadCocoModel(), faceInit]);
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
        const predictions = await cocoModelRef.current.detect(video, 8, 0.40);

        let personCount = 0;
        let carCount = 0;

        const vehicleClasses = ['car', 'truck', 'bus', 'motorcycle', 'bicycle'];
        const vehiclePreds = predictions.filter((pred) => vehicleClasses.includes(pred.class.toLowerCase()));
        const personPreds = predictions.filter((pred) => pred.class.toLowerCase() === 'person');

        // Odamlar: yuz orqali tanish. Bazada yo'q yoki yuzi ko'rinmagan odam — "Piyoda"
        const identities = await faceRecognitionService.identifyPeople(
          video,
          personPreds.map((p) => ({ x: p.bbox[0], y: p.bbox[1], width: p.bbox[2], height: p.bbox[3] }))
        );

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

        setFaceInfo({
          count: withFace.length,
          widthPx: closest?.faceBox ? Math.round(closest.faceBox.width) : 0,
          cycleMs: Math.round(performance.now() - cycleStart),
          calibCount: calib.count,
          calibStable: calib.stable,
          eyePx: Math.round(eyePx),
          faceDistM: closest?.faceBox ? distanceEstimator.rawFaceDistance(CAMERA_KEY, closest.faceBox.width, vH) : 0,
          eyeDistM: eyePx > 0 ? distanceEstimator.rawEyeDistance(CAMERA_KEY, eyePx, vH) : 0
        });

        const items = [
          ...identities.map((identity, i) => ({
            class: 'person',
            bbox: [identity.box.x, identity.box.y, identity.box.width, identity.box.height] as [number, number, number, number],
            score: personPreds[i]?.score ?? identity.faceScore ?? 0.5,
            identity
          })),
          ...vehiclePreds.map((pred) => ({ class: pred.class, bbox: pred.bbox, score: pred.score, identity: undefined }))
        ];

        const newObjects: DetectedObject[] = items
          .map((pred, idx) => {
            const cls = pred.class.toLowerCase();
            const [rawX, rawY, rawW, rawH] = pred.bbox;

            let label = "Noma'lum";
            let color = "#00e5ff";
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
                color = match.person.color || '#00e676';
                isIdentifiedPerson = true;
                confidence = +(match.confidence ?? pred.score).toFixed(2);
              } else {
                label = "Piyoda";
                personName = undefined;
                color = "#38bdf8";
                isIdentifiedPerson = false;
                confidence = +pred.score.toFixed(2);
              }
            } else if (cls === 'car') {
              carCount++;
              label = "Mashina (Avtomobil)";
              color = "#00e5ff"; // Tsian / Moviy
              category = 'car';
            } else if (cls === 'truck') {
              carCount++;
              label = "Yuk mashinasi";
              color = "#38bdf8";
              category = 'car';
            } else if (cls === 'bus') {
              carCount++;
              label = "Avtobus";
              color = "#818cf8";
              category = 'car';
            } else if (cls === 'motorcycle' || cls === 'bicycle') {
              label = cls === 'motorcycle' ? "Motosikl" : "Velosiped";
              color = "#fbbf24"; // Sariq
              category = 'vehicle';
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

            // Masofa: pinhole modeli (yuz kengligi yoki obyekt balandligi), sonar tuzatishi va silliqlash
            const dist = distanceEstimator.estimate(CAMERA_KEY, {
              cls,
              box: { x: rawX, y: rawY, width: rawW, height: rawH },
              faceBox: pred.identity?.faceBox ?? undefined,
              frameWidth: vW,
              frameHeight: vH,
              sonarFrontCm: sonarRealRef.current
            });

            return {
              id: `real-obj-${idx}-${Date.now().toString().slice(-4)}`,
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

        setDetectedObjects(newObjects);
        setDetectedCounts({
          people: personCount,
          cars: carCount,
          total: newObjects.length
        });
      } catch {
        // AI detection pass
      } finally {
        isDetectingRef.current = false;
      }
    }
  }, [aiEnabled, cameraSource, mirrorVideo, setDetectedObjects]);

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

  // Yangi shaxsni bazaga qo'shish
  const handleAddNewPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPersonName.trim()) return;
    if (!newPersonPhoto) {
      addLog('AI', 'warn', "Shaxsni qo'shish uchun yuzi aniq ko'ringan rasm yuklang.");
      return;
    }

    const newPerson: KnownPerson = {
      id: `person-${Date.now()}`,
      fullName: newPersonName.trim(),
      role: newPersonRole.trim() || 'Ruxsat berilgan shaxs',
      photoUrl: newPersonPhoto,
      color: '#38bdf8',
      badge: 'VERIFIED'
    };

    try {
      await faceRecognitionService.addPerson(newPerson);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('AI', 'error', `${newPerson.fullName} bazaga qo'shilmadi: ${msg}`);
      return;
    }
    setKnownPersons([...faceRecognitionService.getPersons()]);
    addLog('AI', 'success', `Yuzlar bazasiga yangi shaxs qo'shildi: ${newPerson.fullName}`);
    setNewPersonName('');
    setNewPersonRole('');
    setNewPersonPhoto(null);
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

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-3 p-3 overflow-y-auto max-w-7xl mx-auto w-full">
      {/* LEFT COLUMN: Live Feed + HUD Overlays */}
      <div className={`flex flex-col gap-3 min-h-0 ${cameraFullscreen ? 'fixed inset-0 z-50 p-2 bg-tactical-950' : 'flex-1'}`}>
        
        {/* TOP STATUS BAR: REAL GPS & CAMERA MODE SWITCHER */}
        <div className="bg-tactical-900/90 border border-tactical-700/70 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 shadow-md">
          {/* Real GPS Info Pill */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-tactical-950 border border-tactical-700 font-mono text-xs">
              <span className="flex h-2.5 w-2.5 relative">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${gps.isReal ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${gps.isReal ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              </span>
              <span className="font-bold text-white flex items-center space-x-1">
                <MapPin className="w-3.5 h-3.5 text-police-cyan" />
                <span>{gps.isReal ? 'HAQIQIY GPS' : 'GPS SIMULYATSIYA'}:</span>
              </span>
              <span className="text-police-cyan font-bold tracking-tight">
                {gps.latitude.toFixed(6)}° N, {gps.longitude.toFixed(6)}° E
              </span>
              <span className="text-[10px] text-slate-400 hidden sm:inline">
                (±{gps.accuracy || 3.5}m • {gps.altitude || 340}m balandlik)
              </span>
            </div>

            <button
              onClick={gps.isReal ? toggleGPSMode : startRealGPS}
              title={gps.isReal ? "Simulyatsiyaga o'tish" : "Haqiqiy GPS datchigini yoqish"}
              className={`px-2 py-1 rounded text-xs font-mono font-bold flex items-center space-x-1 border transition-all ${
                gps.isReal
                  ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500 hover:bg-emerald-600/50'
                  : 'bg-police-blue/30 text-police-cyan border-police-cyan/60 hover:bg-police-blue/50'
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${gps.status === 'SEARCHING' ? 'animate-spin' : ''}`} />
              <span>{gps.isReal ? 'Real GPS Faol' : 'Real GPS Yoqish'}</span>
            </button>
          </div>

          {/* Camera Source Selector & Database Trigger */}
          <div className="flex items-center space-x-1.5 font-mono text-xs">
            <button
              onClick={() => setShowFaceDbModal(true)}
              className="px-2 py-1 rounded bg-tactical-950 border border-tactical-700 text-slate-300 hover:text-white flex items-center space-x-1 transition-all"
              title="Yuzlar bazasini ko'rish va yangi odamlarni qo'shish"
            >
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              <span>Yuzlar Bazasi ({knownPersons.length})</span>
            </button>

            <button
              onClick={() => setShowCalibration(true)}
              className={`px-2 py-1 rounded bg-tactical-950 border flex items-center space-x-1 transition-all ${
                calibrated ? 'border-emerald-600 text-emerald-300' : 'border-amber-500 text-amber-300'
              }`}
              title="Masofa o'lchashni kalibrovka qilish"
            >
              <Ruler className="w-3.5 h-3.5" />
              <span>{calibrated ? 'Kalibrovka ✓' : 'Kalibrovka'}</span>
            </button>

            <button
              onClick={() => setCameraSource('FRONTAL')}
              className={`px-2.5 py-1 rounded font-bold flex items-center space-x-1 border transition-all ${
                cameraSource === 'FRONTAL'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_10px_rgba(0,229,255,0.4)]'
                  : 'bg-tactical-950 text-slate-300 border-tactical-700 hover:bg-tactical-800'
              }`}
            >
              <Camera className="w-3.5 h-3.5 text-police-cyan" />
              <span>Frontal Kamera</span>
            </button>

            <button
              onClick={() => setCameraSource('RPI')}
              className={`px-2.5 py-1 rounded font-bold flex items-center space-x-1 border transition-all ${
                cameraSource === 'RPI'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_10px_rgba(0,229,255,0.4)]'
                  : 'bg-tactical-950 text-slate-300 border-tactical-700 hover:bg-tactical-800'
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-police-cyan" />
              <span>RPi Oqim</span>
            </button>

            <button
              onClick={() => setCameraSource('SIMULATION')}
              className={`px-2.5 py-1 rounded font-bold border transition-all ${
                cameraSource === 'SIMULATION'
                  ? 'bg-police-blue text-white border-police-cyan'
                  : 'bg-tactical-950 text-slate-300 border-tactical-700 hover:bg-tactical-800'
              }`}
            >
              Simulyatsiya
            </button>
          </div>
        </div>

        {/* MAIN HUD VIDEO FEED CONTAINER (Chiziq-chiziq filtr olib tashlangan - Tiniq HD kadr) */}
        <div className="hud-panel rounded-lg overflow-hidden flex flex-col relative flex-1 min-h-[420px]">

          {/* Header Bar inside Feed */}
          <div className="bg-tactical-950/85 px-3 py-2 border-b border-tactical-700/60 flex items-center justify-between z-20">
            <div className="flex items-center space-x-2 font-mono text-xs">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="font-bold text-white tracking-wider">
                {cameraSource === 'FRONTAL' ? 'FRONTAL TINIK AI KAMERA' : cameraSource === 'RPI' ? '360° PTZ RPI GUMBAZ KAMERA' : 'TAKTIK VIRTUAL SIMULYATOR'}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-tactical-800 text-slate-300 border border-tactical-700">
                {ptz.mode}
              </span>
            </div>

            {/* AI Detected Objects Live Summary Badges */}
            <div className="flex items-center space-x-2">
              <div className="hidden sm:flex items-center space-x-1.5 bg-tactical-950/90 px-2 py-0.5 rounded border border-tactical-700 font-mono text-[11px]">
                <span className="text-emerald-400 flex items-center space-x-1 font-bold">
                  <UserCheck className="w-3 h-3" />
                  <span>{detectedCounts.people} Odam</span>
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-police-cyan flex items-center space-x-1 font-bold">
                  <Car className="w-3 h-3" />
                  <span>{detectedCounts.cars} Mashina</span>
                </span>
              </div>

              {cameraSource === 'FRONTAL' && (
                <button
                  onClick={() => setMirrorVideo(!mirrorVideo)}
                  title="Oyna (Mirror) effektini almashtirish"
                  className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-all ${
                    mirrorVideo ? 'bg-police-blue/30 text-police-cyan border-police-blue' : 'bg-tactical-800 text-slate-400 border-tactical-700'
                  }`}
                >
                  {mirrorVideo ? 'Mirror ON' : 'Mirror OFF'}
                </button>
              )}

              <button
                onClick={() => setAiEnabled(!aiEnabled)}
                title="AI Obyekt Detektorini yoqish/o'chirish"
                className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-all flex items-center space-x-1 ${
                  aiEnabled ? 'bg-emerald-950 text-emerald-300 border-emerald-500' : 'bg-tactical-800 text-slate-400 border-tactical-700'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>AI {aiEnabled ? 'FAOL' : 'O\'CHIQ'}</span>
              </button>

              <button
                onClick={() => setCameraFullscreen(!cameraFullscreen)}
                className="p-1 rounded bg-tactical-800 text-slate-300 hover:text-white"
                title="To'liq ekranga ochish"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Video Stream & Viewport: kadr to'liq (kesilmaydi), kadr ustida faqat aniqlangan ramkalar bor.
              Tashqi quti panelning qolgan bo'sh joyini oladi, ichki quti videoning haqiqiy nisbatida shu joyga sig'adi
              (o'lchami ResizeObserver bilan hisoblanadi), shuning uchun pastki qatorlar har doim ekranga sig'adi. */}
          <div ref={viewportWrapRef} className="bg-black flex-1 min-h-0 flex items-center justify-center overflow-hidden">
          <div
            className="relative bg-black flex items-center justify-center overflow-hidden"
            style={{ aspectRatio: String(videoAspect), width: fitWidth ?? '100%' }}
          >

            {/* 1-REJIM: FRONTAL WEBCAM */}
            {cameraSource === 'FRONTAL' && (
              <div className="absolute inset-0 bg-black">
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
                    <AlertTriangle className="w-10 h-10 text-rose-500 mb-2 animate-bounce" />
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

            {/* 2-REJIM: RPI JONLI VIDEO OQIMI */}
            {cameraSource === 'RPI' && (
              <img
                src={`http://${system.rpiIp}:${system.rpiPort}/stream.mjpg`}
                alt="RPi Live Stream"
                style={{ position: 'absolute', inset: 0 }}
                onError={() => {
                  addLog('RPI', 'warn', "RPi video oqimi mavjud emas, simulyatsiyaga o'tildi.");
                  setCameraSource('SIMULATION');
                }}
                className="w-full h-full object-contain"
              />
            )}

            {/* 3-REJIM: VIRTUAL TAKTIK SIMULYATOR */}
            {cameraSource === 'SIMULATION' && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-tactical-950 via-[#0a1120] to-[#040810]">
                <div className="absolute inset-0 opacity-25 pointer-events-none">
                  <div className="w-full h-full flex flex-col justify-end">
                    <div className="h-1/2 w-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/30 via-transparent to-transparent" />
                    <div className="h-1/2 border-t border-police-cyan/30 flex justify-center">
                      <div className="w-48 h-full border-x border-dashed border-police-cyan/40 transform -perspective-500 rotate-x-45" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* AI DETECTED OBJECTS: RAMKA CHETIDA ISM-FAMILIYA BILAN VIZUALLASHTIRISH   */}
            {/* ========================================================================= */}
            {aiEnabled && detectedObjects.map((obj) => (
              <div
                key={obj.id}
                className="absolute border-2 transition-all duration-150 pointer-events-none flex flex-col justify-between z-20"
                style={{
                  borderColor: obj.color,
                  left: `${obj.box.x}%`,
                  top: `${obj.box.y}%`,
                  width: `${obj.box.width}%`,
                  height: `${obj.box.height}%`,
                  boxShadow: `0 0 16px ${obj.color}70, inset 0 0 10px ${obj.color}25`
                }}
              >
                {/* 4 Ta Taktik Burchak Ko'rsatkichlari */}
                <div className="absolute -top-1.5 -left-1.5 w-3 h-3 border-t-2 border-l-2" style={{ borderColor: obj.color }} />
                <div className="absolute -top-1.5 -right-1.5 w-3 h-3 border-t-2 border-r-2" style={{ borderColor: obj.color }} />
                <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 border-b-2 border-l-2" style={{ borderColor: obj.color }} />
                <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 border-b-2 border-r-2" style={{ borderColor: obj.color }} />

                {/* YUQORI TAKTIK YORLIQ: ISM FAMILIYA YOKI OBYEKT TOIFASI */}
                <div
                  className="px-2 py-0.5 text-[10px] font-mono font-black tracking-tight text-white flex items-center justify-between shadow-md"
                  style={{ backgroundColor: `${obj.color}ee` }}
                >
                  <span className="flex items-center space-x-1 truncate max-w-[170px]">
                    {obj.isIdentifiedPerson ? (
                      <CheckCircle2 className="w-3 h-3 inline text-white shrink-0" />
                    ) : obj.category === 'person' ? (
                      <User className="w-3 h-3 inline text-white shrink-0" />
                    ) : (
                      <Car className="w-3 h-3 inline text-white shrink-0" />
                    )}
                    <span className="truncate">{obj.label}</span>
                  </span>
                  <span className="ml-1 opacity-90 text-[9px]">{(obj.confidence * 100).toFixed(0)}%</span>
                </div>

                {/* O'rta Nishon (Target Lock) */}
                <div className="self-center my-auto opacity-40">
                  <div className="w-4 h-4 rounded-full border border-dashed animate-pulse" style={{ borderColor: obj.color }} />
                </div>

                {/* RAMKANING PASTKI CHETIDA TO'LIQ ISM-FAMILIYA VA MAQOM VIDJETI */}
                <div className="flex items-end justify-between w-full p-1 pointer-events-none">
                  {obj.isIdentifiedPerson && obj.personName ? (
                    <div
                      className="px-1.5 py-0.5 rounded font-mono font-bold text-[9px] text-white shadow-md flex items-center space-x-1"
                      style={{ backgroundColor: 'rgba(2, 6, 23, 0.92)', border: `1.5px solid ${obj.color}` }}
                    >
                      <UserCheck className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-300 font-extrabold">{obj.personName}</span>
                      <span className="text-[7.5px] bg-emerald-950 px-1 py-0.2 rounded text-emerald-300 font-mono ml-0.5">IIV</span>
                    </div>
                  ) : obj.category === 'person' ? (
                    <div
                      className="px-1.5 py-0.5 rounded font-mono text-[9px] text-slate-300 shadow-md flex items-center space-x-1"
                      style={{ backgroundColor: 'rgba(2, 6, 23, 0.85)', border: `1px solid ${obj.color}80` }}
                    >
                      <User className="w-3 h-3 text-slate-400" />
                      <span className="text-slate-300 font-bold">Piyoda</span>
                    </div>
                  ) : (
                    <div />
                  )}

                  {/* Pastki Masofa Ko'rsatkichi (Metrda) */}
                  <div
                    className="px-1.5 py-0.5 text-[9px] font-mono text-black font-black rounded shadow-md ml-auto"
                    style={{ backgroundColor: `${obj.color}ee` }}
                  >
                    D: {obj.distanceUpperBound ? '<' : obj.distanceApprox ? '~' : ''}{obj.distance}m
                  </div>
                </div>
              </div>
            ))}

          </div>
          </div>

          {/* AI holati: video ustini yopmaslik uchun bitta qatorda, video ostida */}
          <div className="bg-tactical-950/85 border-t border-tactical-700/60 px-3 py-1.5 min-h-[32px] flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
            <span className="flex items-center space-x-1.5 text-police-cyan font-bold">
              <span
                className={`w-1.5 h-1.5 rounded-full ${aiModelLoaded ? 'bg-emerald-400' : 'bg-amber-400 animate-ping'}`}
              />
              <span>AI: {aiModelLoaded ? 'COCO-SSD + YUZ' : aiModelLoading ? 'YUKLANMOQDA...' : 'DETEKTOR'}</span>
            </span>
            <span className="text-slate-300">OBYEKT: {detectedCounts.total}</span>
            <span className={faceStatus === 'error' ? 'text-rose-400' : faceInfo.count > 0 ? 'text-emerald-300' : 'text-amber-300'}>
              YUZ:{' '}
              {faceStatus === 'loading'
                ? 'yuklanmoqda...'
                : faceStatus === 'error'
                ? 'MODEL XATO (jurnalga qarang)'
                : faceInfo.count > 0
                ? `${faceInfo.count} ta, ${faceInfo.widthPx}px`
                : 'topilmadi'}
              {faceStatus === 'ready' && faceInfo.cycleMs > 0 ? ` · ${faceInfo.cycleMs}ms` : ''}
            </span>
            <span className={faceInfo.faceDistM > 0 ? 'text-emerald-300' : 'text-slate-500'}>
              RAMKA: {faceInfo.faceDistM > 0 ? `${Math.round(faceInfo.faceDistM * 100)} sm` : '—'}
            </span>
            <span className="text-slate-400 ml-auto">GPS ±{gps.accuracy || 3.5}m</span>
          </div>

          {/* Sonarlar va harakat holati: kadr ustini yopmaslik uchun video ostida, bitta qatorda */}
          <div className="bg-tactical-950/85 border-t border-tactical-700/60 px-3 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
            <SonarChip side="front" label="OLD" pins="TRIG A0, ECHO A1" value={sonars.front} critical={isFrontBlocked} />
            <SonarChip side="left" label="CHAP" value={sonars.left} />
            <SonarChip side="right" label="O'NG" value={sonars.right} />
            <SonarChip side="rear" label="ORQA" pins="TRIG A2, ECHO A3" value={sonars.rear} />
            <span className="ml-auto flex items-center space-x-3 text-slate-300">
              <span className="flex items-center space-x-1">
                <Compass className="w-3 h-3 text-police-cyan" />
                <span>
                  AZIMUT {String(gps.heading || 42).padStart(3, '0')}°{gps.isReal ? ' (KOMPAS)' : ''}
                </span>
              </span>
              <span>
                KOMANDA: <span className="font-bold text-police-cyan">{lastCommand}</span>
              </span>
            </span>
          </div>

          {/* PTZ Quick Controls Bar */}
          <div className="bg-tactical-900/90 p-2 border-t border-tactical-700/60 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-1 font-mono text-slate-300">
              <SlidersHorizontal className="w-3.5 h-3.5 text-police-cyan" />
              <span className="text-[11px]">PTZ BURILISH:</span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => adjustPTZ(-15, 0)}
                className="px-2 py-1 bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 rounded text-slate-200 font-mono text-xs"
              >
                ◀ Chap
              </button>
              <button
                onClick={() => adjustPTZ(0, 10)}
                className="px-2 py-1 bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 rounded text-slate-200 font-mono text-xs"
              >
                ▲ Yuqori
              </button>
              <button
                onClick={() => adjustPTZ(0, -10)}
                className="px-2 py-1 bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 rounded text-slate-200 font-mono text-xs"
              >
                ▼ Quyi
              </button>
              <button
                onClick={() => adjustPTZ(15, 0)}
                className="px-2 py-1 bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 rounded text-slate-200 font-mono text-xs"
              >
                O'ng ▶
              </button>
              <button
                onClick={() => setPTZ((p) => ({ ...p, pan: 0, tilt: 15, zoom: 1, mode: p.mode === 'AUTO_CAMERA' ? 'MANUAL' : 'AUTO_CAMERA' }))}
                className="px-2 py-1 bg-police-blue/30 text-police-cyan border border-police-blue/60 rounded font-mono text-xs hover:bg-police-blue/50"
              >
                {ptz.mode === 'AUTO_CAMERA' ? 'Avto' : 'Qo\'lda'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Mecanum Directional Controller & Speed & Logs */}
      <div className="w-full lg:w-96 flex flex-col gap-3">
        {/* Mecanum Kinematics Controller */}
        <div className="hud-panel rounded-lg p-3.5 flex flex-col items-center">
          <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-tactical-700/60 font-mono text-xs">
            <span className="font-bold text-white flex items-center space-x-1.5">
              <Gauge className="w-4 h-4 text-police-cyan" />
              <span>MECANUM 4WD BOSHQARUV</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-tactical-800 text-police-cyan border border-tactical-700">
              L293D SHIELD
            </span>
          </div>

          {/* Speed Selector (1, 2, 3) */}
          <div className="w-full flex items-center justify-between bg-tactical-900/80 p-1.5 rounded border border-tactical-700/50 mb-3">
            <span className="text-[11px] font-mono text-slate-300 pl-1 font-semibold">TEZLIK (PWM):</span>
            <div className="flex space-x-1.5">
              {([1, 2, 3] as SpeedLevel[]).map((lvl) => {
                const pwmLabel = lvl === 1 ? '130' : lvl === 2 ? '190' : '250';
                const active = speedLevel === lvl;
                return (
                  <button
                    key={lvl}
                    onClick={() => setSpeedLevel(lvl)}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all ${
                      active
                        ? 'bg-police-blue text-white shadow-[0_0_10px_rgba(29,99,255,0.7)]'
                        : 'bg-tactical-800 text-slate-400 hover:text-white border border-tactical-700'
                    }`}
                  >
                    {lvl} <span className="text-[9px] opacity-75">({pwmLabel})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3x3 Mecanum Tactical Keypad */}
          <div className="grid grid-cols-3 gap-2 w-full max-w-[280px]">
            <button
              onClick={() => sendMecanumCommand('Q')}
              title="Chapga Yonlama (Strafe Q)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'Q'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <RotateCcw className="w-5 h-5 text-police-cyan mb-1" />
              <span className="text-[11px]">STRAFE Q</span>
            </button>

            <button
              onClick={() => sendMecanumCommand('F')}
              disabled={isFrontBlocked}
              title="Oldinga (F)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                isFrontBlocked
                  ? 'opacity-40 bg-tactical-950 border-rose-900 cursor-not-allowed'
                  : lastCommand === 'F'
                  ? 'bg-emerald-600 text-white border-emerald-400 shadow-[0_0_14px_rgba(0,230,118,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <ArrowUp className="w-6 h-6 text-emerald-400 mb-1" />
              <span className="text-xs">OLDINGA (F)</span>
            </button>

            <button
              onClick={() => sendMecanumCommand('E')}
              title="O'ngga Yonlama (Strafe E)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'E'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <RotateCw className="w-5 h-5 text-police-cyan mb-1" />
              <span className="text-[11px]">STRAFE E</span>
            </button>

            <button
              onClick={() => sendMecanumCommand('L')}
              title="Chapga Burilish (L)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'L'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <ArrowLeft className="w-6 h-6 text-police-cyan mb-1" />
              <span className="text-xs">CHAP (L)</span>
            </button>

            <button
              onClick={() => sendMecanumCommand('S')}
              title="To'xtatish (S)"
              className={`p-3.5 rounded-lg border-2 font-mono font-black flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'S'
                  ? 'bg-rose-600 text-white border-rose-400 shadow-[0_0_18px_rgba(255,34,56,0.9)] animate-pulse'
                  : 'bg-tactical-800 text-rose-300 border-rose-600/70 hover:bg-rose-900/50'
              }`}
            >
              <Square className="w-6 h-6 text-white mb-1 fill-current" />
              <span className="text-xs">STOP (S)</span>
            </button>

            <button
              onClick={() => sendMecanumCommand('R')}
              title="O'ngga Burilish (R)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'R'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <ArrowRight className="w-6 h-6 text-police-cyan mb-1" />
              <span className="text-xs">O'NG (R)</span>
            </button>

            <button
              onClick={() => sendMecanumCommand('L')}
              title="360° Joyida Burilish"
              className="p-3 rounded-lg border font-mono text-[10px] text-slate-400 border-tactical-700/70 bg-tactical-900/90 hover:bg-tactical-800 flex flex-col items-center justify-center"
            >
              <RotateCcw className="w-4 h-4 mb-0.5 text-slate-400" />
              <span>360° BURIL</span>
            </button>

            <button
              onClick={() => sendMecanumCommand('B')}
              title="Orqaga (B)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'B'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <ArrowDown className="w-6 h-6 text-police-cyan mb-1" />
              <span className="text-xs">ORQAGA (B)</span>
            </button>

            <button
              onClick={() => sendMecanumCommand('R')}
              title="360° Joyida O'ngga Burilish"
              className="p-3 rounded-lg border font-mono text-[10px] text-slate-400 border-tactical-700/70 bg-tactical-900/90 hover:bg-tactical-800 flex flex-col items-center justify-center"
            >
              <RotateCw className="w-4 h-4 mb-0.5 text-slate-400" />
              <span>360° SPUR</span>
            </button>
          </div>

          {/* Teleskopik Minora Boshqaruvi */}
          <div className="grid grid-cols-2 gap-2 mt-2 w-full max-w-[280px]">
            <button
              onClick={() => sendMecanumCommand('U')}
              title="Teleskopik Minorani Ko'tarish (U)"
              className="p-2 rounded-lg border font-mono text-xs font-bold text-police-cyan border-police-cyan/40 bg-tactical-900/90 hover:bg-tactical-800 flex items-center justify-center space-x-1"
            >
              <span>🗼 MINORA ↑ (U)</span>
            </button>
            <button
              onClick={() => sendMecanumCommand('D')}
              title="Teleskopik Minorani Tushirish (D)"
              className="p-2 rounded-lg border font-mono text-xs font-bold text-slate-300 border-tactical-700 bg-tactical-900/90 hover:bg-tactical-800 flex items-center justify-center space-x-1"
            >
              <span>🗼 MINORA ↓ (D)</span>
            </button>
          </div>

          <div className="mt-3 text-[10px] font-mono text-slate-400 text-center">
            Klaviatura: <span className="text-police-cyan">W, A, S, D, Q, E, Space (Stop), 1-3 (Tezlik)</span>
          </div>
        </div>

        {/* Real-time Telemetry & Arduino Serial Stream */}
        <div className="hud-panel rounded-lg p-3 flex flex-col flex-1 min-h-[160px]">
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-tactical-700/60 font-mono text-xs">
            <span className="font-bold text-white flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-police-cyan animate-pulse" />
              <span>SERIAL TELEMETRIYA KONSOLI</span>
            </span>
            <span className="text-[10px] text-slate-400">{system.arduinoPort}</span>
          </div>

          <div className="flex-1 bg-tactical-950/90 rounded border border-tactical-800 p-2 overflow-y-auto max-h-40 font-mono text-[11px] space-y-1">
            {logs.slice(0, 15).map((log) => (
              <div key={log.id} className="flex items-start space-x-1.5">
                <span className="text-slate-500 shrink-0">[{log.time}]</span>
                <span
                  className={`px-1 rounded text-[9px] font-bold shrink-0 ${
                    log.level === 'error'
                      ? 'bg-rose-950 text-rose-400'
                      : log.level === 'warn'
                      ? 'bg-amber-950 text-amber-400'
                      : log.level === 'success'
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-tactical-800 text-slate-300'
                  }`}
                >
                  {log.source}
                </span>
                <span
                  className={`break-all ${
                    log.level === 'error'
                      ? 'text-rose-400 font-semibold'
                      : log.level === 'warn'
                      ? 'text-amber-300'
                      : log.level === 'success'
                      ? 'text-emerald-300'
                      : 'text-slate-300'
                  }`}
                >
                  {log.text}
                </span>
              </div>
            ))}
          </div>
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
                <span>Yangi shaxsni bazaga kiritish:</span>
              </span>

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
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold shadow flex items-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Bazaga Saqlash</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
