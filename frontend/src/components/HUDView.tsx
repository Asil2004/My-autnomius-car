import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRobot } from '../context/RobotContext';
import type { SpeedLevel, DetectedObject } from '../types/robot';
import { faceRecognitionService, type KnownPerson } from '../services/faceRecognitionService';
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
  Crosshair,
  Gauge,
  SlidersHorizontal,
  ShieldAlert,
  Zap,
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
  CheckCircle2
} from 'lucide-react';

export const HUDView: React.FC = () => {
  const {
    lastCommand,
    speedLevel,
    sendMecanumCommand,
    setSpeedLevel,
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

  const [cameraFullscreen, setCameraFullscreen] = useState(false);
  const [cameraSource, setCameraSource] = useState<'FRONTAL' | 'RPI' | 'SIMULATION'>('FRONTAL');
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
  const cocoModelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const isDetectingRef = useRef<boolean>(false);
  const proximityCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // COCO-SSD klasslari uchun o'zbekcha nomlar lug'ati
  const UZ_OBSTACLE_NAMES: Record<string, string> = {
    person: "Piyoda",
    car: "Mashina (Avtomobil)",
    truck: "Yuk mashinasi",
    bus: "Avtobus",
    motorcycle: "Motosikl",
    bicycle: "Velosiped",
    chair: "Stul (To'siq)",
    couch: "Divan (To'siq)",
    "dining table": "Stol (To'siq)",
    bed: "Karovot (To'siq)",
    "potted plant": "Gultuvak (To'siq)",
    tv: "Monitor / TV",
    laptop: "Noutbuk",
    "cell phone": "Telefon (Obyekt)",
    bottle: "Idish / Butilka",
    cup: "Chashka / Finka",
    backpack: "Ryukzak (Yuk)",
    handbag: "Sumka",
    suitcase: "Chemodan (Yuk)",
    book: "Kitob / Blok",
    umbrella: "Soyabon",
    box: "Quti (To'siq)",
    dog: "It (Hayvon)",
    cat: "Mushuk (Hayvon)",
  };

  // =========================================================================
  // 1. TENSORFLOW COCO-SSD VA YUZ BAZASINI YUKLASH (Lokal va Parallel)
  // =========================================================================
  useEffect(() => {
    let isMounted = true;
    const loadAiServices = async () => {
      try {
        setAiModelLoading(true);
        addLog('AI', 'info', "Neyron tarmoqlar (COCO-SSD va face-api.js) lokal yuklanmoqda...");

        // Jonli kamera oldidan soxta namuna ramkalarni tozalash
        setDetectedObjects([]);

        const baseUrl = import.meta.env.BASE_URL || './';
        const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        const localCocoUrl = `${cleanBase}models/coco-ssd/model.json`;

        // COCO-SSD modelini lokal yoki keshdan bir marta yuklash
        const loadCoco = async () => {
          if (cocoModelRef.current) return cocoModelRef.current;
          try {
            const m = await cocoSsd.load({ modelUrl: localCocoUrl, base: 'lite_mobilenet_v2' });
            console.log('[AI] COCO-SSD modeli lokal public/models/coco-ssd dan yuklandi');
            return m;
          } catch (localErr) {
            console.warn('[AI] Lokal COCO-SSD topilmadi, tarmoq orqali yuklanadi:', localErr);
            return await cocoSsd.load({ base: 'lite_mobilenet_v2' });
          }
        };

        // Mustaqil parallel yuklash: face-api.js va COCO-SSD bir-birini kutmasligi shart
        faceRecognitionService.initDatabase().then(() => {
          if (isMounted) {
            setAiModelLoaded(true);
            setKnownPersons([...faceRecognitionService.getPersons()]);
            addLog('AI', 'success', "Yuz tanish (face-api.js) biometriyasi tayyor! Ro'yxatda 3 nafar IIV xodimi.");
          }
        }).catch(err => {
          console.warn('[AI] faceRecognitionService init xatosi:', err);
        });

        loadCoco().then(model => {
          if (isMounted) {
            cocoModelRef.current = model;
            setAiModelLoaded(true);
            setAiModelLoading(false);
            addLog('AI', 'success', "COCO-SSD transport/odam detektori tayyor!");
          }
        }).catch(err => {
          console.warn('[AI] COCO-SSD yuklash xatosi:', err);
          if (isMounted) setAiModelLoading(false);
        });
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

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (pErr: unknown) {
          const errName = pErr instanceof Error ? pErr.name : '';
          if (errName !== 'AbortError') throw pErr;
        }
      }
      setCameraLoading(false);
      addLog('SYSTEM', 'success', "Frontal kamera oqimi tiniq rejimda ulandi.");
    } catch (err: unknown) {
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
      stopCameraStream();
    };
  }, [cameraSource, startFrontalCamera, stopCameraStream]);

  // =========================================================================
  // 3. TASVIRDAN ODAM VA MASHINALARNI HAMDA SHAXSNI ANIQLASH (COCO-SSD + face-api.js)
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

    try {
      isDetectingRef.current = true;
      const predictionsPromise = cocoModelRef.current
        ? cocoModelRef.current.detect(video, 12, 0.28)
        : Promise.resolve([]);
      const facesPromise = faceRecognitionService.detectFacesInVideo(video);

      const [predictions, detectedFaces] = await Promise.all([
        predictionsPromise,
        facesPromise
      ]);

        let personCount = 0;
        let carCount = 0;
        let obstacleCount = 0;
        const matchedFaceIndices = new Set<number>();
        const activeTrackKeys = new Set<string>();

        // Barcha aniqlangan COCO klasslarini qabul qilamiz (to'siqlar ham ko'rinadi)
        const validPredictions = predictions.filter((pred) => pred.score >= 0.28);

        const newObjects: DetectedObject[] = [];

        validPredictions.forEach((pred, idx) => {
          const cls = pred.class.toLowerCase();
          const [rawX, rawY, rawW, rawH] = pred.bbox;

          let label = "Piyoda";
          let color = "#38bdf8";
          let category: DetectedObject['category'] = 'other';
          let personName: string | undefined = undefined;
          let isIdentifiedPerson = false;
          let confidence = +pred.score.toFixed(2);

          if (cls === 'person') {
            personCount++;
            category = 'person';

            // Odam ramkasi ichidagi eng yaqin yuzni topish
            let bestFaceIdx = -1;
            let bestFaceDistToCenter = Infinity;
            const personCenterX = rawX + rawW / 2;
            const personCenterY = rawY + rawH * 0.35;

            detectedFaces.forEach((face, fIdx) => {
              const fCenterX = face.box.x + face.box.width / 2;
              const fCenterY = face.box.y + face.box.height / 2;

              const marginX = rawW * 0.15;
              const marginY = rawH * 0.15;
              if (
                fCenterX >= rawX - marginX &&
                fCenterX <= rawX + rawW + marginX &&
                fCenterY >= rawY - marginY &&
                fCenterY <= rawY + rawH + marginY
              ) {
                const dist = Math.hypot(fCenterX - personCenterX, fCenterY - personCenterY);
                if (dist < bestFaceDistToCenter) {
                  bestFaceDistToCenter = dist;
                  bestFaceIdx = fIdx;
                }
              }
            });

            const trackKey = `trk_p_${Math.round(rawX / 80)}_${Math.round(rawY / 80)}`;
            activeTrackKeys.add(trackKey);

            if (bestFaceIdx >= 0) {
              matchedFaceIndices.add(bestFaceIdx);
              const matchedFace = detectedFaces[bestFaceIdx];
              const matchResult = faceRecognitionService.matchFace(matchedFace.descriptor);

              // Voting (anti-flicker): Masofa <= 0.52 bo'lsa darhol ko'rsatiladi, 0.52-0.58 oralig'ida kadrli tasdiqlash
              const isInstantMatch = matchResult.isIdentified && matchResult.distance <= 0.52;
              const votedId = faceRecognitionService.votePerson(
                trackKey,
                matchResult.isIdentified && matchResult.person ? matchResult.person.id : null
              );

              if (matchResult.isIdentified && matchResult.person && (isInstantMatch || votedId === matchResult.person.id)) {
                label = matchResult.person.fullName;
                personName = matchResult.person.fullName;
                color = matchResult.person.color || '#00e676';
                isIdentifiedPerson = true;
                confidence = matchResult.confidence;
              } else {
                label = "Piyoda";
                personName = undefined;
                color = "#38bdf8";
                isIdentifiedPerson = false;
                confidence = +pred.score.toFixed(2);
              }
            } else {
              // Yuz ko'rinmaydi (orqasi bilan yoki uzoqda) -> Har doim "Piyoda"
              faceRecognitionService.votePerson(trackKey, null);
              label = "Piyoda";
              personName = undefined;
              color = "#38bdf8";
              isIdentifiedPerson = false;
              confidence = +pred.score.toFixed(2);
            }
          } else if (cls === 'car') {
            carCount++;
            label = "Mashina (Avtomobil)";
            color = "#00e5ff";
            category = 'car';
          } else if (cls === 'truck') {
            carCount++;
            label = "Yuk mashinasi";
            color = "#06b6d4";
            category = 'car';
          } else if (cls === 'bus') {
            carCount++;
            label = "Avtobus";
            color = "#818cf8";
            category = 'car';
          } else if (cls === 'motorcycle' || cls === 'bicycle') {
            label = cls === 'motorcycle' ? "Motosikl" : "Velosiped";
            color = "#fbbf24";
            category = 'vehicle';
          } else {
            // Har qanday boshqa jism robot uchun to'siq hisoblanadi
            obstacleCount++;
            const uzName = UZ_OBSTACLE_NAMES[cls] || `To'siq (${cls})`;
            label = uzName;
            color = "#f59e0b";
            category = 'other';
          }

          let boxX = (rawX / vW) * 100;
          const boxY = (rawY / vH) * 100;
          const boxW = (rawW / vW) * 100;
          const boxH = (rawH / vH) * 100;

          if (mirrorVideo) {
            boxX = 100 - (boxX + boxW);
          }

          const focalRatio = category === 'person' ? 52 : (category === 'car' ? 68 : 45);
          const estimatedDistance = +(focalRatio / Math.max(10, boxH)).toFixed(2);
          const distanceM = Math.min(18.0, Math.max(0.18, estimatedDistance));

          // Agar to'siq juda yaqin bo'lsa (< 0.40m) qizil xavf rangiga o'tadi
          if (distanceM <= 0.40 && !isIdentifiedPerson) {
            color = "#ef4444";
          }

          newObjects.push({
            id: `real-obj-${idx}-${Date.now().toString().slice(-4)}`,
            label,
            confidence,
            distance: distanceM,
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
          });
        });

        // 2. COCO odamni topmadi, lekin face-api yuzni topdi holati
        detectedFaces.forEach((face, fIdx) => {
          if (!matchedFaceIndices.has(fIdx)) {
            personCount++;
            const trackKey = `trk_f_${Math.round(face.box.x / 80)}_${Math.round(face.box.y / 80)}`;
            activeTrackKeys.add(trackKey);

            const matchResult = faceRecognitionService.matchFace(face.descriptor);
            const isInstantMatch = matchResult.isIdentified && matchResult.distance <= 0.52;
            const votedId = faceRecognitionService.votePerson(
              trackKey,
              matchResult.isIdentified && matchResult.person ? matchResult.person.id : null
            );

            let label = "Piyoda";
            let color = "#38bdf8";
            let personName: string | undefined = undefined;
            let isIdentifiedPerson = false;
            let confidence = Math.min(0.98, Math.max(0.70, +face.score.toFixed(2)));

            if (matchResult.isIdentified && matchResult.person && (isInstantMatch || votedId === matchResult.person.id)) {
              label = matchResult.person.fullName;
              personName = matchResult.person.fullName;
              color = matchResult.person.color || '#00e676';
              isIdentifiedPerson = true;
              confidence = matchResult.confidence;
            }

            const headW = face.box.width * 1.8;
            const headH = face.box.height * 2.6;
            const headX = Math.max(0, face.box.x - (headW - face.box.width) / 2);
            const headY = Math.max(0, face.box.y - face.box.height * 0.2);

            let boxX = (headX / vW) * 100;
            const boxY = (headY / vH) * 100;
            const boxW = (headW / vW) * 100;
            const boxH = (headH / vH) * 100;

            if (mirrorVideo) {
              boxX = 100 - (boxX + boxW);
            }

            const estimatedDistance = +(52 / Math.max(12, boxH)).toFixed(1);

            newObjects.push({
              id: `face-obj-${fIdx}-${Date.now().toString().slice(-4)}`,
              label,
              confidence,
              distance: Math.min(18.0, Math.max(0.6, estimatedDistance)),
              box: {
                x: Math.max(0, Math.min(100 - boxW, boxX)),
                y: Math.max(0, Math.min(100 - boxH, boxY)),
                width: Math.min(100, boxW),
                height: Math.min(100, boxH)
              },
              color,
              category: 'person',
              personName,
              isIdentifiedPerson
            });
          }
        });

        faceRecognitionService.pruneVoteHistory(activeTrackKeys);

        // =========================================================================
        // OPTIK YAQINLIK / TO'SIQNI TEKSHIRISH (Unclassified Close Obstacle Check)
        // Kameraning to'g'ridan-to'g'ri oldida qo'l, quti yoki devor turganini sezish
        // =========================================================================
        try {
          if (!proximityCanvasRef.current) {
            proximityCanvasRef.current = document.createElement('canvas');
            proximityCanvasRef.current.width = 40;
            proximityCanvasRef.current.height = 30;
          }
          const pCanvas = proximityCanvasRef.current;
          const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });
          if (pCtx) {
            pCtx.drawImage(video, 0, 0, 40, 30);
            const imgData = pCtx.getImageData(10, 12, 20, 16).data;
            let totalLum = 0;
            let minLum = 255;
            let maxLum = 0;
            const pixelCount = 20 * 16;
            for (let i = 0; i < imgData.length; i += 4) {
              const lum = (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
              totalLum += lum;
              if (lum < minLum) minLum = lum;
              if (lum > maxLum) maxLum = lum;
            }
            const avgLum = totalLum / pixelCount;
            const contrast = maxLum - minLum;

            // Kamera oldi tekis jism (qo'l, devor, kitob) bilan to'silganda
            if (contrast < 30 && (avgLum < 50 || avgLum > 200) && newObjects.length === 0) {
              obstacleCount++;
              newObjects.push({
                id: `opt-barr-${Date.now().toString().slice(-4)}`,
                label: "To'siq (Yaqin Jism / To'siq)",
                confidence: 0.94,
                distance: 0.18,
                box: { x: 20, y: 35, width: 60, height: 60 },
                color: "#ef4444",
                category: "other"
              });
            }
          }
        } catch {
          // Offscreen canvas tahlil xatosi e'tiborga olinmaydi
        }

        // =========================================================================
        // XAVFSIZLIK YO'LAGI (Central Collision Corridor) VA AVTOTORMOZ TAHLILI
        // =========================================================================
        let minCollisionDistCm = 200; // Standart ochiq yo'l
        let closestLabel = "Yo'l ochiq";
        let closestCenterX = 50;
        let closestWidth = 0;

        newObjects.forEach((obj) => {
          const objCenterX = obj.box.x + obj.box.width / 2;
          const objBottomY = obj.box.y + obj.box.height;
          const distCm = Math.round(obj.distance * 100);

          // Robot harakat koridorida bo'lsa (x: 18% .. 82%, pastki qism)
          if (objCenterX >= 18 && objCenterX <= 82 && objBottomY >= 25) {
            if (distCm < minCollisionDistCm) {
              minCollisionDistCm = distCm;
              closestLabel = obj.label;
              closestCenterX = objCenterX;
              closestWidth = obj.box.width;
            }
          }
        });

        // Aylanib o'tish yoki chekinish yo'nalishini hisoblash
        let evasionDirection: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE' = 'CLEAR';
        if (minCollisionDistCm <= 80) {
          if (closestWidth >= 55) {
            evasionDirection = 'REVERSE';
          } else if (closestCenterX < 48) {
            evasionDirection = 'RIGHT'; // To'siq chapda -> O'ngga burilish
          } else {
            evasionDirection = 'LEFT';  // To'siq o'ngda -> Chapga burilish
          }
        }

        // Robot miyasiga (RobotContext) jonli uzatish
        updateCameraObstacle(minCollisionDistCm, closestLabel, evasionDirection);

        setDetectedObjects(newObjects);
        setDetectedCounts({
          people: personCount,
          cars: carCount,
          obstacles: obstacleCount,
          total: newObjects.length
        });
      } catch (err) {
        console.warn('[HUDView] Kadr deteksiyasida ogohlantirish:', err);
      } finally {
        isDetectingRef.current = false;
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

  // Yangi shaxsni bazaga qo'shish (Yuz tekshiruvi va xatoliklar bilan)
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

    try {
      const added = await faceRecognitionService.addPerson({
        fullName: newPersonName.trim(),
        role: newPersonRole.trim() || 'Ruxsat berilgan shaxs',
        photoDataUrl: newPersonPhoto,
        color: '#38bdf8'
      });

      setKnownPersons([...faceRecognitionService.getPersons()]);
      addLog('AI', 'success', `Yuzlar bazasiga yangi shaxs muvaffaqiyatli qo'shildi: ${added.fullName}`);
      setNewPersonName('');
      setNewPersonRole('');
      setNewPersonPhoto(null);
      setAddPersonError(null);
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

  const getSonarColor = (distance: number, isCritical = false) => {
    if (isCritical || distance <= 22) return 'text-rose-500 bg-rose-950/60 border-rose-500 shadow-[0_0_10px_rgba(255,34,56,0.6)] animate-pulse';
    if (distance <= 45) return 'text-amber-400 bg-amber-950/40 border-amber-500/60';
    return 'text-emerald-400 bg-emerald-950/30 border-emerald-500/50';
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-3 p-3 overflow-y-auto max-w-7xl mx-auto w-full">
      {/* LEFT COLUMN: Live Feed + HUD Overlays */}
      <div className={`flex flex-col gap-3 ${cameraFullscreen ? 'fixed inset-0 z-50 p-2 bg-tactical-950' : 'flex-1'}`}>
        
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
        <div className="hud-panel rounded-lg overflow-hidden flex flex-col flex-1 relative min-h-[360px] max-h-[560px]">
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
                <span className="text-slate-600">|</span>
                <span className={`flex items-center space-x-1 font-bold ${detectedCounts.obstacles > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                  <AlertTriangle className="w-3 h-3" />
                  <span>{detectedCounts.obstacles} To'siq</span>
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

          {/* Video Stream & Viewport: scanlines olib tashlangan, tiniq tasvir */}
          <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
            
            {/* 1-REJIM: FRONTAL WEBCAM */}
            {cameraSource === 'FRONTAL' && (
              <div className="w-full h-full relative flex items-center justify-center bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover transition-transform ${mirrorVideo ? 'scale-x-[-1]' : ''}`}
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
                onError={() => {
                  addLog('RPI', 'warn', "RPi video oqimi mavjud emas, simulyatsiyaga o'tildi.");
                  setCameraSource('SIMULATION');
                }}
                className="w-full h-full object-cover"
              />
            )}

            {/* 3-REJIM: VIRTUAL TAKTIK SIMULYATOR */}
            {cameraSource === 'SIMULATION' && (
              <div className="w-full h-full relative flex items-center justify-center bg-gradient-to-b from-tactical-950 via-[#0a1120] to-[#040810]">
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
                    D: {obj.distance}m
                  </div>
                </div>
              </div>
            ))}

            {/* DYNAMIC AR SAFETY CORRIDOR (Robot Ko'zi Traektoriya Yo'lagi) */}
            {cameraSource === 'FRONTAL' && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="corridorGradGreen" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.30" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.03" />
                  </linearGradient>
                  <linearGradient id="corridorGradAmber" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.06" />
                  </linearGradient>
                  <linearGradient id="corridorGradRed" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity="0.65" />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity="0.10" />
                  </linearGradient>
                </defs>

                {/* Trapezoid Safety Corridor */}
                <polygon
                  points="18,100 82,100 62,56 38,56"
                  fill={
                    cameraObstacle.isBlocked 
                      ? "url(#corridorGradRed)" 
                      : cameraObstacle.distanceCm < 80 
                      ? "url(#corridorGradAmber)" 
                      : "url(#corridorGradGreen)"
                  }
                  stroke={
                    cameraObstacle.isBlocked 
                      ? "#ef4444" 
                      : cameraObstacle.distanceCm < 80 
                      ? "#f59e0b" 
                      : "#10b981"
                  }
                  strokeWidth="0.8"
                  strokeDasharray={cameraObstacle.isBlocked ? "none" : "2,1"}
                />

                {/* Forward Barrier Line if blocked */}
                {cameraObstacle.isBlocked && (
                  <line x1="26" y1="78" x2="74" y2="78" stroke="#ef4444" strokeWidth="2.5" className="animate-pulse" />
                )}
              </svg>
            )}

            {/* TOP AR ROBOT EYE TELEMETRY BANNER & EVASION HINT */}
            {cameraSource === 'FRONTAL' && (
              <div className="absolute top-3 inset-x-0 z-20 flex flex-col items-center pointer-events-none space-y-1.5 px-4">
                <div className={`px-3 py-1 rounded-full font-mono text-xs font-black flex items-center space-x-2 border shadow-2xl backdrop-blur-md transition-all ${
                  cameraObstacle.isBlocked
                    ? 'bg-rose-950/95 text-rose-300 border-rose-500 animate-pulse ring-2 ring-rose-500/50'
                    : cameraObstacle.distanceCm < 80
                    ? 'bg-amber-950/90 text-amber-300 border-amber-500'
                    : 'bg-tactical-950/85 text-emerald-300 border-emerald-500/60'
                }`}>
                  <Eye className={`w-3.5 h-3.5 ${cameraObstacle.isBlocked ? 'text-rose-400 animate-ping' : 'text-emerald-400'}`} />
                  <span>👁️ ROBOT "KO'ZI": {cameraObstacle.label} — {cameraObstacle.distanceCm} sm</span>
                  {cameraObstacle.isBlocked && (
                    <span className="bg-rose-600 text-white text-[9px] px-1.5 py-0.5 rounded font-black tracking-wider animate-bounce ml-1">
                      🛑 AVTOTORMOZ!
                    </span>
                  )}
                </div>

                {/* Evasion Suggestion Badge */}
                {cameraObstacle.distanceCm <= 80 && cameraObstacle.evasionDirection !== 'CLEAR' && (
                  <div className="flex items-center space-x-1.5 bg-police-blue/95 border border-police-cyan/80 px-3 py-0.5 rounded-full font-mono text-[11px] font-bold text-white shadow-xl animate-bounce">
                    {cameraObstacle.evasionDirection === 'LEFT' && <span>⬅️ Chapdan chetlab o'tish tavsiya etiladi (A)</span>}
                    {cameraObstacle.evasionDirection === 'RIGHT' && <span>➡️ O'ngdan chetlab o'tish tavsiya etiladi (D)</span>}
                    {cameraObstacle.evasionDirection === 'REVERSE' && <span>⬇️ Orqaga chekinish tavsiya etiladi (S)</span>}
                  </div>
                )}
              </div>
            )}

            {/* Center Tactical Crosshair */}
            <div className="relative pointer-events-none flex items-center justify-center z-10">
              <Crosshair className="w-14 h-14 text-police-cyan/60 animate-pulse-subtle" />
              <div className="absolute w-28 h-28 border border-dashed border-police-cyan/30 rounded-full" />
              <div className="absolute -top-7 text-[10px] font-mono text-police-cyan font-bold bg-tactical-950/80 px-2 py-0.5 rounded border border-tactical-700/60 shadow-md">
                GPS: {gps.latitude.toFixed(6)}° N, {gps.longitude.toFixed(6)}° E
              </div>
            </div>

            {/* Front Obstacle Warning Overlay */}
            {isFrontBlocked && (
              <div className="absolute top-4 inset-x-4 bg-rose-600/90 text-white p-2.5 rounded border border-rose-400 flex items-center justify-center space-x-2 animate-bounce z-30 shadow-lg">
                <ShieldAlert className="w-6 h-6 text-white animate-spin" />
                <span className="font-mono font-black text-sm uppercase tracking-wide">
                  XAVF: OLD TO'SIQ ({sonars.front} sm &lt; 22 sm) — AVTOTORMOZ!
                </span>
              </div>
            )}

            {/* Corner Bracket HUD Graphics */}
            <div className="absolute top-3 left-3 font-mono text-[10px] text-police-cyan/90 pointer-events-none bg-tactical-950/80 p-1.5 rounded border border-tactical-700/60 shadow z-10">
              <div className="flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                <span>AI: {aiModelLoaded ? 'COCO-SSD & YUZ' : aiModelLoading ? 'YUKLANMOQDA...' : 'DETEKTOR'}</span>
              </div>
              <div>ANIQLANGAN: {detectedCounts.total} ta obyekt</div>
              <div>ANIQLIK: ±{gps.accuracy || 3.5}m</div>
            </div>

            <div className="absolute bottom-3 left-3 font-mono text-[10px] text-police-cyan/90 pointer-events-none bg-tactical-950/80 p-1.5 rounded border border-tactical-700/60 flex items-center space-x-1.5 shadow z-10">
              <Compass className="w-3.5 h-3.5 text-police-cyan animate-pulse" />
              <span>AZIMUT: {String(gps.heading || 42).padStart(3, '0')}° {gps.isReal ? '(REAL KOMPAS)' : 'NE'}</span>
            </div>

            <div className="absolute bottom-3 right-3 font-mono text-[10px] text-slate-300 pointer-events-none bg-tactical-950/80 p-1.5 rounded border border-tactical-700/60 shadow z-10">
              KOMANDA: <span className="font-bold text-police-cyan">{lastCommand}</span>
            </div>
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

        {/* HC-SR04 4X SONAR RADAR STATUS */}
        <div className="hud-panel rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-xs font-bold text-white flex items-center space-x-1.5">
              <Zap className="w-3.5 h-3.5 text-police-cyan" />
              <span>4X HC-SR04 ULTRATOVUSH SONARLARI</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              Chegara: &lt;22sm = AVTOTORMOZ
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className={`p-2 rounded border font-mono flex flex-col items-center justify-center transition-all ${getSonarColor(sonars.front, isFrontBlocked)}`}>
              <span className="text-[10px] text-slate-300 font-bold">OLD (TRIG A0, ECHO A1)</span>
              <span className="text-xl font-black mt-0.5">{sonars.front} sm</span>
              <span className="text-[9px] mt-0.5 font-semibold">
                {sonars.front <= 22 ? 'XAVF: TO\'SIQ!' : 'Xavfsiz'}
              </span>
            </div>

            <div className={`p-2 rounded border font-mono flex flex-col items-center justify-center transition-all ${getSonarColor(sonars.rear)}`}>
              <span className="text-[10px] text-slate-300 font-bold">ORQA (TRIG A2, ECHO A3)</span>
              <span className="text-xl font-black mt-0.5">{sonars.rear} sm</span>
              <span className="text-[9px] mt-0.5 font-semibold">
                {sonars.rear <= 22 ? 'Orqa to\'siq' : 'Ochiq'}
              </span>
            </div>

            <div className={`p-2 rounded border font-mono flex flex-col items-center justify-center transition-all ${getSonarColor(sonars.left)}`}>
              <span className="text-[10px] text-slate-300 font-bold">CHAP YONLAMA</span>
              <span className="text-xl font-black mt-0.5">{sonars.left} sm</span>
              <span className="text-[9px] mt-0.5 font-semibold">Ochiq</span>
            </div>

            <div className={`p-2 rounded border font-mono flex flex-col items-center justify-center transition-all ${getSonarColor(sonars.right)}`}>
              <span className="text-[10px] text-slate-300 font-bold">O'NG YONLAMA</span>
              <span className="text-xl font-black mt-0.5">{sonars.right} sm</span>
              <span className="text-[9px] mt-0.5 font-semibold">Ochiq</span>
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
                  <span>{isAddingPerson ? "Tekshirilmoqda..." : "Bazaga Saqlash"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
