import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Lock, Unlock, Camera, CameraOff, Volume2, ShieldCheck, Mic } from 'lucide-react';
import { SpeechToSpeechModal } from './SpeechToSpeechModal';
import { faceRecognitionService } from '../services/faceRecognitionService';
import { tacticalAudio } from '../services/audioService';
import { edgeTtsService } from '../services/edgeTtsService';
import { RobotAvatar, type EyeInput } from './RobotAvatar';

interface RobotFaceViewProps {
  onUnlockRequest: () => void;
  /** Ikkinchi planshetdan masofaviy admin kirishi */
  onAdminRequest?: () => void;
}

export const RobotFaceView: React.FC<RobotFaceViewProps> = ({ onUnlockRequest, onAdminRequest }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraActive, setCameraActive] = useState<boolean>(true);
  const [isFaceDetected, setIsFaceDetected] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [speechSubtitle, setSpeechSubtitle] = useState<string>('');
  const [s2sModalOpen, setS2sModalOpen] = useState<boolean>(false);
  const [autoGreetEnabled, setAutoGreetEnabled] = useState<boolean>(true);
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);
  const lastGreetTimeRef = useRef<number>(0);
  const lastGreetedIdRef = useRef<string | null>(null);
  const [recognizedPerson, setRecognizedPerson] = useState<{
    fullName: string;
    role: string;
    color: string;
    isIdentified: boolean;
    confidence: number;
  } | null>(null);

  // Ko'zlar shu ref dan o'qiydi (har kadrda React qayta chizilmaydi)
  const eyeInputRef = useRef<EyeInput>({ faceX: 0, faceY: 0, hasFace: false, speech: 0, happy: false });

  // Yuz bazasi va neyron modellarini fonda tayyorlash (yengil: shader isitishsiz)
  useEffect(() => {
    faceRecognitionService.initDatabase().catch(err => {
      console.warn('[RobotFaceView] faceRecognitionService init error:', err);
    });
  }, []);

  // ==========================================================================
  // AI OVOZIGA MOS NUTQ (Edge TTS Sardor 1x). Ko'zlar nutq ritmiga javob beradi
  // ==========================================================================
  const speakDemoPhrase = useCallback((phraseText: string) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    setSpeechSubtitle(phraseText);
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
      setIsSpeaking(false);
      setSpeechSubtitle('');
    };

    edgeTtsService.speak(phraseText, { voice: 'uz-UZ-SardorNeural', rate: 1.0 }, undefined, finish);
  }, [isSpeaking]);

  const handleUnlockAudio = useCallback(() => {
    setAudioUnlocked(true);
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
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 320 },
            height: { ideal: 240 }
          },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (pErr: unknown) {
            const errName = pErr instanceof Error ? pErr.name : '';
            if (errName !== 'AbortError') throw pErr;
          }
        }

        let isBusyDetecting = false;
        trackInterval = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2 || isBusyDetecting) return;
          isBusyDetecting = true;

          try {
            const detectedFaces = await faceRecognitionService.detectFacesInVideo(videoRef.current);
            if (detectedFaces && detectedFaces.length > 0) {
              const face = detectedFaces[0];
              const vW = videoRef.current.videoWidth || 320;
              const vH = videoRef.current.videoHeight || 240;

              const normX = (face.box.x + face.box.width / 2) / vW;
              const normY = (face.box.y + face.box.height / 2) / vH;
              // Oyna inversiyasi: odam o'ng tomonga o'tsa, ko'zlar ham o'ng tomonga qaraydi
              input.faceX = (1.0 - normX - 0.5) * 2;
              input.faceY = (normY - 0.5) * 2;
              input.hasFace = true;
              setIsFaceDetected(true);

              const matchResult = faceRecognitionService.matchFace(face.descriptor);
              const nowMs = Date.now();

              if (matchResult.isIdentified && matchResult.person) {
                input.happy = true;
                setRecognizedPerson({
                  fullName: matchResult.person.fullName,
                  role: matchResult.person.role,
                  color: matchResult.person.color || '#4ade80',
                  isIdentified: true,
                  confidence: matchResult.confidence
                });

                // Kamera asosida tanilgan xodim bilan salomlashish
                if (autoGreetEnabled && (lastGreetedIdRef.current !== matchResult.person.id || nowMs - lastGreetTimeRef.current > 18000)) {
                  lastGreetedIdRef.current = matchResult.person.id;
                  lastGreetTimeRef.current = nowMs;
                  const firstName = matchResult.person.fullName.split(' ')[0] || matchResult.person.fullName;
                  speakRef.current(`Assalomu alaykum ${firstName}! QALQON tizimi shaxsingizni tasdiqladi.`);
                }
              } else {
                input.happy = false;
                setRecognizedPerson({
                  fullName: 'Piyoda / Fuqaro',
                  role: 'Jamoat xavfsizligi hududi',
                  color: '#5ad1e6',
                  isIdentified: false,
                  confidence: Math.min(0.98, Math.max(0.70, +face.score.toFixed(2)))
                });

                // Kamera asosida istalgan inson/piyoda ko'ringanda avtomatik salomlashish va og'iz qimirlashi
                if (autoGreetEnabled && (lastGreetedIdRef.current !== 'stranger' || nowMs - lastGreetTimeRef.current > 18000)) {
                  lastGreetedIdRef.current = 'stranger';
                  lastGreetTimeRef.current = nowMs;
                  speakRef.current("Assalomu alaykum! Men QALQON avtonom patrul robotiman. Jamoat xavfsizligini ta'minlashga tayyorman!");
                }
              }
              return;
            }

            // Yuz yo'q: ko'zlar yana o'zi atrofga qaraydi
            input.hasFace = false;
            input.happy = false;
            setIsFaceDetected(false);
            setRecognizedPerson(null);
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
        console.warn("Front kamera ochilmadi (foydalanuvchi rad etgan yoki qurilmada yo'q):", err);
        setCameraActive(false);
        setIsFaceDetected(false);
      }
    };

    startCamera();

    return () => {
      if (trackInterval) clearInterval(trackInterval);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      input.hasFace = false;
      input.happy = false;
    };
  }, [cameraActive]);

  const statusText = isFaceDetected
    ? 'Yuz kuzatilmoqda'
    : cameraActive
    ? 'Atrof kuzatilmoqda'
    : "Kamera o'chiq, kursor va teginishga javob beradi";

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

      {/* Yuqori chap: holat yoki tanilgan shaxs */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        {recognizedPerson ? (
          <div className="flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-xl bg-tactical-900 border border-tactical-700 animate-fade-in">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">{recognizedPerson.fullName}</span>
                {recognizedPerson.isIdentified && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-police-green/15 text-police-green">
                    Tasdiqlandi
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-400">
                {recognizedPerson.role}
                {recognizedPerson.confidence ? `, ${(recognizedPerson.confidence * 100).toFixed(0)}%` : ''}
              </span>
            </div>
            {recognizedPerson.isIdentified && (
              <button
                onClick={() => {
                  tacticalAudio.playCommandBeep();
                  onUnlockRequest();
                }}
                className="px-3 py-1.5 rounded-lg bg-police-cyan text-tactical-950 text-xs font-semibold flex items-center gap-1.5 transition-transform active:scale-95"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Panelga kirish</span>
              </button>
            )}
          </div>
        ) : (
          <div className="px-3 py-1.5 rounded-xl bg-tactical-900 border border-tactical-700 text-xs text-slate-300">
            {statusText}
          </div>
        )}
      </div>

      {/* Ovozni faollashtirish eslatmasi (Autoplay ruxsati) */}
      {!audioUnlocked && (
        <button
          onClick={handleUnlockAudio}
          className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-full bg-police-blue/30 border border-police-cyan/60 text-police-cyan text-xs font-mono font-bold animate-pulse flex items-center space-x-1.5 shadow-lg backdrop-blur-md"
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span>Ovozni to'liq faollashtirish uchun ekranga bosing</span>
        </button>
      )}

      {/* Nutq subtitri va og'iz animatsiyasi ko'rsatkichi */}
      {speechSubtitle && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 max-w-lg w-[90%] px-5 py-3 rounded-2xl bg-tactical-900/95 border border-police-cyan/60 text-center shadow-2xl backdrop-blur-md animate-fade-in flex flex-col items-center space-y-1">
          <div className="flex items-center space-x-2 text-police-cyan font-mono text-[11px] font-bold">
            <span className="w-2 h-2 rounded-full bg-police-cyan animate-ping"></span>
            <span>QALQON GAPIRMOQDA (Sardor 1.0x):</span>
          </div>
          <p className="text-sm font-semibold text-white tracking-wide leading-relaxed">{speechSubtitle}</p>
        </div>
      )}

      {/* Pastki tugmalar: kamera va ovozni sinash */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
        <button
          onClick={() => {
            tacticalAudio.playClick();
            setCameraActive(!cameraActive);
          }}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-transform active:scale-95 border ${
            cameraActive
              ? 'bg-police-blue text-white border-police-blue'
              : 'bg-tactical-900 text-slate-300 border-tactical-700 hover:bg-tactical-800'
          }`}
        >
          {cameraActive ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
          {cameraActive ? 'Kamera yoqilgan' : "Kamera o'chirilgan"}
        </button>

        <button
          onClick={() => {
            speakDemoPhrase("Assalomu alaykum! Men QALQON avtonom patrul robotiman. Jamoat xavfsizligini ta'minlashga tayyorman!");
          }}
          disabled={isSpeaking}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-tactical-900 text-slate-200 border border-tactical-700 hover:bg-tactical-800 transition-transform active:scale-95 disabled:opacity-50"
        >
          <Volume2 className="w-4 h-4" />
          Ovozni sinash
        </button>

        {/* Kamera asosida avto-gapirish tugmasi */}
        <button
          onClick={() => {
            tacticalAudio.playClick();
            setAutoGreetEnabled(!autoGreetEnabled);
          }}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-transform active:scale-95 border ${
            autoGreetEnabled
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
              : 'bg-tactical-900 text-slate-400 border-tactical-700'
          }`}
          title="Kamera insonni ko'rganda avtomatik salomlashish va og'iz qimirlashi"
        >
          <span className={`w-2 h-2 rounded-full ${autoGreetEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></span>
          <span>{autoGreetEnabled ? 'Avto-salom: FAOL' : "Avto-salom: O'CHIQ"}</span>
        </button>

        {/* O'zbekcha Speech-to-Speech Muloqot Tugmasi */}
        <button
          onClick={() => {
            tacticalAudio.playCommandBeep();
            setS2sModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-police-blue to-cyan-600 hover:from-blue-600 hover:to-cyan-500 text-white shadow-lg shadow-police-blue/20 transition-transform active:scale-95 border border-police-cyan/50 animate-pulse"
        >
          <Mic className="w-4 h-4 text-white" />
          <span>Ovozli muloqot (S2S)</span>
        </button>
      </div>

      {/* UzbekVoice.ai Speech-to-Speech Interaktiv Modali */}
      <SpeechToSpeechModal
        isOpen={s2sModalOpen}
        onClose={() => setS2sModalOpen(false)}
        onSpeechActivity={(level) => {
          eyeInputRef.current.speech = level;
        }}
      />

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
