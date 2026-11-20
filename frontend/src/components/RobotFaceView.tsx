import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Lock, ScanFace, PhoneCall, PhoneOff, X, Bot, Sparkles } from 'lucide-react';
import { robotCall, type CallInfo } from '../services/voiceCall';
import { faceRecognitionService, type PersonIdentity } from '../services/faceRecognitionService';
import { aiDialogService } from '../services/aiDialogService';
import { tacticalAudio } from '../services/audioService';
import { LolaWaveCanvas, type LolaWaveState } from './LolaWaveCanvas';
import { robotCamBroadcaster } from '../services/robotCamLink';
import { faceCameraSettings } from '../services/faceCameraSettings';

interface RobotFaceViewProps {
  onUnlockRequest: () => void;
  /** Ikkinchi planshetdan masofaviy admin kirishi */
  onAdminRequest?: () => void;
  /** ESP32 masofaviy boshqaruv pultini ochish */
  onControllerRequest?: () => void;
}

export const RobotFaceView: React.FC<RobotFaceViewProps> = ({ onUnlockRequest }) => {
  // ---- 1. LOLA WAVE HOLATLARI (jarvis.nspi.uz uslubi) ----
  const [waveState, setWaveState] = useState<LolaWaveState>('sleep');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>("«Qalqon» deng yoki ekranga bosing");
  const [dialogCard, setDialogCard] = useState<{ question: string; answer: string } | null>(null);

  // ---- 2. 102 OPERATOR CHAQIRUVI ----
  const [call, setCall] = useState<CallInfo>(() => robotCall.getState());
  useEffect(() => robotCall.subscribe(setCall), []);

  // ---- 3. FACE ID ON-DEMAND (Faqat yoqilganda ishlaydi, CPU 0%) ----
  const [faceIdActive, setFaceIdActive] = useState<boolean>(false);
  const [detectedPerson, setDetectedPerson] = useState<string | null>(null);
  /** Face ID ochilmasa sababi (ekranda ko'rsatiladi) */
  const [faceIdError, setFaceIdError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const faceIntervalRef = useRef<number | null>(null);
  const faceStreamRef = useRef<MediaStream | null>(null);

  // ---- AUDIO / RECORDING REFS ----
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const isBusyRef = useRef<boolean>(false);

  // ---- TOZALASH ----
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (faceStreamRef.current) faceStreamRef.current.getTracks().forEach((t) => t.stop());
      if (faceIntervalRef.current) clearInterval(faceIntervalRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        void audioContextRef.current.close();
      }
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.src = '';
      }
    };
  }, []);

  // ==============================================================================
  // 1. LOLA TTS AUDIOSINI O'YNATISH VA TO'LQIN BILAN SINXRONLASHTIRISH
  // ==============================================================================
  const playLolaAudio = useCallback(async (audioUrl: string) => {
    try {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current = null;
      }

      setWaveState('speak');
      setStatusText("Lola javob bermoqda…");

      let playableUrl = audioUrl;
      try {
        const resp = await fetch(audioUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          playableUrl = URL.createObjectURL(blob);
        }
      } catch {
        /* Asl url ishlatiladi */
      }

      const audio = new Audio(playableUrl);
      audioElementRef.current = audio;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();

      const sourceNode = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      sourceNode.connect(analyser);
      analyser.connect(ctx.destination);

      const freqData = new Uint8Array(analyser.frequencyBinCount);

      const trackPlayback = () => {
        if (!audioElementRef.current || audioElementRef.current.paused || audioElementRef.current.ended) {
          setAudioLevel(0);
          return;
        }

        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) sum += freqData[i];
        const avg = sum / freqData.length;
        const normLevel = Math.min(1, avg / 60);

        setAudioLevel(normLevel);
        requestAnimationFrame(trackPlayback);
      };

      audio.onplay = () => requestAnimationFrame(trackPlayback);
      audio.onended = () => {
        setAudioLevel(0);
        setWaveState('sleep');
        setStatusText("«Qalqon» deng yoki ekranga bosing");
        isBusyRef.current = false;
        void ctx.close();
      };
      audio.onerror = () => {
        setAudioLevel(0);
        setWaveState('sleep');
        setStatusText("«Qalqon» deng yoki ekranga bosing");
        isBusyRef.current = false;
        void ctx.close();
      };

      await audio.play();
    } catch {
      setAudioLevel(0);
      setWaveState('sleep');
      setStatusText("«Qalqon» deng yoki ekranga bosing");
      isBusyRef.current = false;
    }
  }, []);

  // ==============================================================================
  // 2. SAVOLNI YUBORISH VA CLAUDE SONNET 5.5 + LOLA TTS JAVOBINI OLISH
  // ==============================================================================
  const processQuestion = useCallback(
    async (textOrBlob: string | Blob) => {
      isBusyRef.current = true;
      setWaveState('think');
      setStatusText("O'ylayapman… (Claude Sonnet 5.5 + Web Search)");

      try {
        let questionText = '';
        let answerText = '';
        let audioUrl: string | undefined;

        if (typeof textOrBlob === 'string') {
          questionText = textOrBlob;
          const res = await aiDialogService.respond(questionText);
          answerText = res.answer;
          audioUrl = res.audioUrl;
        } else {
          const res = await aiDialogService.askVoice(textOrBlob);
          questionText = res.question;
          answerText = res.answer;
          audioUrl = res.audioUrl;
        }

        setDialogCard({ question: questionText, answer: answerText });

        if (audioUrl) {
          await playLolaAudio(audioUrl);
        } else {
          setWaveState('sleep');
          setStatusText("«Qalqon» deng yoki ekranga bosing");
          isBusyRef.current = false;
        }
      } catch {
        setWaveState('sleep');
        setStatusText("«Qalqon» deng yoki ekranga bosing");
        isBusyRef.current = false;
      }
    },
    [playLolaAudio]
  );

  // ==============================================================================
  // 3. MIKROFON ORQALI OVOZ YOZIB OLISH (Faqat faollashganda)
  // ==============================================================================
  const stopRecording = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startListening = useCallback(async () => {
    if (isBusyRef.current) return;
    if (call.state === 'active' || call.state === 'ringing') return;

    // Agar Lola gapirayotgan bo'lsa, to'xtatish
    if (audioElementRef.current && !audioElementRef.current.paused) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
      setWaveState('sleep');
      setStatusText("«Qalqon» deng yoki ekranga bosing");
      return;
    }

    try {
      tacticalAudio.playCommandBeep();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume();

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const micSource = ctx.createMediaStreamSource(stream);
      micSource.connect(analyser);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        setAudioLevel(0);

        const recordedBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm'
        });
        if (recordedBlob.size > 2000) {
          void processQuestion(recordedBlob);
        } else {
          setWaveState('sleep');
          setStatusText("«Qalqon» deng yoki ekranga bosing");
        }
      };

      recorder.start(100);
      setWaveState('listen');
      setStatusText("🔴 Sizni eshityapman… (gapiring)");

      // Real vaqtda ovoz balandligini to'lqinga uzatish va jimlikni sezish
      let lastSpeechTime = performance.now();
      const data = new Uint8Array(analyser.fftSize);

      const trackMic = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return;
        analyser.getByteTimeDomainData(data);

        let maxDev = 0;
        for (let i = 0; i < data.length; i++) {
          const dev = Math.abs(data[i] - 128);
          if (dev > maxDev) maxDev = dev;
        }

        const normVol = Math.min(1, maxDev / 100);
        setAudioLevel(normVol);

        if (normVol > 0.08) {
          lastSpeechTime = performance.now();
        }

        // 1.8 soniya jimlik bo'lsa avtomatik to'xtatish
        if (performance.now() - lastSpeechTime > 1800) {
          stopRecording();
          return;
        }

        animFrameRef.current = requestAnimationFrame(trackMic);
      };

      animFrameRef.current = requestAnimationFrame(trackMic);
    } catch {
      setWaveState('sleep');
      setStatusText("Mikrofon ruxsati berilmadi");
    }
  }, [call.state, processQuestion, stopRecording]);

  // ==============================================================================
  // 4. «QALQON» KALIT SO'ZI KUZATUVCHISI (Web Speech API, yengil, 0% CPU)
  // ==============================================================================
  useEffect(() => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    if (!SpeechRec) return;

    let recognizer: any = null;
    let active = true;

    try {
      recognizer = new (SpeechRec as any)();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.lang = 'uz-UZ';

      recognizer.onresult = (e: any) => {
        if (isBusyRef.current || waveState !== 'sleep') return;

        for (let i = e.resultIndex; i < e.results.length; ++i) {
          const transcript = (e.results[i][0].transcript || '').toLowerCase().trim();
          if (transcript.includes('qalqon') || transcript.includes('qalkon')) {
            tacticalAudio.playCommandBeep();
            const afterWord = transcript.replace(/.*qalqon|.*qalkon/i, '').trim();
            if (afterWord.length > 3) {
              void processQuestion(afterWord);
            } else {
              void startListening();
            }
            break;
          }
        }
      };

      recognizer.onend = () => {
        if (active && waveState === 'sleep' && !isBusyRef.current) {
          try {
            recognizer.start();
          } catch {
            /* ignore */
          }
        }
      };

      recognizer.start();
    } catch {
      /* Web Speech API cheklovi */
    }

    return () => {
      active = false;
      if (recognizer) {
        try {
          recognizer.stop();
        } catch {
          /* ignore */
        }
      }
    };
  }, [waveState, processQuestion, startListening]);

  // ==============================================================================
  // 5. FACE ID ON-DEMAND (Faqat foydalanuvchi yoqqanda ishlaydi, NVR siz, 1.5s davr)
  // ==============================================================================
  useEffect(() => {
    if (!faceIdActive) {
      if (faceIntervalRef.current) clearInterval(faceIntervalRef.current);
      if (faceStreamRef.current) {
        faceStreamRef.current.getTracks().forEach((t) => t.stop());
        faceStreamRef.current = null;
      }
      setDetectedPerson(null);
      return;
    }

    let isBusy = false;

    let cancelled = false;
    const startFaceScanner = async () => {
      setFaceIdError(null);
      // Kamera faqat xavfsiz sahifada (https yoki localhost) ochiladi: http://<IP> da brauzer kamerani bermaydi
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setFaceIdError(
          `Kamera bu manzilda ochilmaydi (${location.protocol}//${location.host}): saytni https orqali oching (GitHub Pages)`
        );
        setFaceIdActive(false);
        return;
      }
      let stream: MediaStream;
      try {
        // Sozlamalarda tanlangan Face ID kamerasi (USB web-kamera yoki frontal), 640x480 — CPU tejash
        stream = await faceCameraSettings.open({ width: 640, height: 480 });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        setFaceIdError(
          name === 'NotAllowedError'
            ? "Kameraga ruxsat berilmagan: brauzer manzil satridagi qulf belgisi → Kamera → Ruxsat"
            : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'Kamera topilmadi: USB web-kamera ulanganini tekshiring'
            : name === 'NotReadableError'
            ? 'Kamera boshqa ilova yoki sahifa tomonidan band'
            : `Kamerani ochib bo'lmadi: ${e instanceof Error ? e.message : String(e)}`
        );
        setFaceIdActive(false);
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      try {
        faceStreamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // Operatorlarga kamera tasvirini uzatish (yozmasdan!)
        robotCamBroadcaster.setSource(stream);

        // Yuz modeli kamera ochilgandan keyin yuklanadi: model yuklanmasa ham tasvir ko'rinadi
        try {
          await faceRecognitionService.prepare();
        } catch (e) {
          setFaceIdError(`Yuz tanish modeli yuklanmadi: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        if (cancelled) return;

        // Har 1500 ms da bir marta yuzni tekshirish (120ms emas - CPU 90% tejaladi!)
        faceIntervalRef.current = window.setInterval(async () => {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || isBusy) return;
          isBusy = true;

          try {
            const vW = video.videoWidth;
            const vH = video.videoHeight;
            if (vW && vH) {
              const identities: PersonIdentity[] = await faceRecognitionService.identifyPeople(
                video,
                [{ x: 0, y: 0, width: vW, height: vH }],
                { voteMissingFace: false }
              );
              const found = identities.find((i) => i.person);
              if (found?.person) {
                setDetectedPerson(found.person.fullName);
              } else {
                setDetectedPerson(identities.some((i) => i.faceFound) ? 'Piyoda' : null);
              }
            }
          } catch {
            /* ignore */
          } finally {
            isBusy = false;
          }
        }, 1500);
      } catch (e) {
        setFaceIdError(`Face ID xatosi: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    void startFaceScanner();

    return () => {
      cancelled = true;
      if (faceIntervalRef.current) clearInterval(faceIntervalRef.current);
      const s = faceStreamRef.current;
      if (s) {
        robotCamBroadcaster.clearSource(s);
        s.getTracks().forEach((t) => t.stop());
        faceStreamRef.current = null;
      }
      setDetectedPerson(null);
    };
  }, [faceIdActive]);

  // ==============================================================================
  // 6. EKRANGA BOSGANDA OVOZNI ISHGA TUSHIRISH
  // ==============================================================================
  const handleTapWave = () => {
    if (waveState === 'listen') {
      stopRecording();
    } else if (waveState === 'speak') {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current = null;
      }
      setWaveState('sleep');
      setStatusText("«Qalqon» deng yoki ekranga bosing");
    } else if (waveState === 'sleep') {
      void startListening();
    }
  };

  return (
    <div className="relative w-full h-full bg-[#070a12] overflow-hidden select-none">
      {/* LOLA CANVAS TO'LQIN EFFEKTI (jarvis.nspi.uz) */}
      <LolaWaveCanvas state={waveState} audioLevel={audioLevel} onTap={handleTapWave} />

      {/* Yuzni aniqlash uchun ko'rinmas video elementi (faqat Face ID faol bo'lsa ochiladi) */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      {/* YUQORI BOSHQARUV PANELI: Face ID On-Demand & Operator Lock */}
      <div className="absolute top-4 left-4 right-4 z-40 flex items-center justify-between pointer-events-auto">
        {/* Face ID rejimini yoqish/o'chirish (On-Demand) */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              tacticalAudio.playClick();
              setFaceIdActive(!faceIdActive);
            }}
            title="Face ID rejimini yoqish/o'chirish (CPU tejash)"
            className={`px-3.5 py-2 rounded-xl font-mono text-xs font-semibold border flex items-center space-x-2 transition-all active:scale-95 shadow-lg backdrop-blur-md ${
              faceIdActive
                ? 'bg-emerald-950/90 border-emerald-500/80 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.35)]'
                : 'bg-slate-900/80 border-slate-700/80 text-slate-400 hover:text-slate-200 hover:border-slate-500'
            }`}
          >
            <ScanFace className="w-4 h-4" />
            <span>Face ID: {faceIdActive ? 'YONIQ' : "O'CHIQ"}</span>
          </button>

          {/* Tanilgan shaxs nishoni */}
          {faceIdActive && detectedPerson && (
            <div className="px-3 py-1.5 rounded-xl bg-cyan-950/80 border border-cyan-500/60 text-cyan-300 text-xs font-mono font-medium shadow-md backdrop-blur-md animate-fade-in flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span>{detectedPerson}</span>
            </div>
          )}

          {/* Kamera ochilmasa sababi */}
          {faceIdError && (
            <button
              onClick={() => setFaceIdError(null)}
              title="Yopish"
              className="max-w-md px-3 py-1.5 rounded-xl bg-rose-950/85 border border-rose-500/60 text-rose-200 text-xs font-medium text-left shadow-md backdrop-blur-md"
            >
              {faceIdError}
            </button>
          )}
        </div>

        {/* Operator paneliga kirish */}
        <button
          onClick={() => {
            tacticalAudio.playClick();
            onUnlockRequest();
          }}
          title="Operator paneli"
          aria-label="Operator paneli"
          className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-800 transition-transform active:scale-90 shadow-lg backdrop-blur-md"
        >
          <Lock className="w-4 h-4" />
        </button>
      </div>

      {/* MARKAZIY HOLAT VA MATN */}
      <div className="absolute top-20 sm:top-24 left-0 right-0 z-30 flex flex-col items-center pointer-events-none px-4">
        <div className="flex items-center space-x-2 px-4 py-1.5 rounded-full bg-slate-900/60 border border-slate-700/50 backdrop-blur-md">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span className="font-mono text-xs sm:text-sm text-slate-200 font-medium tracking-wide">
            {statusText}
          </span>
        </div>
      </div>

      {/* SUBTITR / JONLI MULOQOT KARTASI */}
      {dialogCard && (
        <div className="absolute top-36 sm:top-40 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-lg bg-slate-950/90 backdrop-blur-xl border border-cyan-500/40 rounded-2xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.7)] animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between border-b border-cyan-900/40 pb-2 mb-2">
            <div className="flex items-center space-x-2">
              <Bot className="w-4 h-4 text-cyan-400" />
              <span className="font-mono text-xs font-bold text-cyan-300">QALQON • Lola</span>
            </div>
            <button
              onClick={() => setDialogCard(null)}
              className="text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1.5 text-xs sm:text-sm">
            <p className="text-slate-300 italic font-sans">
              <span className="text-cyan-400 font-semibold not-italic">Siz:</span> "{dialogCard.question}"
            </p>
            <p className="text-slate-100 font-sans font-medium pt-1">
              <span className="text-emerald-400 font-semibold">Lola:</span> {dialogCard.answer}
            </p>
          </div>
        </div>
      )}

      {/* PASTKI O'NG QISM: 102 OPERATOR CHAQIRUV TUGMASI (Yengil va ixcham) */}
      <div className="absolute bottom-6 right-6 z-40 pointer-events-auto">
        <button
          onClick={() => {
            tacticalAudio.playClick();
            if (call.state === 'ringing' || call.state === 'active') robotCall.hangup();
            else robotCall.ring();
          }}
          title={call.state === 'active' ? '102: Qo‘ng‘iroqni tugatish' : '102: Operatorni chaqirish'}
          className={`flex items-center space-x-2 px-5 py-3 rounded-2xl font-mono font-bold text-base shadow-2xl transition-all active:scale-90 border-2 select-none ${
            call.state === 'active'
              ? 'bg-emerald-600 border-emerald-300 text-white shadow-[0_0_30px_rgba(16,185,129,0.6)] animate-pulse'
              : call.state === 'ringing'
              ? 'bg-rose-600 border-rose-300 text-white shadow-[0_0_30px_rgba(244,63,94,0.7)] animate-bounce'
              : 'bg-rose-700/90 hover:bg-rose-600 border-rose-500/80 text-white shadow-[0_0_20px_rgba(225,29,72,0.4)] backdrop-blur-md'
          }`}
        >
          {call.state === 'active' || call.state === 'ringing' ? (
            <PhoneOff className="w-5 h-5" />
          ) : (
            <PhoneCall className="w-5 h-5" />
          )}
          <span>102 {call.state === 'active' ? 'Faol' : call.state === 'ringing' ? 'Ulanmoqda' : 'Chaqiruv'}</span>
        </button>
      </div>

      {/* PASTKI CHAP QISM: Qalqon belgi */}
      <div className="absolute bottom-6 left-6 z-30 pointer-events-none opacity-60 font-mono text-[11px] text-slate-400">
        QALQON v1.0 • Lola Audio
      </div>
    </div>
  );
};
