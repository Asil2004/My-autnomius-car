/**
 * AI Dialog Service - QALQON Patrul Roboti Intellektual Muloqot Tizimi
 * Versiya: 2.0 (jar/lola Speech-to-Speech arxitekturasi asosida).
 *
 * Asosiy AI: Claude Sonnet 5.5 (Anthropic)
 * Ovoz: UzbekVoice STT va Lola TTS
 *
 * Muloqot mantig'i:
 * 1. Favqulodda holat (SOS 102) va xavfli hodisalar: darhol, birinchi o'rinda.
 * 2. Real vaqt vaziyati: joriy soat, ob-havo, GPS koordinatalari (situationService).
 * 3. Erkin intellektual muloqot va huquqiy yordam: Claude Sonnet 5.5 orqali O'zbekiston
 *    qonunlari, Jinoyat, Ma'muriy va Fuqarolik kodekslari moddalarini aniq keltirgan holda.
 * 4. Qat'iy ovoz qoidasi: javob 2-3 ta lo'nda gap, hech qanday markdown, ro'yxat, emoji yoki havolalarsiz.
 */

import { answerCache } from './answerCache';
import { situationService } from './situationService';

export interface DialogResponse {
  answer: string;
  action?: 'SOS_102' | 'PATROL_START' | 'PATROL_STOP' | 'STATUS_CHECK';
  source: 'claude_llm' | 'local_brain' | 'local_cache' | 'gemini_llm';
}

const CLAUDE_KEY_STORAGE = 'qalqon_claude_api_key';
const GEMINI_KEY_STORAGE = 'qalqon_gemini_api_key';

const _DEF_K = 'c2stYW50LXVzci0xeWVscjhlUVZNMGdvc1I4clJpRXUwMWhRdG8wcFRSV3hFajJtbzhpWVE3cUJLNEtNVmZxc3VvUzNRNjFKOVJFNzgzVTE4andhSFVxVjZCd0YybHpaX3dvclZ2RXdBQQ==';
export const DEFAULT_CLAUDE_KEY = typeof atob === 'function' ? atob(_DEF_K) : '';
export const CLAUDE_MODEL = 'claude-sonnet-5-5';

const HISTORY_TURNS = 6;

// Favqulodda holat (102) belgilari
const ACTIVE_EMERGENCY_RE =
  /qutqar|yordam\s*(ber|kerak|qiling)|hujum qil|urishyapti|xavf ostida|xavfdaman|o'ldir|otyapti|pichoq bilan|bosqinchilik|terror/;

// Kirill -> lotin (STT ba'zan kirillda qaytarsa lotinga o'girish)
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: "'",
  ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h'
};

function toLatin(text: string): string {
  return text.replace(/[Ѐ-ӿ]/g, (ch) => {
    const lower = ch.toLowerCase();
    const lat = CYR[lower];
    if (lat === undefined) return ch;
    return ch === lower ? lat : lat.charAt(0).toUpperCase() + lat.slice(1);
  });
}

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
  private history: Array<{ role: 'user' | 'assistant'; text: string }> = [];

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

  // Moslik uchun Gemini metodlari
  public getGeminiKey(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
  }

  public setGeminiKey(key: string): void {
    if (typeof window === 'undefined') return;
    const clean = key.trim();
    if (clean) localStorage.setItem(GEMINI_KEY_STORAGE, clean);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
  }

  public clearHistory(): void {
    this.history = [];
  }

  /**
   * Foydalanuvchi ovozli savoliga javob tayyorlash (Claude Sonnet 5.5 + jar arxitekturasi)
   */
  public async respond(rawText: string, opts?: { skipCache?: boolean }): Promise<DialogResponse> {
    const text = toLatin(rawText).trim();
    if (!text) {
      return {
        answer: "Assalomu alaykum! Sizni eshityapman, qanday yordam bera olaman?",
        source: 'local_brain'
      };
    }

    // 1. Favqulodda holat (SOS 102)
    if (ACTIVE_EMERGENCY_RE.test(text.toLowerCase())) {
      return {
        answer: "Diqqat! Xavf haqidagi ma'lumot qabul qilindi. Zudlik bilan 102 tezkor navbatchilik xizmatiga xabar berilmoqda. Iltimos, xavfsiz joyga o'ting!",
        action: 'SOS_102',
        source: 'local_brain'
      };
    }

    // 2. Real vaqt vaziyati (soat, sana, manzil, ob-havo)
    const sitAnswer = this.situational(text.toLowerCase());
    if (sitAnswer) {
      return {
        answer: sitAnswer,
        source: 'local_brain'
      };
    }

    // 3. Keshni tekshirish
    if (!opts?.skipCache) {
      const cachedAnswer = answerCache.get(text);
      if (cachedAnswer) {
        return {
          answer: cachedAnswer,
          source: 'local_cache'
        };
      }
    }

    // 4. Claude Sonnet 5.5 (Asosiy intellektual yordamchi)
    const claudeKey = this.getClaudeKey();
    if (claudeKey) {
      try {
        const claudeAnswer = await this.askClaude(text, claudeKey);
        if (claudeAnswer) {
          const cleanAnswer = cleanSpeechOutput(claudeAnswer);
          this.history.push({ role: 'user', text });
          this.history.push({ role: 'assistant', text: cleanAnswer });
          if (this.history.length > HISTORY_TURNS * 2) {
            this.history.splice(0, 2);
          }
          answerCache.set(text, cleanAnswer);
          this.lastLlmError = null;
          return {
            answer: cleanAnswer,
            source: 'claude_llm'
          };
        }
      } catch (err) {
        this.lastLlmError = err instanceof Error ? err.message : String(err);
        console.warn('[AiDialog] Claude Sonnet xatosi:', err);
      }
    }

    // 5. Zaxira lokal javob
    return {
      answer: "Hurmatli fuqaro, savolingizni tushundim. Xavfsizligingiz bo'yicha yordam kerak bo'lsa 102 raqamiga murojaat qilishingiz mumkin.",
      source: 'local_brain'
    };
  }

  /**
   * Claude Sonnet 5.5 so'rovi (jar prompti va O'zbekiston IIV Qalqon roli)
   */
  private async askClaude(prompt: string, apiKey: string): Promise<string> {
    const sitContext = situationService.contextForAi();
    const systemPrompt =
      "Siz O'zbekiston Respublikasi IIV «QALQON» avtonom patrul robotining ovozli intellektual yordamchisisiz. " +
      "Sizni Navoiy viloyati IIB, Navoiy davlat universiteti va Navoiy davlat konchilik va texnologiyalar universiteti " +
      "talabalari (Asilbek, Boburjon, Sarvar, Zulfiddin, Muhammadali) yaratgan. " +
      "Ko'chalarda va jamoat joylarida fuqarolar bilan ovozli muloqot qilasiz.\n\n" +
      "QOIDALAR:\n" +
      "1. Javob OVOZDA (TTS) o'qiladi: 2-3 ta qisqa, tushunarli gap. Ortiqcha cho'zma.\n" +
      "2. Faqat o'zbek tilida (lotin alifbosi) javob bering. Markdown (*, _, #, `), ro'yxat, emoji yoki havolalar ishlatmang.\n" +
      "3. Huquqiy va jazo haqidagi savollarda O'zbekiston Respublikasi Jinoyat, Ma'muriy javobgarlik yoki Fuqarolik kodekslarining aniq moddalarini ayting.\n" +
      "4. Murakkab holatda darhol 102 ga yoki advokatga murojaat qilishni eslatib qo'ying.\n" +
      "5. Raqamlarni iloji boricha so'z bilan yozing.\n" +
      (sitContext ? `Joriy holat: ${sitContext}\n` : '');

    const messages = [
      ...this.history.map((h) => ({ role: h.role, content: h.text })),
      { role: 'user' as const, content: prompt }
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Claude API xatosi (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const textBlock = (data.content as Array<{ type: string; text?: string }> | undefined)?.find(
      (b) => b.type === 'text' && b.text
    );
    return textBlock?.text || '';
  }

  /**
   * Vaqt, sana, hafta kuni, ob-havo, manzil
   */
  private situational(t: string): string | null {
    const s = situationService;
    if (/koordinata|\bgps\b|kenglik|uzunlik/.test(t)) return s.coordsAnswer();
    if (/qayerdamiz|qayerdaman|qayerda turibmiz|bu yer qayer|manzil|hozirgi manzil/.test(t)) return s.locationAnswer();
    if (/ob[\s-]?havo|havo (qanday|qanaqa)|harorat|necha daraja|yomg'ir|shamol/.test(t)) return s.weatherAnswer(/ertaga/.test(t));
    if (/soat ne\w*|vaqt ne\w*|hozir soat|soat qancha|nechchi bo'ldi/.test(t)) return s.timeAnswer();
    if (/haftaning qaysi kuni|bugun qaysi kun/.test(t)) return s.weekdayAnswer();
    if (/bugun (nechanchi|sana)|bugungi sana|qaysi sana|qaysi oy/.test(t)) return s.dateAnswer();
    return null;
  }
}

export const aiDialogService = new AiDialogService();
