import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { faceRecognitionService } from '../services/faceRecognitionService';
import { faceViewSettings } from '../services/faceViewSettings';
import { tacticalAudio } from '../services/audioService';
import { edgeTtsService } from '../services/edgeTtsService';
import { nvrRecordingService } from '../services/nvrRecordingService';
import { RobotAvatar, type EyeInput } from './RobotAvatar';

interface RobotFaceViewProps {
  onUnlockRequest: () => void;
  /** Ikkinchi planshetdan masofaviy admin kirishi */
  onAdminRequest?: () => void;
}

export const RobotFaceView: React.FC<RobotFaceViewProps> = ({ onUnlockRequest, onAdminRequest }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Kamera va avto-salom AI & Avtonom bo'limida sozlanadi (bosh sahifada boshqaruv elementlari yo'q)
  const [cameraActive, setCameraActive] = useState<boolean>(() => faceViewSettings.get().cameraEnabled);
  const isSpeakingRef = useRef(false);
  const lastGreetTimeRef = useRef<number>(0);
  const lastGreetedIdRef = useRef<string | null>(null);

  // Ko'zlar shu ref dan o'qiydi (har kadrda React qayta chizilmaydi)
  const eyeInputRef = useRef<EyeInput>({ faceX: 0, faceY: 0, hasFace: false, speech: 0, happy: false });

  // Avto-salom holati detektsiya siklida eskirib qolmasligi uchun ref orqali o'qiladi
  const autoGreetRef = useRef(faceViewSettings.get().autoGreet);
  useEffect(
    () =>
      faceViewSettings.subscribe((s) => {
        autoGreetRef.current = s.autoGreet;
        setCameraActive(s.cameraEnabled);
      }),
    []
  );

  // Yuz bazasi, modellar va shader isitish: Operator HUD bilan bir xil tayyorgarlik (prepare)
  useEffect(() => {
    faceRecognitionService.prepare().catch(err => {
      console.warn('[RobotFaceView] faceRecognitionService init error:', err);
    });
  }, []);

  // ==========================================================================
  // AI OVOZIGA MOS NUTQ (Edge TTS Sardor 1x). Ko'zlar nutq ritmiga javob beradi
  // ==========================================================================
  const speakDemoPhrase = useCallback((phraseText: string) => {
    if (isSpeakingRef.current) return;
    isSpeakingRef.current = true;
    tacticalAudio.playCommandBeep();

    let speakTick = 0;
    const speechTimer = window.setInterval(() => {
      speakTick++;
      // Haqiqiy Sardor audiosining balandligi (jim joylarda og'iz yopiladi); o'lchab bo'lmasa taxminiy ritm
      const level = edgeTtsService.getLevel();
      eyeInputRef.current.speech = level !== null
        ? level
        : 0.5 + Math.sin(speakTick * 0.8) * 0.4 + Math.random() * 0.2;
    }, 33);

    // Uzun gaplar animatsiyasi audio tugamasdan uzilmasligi uchun matn uzunligiga qarab
    const safetyTimeout = window.setTimeout(() => {
      finish();
    }, Math.max(7500, phraseText.length * 95 + 2500));

    const finish = () => {
      window.clearTimeout(safetyTimeout);
      clearInterval(speechTimer);
      eyeInputRef.current.speech = 0;
      isSpeakingRef.current = false;
    };

    edgeTtsService.speak(phraseText, { voice: 'uz-UZ-SardorNeural', rate: 1.0 }, undefined, finish);
  }, []);

  // Ekranga birinchi bosish: brauzer ovoz va disk ruxsatini faqat foydalanuvchi harakatidan keyin beradi
  const handleUnlockAudio = useCallback(() => {
    // Yangi seansda D diskdagi NVR papkasiga yozish ruxsatini qayta tiklash (brauzer faqat bosishda so'raydi)
    void nvrRecordingService.resumeDiskAccess();
    tacticalAudio.playClick();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
    }
  }, []);

  const speakRef = useRef(speakDemoPhrase);
  useEffect(() => {
    speakRef.current = speakDemoPhrase;
  }, [speakDemoPhrase]);

  // ==========================================================================
  // OLD KAMERA ORQALI INSON YUZINI KUZATISH VA TANISH
  // ==========================================================================
  useEffect(() => {
    const input = eyeInputRef.current;
    if (!cameraActive) {
      input.hasFace = false;
      input.happy = false;
      return;
    }

    let stream: MediaStream | null = null;
    let trackInterval: number | null = null;

    const startCamera = async () => {
      try {
        // Operator HUD bilan bir xil o'lcham: past o'lchamda yuz kichik chiqib, descriptor noaniq bo'lardi
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });

        if (cancelled) {
          // Kamera ochilguncha effekt tozalangan (kamera o'chirildi yoki sahifa almashdi)
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (pErr: unknown) {
            const errName = pErr instanceof Error ? pErr.name : '';
            if (errName !== 'AbortError') throw pErr;
          }
        }

        // Kamera tasviri avtomatik yoziladi: tanlangan disk papkasiga (1 GB) yoki brauzer xotirasiga (100 MB)
        nvrRecordingService.startRecording(stream);

        // ------------------------------------------------------------------
        // Operator HUD dagi Face ID texnologiyasi (faceRecognitionService.identifyPeople):
        // - jonli detektor sozlamasi (416, 0.5) va aksessuarli shablonlar (ko'zoynak, niqob, bosh kiyim)
        // - qat'iy chegaralar (0.5 / 0.4) va eng yaqin ikki shaxs orasidagi farq tekshiruvi
        // - iz (track) bo'yicha ovoz berish: oxirgi 5 kadrdan 3 tasi bir xil shaxs bo'lsagina ism chiqadi
        // - kameraga juda yaqin yuz (kadr kichraytiriladi) va past baholi yuzlarni qayta qidirish
        // Qulf ekranida COCO yo'q, shuning uchun butun kadr bitta "odam ramkasi" sifatida beriladi.
        // ------------------------------------------------------------------
        let isBusyDetecting = false;
        let faceCycles = 0; // ketma-ket yuz ko'ringan kadrlar soni
        // Tanish ovozi to'planguncha begona deb e'lon qilmaymiz (bazadagi xodimga "Piyoda" deb salom bermaslik uchun)
        const STRANGER_AFTER_CYCLES = 6;

        trackInterval = window.setInterval(async () => {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || isBusyDetecting) return;
          const vW = video.videoWidth;
          const vH = video.videoHeight;
          if (!vW || !vH) return;
          isBusyDetecting = true;

          try {
            const identities = await faceRecognitionService.identifyPeople(
              video,
              [{ x: 0, y: 0, width: vW, height: vH }],
              { voteMissingFace: true }
            );
            const withFace = identities.filter((i) => i.faceFound);
            // Bir nechta odam bo'lsa: avval tanilgan, keyin eng katta (eng yaqin) yuz
            const main = withFace.length
              ? withFace.reduce((a, b) => {
                  if (!!a.person !== !!b.person) return a.person ? a : b;
                  const aw = (a.faceBox ?? a.box).width;
                  const bw = (b.faceBox ?? b.box).width;
                  return aw >= bw ? a : b;
                })
              : null;

            if (main) {
              faceCycles++;
              // Ko'zlar yuz ramkasiga qaraydi (past baholi yuzda ramka yo'q: oldingi yo'nalish saqlanadi)
              if (main.faceBox) {
                const normX = (main.faceBox.x + main.faceBox.width / 2) / vW;
                const normY = (main.faceBox.y + main.faceBox.height / 2) / vH;
                // Oyna inversiyasi: odam o'ng tomonga o'tsa, ko'zlar ham o'ng tomonga qaraydi
                input.faceX = (1.0 - normX - 0.5) * 2;
                input.faceY = (normY - 0.5) * 2;
              }
              input.hasFace = true;
              const nowMs = Date.now();

              if (main.person) {
                input.happy = true;

                // Kamera asosida tanilgan xodim bilan salomlashish
                if (autoGreetRef.current && (lastGreetedIdRef.current !== main.person.id || nowMs - lastGreetTimeRef.current > 18000)) {
                  lastGreetedIdRef.current = main.person.id;
                  lastGreetTimeRef.current = nowMs;
                  const firstName = main.person.fullName.split(' ')[0] || main.person.fullName;
                  speakRef.current(`Assalomu alaykum ${firstName}! QALQON tizimi shaxsingizni tasdiqladi.`);
                }
              } else if (faceCycles >= STRANGER_AFTER_CYCLES) {
                input.happy = false;

                // Kamera asosida istalgan inson/piyoda ko'ringanda avtomatik salomlashish va og'iz qimirlashi
                if (autoGreetRef.current && (lastGreetedIdRef.current !== 'stranger' || nowMs - lastGreetTimeRef.current > 18000)) {
                  lastGreetedIdRef.current = 'stranger';
                  lastGreetTimeRef.current = nowMs;
                  speakRef.current("Assalomu alaykum! Men QALQON avtonom patrul robotiman. Jamoat xavfsizligini ta'minlashga tayyorman!");
                }
              } else {
                // Shaxs hali tekshirilmoqda (ovozlar to'planmoqda)
                input.happy = false;
              }
              return;
            }

            // Yuz yo'q: ko'zlar yana o'zi atrofga qaraydi
            faceCycles = 0;
            input.hasFace = false;
            input.happy = false;
            if (Date.now() - lastGreetTimeRef.current > 6000) {
              lastGreetedIdRef.current = null;
            }
          } catch (e) {
            console.warn('[RobotFaceView] Yuz deteksiya siklida ogohlantirish:', e);
          } finally {
            isBusyDetecting = false;
          }
        }, 120);
      } catch (err) {
        // Kamera yo'q yoki rad etilgan: robot yuzi kursor va teginishga javob berishda davom etadi
        console.warn("Front kamera ochilmadi (foydalanuvchi rad etgan yoki qurilmada yo'q):", err);
      }
    };

    let cancelled = false;
    startCamera();

    return () => {
      cancelled = true;
      if (trackInterval) clearInterval(trackInterval);
      nvrRecordingService.stopRecording();
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      input.hasFace = false;
      input.happy = false;
    };
  }, [cameraActive]);

  return (
    <div onClick={handleUnlockAudio} className="relative w-full h-full bg-tactical-950 overflow-hidden select-none">
      <RobotAvatar inputRef={eyeInputRef} />

      {/* Yuzni aniqlash uchun ko'rinmas kamera oqimi */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      {/* Bosh sahifada faqat robot yuzi va ikkita kirish tugmasi. Kamera, avto-salom, ovozni sinash va
          ovozli muloqot AI & Avtonom bo'limida */}

      {/* Admin (masofaviy) kirish tugmasi */}
      {onAdminRequest && (
        <button
          onClick={() => {
            tacticalAudio.playClick();
            onAdminRequest();
          }}
          title="Admin kirishi (masofaviy boshqaruv)"
          aria-label="Admin kirishi"
          className="absolute top-4 right-16 z-30 p-2.5 rounded-xl bg-tactical-900 border border-tactical-700 text-slate-300 hover:text-white hover:bg-tactical-800 transition-transform active:scale-90"
        >
          <ShieldCheck className="w-4 h-4" />
        </button>
      )}

      {/* Operator kirish tugmasi */}
      <button
        onClick={() => {
          tacticalAudio.playClick();
          onUnlockRequest();
        }}
        title="Operator paneli"
        aria-label="Operator paneli"
        className="absolute top-4 right-4 z-30 p-2.5 rounded-xl bg-tactical-900 border border-tactical-700 text-slate-300 hover:text-white hover:bg-tactical-800 transition-transform active:scale-90"
      >
        <Lock className="w-4 h-4" />
      </button>
    </div>
  );
};
