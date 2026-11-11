import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  Square,
  Sparkles,
  Volume2,
  Keyboard,
  Send,
  X,
  AlertCircle,
  Bot
} from 'lucide-react';
import { aiDialogService } from '../services/aiDialogService';
import { tacticalAudio } from '../services/audioService';

export interface JarVoiceOrbProps {
  /** Real vaqtda og'iz harakatini boshqarish uchun audio balandligi (0..1) */
  onSpeechLevel?: (level: number) => void;
  /** Qo'shimcha CSS klasslar */
  className?: string;
}

export type OrbState = 'idle' | 'recording' | 'thinking' | 'speaking';

export const JarVoiceOrb: React.FC<JarVoiceOrbProps> = ({ onSpeechLevel, className = '' }) => {
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [statusText, setStatusText] = useState<string>("Bosing va gapiring");
  const [subtitle, setSubtitle] = useState<{
    question: string;
    answer: string;
    source?: string;
  } | null>(null);

  const [textModeOpen, setTextModeOpen] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio / Recording refs
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        void audioContextRef.current.close();
      }
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.src = '';
      }
    };
  }, []);

  // Real vaqtda mikrofon ovoz darajasini o'lchash (orb kattalashadi)
  const trackMicLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || !orbRef.current) return;

    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    let maxDev = 0;
    for (let i = 0; i < data.length; i++) {
      const dev = Math.abs(data[i] - 128);
      if (dev > maxDev) maxDev = dev;
    }

    const scale = 1 + (maxDev / 128) * 0.45;
    orbRef.current.style.transform = `scale(${scale.toFixed(3)})`;
    animFrameRef.current = requestAnimationFrame(trackMicLevel);
  }, []);

  // Lola TTS audio ijrosi paytida og'iz va orb animatsiyasi
  const playLolaAudio = useCallback(async (audioUrl: string) => {
    try {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current = null;
      }

      setOrbState('speaking');
      setStatusText("Lola javob bermoqda… (to'xtatish uchun bosing)");

      // CORS cheklovlarini chetlab o'tish uchun Blob URL yaratish
      let playableUrl = audioUrl;
      try {
        const resp = await fetch(audioUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          playableUrl = URL.createObjectURL(blob);
        }
      } catch (blobErr) {
        console.warn('[JarVoiceOrb] Blob fetch ogohlantirish:', blobErr);
      }

      const audio = new Audio(playableUrl);
      audioElementRef.current = audio;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const sourceNode = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      sourceNode.connect(analyser);
      analyser.connect(ctx.destination);

      const freqData = new Uint8Array(analyser.frequencyBinCount);

      const trackPlayback = () => {
        if (!audioElementRef.current || audioElementRef.current.paused || audioElementRef.current.ended) {
          onSpeechLevel?.(0);
          if (orbRef.current) orbRef.current.style.transform = 'scale(1)';
          return;
        }

        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) {
          sum += freqData[i];
        }
        const avg = sum / freqData.length;
        const normLevel = Math.min(1, avg / 65);

        onSpeechLevel?.(normLevel);

        if (orbRef.current) {
          orbRef.current.style.transform = `scale(${(1 + normLevel * 0.25).toFixed(3)})`;
        }

        requestAnimationFrame(trackPlayback);
      };

      audio.onplay = () => {
        requestAnimationFrame(trackPlayback);
      };

      audio.onended = () => {
        onSpeechLevel?.(0);
        if (orbRef.current) orbRef.current.style.transform = 'scale(1)';
        setOrbState('idle');
        setStatusText("Bosing va gapiring");
        void ctx.close();
      };

      audio.onerror = (e) => {
        console.warn('[JarVoiceOrb] Audio ijro xatosi:', e);
        onSpeechLevel?.(0);
        if (orbRef.current) orbRef.current.style.transform = 'scale(1)';
        setOrbState('idle');
        setStatusText("Bosing va gapiring");
        void ctx.close();
      };

      await audio.play();
    } catch (err) {
      console.warn('[JarVoiceOrb] Audio ijro etishda xato:', err);
      onSpeechLevel?.(0);
      setOrbState('idle');
      setStatusText("Bosing va gapiring");
    }
  }, [onSpeechLevel]);

  // Audio Blob ni yuborish va Claude Sonnet 5.5 + Lola TTS natijasini olish
  const processAudio = useCallback(async (audioBlob: Blob) => {
    setOrbState('thinking');
    setStatusText("O'ylayapman… (Claude Sonnet 5.5 + Web Search)");
    setErrorMessage(null);

    try {
      const res = await aiDialogService.askVoice(audioBlob);
      setSubtitle({
        question: res.question,
        answer: res.answer,
        source: res.source
      });

      if (res.audioUrl) {
        await playLolaAudio(res.audioUrl);
      } else {
        setOrbState('idle');
        setStatusText("Bosing va gapiring");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[JarVoiceOrb] Xatolik:', err);
      setErrorMessage(msg);
      setOrbState('idle');
      setStatusText("Bosing va gapiring");
      tacticalAudio.playObstacleAlert();
    }
  }, [playLolaAudio]);

  // Yozib olishni boshlash
  const startRecording = async () => {
    setErrorMessage(null);
    try {
      tacticalAudio.playClick();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (orbRef.current) orbRef.current.style.transform = 'scale(1)';

        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();

        const recordedBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        void processAudio(recordedBlob);
      };

      recorder.start(100);
      setOrbState('recording');
      setStatusText("Eshityapman… (tugatish uchun bosing)");
      trackMicLevel();
    } catch (err: unknown) {
      console.error('[JarVoiceOrb] Mikrofon ruxsati olinmadi:', err);
      setErrorMessage("Mikrofon ruxsati berilmadi. Iltimos, brauzer sozlamalaridan mikrofonni yoqing.");
      setOrbState('idle');
      setStatusText("Mikrofon ruxsati kerak");
      tacticalAudio.playObstacleAlert();
    }
  };

  // Yozib olishni to'xtatish
  const stopRecording = () => {
    tacticalAudio.playCommandBeep();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  // Orb tugmasini bosish
  const handleOrbClick = () => {
    // 1. Agar gapirayotgan bo'lsa, to'xtatish
    if (orbState === 'speaking') {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current = null;
      }
      onSpeechLevel?.(0);
      if (orbRef.current) orbRef.current.style.transform = 'scale(1)';
      setOrbState('idle');
      setStatusText("Bosing va gapiring");
      tacticalAudio.playClick();
      return;
    }

    // 2. Agar yozayotgan bo'lsa, to'xtatish
    if (orbState === 'recording') {
      stopRecording();
      return;
    }

    // 3. Agar o'ylanayotgan bo'lsa, kutamiz
    if (orbState === 'thinking') {
      return;
    }

    // 4. Idle bo'lsa, yozib olishni boshlash
    void startRecording();
  };

  // Matn orqali savol berish
  const handleTextSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const prompt = textInput.trim();
    if (!prompt) return;

    setTextInput('');
    setTextModeOpen(false);
    setOrbState('thinking');
    setStatusText("O'ylayapman… (Claude Sonnet 5.5 + Web Search)");
    setErrorMessage(null);

    try {
      const res = await aiDialogService.respond(prompt);
      setSubtitle({
        question: prompt,
        answer: res.answer,
        source: res.source
      });

      if (res.audioUrl) {
        await playLolaAudio(res.audioUrl);
      } else {
        setOrbState('idle');
        setStatusText("Bosing va gapiring");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[JarVoiceOrb] Matnli savol xatosi:', err);
      setErrorMessage(msg);
      setOrbState('idle');
      setStatusText("Bosing va gapiring");
    }
  };

  // Namuna savollarni tanlash
  const handleQuickChip = (prompt: string) => {
    setTextInput(prompt);
    void (async () => {
      setTextModeOpen(false);
      setOrbState('thinking');
      setStatusText("O'ylayapman… (Claude Sonnet 5.5 + Web Search)");
      setErrorMessage(null);

      try {
        const res = await aiDialogService.respond(prompt);
        setSubtitle({
          question: prompt,
          answer: res.answer,
          source: res.source
        });

        if (res.audioUrl) {
          await playLolaAudio(res.audioUrl);
        } else {
          setOrbState('idle');
          setStatusText("Bosing va gapiring");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg);
        setOrbState('idle');
        setStatusText("Bosing va gapiring");
      }
    })();
  };

  return (
    <div className={`relative flex flex-col items-center select-none ${className}`}>
      {/* Subtitr / Jonli Muloqot Kartasi */}
      {subtitle && (
        <div className="w-full max-w-xl mb-4 bg-slate-950/90 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-4 shadow-[0_10px_35px_rgba(0,0,0,0.6)] animate-fade-in relative z-40">
          <div className="flex items-center justify-between border-b border-cyan-900/40 pb-2 mb-2.5">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded-lg bg-cyan-500/20 flex items-center justify-center border border-cyan-500/40">
                <Bot className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <span className="font-mono text-xs font-semibold text-cyan-300 tracking-wide">
                QALQON MULOQOT
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950/80 text-cyan-400 border border-cyan-500/30">
                Claude Sonnet 5.5 • Web Search
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-500/30">
                Lola TTS
              </span>
            </div>
            <button
              onClick={() => setSubtitle(null)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              title="Yopish"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2 text-sm leading-relaxed">
            <div className="flex items-start space-x-2 text-slate-300">
              <span className="text-cyan-400 font-semibold shrink-0 text-xs mt-0.5">Siz:</span>
              <p className="italic font-sans text-slate-200">"{subtitle.question}"</p>
            </div>
            <div className="flex items-start space-x-2 text-white pt-1">
              <span className="text-emerald-400 font-semibold shrink-0 text-xs mt-0.5">QALQON:</span>
              <p className="font-sans text-slate-100 font-medium">{subtitle.answer}</p>
            </div>
          </div>
        </div>
      )}

      {/* Xatolik xabari */}
      {errorMessage && (
        <div className="w-full max-w-md mb-3 px-3 py-2 bg-rose-950/80 border border-rose-500/40 rounded-xl text-rose-200 text-xs flex items-center space-x-2 shadow-lg animate-fade-in z-40">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="flex-1">{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Tezkor Savol Tugmalari (Idle paytida) */}
      {orbState === 'idle' && !textModeOpen && (
        <div className="flex flex-wrap items-center justify-center gap-2 mb-4 max-w-lg z-30 px-2">
          <button
            onClick={() => handleQuickChip("Bugun Toshkentda ob-havo qanday?")}
            className="px-3 py-1.5 rounded-full text-xs font-mono bg-slate-900/80 hover:bg-cyan-950 border border-cyan-800/50 hover:border-cyan-400 text-cyan-300 transition-all active:scale-95 shadow-md"
          >
            ⛅ Ob-havo qanday?
          </button>
          <button
            onClick={() => handleQuickChip("Yo'l harakati qoidalarida tezlikni oshirganlik uchun jarima qancha?")}
            className="px-3 py-1.5 rounded-full text-xs font-mono bg-slate-900/80 hover:bg-cyan-950 border border-cyan-800/50 hover:border-cyan-400 text-cyan-300 transition-all active:scale-95 shadow-md"
          >
            🚗 Tezlik oshirish jarimasi
          </button>
          <button
            onClick={() => handleQuickChip("Ichki ishlar xodimining fuqaro oldidagi asosiy majburiyatlari nimalardan iborat?")}
            className="px-3 py-1.5 rounded-full text-xs font-mono bg-slate-900/80 hover:bg-cyan-950 border border-cyan-800/50 hover:border-cyan-400 text-cyan-300 transition-all active:scale-95 shadow-md"
          >
            ⚖️ IIV xodimi majburiyati
          </button>
        </div>
      )}

      {/* Matnli kiritish paneli (Keyboard Mode) */}
      {textModeOpen && (
        <form
          onSubmit={handleTextSubmit}
          className="w-full max-w-md mb-4 flex items-center space-x-2 bg-slate-900/90 border border-cyan-500/40 rounded-2xl p-2 shadow-2xl z-40 backdrop-blur-md animate-fade-in"
        >
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Savolingizni yozing (Claude Sonnet 5.5 javob beradi)..."
            className="flex-1 bg-transparent px-3 py-1.5 text-sm text-white placeholder-slate-400 focus:outline-none font-sans"
            autoFocus
          />
          <button
            type="submit"
            disabled={!textInput.trim()}
            className="p-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-xl transition-all"
            title="Yuborish"
          >
            <Send className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setTextModeOpen(false)}
            className="p-2 text-slate-400 hover:text-white rounded-xl transition-all"
            title="Yopish"
          >
            <X className="w-4 h-4" />
          </button>
        </form>
      )}

      {/* ASOSIY OVOZLI ORB TUGMASI (jar loyihasining #orb uslubi) */}
      <div className="relative flex items-center justify-center z-30">
        {/* Klaviatura rejimi tugmasi */}
        <button
          onClick={() => setTextModeOpen(!textModeOpen)}
          title={textModeOpen ? "Ovozli rejimga qaytish" : "Matn orqali savol berish"}
          className="absolute -left-16 sm:-left-20 p-3 rounded-full bg-slate-900/90 border border-slate-700/80 text-slate-300 hover:text-cyan-300 hover:border-cyan-500 transition-transform active:scale-90 shadow-xl"
        >
          <Keyboard className="w-5 h-5" />
        </button>

        {/* Jar Orb Tugmasi */}
        <button
          ref={orbRef}
          onClick={handleOrbClick}
          aria-label={statusText}
          className={`
            relative w-28 h-28 sm:w-32 sm:h-32 rounded-full border-0 cursor-pointer
            flex items-center justify-center transition-all duration-200
            ${
              orbState === 'idle'
                ? 'bg-[radial-gradient(circle_at_35%_30%,#7aa7ff,#3b4fd8_60%,#1a1f5c)] shadow-[0_0_45px_rgba(59,79,216,0.55)] hover:shadow-[0_0_60px_rgba(59,79,216,0.8)] active:scale-95'
                : orbState === 'recording'
                ? 'bg-[radial-gradient(circle_at_35%_30%,#ff9aa8,#d83b5a_60%,#5c1a2a)] shadow-[0_0_55px_rgba(216,59,90,0.85)] animate-pulse'
                : orbState === 'thinking'
                ? 'bg-[radial-gradient(circle_at_35%_30%,#c4b5fd,#6366f1_60%,#312e81)] shadow-[0_0_55px_rgba(99,102,241,0.85)] animate-pulse'
                : 'bg-[radial-gradient(circle_at_35%_30%,#8bffc8,#2fbf8a_60%,#14503c)] shadow-[0_0_55px_rgba(47,191,138,0.85)] animate-pulse'
            }
          `}
        >
          {/* Ichki Ikonka */}
          {orbState === 'idle' && <Mic className="w-12 h-12 text-white drop-shadow-md" />}
          {orbState === 'recording' && <Square className="w-10 h-10 text-white fill-white drop-shadow-md" />}
          {orbState === 'thinking' && <Sparkles className="w-11 h-11 text-white animate-spin drop-shadow-md" />}
          {orbState === 'speaking' && <Volume2 className="w-12 h-12 text-white drop-shadow-md" />}

          {/* Tashqi aylanma halqa (Thinking paytida) */}
          {orbState === 'thinking' && (
            <div className="absolute inset-0 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
          )}
        </button>
      </div>

      {/* Holat Matni */}
      <div className="mt-3 font-sans text-sm sm:text-base font-semibold text-slate-200 tracking-wide text-center drop-shadow-md z-30">
        {statusText}
      </div>

      {/* Model haqida ma'lumot */}
      <div className="mt-1 font-mono text-[11px] text-slate-400 flex items-center space-x-2 z-30">
        <span>UzbekVoice STT</span>
        <span>•</span>
        <span className="text-cyan-400">Claude Sonnet 5.5 (Web)</span>
        <span>•</span>
        <span>Lola TTS</span>
      </div>
    </div>
  );
};
