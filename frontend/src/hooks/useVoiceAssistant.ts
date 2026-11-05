import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { AssistantAnswer } from '../types/robot';
import {
  AssistantError,
  WakeWordListener,
  askAssistant,
  isSpeechRecognitionSupported,
  type ListenerState
} from '../services/assistantClient';
import { edgeTtsService } from '../services/edgeTtsService';
import { tacticalAudio } from '../services/audioService';
import type { EyeInput } from '../components/RobotAvatar';

export type AssistantUiState = 'off' | 'listening' | 'awaiting' | 'thinking' | 'speaking';

interface Options {
  /** Pi tomonidagi holat (yoqish/o'chirish paneldan boshqariladi) */
  enabled: boolean;
  /** Pi API manzili (masalan http://192.168.1.50:8000) */
  baseUrl: string;
  /** Avatar og'zi shu yerdan o'qiydi: haqiqiy ovoz balandligi yoziladi */
  eyeInputRef: MutableRefObject<EyeInput>;
}

const RESULT_VISIBLE_MS = 30000;

/**
 * Ovozli yordamchi oqimi: "Qalqon" so'zini tinglash -> savol -> Pi (lex.uz + Gemini) -> Sardor ovozi (mp3).
 * Robot gapirayotganda mikrofon to'xtatiladi (o'zini eshitmaslik uchun).
 */
export const useVoiceAssistant = ({ enabled, baseUrl, eyeInputRef }: Options) => {
  const [state, setState] = useState<AssistantUiState>('off');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const supported = isSpeechRecognitionSupported();

  const listenerRef = useRef<WakeWordListener | null>(null);
  const enabledRef = useRef(enabled);
  const baseUrlRef = useRef(baseUrl);
  const busyRef = useRef(false);
  const pendingAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    enabledRef.current = enabled;
    baseUrlRef.current = baseUrl;
  }, [enabled, baseUrl]);

  const finishSpeaking = useCallback(() => {
    eyeInputRef.current.speech = 0;
    busyRef.current = false;
    setState(enabledRef.current ? 'listening' : 'off');
    // Oxirgi ovoz "dumi" mikrofonga tushmasligi uchun biroz kutiladi
    setTimeout(() => listenerRef.current?.resume(), 500);
  }, [eyeInputRef]);

  /** mp3 ni ijro etadi va haqiqiy ovoz balandligini avatar og'ziga uzatadi */
  const playAudio = useCallback(
    async (audio: HTMLAudioElement) => {
      let timer: ReturnType<typeof setInterval> | undefined;
      const done = () => {
        if (timer) clearInterval(timer);
        finishSpeaking();
      };
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = audioCtxRef.current ?? (audioCtxRef.current = new Ctx());
        if (ctx.state === 'suspended') await ctx.resume();
        const src = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        analyser.connect(ctx.destination);
        const buf = new Uint8Array(analyser.fftSize);
        timer = setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          eyeInputRef.current.speech = Math.min(1, Math.sqrt(sum / buf.length) * 5);
        }, 50);
      } catch {
        // tahlil ishlamasa ham ovoz chiqadi, og'iz taxminiy ritmda qimirlaydi
        let tick = 0;
        timer = setInterval(() => {
          tick += 1;
          eyeInputRef.current.speech = 0.5 + Math.sin(tick * 0.8) * 0.4;
        }, 50);
      }
      audio.onended = done;
      audio.onerror = done;
      setState('speaking');
      try {
        await audio.play();
      } catch (e) {
        if (timer) clearInterval(timer);
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          // Brauzer ovozni bloklagan: foydalanuvchi bir marta bossa, ijro boshlanadi
          pendingAudioRef.current = audio;
          setAudioBlocked(true);
          eyeInputRef.current.speech = 0;
          setState('listening');
        } else {
          done();
        }
      }
    },
    [eyeInputRef, finishSpeaking]
  );

  const unblockAudio = useCallback(() => {
    const audio = pendingAudioRef.current;
    pendingAudioRef.current = null;
    setAudioBlocked(false);
    if (audio) void playAudio(audio);
  }, [playAudio]);

  const ask = useCallback(
    async (q: string) => {
      const text = q.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;
      listenerRef.current?.pause();
      clearTimeout(clearTimerRef.current);
      setQuestion(text);
      setResult(null);
      setError(null);
      setState('thinking');
      try {
        const res = await askAssistant(baseUrlRef.current, text);
        setResult(res);
        clearTimerRef.current = setTimeout(() => {
          setResult(null);
          setQuestion('');
        }, RESULT_VISIBLE_MS);
        if (res.audio_url) {
          const audio = new Audio();
          audio.crossOrigin = 'anonymous';
          audio.src = res.audio_url;
          await playAudio(audio);
        } else {
          // Pi ovozni tayyorlay olmadi: qurilmaning o'zbek ovozi (bo'lsa) bilan o'qiladi
          setState('speaking');
          let tick = 0;
          const timer = setInterval(() => {
            tick += 1;
            eyeInputRef.current.speech = 0.5 + Math.sin(tick * 0.8) * 0.4;
          }, 50);
          edgeTtsService.speak(res.answer, { voice: 'uz-UZ-SardorNeural', rate: 1.0 }, undefined, () => {
            clearInterval(timer);
            finishSpeaking();
          });
        }
      } catch (e) {
        const msg = e instanceof AssistantError ? e.message : "Javob olib bo'lmadi";
        setError(msg);
        busyRef.current = false;
        setState(enabledRef.current ? 'listening' : 'off');
        tacticalAudio.playObstacleAlert();
        listenerRef.current?.resume();
      }
    },
    [eyeInputRef, finishSpeaking, playAudio]
  );

  // Tinglovchini bir marta yaratish
  useEffect(() => {
    const listener = new WakeWordListener({
      onState: (s: ListenerState) => {
        if (busyRef.current) return;
        setState(s === 'off' ? 'off' : s === 'awaiting-question' ? 'awaiting' : 'listening');
      },
      onWake: () => {
        setError(null);
        tacticalAudio.playCommandBeep();
      },
      onQuestion: (q) => void ask(q),
      onError: (m) => setError(m)
    });
    listenerRef.current = listener;
    return () => {
      listener.stop();
      clearTimeout(clearTimerRef.current);
    };
  }, [ask]);

  // Yoqish/o'chirish
  useEffect(() => {
    const listener = listenerRef.current;
    if (!listener) return;
    if (enabled) {
      setError(null);
      listener.start();
    } else {
      listener.stop();
      setState('off');
    }
  }, [enabled]);

  return { state, question, result, error, audioBlocked, supported, ask, unblockAudio };
};
