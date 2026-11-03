import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Lock, Unlock, Camera, CameraOff, Volume2 } from 'lucide-react';
import { faceRecognitionService } from '../services/faceRecognitionService';
import { tacticalAudio } from '../services/audioService';
import { edgeTtsService } from '../services/edgeTtsService';
import { RobotAvatar, type EyeInput } from './RobotAvatar';

interface RobotFaceViewProps {
  onUnlockRequest: () => void;
}

export const RobotFaceView: React.FC<RobotFaceViewProps> = ({ onUnlockRequest }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraActive, setCameraActive] = useState<boolean>(true);
  const [isFaceDetected, setIsFaceDetected] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [speechSubtitle, setSpeechSubtitle] = useState<string>('');
  const [recognizedPerson, setRecognizedPerson] = useState<{
    fullName: string;
    role: string;
    color: string;
    isIdentified: boolean;
    confidence: number;
  } | null>(null);
  const greetedRef = useRef<string | null>(null);

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
      eyeInputRef.current.speech = 0.5 + Math.sin(speakTick * 0.8) * 0.4 + Math.random() * 0.2;
    }, 50);

    const finish = () => {
      clearInterval(speechTimer);
      eyeInputRef.current.speech = 0;
      setIsSpeaking(false);
      setSpeechSubtitle('');
    };

    edgeTtsService.speak(phraseText, { voice: 'uz-UZ-SardorNeural', rate: 1.0 }, undefined, finish);
  }, [isSpeaking]);

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
              if (matchResult.isIdentified && matchResult.person) {
                input.happy = true;
                setRecognizedPerson({
                  fullName: matchResult.person.fullName,
                  role: matchResult.person.role,
                  color: matchResult.person.color || '#4ade80',
                  isIdentified: true,
                  confidence: matchResult.confidence
                });

                if (greetedRef.current !== matchResult.person.id) {
                  greetedRef.current = matchResult.person.id;
                  const firstName = matchResult.person.fullName.split(' ')[0] || matchResult.person.fullName;
                  speakRef.current(`Assalomu alaykum ${firstName}! QALQON tizimi shaxsingizni tasdiqladi.`);
                }
              } else {
                input.happy = false;
                setRecognizedPerson({
                  fullName: 'Piyoda / Fuqaro',
                  role: 'Notanish shaxs',
                  color: '#5ad1e6',
                  isIdentified: false,
                  confidence: Math.min(0.98, Math.max(0.70, +face.score.toFixed(2)))
                });
              }
              return;
            }

            // Yuz yo'q: ko'zlar yana o'zi atrofga qaraydi
            input.hasFace = false;
            input.happy = false;
            setIsFaceDetected(false);
            setRecognizedPerson(null);
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
    <div className="relative w-full h-full bg-tactical-950 overflow-hidden select-none">
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

      {/* Nutq subtitri */}
      {speechSubtitle && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 max-w-lg px-5 py-2.5 rounded-xl bg-tactical-900 border border-tactical-700 text-center animate-fade-in">
          <p className="text-sm font-medium text-slate-100">{speechSubtitle}</p>
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
      </div>

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
