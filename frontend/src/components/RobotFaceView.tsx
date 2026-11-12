import React, { useEffect, useRef, useState, useCallback } from 'react';
import { robotCall, type CallInfo } from '../services/voiceCall';
import { faceRecognitionService } from '../services/faceRecognitionService';
import { faceViewSettings } from '../services/faceViewSettings';
import { HandsFreeListener } from '../services/handsFreeListener';
import { uzbekVoiceService } from '../services/uzbekVoiceService';
import { aiDialogService } from '../services/aiDialogService';
import { tacticalAudio } from '../services/audioService';
import { edgeTtsService } from '../services/edgeTtsService';
import { nvrRecordingService } from '../services/nvrRecordingService';
import { robotCamBroadcaster } from '../services/robotCamLink';
import { camLinkSettings } from '../services/camLinkSettings';
import { faceCameraSettings } from '../services/faceCameraSettings';
import { createAnnotatedStream, type AnnotatedStream, type OverlayBox } from '../services/nvrOverlayCompositor';
import { RobotAvatar, type EyeInput } from './RobotAvatar';

// Avto-salom oraliqlari
const GREET_ANY_MS = 60 * 1000; // har qanday ikki salom orasida (yangi odam tanilsa ham) kamida 1 daqiqa
const GREET_SAME_PERSON_MS = 10 * 60 * 1000; // bir xil xodimga 10 daqiqada bir marta
const GREET_STRANGER_MS = 3 * 60 * 1000; // notanish odamlarga 3 daqiqada bir marta

interface RobotFaceViewProps {
  onUnlockRequest: () => void;
  /** Ikkinchi planshetdan masofaviy admin kirishi */
  onAdminRequest?: () => void;
  /** ESP32 masofaviy boshqaruv pultini ochish */
  onControllerRequest?: () => void;
}

export const RobotFaceView: React.FC<RobotFaceViewProps> = ({ onUnlockRequest }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Kamera va avto-salom AI & Avtonom bo'limida sozlanadi (bosh sahifada boshqaruv elementlari yo'q)
  const [cameraActive, setCameraActive] = useState<boolean>(() => faceViewSettings.get().cameraEnabled);
  const [faceCamChoice, setFaceCamChoice] = useState(() => faceCameraSettings.get());
  useEffect(() => faceCameraSettings.subscribe(setFaceCamChoice), []);
  const [camRole, setCamRole] = useState(() => camLinkSettings.get().role);
  useEffect(() => camLinkSettings.subscribe((s) => setCamRole(s.role)), []);
  const isSpeakingRef = useRef(false);
  /** 102 chaqiruvi kutilmoqda yoki suhbat ketmoqda */
  const callBusyRef = useRef(false);
  // Qo'l tegizmasdan suhbat: mikrofon tinglovchisi, javob tayyorlanmoqdami, oxirgi suhbat vaqti
  const listenerRef = useRef<HandsFreeListener | null>(null);
  const processingRef = useRef(false);
  const lastConversationRef = useRef(0);
  const speakRef = useRef<(text: string, opts?: { force?: boolean; onDone?: () => void }) => void>(() => {});
  // Avto-salom oralig'i: istalgan ikki salom orasida kamida GREET_ANY_MS (yangi odam tanilsa ham),
  // bir xil xodimga GREET_SAME_PERSON_MS, notanish odamlarga GREET_STRANGER_MS da bir marta
  const lastGreetTimeRef = useRef<number>(0);
  const greetLogRef = useRef(new Map<string, number>());

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
  const finishRef = useRef<(() => void) | null>(null);
  const speakDemoPhrase = useCallback((phraseText: string, opts?: { force?: boolean; onDone?: () => void }) => {
    // 102 suhbati paytida robot o'zi gapirmaydi (salomlashuv ham)
    if (callBusyRef.current) return;
    if (isSpeakingRef.current) {
      if (!opts?.force) return;
      // Suhbat javobi salomlashuvdan muhimroq: joriy gapni to'xtatamiz
      finishRef.current?.();
      edgeTtsService.stop();
    }
    isSpeakingRef.current = true;
    // Robot gapirayotganda mikrofon o'z ovozini eshitib qolmasligi uchun tinglash to'xtatiladi
    listenerRef.current?.setPaused(true);
    tacticalAudio.playCommandBeep();

    let speakTick = 0;
    // Og'iz faqat ovoz HAQIQATAN eshitilayotganda qimirlaydi (edgeTtsService.isAudible: audio 'playing' dan
    // 'ended' gacha). TTS so'rovi va audio yuklanayotgan paytda (1-5 s) og'iz yopiq turadi
    const speechTimer = window.setInterval(() => {
      if (!edgeTtsService.isAudible()) {
        eyeInputRef.current.speech = 0;
        return;
      }
      speakTick++;
      // Haqiqiy audio balandligi (jim joylarda og'iz yopiladi); o'lchab bo'lmasa (Web Speech) taxminiy ritm
      const level = edgeTtsService.getLevel();
      eyeInputRef.current.speech = level !== null
        ? level
        : 0.5 + Math.sin(speakTick * 0.8) * 0.4 + Math.random() * 0.2;
    }, 16);

    // Ehtiyot taymeri: ovoz umuman boshlanmasa 25 s da, boshlangach esa matn uzunligiga qarab (ijro boshidan) tugatadi
    let safetyTimeout = window.setTimeout(() => finish(), 25000);
    const onAudioStart = () => {
      window.clearTimeout(safetyTimeout);
      safetyTimeout = window.setTimeout(() => finish(), Math.max(7500, phraseText.length * 95 + 2500));
    };

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (finishRef.current === finish) finishRef.current = null;
      window.clearTimeout(safetyTimeout);
      clearInterval(speechTimer);
      eyeInputRef.current.speech = 0;
      isSpeakingRef.current = false;
      // Aks-sado so'nguncha biroz kutib, tinglashni qayta yoqamiz
      window.setTimeout(() => {
        if (!isSpeakingRef.current && !processingRef.current && !callBusyRef.current) listenerRef.current?.setPaused(false);
      }, 500);
      opts?.onDone?.();
    };
    finishRef.current = finish;

    edgeTtsService.speak(phraseText, { voice: 'uz-UZ-SardorNeural', rate: 1.0 }, onAudioStart, finish);
  }, []);

  // ==========================================================================
  // QO'L TEGIZMASDAN SUHBAT: mikrofon gapni sezadi -> UzbekVoice.ai matnga aylantiradi -> AI javob beradi -> Sardor o'qiydi
  // ==========================================================================
  const [listenEnabled, setListenEnabled] = useState<boolean>(() => faceViewSettings.get().listen);
  useEffect(() => faceViewSettings.subscribe((s) => setListenEnabled(s.listen)), []);

  // 102 suhbati paytida qo'l tegizmasdan tinglash butunlay o'chadi (mikrofonni bo'shatadi: Android da ikkita
  // mikrofon oqimi bir-biriga xalaqit berib, suhbat ovozi uzilib qolardi). Suhbat tugagach qayta yoqiladi
  const [callBusy, setCallBusy] = useState(false);
  useEffect(() => {
    if (!listenEnabled || callBusy) return;
    const listener = new HandsFreeListener({
      onUtterance: async (wav) => {
        if (processingRef.current || isSpeakingRef.current) return;
        processingRef.current = true;
        lastConversationRef.current = Date.now();
        listener.setPaused(true);
        try {
          const { text } = await uzbekVoiceService.transcribeAudio(wav);
          if (text.replace(/[^\p{L}]/gu, '').length < 2) return; // shovqin yoki bitta tovush
          console.info('[Suhbat] Fuqaro:', text);
          const reply = await aiDialogService.respond(text);
          console.info('[Suhbat] Robot:', reply.answer, `(${reply.source})`);
          lastConversationRef.current = Date.now();
          speakRef.current(reply.answer, { force: true, onDone: () => (lastConversationRef.current = Date.now()) });
        } catch (err) {
          // Bo'sh nutq yoki tarmoq xatosi: jim o'tamiz, keyingi gapni kutamiz
          console.warn('[Suhbat] Nutqni aniqlab bo\'lmadi:', err instanceof Error ? err.message : err);
        } finally {
          processingRef.current = false;
          if (!isSpeakingRef.current && !callBusyRef.current) listener.setPaused(false);
        }
      }
    });
    listenerRef.current = listener;
    listener.start().catch((err) => console.warn('[Suhbat] Mikrofon ochilmadi:', err));
    return () => {
      listener.stop();
      if (listenerRef.current === listener) listenerRef.current = null;
    };
  }, [listenEnabled, callBusy]);

  // Ekranga birinchi bosish: brauzer ovoz va disk ruxsatini faqat foydalanuvchi harakatidan keyin beradi
  const handleUnlockAudio = useCallback(() => {
    // Yangi seansda D diskdagi NVR papkasiga yozish ruxsatini qayta tiklash (brauzer faqat bosishda so'raydi)
    void nvrRecordingService.resumeDiskAccess();
    listenerRef.current?.resume();
    tacticalAudio.playClick();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
    }
  }, []);

  useEffect(() => {
    speakRef.current = speakDemoPhrase;
  }, [speakDemoPhrase]);

  // 102 CHAQIRUV: suhbat davomida robotning o'z ovozli yordamchisi jim turadi (operator bilan gaplashilmoqda)
  const [call, setCall] = useState<CallInfo>(() => robotCall.getState());
  useEffect(
    () =>
      robotCall.subscribe((c) => {
        setCall(c);
        const busy = c.state === 'ringing' || c.state === 'active';
        callBusyRef.current = busy;
        setCallBusy(busy);
        if (busy) {
          edgeTtsService.stop();
          finishRef.current?.();
        }
        listenerRef.current?.setPaused(busy || isSpeakingRef.current);
        eyeInputRef.current.happy = c.state === 'active';
      }),
    []
  );

  // Ko'rinmas operator kirishi: o'ng yuqori burchakni 3 soniya bosib turish
  const hiddenPressRef = useRef<number | null>(null);
  const startHiddenPress = useCallback(() => {
    if (hiddenPressRef.current) window.clearTimeout(hiddenPressRef.current);
    hiddenPressRef.current = window.setTimeout(() => {
      hiddenPressRef.current = null;
      tacticalAudio.playClick();
      onUnlockRequest();
    }, 3000);
  }, [onUnlockRequest]);
  const cancelHiddenPress = useCallback(() => {
    if (hiddenPressRef.current) window.clearTimeout(hiddenPressRef.current);
    hiddenPressRef.current = null;
  }, []);

  // ==========================================================================
  // OLD KAMERA ORQALI INSON YUZINI KUZATISH VA TANISH
  // ==========================================================================
  useEffect(() => {
    const input = eyeInputRef.current;
    // Dispetcher (operator) qurilmasi o'z kamerasini ochmaydi: tasvir faqat robot planshetidan keladi
    if (!cameraActive || camRole !== 'robot') {
      input.hasFace = false;
      input.happy = false;
      return;
    }

    let stream: MediaStream | null = null;
    let trackInterval: number | null = null;
    let annotated: AnnotatedStream | null = null;

    const startCamera = async () => {
      try {
        // Operator HUD bilan bir xil o'lcham: past o'lchamda yuz kichik chiqib, descriptor noaniq bo'lardi
        // Sozlamalarda tanlangan Face ID kamerasi (frontal yoki USB web-kamera)
        stream = await faceCameraSettings.open();

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

        // Kamera tasviri avtomatik yoziladi: tanlangan disk papkasiga (1 GB) yoki brauzer xotirasiga (100 MB).
        // Yozuvga yuz identifikatsiya ramkalari (ism yoki "Piyoda") va sana-vaqt ham chiziladi
        let recBoxes: { boxes: OverlayBox[]; t: number } = { boxes: [], t: 0 };
        annotated = videoRef.current
          ? createAnnotatedStream(videoRef.current, {
              title: 'QALQON ROBOT',
              mirror: () => false,
              // 1.5 s dan eski natija chizilmaydi (odam ketgan bo'lsa ramka qolib ketmasin)
              getBoxes: () => (Date.now() - recBoxes.t < 1500 ? recBoxes.boxes : [])
            })
          : null;
        nvrRecordingService.startRecording(annotated?.stream ?? stream);
        // Operatorlarga uzatish (dispetcher markazi shu tasvirni kuzatadi)
        robotCamBroadcaster.setSource(stream);

        // ------------------------------------------------------------------
        // Operator HUD dagi Face ID texnologiyasi (faceRecognitionService.identifyPeople):
        // - jonli detektor sozlamasi (416, 0.5) va aksessuarli shablonlar (ko'zoynak, niqob, bosh kiyim)
        // - qat'iy chegaralar (0.5 / 0.4) va eng yaqin ikki shaxs orasidagi farq tekshiruvi
        // - iz (track) bo'yicha ovoz berish: oxirgi 5 kadrdan 3 tasi bir xil shaxs bo'lsagina ism chiqadi
        // - kameraga juda yaqin yuz (kadr kichraytiriladi) va past baholi yuzlarni qayta qidirish
        // Qulf ekranida COCO yo'q, shuning uchun butun kadr bitta "odam ramkasi" sifatida beriladi.
        // ------------------------------------------------------------------
        // Salom berish mumkinmi: avto-salom yoqilgan, suhbat yo'q, oxirgi salomdan keyin yetarli vaqt o'tgan
        const canGreet = (id: string, nowMs: number) => {
          if (!autoGreetRef.current || processingRef.current) return false;
          if (nowMs - lastConversationRef.current < 30000) return false;
          if (nowMs - lastGreetTimeRef.current < GREET_ANY_MS) return false;
          const last = greetLogRef.current.get(id) ?? 0;
          return nowMs - last >= (id === 'stranger' ? GREET_STRANGER_MS : GREET_SAME_PERSON_MS);
        };
        const markGreeted = (id: string, nowMs: number) => {
          lastGreetTimeRef.current = nowMs;
          greetLogRef.current.set(id, nowMs);
        };

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
            recBoxes = {
              t: Date.now(),
              boxes: withFace
                .filter((i) => i.faceBox)
                .map((i) => ({
                  x: i.faceBox!.x / vW,
                  y: i.faceBox!.y / vH,
                  w: i.faceBox!.width / vW,
                  h: i.faceBox!.height / vH,
                  color: i.person ? i.person.color : faceCycles >= STRANGER_AFTER_CYCLES ? '#f59e0b' : '#94a3b8',
                  label: i.person
                    ? `${i.person.fullName}${i.confidence ? ` ${(i.confidence * 100).toFixed(0)}%` : ''}`
                    : faceCycles >= STRANGER_AFTER_CYCLES ? 'Piyoda' : 'Tekshirilmoqda'
                }))
            };
            // Operatorlar ekranidagi ramkalar (ism yoki "Piyoda")
            const faced = withFace.filter((i) => i.faceBox);
            robotCamBroadcaster.setBoxes(
              recBoxes.boxes.map((b, k) => ({ ...b, kind: 'person' as const, identified: !!faced[k]?.person, conf: faced[k]?.confidence ?? undefined }))
            );
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
                if (canGreet(main.person.id, nowMs)) {
                  markGreeted(main.person.id, nowMs);
                  // To'liq ism: "Qo'ldoshev Sarvar" da birinchi so'z familiya. Tayyor Sardor audiosi ism bo'yicha tanlanadi
                  speakRef.current(`Assalomu alaykum ${main.person.fullName}! QALQON tizimi shaxsingizni tasdiqladi.`);
                }
              } else if (faceCycles >= STRANGER_AFTER_CYCLES) {
                input.happy = false;

                // Kamera asosida istalgan inson/piyoda ko'ringanda avtomatik salomlashish va og'iz qimirlashi
                if (canGreet('stranger', nowMs)) {
                  markGreeted('stranger', nowMs);
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
      annotated?.stop();
      robotCamBroadcaster.clearSource(stream);
      robotCamBroadcaster.setBoxes([]);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      input.hasFace = false;
      input.happy = false;
    };
  }, [cameraActive, camRole, faceCamChoice]);

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

      {/* Yuz ekranida faqat robot yuzi va "102" tugmasi. Operator paneli: o'ng yuqori burchakni 3 soniya bosib turish
          (ko'rinmas). Admin va pult: sayt manzili oxiriga #admin yoki #controller */}
      <div
        onPointerDown={startHiddenPress}
        onPointerUp={cancelHiddenPress}
        onPointerLeave={cancelHiddenPress}
        onPointerCancel={cancelHiddenPress}
        aria-hidden
        className="absolute top-0 right-0 w-24 h-24 z-30"
      />

      {/* 102: barcha operatorlarga ovozli chaqiruv (yana bosilsa tugatiladi) */}
      <div className="absolute bottom-6 sm:bottom-10 left-0 right-0 z-30 flex justify-center pointer-events-none">
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleUnlockAudio();
            if (call.state === 'ringing' || call.state === 'active') robotCall.hangup();
            else {
              // Mikrofonni avval tinglash funksiyasidan bo'shatamiz, keyin suhbat uchun ochamiz
              listenerRef.current?.stop();
              listenerRef.current = null;
              void robotCall.ring();
            }
          }}
          aria-label={call.state === 'active' ? '102: operator bilan suhbat (tugatish)' : call.state === 'ringing' ? '102: operator chaqirilmoqda (bekor qilish)' : '102: operatorga ulanish'}
          className={`pointer-events-auto w-32 h-32 sm:w-36 sm:h-36 rounded-full font-mono font-black text-5xl sm:text-6xl text-white border-4 transition-transform active:scale-95 select-none ${
            call.state === 'active'
              ? 'bg-emerald-600 border-emerald-300 shadow-[0_0_40px_rgba(16,185,129,0.7)]'
              : call.state === 'ringing'
              ? 'bg-red-600 border-red-300 call-102-ring'
              : 'bg-red-700 border-red-400/80 shadow-[0_0_30px_rgba(239,68,68,0.45)] hover:bg-red-600'
          }`}
        >
          102
        </button>
      </div>
    </div>
  );
};
