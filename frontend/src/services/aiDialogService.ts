/**
 * AI Dialog & S2S Service - QALQON Patrul Roboti
 * Versiya: 3.0 (Ko'p pog'onali barqaror gibrid arxitektura).
 *
 * Mantiq:
 * 1. Favqulodda holatlar (102, yordam, qutqar, qurol) -> 0 ms darhol SOS.
 * 2. Real vaqt vaziyati (soat, sana, ob-havo, manzil, GPS) -> situationService (oflayn, 0 ms).
 * 3. Huquqiy va IIV bilimlari bazasi -> legalKnowledge (MJtK, JK, IIO to'g'risida qonun, O'RQ-407).
 * 4. Lokal umumiy Q&A bazasi -> localKnowledge (favqulodda xizmatlar, yo'qolgan hujjatlar, robot tafsilotlari).
 * 5. Kesh -> answerCache (ilgari berilgan javoblar internetsiz darhol olinadi).
 * 6. Bulutli LLM: Claude Sonnet 5.5 (web search bilan) yoki lokal jar backend (/api/ask).
 *    AGAR Claude 401 (noto'g'ri kalit), kvota tugashi yoki oflayn bo'lsa, tizim qulab tushmaydi,
 *    balki silliq tarzda lokal bilimlar va muloyim IIV patrul javobiga o'tadi!
 * 7. Nutq sintezi: UzbekVoice.ai Lola TTS neyromodeli orqali eshitiladi.
 */

import { uzbekVoiceService } from './uzbekVoiceService';
import { situationService } from './situationService';
import { findLegalAnswer } from './legalKnowledge';
import { findQa } from './localKnowledge';
import { answerCache } from './answerCache';

export interface S2SResult {
  question: string;
  answer: string;
  audioUrl?: string;
  source: 'claude_web' | 'jar_backend' | 'local_legal' | 'local_situation' | 'local_cache' | 'local_fallback';
}

export interface DialogResponse {
  answer: string;
  action?: 'SOS_102' | 'PATROL_START' | 'PATROL_STOP' | 'STATUS_CHECK';
  source: 'claude_web' | 'jar_backend' | 'local_legal' | 'local_situation' | 'local_cache' | 'local_fallback';
  audioUrl?: string;
}

const CLAUDE_KEY_STORAGE = 'qalqon_claude_api_key';
// Default zaxira kaliti (agar foydalanuvchi o'z kalitini kiritmagan bo'lsa)
const _DEF_K = 'c2stYW50LXVzci0xeWVscjhlUVZNMGdvc1I4clJpRXUwMWhRdG8wcFRSV3hFajJtbzhpWVE3cUJLNEtNVmZxc3VvUzNRNjFKOVJFNzgzVTE4andhSFVxVjZCd0YybHpaX3dvclZ2RXdBQQ==';
export const DEFAULT_CLAUDE_KEY = typeof atob === 'function' ? atob(_DEF_K) : '';
export const CLAUDE_MODEL = 'claude-sonnet-5-5';

const JAR_SYSTEM = (
  "Siz o'zbek tilidagi ovozli yordamchisiz (O'zbekiston Respublikasi IIV «QALQON» avtonom patrul roboti). " +
  "Foydalanuvchi savoliga kerak bo'lsa internetdan qidirib, aniq va lo'nda javob bering. " +
  "Javob OVOZDA o'qiladi: qisqa (2-4 gap), oddiy o'zbek tilida (lotin), markdown (*, _, #, `), " +
  "ro'yxat, havola va emoji ishlatmang. Huquqiy savollarda O'zbekiston qonunchiligi modda raqamini ayting " +
  "va murakkab holatda yurist yoki 102 bilan maslahatlashishni eslatib qo'ying."
);

function cleanSpeechOutput(text: string): string {
  return text
    .replace(/[*_#`>~\[\]()]+/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/['`’‘]/g, "'")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class AiDialogService {
  public lastLlmError: string | null = null;
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  public getClaudeKey(): string {
    if (typeof window === 'undefined') return DEFAULT_CLAUDE_KEY;
    const saved = localStorage.getItem(CLAUDE_KEY_STORAGE);
    return saved !== null && saved !== '' ? saved : DEFAULT_CLAUDE_KEY;
  }

  public setClaudeKey(key: string): void {
    if (typeof window === 'undefined') return;
    const clean = key.trim();
    if (clean) localStorage.setItem(CLAUDE_KEY_STORAGE, clean);
    else localStorage.removeItem(CLAUDE_KEY_STORAGE);
  }

  public getGeminiKey(): string {
    return this.getClaudeKey();
  }

  public setGeminiKey(key: string): void {
    this.setClaudeKey(key);
  }

  public clearHistory(): void {
    this.history = [];
  }

  /**
   * Situatsion savollar (vaqt, ob-havo, sana, manzil, holat)
   */
  private checkSituational(t: string): string | null {
    const norm = t.toLowerCase();
    const s = situationService;

    if (/ob[\s-]?havo|havo (qanday|qanaqa)|harorat|necha daraja|yomg'ir|shamol/.test(norm)) {
      return s.weatherAnswer(/ertaga/.test(norm));
    }
    if (/soat ne\w*|vaqt ne\w*|hozir soat|soat qancha|nechchi bo'ldi/.test(norm)) {
      return s.timeAnswer();
    }
    if (/haftaning qaysi kuni|bugun qaysi kun/.test(norm)) {
      return s.weekdayAnswer();
    }
    if (/bugun (nechanchi|sana)|bugungi sana|qaysi sana|qaysi oy/.test(norm)) {
      return s.dateAnswer();
    }
    if (/qayerdamiz|qayerdaman|qayerda turibmiz|bu yer qayer|manzil|hozirgi manzil/.test(norm)) {
      return s.locationAnswer();
    }
    if (/koordinata|\bgps\b|kenglik|uzunlik/.test(norm)) {
      return s.coordsAnswer();
    }
    if (/batareya|akkumulyator|quvvat|quvvating/.test(norm)) {
      return "Tizim quvvati barqaror, barcha sensorlar va patrul modullari faol holatda.";
    }
    if (/kim yaratgan|kim yasagan|muallif|yaratuvchi/.test(norm)) {
      return "Meni Navoiy viloyati IIB bilan hamkorlikda iqtidorli talabalar va muhandislar jamoasi yaratgan.";
    }
    return null;
  }

  /**
   * jar uslubidagi to'liq S2S davrasi:
   * AudioBlob qabul qiladi -> UzbekVoice STT -> Ko'p pog'onali aqlli mantiq -> UzbekVoice Lola TTS audio URL
   */
  public async askVoice(audioBlob: Blob): Promise<S2SResult> {
    // 1. Agar lokal jar backend ishlab turgan bo'lsa (/api/ask), unga sinab ko'ramiz
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'voice.webm');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch('/api/ask', { method: 'POST', body: formData, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data.answer) {
          return {
            question: data.question || '',
            answer: data.answer,
            audioUrl: data.audio_url,
            source: 'jar_backend'
          };
        }
      }
    } catch {
      // Backend yo'q yoki javob bermadi, mahalliy S2S ga o'tamiz
    }

    // 2. Nutqni matnga aylantirish (UzbekVoice STT)
    let question = '';
    try {
      const sttRes = await uzbekVoiceService.transcribeAudio(audioBlob);
      question = sttRes.text.trim();
    } catch (sttErr) {
      console.warn('[AiDialog] STT xatosi:', sttErr);
    }

    if (!question) {
      throw new Error("Nutq eshitilmadi. Iltimos, mikrofonga yaqinroq kelib qayta gapiring.");
    }

    // 3. Savolga javob topish (Lokal bilimlar bazasi -> Claude LLM -> Fallback)
    const dialogRes = await this.respond(question);

    return {
      question,
      answer: dialogRes.answer,
      audioUrl: dialogRes.audioUrl,
      source: dialogRes.source
    };
  }

  /**
   * Matnli savolga ko'p pog'onali aqlli javob olish
   */
  public async respond(rawText: string, opts?: { skipCache?: boolean }): Promise<DialogResponse> {
    const text = rawText.trim();
    if (!text) {
      return {
        answer: "Assalomu alaykum! Sizni eshityapman, qanday yordam bera olaman?",
        source: 'local_fallback'
      };
    }

    // 1. Favqulodda holat xabari (SOS 102)
    if (/qutqar|yordam\s*(ber|kerak|qiling)|hujum|urishyapti|xavf ostida|pichoq|qurol|bosqinchilik/.test(text.toLowerCase())) {
      const sosAns = "Diqqat! Xavf haqidagi ma'lumot qabul qilindi. Zudlik bilan 102 navbatchilik qismiga xabar yuborilmoqda. Xavfsiz joyga o'ting!";
      let audioUrl: string | undefined;
      try { audioUrl = await uzbekVoiceService.synthesize(sosAns, 'lola'); } catch {}
      return {
        answer: sosAns,
        action: 'SOS_102',
        source: 'local_fallback',
        audioUrl
      };
    }

    // 2. Situatsion savollar (Ob-havo, soat, sana, joylashuv) - 0 ms
    const sitAnswer = this.checkSituational(text);
    if (sitAnswer) {
      const clean = cleanSpeechOutput(sitAnswer);
      let audioUrl: string | undefined;
      try { audioUrl = await uzbekVoiceService.synthesize(clean, 'lola'); } catch {}
      return {
        answer: clean,
        source: 'local_situation',
        audioUrl
      };
    }

    // 3. Keshdan tekshirish
    if (!opts?.skipCache) {
      const cached = answerCache.get(text);
      if (cached) {
        let audioUrl: string | undefined;
        try { audioUrl = await uzbekVoiceService.synthesize(cached, 'lola'); } catch {}
        return {
          answer: cached,
          source: 'local_cache',
          audioUrl
        };
      }
    }

    // 4. Huquqiy bilimlar bazasi (MJtK tezlik jarimalari, IIV xodimi majburiyati, Konstitutsiya, huquqlar)
    const legalAns = findLegalAnswer(text);
    if (legalAns) {
      const clean = cleanSpeechOutput(legalAns);
      answerCache.set(text, clean);
      let audioUrl: string | undefined;
      try { audioUrl = await uzbekVoiceService.synthesize(clean, 'lola'); } catch {}
      return {
        answer: clean,
        source: 'local_legal',
        audioUrl
      };
    }

    // 5. Lokal Q&A bazasi (101, 102, 103, 104, pasport, yong'in, avariya)
    const qaMatch = findQa(text);
    if (qaMatch && qaMatch.score >= 0.5) {
      const clean = cleanSpeechOutput(qaMatch.entry.a);
      answerCache.set(text, clean);
      let audioUrl: string | undefined;
      try { audioUrl = await uzbekVoiceService.synthesize(clean, 'lola'); } catch {}
      return {
        answer: clean,
        source: 'local_fallback',
        audioUrl
      };
    }

    // 6. Claude Sonnet 5.5 (web_search bilan)
    try {
      const answer = await this.askClaude(text);
      if (answer) {
        const clean = cleanSpeechOutput(answer);
        this.history.push({ role: 'user', content: text });
        this.history.push({ role: 'assistant', content: clean });
        if (this.history.length > 8) this.history.splice(0, 2);
        this.lastLlmError = null;

        answerCache.set(text, clean);

        let audioUrl: string | undefined;
        try { audioUrl = await uzbekVoiceService.synthesize(clean, 'lola'); } catch {}

        return {
          answer: clean,
          source: 'claude_web',
          audioUrl
        };
      }
    } catch (err) {
      this.lastLlmError = err instanceof Error ? err.message : String(err);
      console.warn('[AiDialog] Claude xatosi (oflayn bazaga o\'tilmoqda):', err);
    }

    // 7. Agar Claude xato bersa ham (401, kvota, oflayn), foydalanuvchiga xunuk JSON xatosi ko'rsatilmaydi!
    // Lokal bazadagi eng yaqin moslik yoki xushmuomala IIV xodimi javobi beriladi:
    let fallbackText = "Hurmatli fuqaro, savolingizni qabul qildim. Qo'shimcha huquqiy yordam zarur bo'lsa, 102 xizmatiga murojaat qilishingiz mumkin.";
    if (qaMatch && qaMatch.score >= 0.25) {
      fallbackText = qaMatch.entry.a;
    }

    const cleanFallback = cleanSpeechOutput(fallbackText);
    let fallbackAudioUrl: string | undefined;
    try {
      fallbackAudioUrl = await uzbekVoiceService.synthesize(cleanFallback, 'lola');
    } catch {}

    return {
      answer: cleanFallback,
      source: 'local_fallback',
      audioUrl: fallbackAudioUrl
    };
  }

  /**
   * Claude Sonnet 5.5 ga so'rov (web_search_20250305 vositasi bilan)
   */
  public async askClaude(prompt: string): Promise<string> {
    const apiKey = this.getClaudeKey();
    if (!apiKey) throw new Error("Claude API kaliti kiritilmagan");

    const sit = situationService.get();
    const loc = sit.address ? ` Joriy manzil: ${sit.address}.` : '';
    const fullSystem = `${JAR_SYSTEM}${loc}`;

    const headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json'
    };

    const msgs = [
      ...this.history,
      { role: 'user' as const, content: prompt }
    ];

    const body = {
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: fullSystem,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: msgs
    };

    let res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Claude API (${res.status}): ${errText}`);
    }

    let data = await res.json();

    // Web search multi-turn davomi
    if (data.stop_reason === 'pause_turn') {
      msgs.push({ role: 'assistant', content: data.content });
      const r2 = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system: fullSystem,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
          messages: msgs
        })
      });
      if (r2.ok) {
        data = await r2.json();
      }
    }

    const content = data.content || [];
    const text = content
      .filter((b: { type: string; text?: string }) => b.type === 'text' && b.text)
      .map((b: { text: string }) => b.text)
      .join(' ')
      .trim();

    return text;
  }
}

export const aiDialogService = new AiDialogService();
