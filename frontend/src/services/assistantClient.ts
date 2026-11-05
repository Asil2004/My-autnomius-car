import type { AssistantAnswer } from '../types/robot';

/**
 * Ovozli yordamchi mijozi: uyg'otuvchi so'z ("Qalqon") ni tinglaydi, savolni Pi ga yuboradi (Pi lex.uz bazasidan Gemini
 * yordamida javob tayyorlaydi va Sardor ovozida mp3 beradi).
 *
 * Nutqni matnga aylantirish: Chrome ning ichki nutq tanishi (uz-UZ). Internet kerak, kalit kerak emas.
 * Ovoz yozib saqlanmaydi va serverga yuborilmaydi, faqat tanilgan MATN yuboriladi.
 */

// ---------------------------------------------------------------- matnni normallashtirish (Pi dagi assistant.py bilan bir xil)
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', ъ: "'", ь: '', ы: 'i', э: 'e',
  ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h'
};

export const normalizeSpeech = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‘’ʻʼ`´′]/g, "'")
    .split('')
    .map((ch) => CYR[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Nutq tanish "Qalqon" ni turlicha eshitishi mumkin: qalqon, kalkon, qalqan... */
export const isWakeWord = (normalizedWord: string): boolean =>
  normalizedWord.length >= 5 && normalizedWord.length <= 8 && /^(qalq|kalk|galq|kalq|qalk)[oau]n$/.test(normalizedWord);

/** Matndan uyg'otuvchi so'zni topadi. Topilsa, undan KEYINGI qismni (savolni) qaytaradi, topilmasa null */
export const extractAfterWakeWord = (transcript: string): string | null => {
  const words = transcript.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (isWakeWord(normalizeSpeech(words[i]))) {
      return words
        .slice(i + 1)
        .join(' ')
        .replace(/^[,.!?\s]+/, '')
        .trim();
    }
  }
  return null;
};

// ---------------------------------------------------------------- Pi ga savol
export class AssistantError extends Error {
  code: 'busy' | 'llm' | 'network' | 'error';
  constructor(code: AssistantError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export const askAssistant = async (baseUrl: string, question: string): Promise<AssistantAnswer> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  try {
    const res = await fetch(`${baseUrl}/api/assistant/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: question }),
      signal: ctrl.signal
    });
    const body = (await res.json().catch(() => ({}))) as Partial<AssistantAnswer> & { message?: string };
    if (res.status === 429) throw new AssistantError('busy', body.message || 'Oldingi savolga javob tayyorlanmoqda');
    if (res.status === 502) throw new AssistantError('llm', body.message || 'Javob tayyorlab bo\'lmadi');
    if (!res.ok || body.status !== 'ok') throw new AssistantError('error', body.message || `Pi javobi: ${res.status}`);
    const answer = body as AssistantAnswer;
    return { ...answer, audio_url: answer.audio_url ? `${baseUrl}${answer.audio_url}` : null };
  } catch (e) {
    if (e instanceof AssistantError) throw e;
    throw new AssistantError('network', "Pi ga ulanib bo'lmadi");
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------- uyg'otuvchi so'zni tinglash
/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = any;

const getSR = (): (new () => SR) | null => {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

export const isSpeechRecognitionSupported = (): boolean => typeof window !== 'undefined' && getSR() !== null;

export type ListenerState = 'off' | 'listening' | 'awaiting-question';

export interface WakeWordHandlers {
  onState: (s: ListenerState) => void;
  /** "Qalqon" deyildi, savol keyingi gapda kutiladi */
  onWake: () => void;
  onQuestion: (q: string) => void;
  onError: (message: string) => void;
}

const QUESTION_WINDOW_MS = 8000;

export class WakeWordListener {
  private h: WakeWordHandlers;
  private rec: SR | null = null;
  private wanted = false;
  private paused = false;
  private awaitingUntil = 0;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private quickFails = 0;
  private startedAt = 0;

  constructor(handlers: WakeWordHandlers) {
    this.h = handlers;
  }

  start() {
    if (this.wanted) return;
    const Ctor = getSR();
    if (!Ctor) {
      this.h.onError("Bu brauzer nutq tanishni qo'llamaydi (Chrome kerak)");
      return;
    }
    this.wanted = true;
    this.quickFails = 0;
    this.begin(Ctor);
  }

  stop() {
    this.wanted = false;
    clearTimeout(this.restartTimer);
    try {
      this.rec?.abort();
    } catch {
      // allaqachon to'xtagan
    }
    this.rec = null;
    this.h.onState('off');
  }

  /** Robot gapirayotganda o'zini eshitmasligi uchun */
  pause() {
    this.paused = true;
    try {
      this.rec?.abort();
    } catch {
      // allaqachon to'xtagan
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.wanted) this.scheduleRestart(200);
  }

  private begin(Ctor: new () => SR) {
    if (!this.wanted || this.paused) return;
    const rec = new Ctor();
    rec.lang = 'uz-UZ';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    this.startedAt = Date.now();

    rec.onstart = () => this.h.onState(Date.now() < this.awaitingUntil ? 'awaiting-question' : 'listening');
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) this.handleTranscript(String(e.results[i][0].transcript || ''));
      }
    };
    rec.onerror = (e: any) => {
      const code = String(e.error || '');
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        this.wanted = false;
        this.h.onState('off');
        this.h.onError('Mikrofonga ruxsat berilmagan: brauzer sozlamalarida ruxsat bering');
      } else if (code === 'network') {
        this.h.onError("Nutqni tanish uchun internet kerak (Chrome nutq xizmati)");
      } else if (code === 'language-not-supported') {
        this.wanted = false;
        this.h.onState('off');
        this.h.onError("O'zbek tili (uz-UZ) nutq tanishda qo'llab-quvvatlanmaydi");
      }
      // 'no-speech' va 'aborted' oddiy holat, e'tiborga olinmaydi
    };
    rec.onend = () => {
      this.rec = null;
      if (!this.wanted || this.paused) return;
      // Tez-tez uzilsa (masalan tarmoq yo'q), oraliq kattalashadi
      this.quickFails = Date.now() - this.startedAt < 2000 ? this.quickFails + 1 : 0;
      this.scheduleRestart(Math.min(5000, 300 * (this.quickFails + 1)));
    };

    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.scheduleRestart(1000);
    }
  }

  private scheduleRestart(ms: number) {
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      const Ctor = getSR();
      if (Ctor && this.wanted && !this.paused && !this.rec) this.begin(Ctor);
    }, ms);
  }

  private handleTranscript(transcript: string) {
    const text = transcript.trim();
    if (!text) return;
    if (Date.now() < this.awaitingUntil) {
      // "Qalqon" dan keyingi gap savol hisoblanadi (u yana "Qalqon" bilan boshlangan bo'lsa, shu so'zdan keyingisi)
      this.awaitingUntil = 0;
      this.h.onState('listening');
      this.h.onQuestion(extractAfterWakeWord(text) || text);
      return;
    }
    const after = extractAfterWakeWord(text);
    if (after === null) return; // uyg'otuvchi so'z yo'q: gap e'tiborga olinmaydi
    if (after.length >= 3) {
      this.h.onQuestion(after);
    } else {
      this.awaitingUntil = Date.now() + QUESTION_WINDOW_MS;
      this.h.onState('awaiting-question');
      this.h.onWake();
      setTimeout(() => {
        if (this.wanted && Date.now() >= this.awaitingUntil && !this.paused) this.h.onState('listening');
      }, QUESTION_WINDOW_MS + 100);
    }
  }
}
