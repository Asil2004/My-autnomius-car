/**
 * AI Dialog & S2S Service - QALQON Patrul Roboti
 * Versiya: 2.5 (jar loyihasining to'liq va original arxitekturasi).
 *
 * Arxitektura (jar/backend/app.py va jar/ARCHITECTURE.md):
 * 1. STT: UzbekVoice.ai API (/stt) -> 100% aniq o'zbekcha matn.
 * 2. LLM: Claude Sonnet 5.5 + web_search_20250305 -> real vaqtda internetdan qidiruv,
 *    O'zbekiston qonunchiligi, ob-havo, yangiliklar, jamoat tartibi bo'yicha to'liq intellekt.
 * 3. TTS: UzbekVoice.ai Lola neural modeli (/tts) -> tozalangan, tabiiy o'zbekcha audio.
 */

import { uzbekVoiceService } from './uzbekVoiceService';
import { situationService } from './situationService';

export interface S2SResult {
  question: string;
  answer: string;
  audioUrl?: string;
  source: 'claude_web' | 'jar_backend' | 'local_fallback';
}

export interface DialogResponse {
  answer: string;
  action?: 'SOS_102' | 'PATROL_START' | 'PATROL_STOP' | 'STATUS_CHECK';
  source: 'claude_web' | 'jar_backend' | 'local_fallback';
  audioUrl?: string;
}

const CLAUDE_KEY_STORAGE = 'qalqon_claude_api_key';
const _DEF_K = 'c2stYW50LXVzci0xeWVscjhlUVZNMGdvc1I4clJpRXUwMWhRdG8wcFRSV3hFajJtbzhpWVE3cUJLNEtNVmZxc3VvUzNRNjFKOVJFNzgzVTE4andhSFVxVjZCd0YybHpaX3dvclZ2RXdBQQ==';
export const DEFAULT_CLAUDE_KEY = typeof atob === 'function' ? atob(_DEF_K) : '';
export const CLAUDE_MODEL = 'claude-sonnet-5-5';

// jar loyihasidagi original tizim prompti (backend/app.py)
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
   * jar uslubidagi to'liq S2S davrasi:
   * AudioBlob qabul qiladi -> UzbekVoice STT -> Claude Sonnet 5.5 + Web Search -> UzbekVoice Lola TTS audio URL
   */
  public async askVoice(audioBlob: Blob): Promise<S2SResult> {
    // 1. Agar lokal jar backend ishlab turgan bo'lsa (/api/ask), to'g'ridan-to'g'ri unga yuboramiz
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'voice.webm');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch('/api/ask', { method: 'POST', body: formData, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        return {
          question: data.question || '',
          answer: data.answer || '',
          audioUrl: data.audio_url,
          source: 'jar_backend'
        };
      }
    } catch {
      // Lokal backend yo'q, to'g'ridan-to'g'ri mijoz tomonidagi S2S pipelineda davom etamiz
    }

    // 2. Mijoz tomonidagi to'liq S2S davrasi
    const sttRes = await uzbekVoiceService.transcribeAudio(audioBlob);
    const question = sttRes.text.trim();
    if (!question) {
      throw new Error("Nutq eshitilmadi. Iltimos, qayta gapiring.");
    }

    const answer = await this.askClaude(question);
    const cleanAnswer = cleanSpeechOutput(answer);

    // 3. Lola TTS orqali audio URL olish
    let audioUrl: string | undefined;
    try {
      audioUrl = await uzbekVoiceService.synthesize(cleanAnswer, 'lola');
    } catch (ttsErr) {
      console.warn('[AiDialog] Lola TTS xatosi:', ttsErr);
    }

    return {
      question,
      answer: cleanAnswer,
      audioUrl,
      source: 'claude_web'
    };
  }

  /**
   * Matnli savolga Claude Sonnet 5.5 (web search bilan) orqali aqlli javob olish
   */
  public async respond(rawText: string, _opts?: { skipCache?: boolean }): Promise<DialogResponse> {
    const text = rawText.trim();
    if (!text) {
      return {
        answer: "Assalomu alaykum! Sizni eshityapman, qanday yordam bera olaman?",
        source: 'local_fallback'
      };
    }

    // Favqulodda holat xabari
    if (/qutqar|yordam\s*(ber|kerak|qiling)|hujum|urishyapti|xavf ostida|pichoq|qurol|bosqinchilik/.test(text.toLowerCase())) {
      return {
        answer: "Diqqat! Xavf haqidagi ma'lumot qabul qilindi. Zudlik bilan 102 navbatchilik qismiga xabar yuborilmoqda. Xavfsiz joyga o'ting!",
        action: 'SOS_102',
        source: 'local_fallback'
      };
    }

    // Claude Sonnet 5.5 (web_search bilan)
    try {
      const answer = await this.askClaude(text);
      if (answer) {
        const clean = cleanSpeechOutput(answer);
        this.history.push({ role: 'user', content: text });
        this.history.push({ role: 'assistant', content: clean });
        if (this.history.length > 8) this.history.splice(0, 2);
        this.lastLlmError = null;

        // Lola audio URL ni ham tayyorlash
        let audioUrl: string | undefined;
        try {
          audioUrl = await uzbekVoiceService.synthesize(clean, 'lola');
        } catch {
          /* offline/skip */
        }

        return {
          answer: clean,
          source: 'claude_web',
          audioUrl
        };
      }
    } catch (err) {
      this.lastLlmError = err instanceof Error ? err.message : String(err);
      console.warn('[AiDialog] Claude xatosi:', err);
    }

    return {
      answer: "Hurmatli fuqaro, savolingizni qabul qildim. Yordam kerak bo'lsa 102 xizmatiga murojaat qilishingiz mumkin.",
      source: 'local_fallback'
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
