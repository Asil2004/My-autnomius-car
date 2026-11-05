/**
 * AI Dialog Service - QALQON Patrul Roboti Intellektual Muloqot Tizimi
 * O'zbek tilidagi ovozli savollarni tahlil qilib, rasmiy va mazmunli javob qaytaradi.
 *
 * Javob tartibi:
 * 1. Salomlashuv gap boshidan ajratiladi ("Assalomu alaykum, ..." dan keyingi savolga javob beriladi).
 *    Avval har qanday gap "salom" so'zi bo'lgani uchun doim bir xil tanishuv javobi qaytardi.
 * 2. Favqulodda holat (SOS 102) va harakat buyruqlari: lokal, darhol.
 * 3. Huquqiy savollar: tekshirilgan modda raqamlari bilan lokal javob (legalKnowledge).
 * 4. Robot va jamoa haqida aniq savollar: lokal.
 * 5. Qolgan barcha erkin savollar: Gemini (kalit kiritilgan bo'lsa), suhbat tarixi bilan.
 * 6. Hech biri bo'lmasa: robot buni ochiq aytadi (bir xil "men robotman" javobini takrorlamaydi).
 */

import { findLegalAnswer, isLegalQuestion, looksLikeQuestion, LEGAL_ENTRIES } from './legalKnowledge';
import { findQa, isRightsEntry } from './localKnowledge';
import { answerCache } from './answerCache';
import { OFFICER_CONDUCT, RIGHTS_QA } from './rightsKnowledge';

// Favqulodda holat (102) belgilari
const EMERGENCY_RE = /\b102\b|yordam\s*(ber|kerak|qiling)|qutqar|hujum|o'g'ri|ogri\b|o'g'irla|bezori|pichoq|qurol|urishyapti|xavf ostida|xavfdaman/;
// Hozir sodir bo'layotgan xavf: savol shaklida bo'lsa ham huquqiy ma'lumot emas, darhol SOS
const ACTIVE_EMERGENCY_RE = /qutqar|yordam\s*(ber|kerak|qiling)|hujum qil|urishyapti|xavf ostida|xavfdaman|o'ldir|otyapti|pichoq bilan/;

const GEMINI_KEY_STORAGE = 'qalqon_gemini_api_key';
// gemini-1.5-flash o'chirilgan (404). Avval doimiy yangilanadigan taxallus, keyin aniq versiyalar
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
const HISTORY_TURNS = 6;

export interface DialogResponse {
  answer: string;
  action?: 'SOS_102' | 'PATROL_START' | 'PATROL_STOP' | 'STATUS_CHECK';
  source: 'local_brain' | 'local_cache' | 'gemini_llm';
}

// Lokal savol-javob bazasi uchun moslik chegaralari
const QA_STRONG = 0.55; // Gemini'dan oldin javob beriladi
const QA_WEAK = 0.4; // faqat Gemini bo'lmasa yoki ishlamasa

// Kirill -> lotin (STT ba'zan kirillda qaytaradi)
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

/** Solishtirish uchun: kichik harf, apostroflar bitta ko'rinishda, tinish belgilarisiz */
function norm(text: string): string {
  return toLatin(text)
    .toLowerCase()
    .replace(/[ʻʼ`’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Gap boshidagi salomlashuv va murojaat ("Qalqon", "robot")
const GREETING_PREFIX =
  /^(?:(?:assalomu?\s*alaykum|assalom|salom(?:\s*alaykum)?|va\s*alaykum\s*assalom|xayrli\s*(?:kun|tong|kech)|hey|ey|qalqon|robot|robotjon)\s*)+/;

const has = (t: string, re: RegExp) => re.test(t);

class AiDialogService {
  private history: Array<{ role: 'user' | 'model'; text: string }> = [];
  private workingModel: string | null = null;
  public lastLlmError: string | null = null;

  public getGeminiKey(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
  }

  public setGeminiKey(key: string): void {
    if (typeof window === 'undefined') return;
    const clean = key.trim();
    if (clean) localStorage.setItem(GEMINI_KEY_STORAGE, clean);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
    this.workingModel = null;
    this.lastLlmError = null;
  }

  /** Foydalanuvchi nutqi (matn) ga robot nomidan javob tayyorlash */
  public async respond(userText: string, options: { skipCache?: boolean } = {}): Promise<DialogResponse> {
    const res = await this.decide(userText, options);
    this.remember(userText, res.answer);
    return res;
  }

  private remember(user: string, answer: string) {
    this.history.push({ role: 'user', text: user.trim() }, { role: 'model', text: answer });
    while (this.history.length > HISTORY_TURNS * 2) this.history.shift();
  }

  private async decide(userText: string, options: { skipCache?: boolean }): Promise<DialogResponse> {
    const raw = toLatin(userText.trim());
    const full = norm(raw);
    if (!full) {
      return { answer: "Kechirasiz, gapingizni yaxshi eshitmadim. Iltimos, qaytadan gapirib bering.", source: 'local_brain' };
    }

    // 1. Salomlashuvni ajratish: "Assalomu alaykum, bugun havo qanday?" -> savol "bugun havo qanday"
    const greeted = GREETING_PREFIX.test(full);
    const t = full.replace(GREETING_PREFIX, '').trim();
    const greet = greeted ? 'Va alaykum assalom! ' : '';
    if (!t) {
      return {
        answer: "Va alaykum assalom, hurmatli fuqaro! Men QALQON patrul robotiman. Sizga qanday yordam bera olaman?",
        source: 'local_brain'
      };
    }

    // 2a. Fuqaro va xodim huquq-burchlari (IIO qonuni, Konstitutsiya). "Qurol ishlatishi mumkinmi" kabi savol
    // SOS emas: savol shaklida bo'lsa yoki favqulodda so'z bo'lmasa, aniq mos kelgan huquqiy javob beriladi.
    const qa = findQa(t);
    if (
      qa && qa.score >= QA_STRONG && isRightsEntry(qa.entry) && !ACTIVE_EMERGENCY_RE.test(t) &&
      (looksLikeQuestion(t) || !EMERGENCY_RE.test(t))
    ) {
      return { answer: greet + qa.entry.a, source: 'local_brain' };
    }

    // 2b. Huquqiy savol (savol shaklida, favqulodda chaqiruv emas) SOS dan oldin
    const legalAnswer = isLegalQuestion(t) ? findLegalAnswer(t) : null;
    if (legalAnswer) return { answer: greet + legalAnswer, source: 'local_brain' };

    // 3. Tibbiy favqulodda holat: 103
    if (has(t, /yurag\w*|yurak|og'riyapti|og'riq|hushidan|qon ket|nafas ol(a|o)lmay|tez yordam|\b103\b|tutqanoq|zahar/)) {
      return {
        answer: "Tibbiy yordam kerak bo'lsa, darhol 103 raqamiga qo'ng'iroq qiling. Bemorni xotirjam joyga yotqizing va yolg'iz qoldirmang. Men 102 navbatchisiga ham xabar beraman.",
        action: 'SOS_102',
        source: 'local_brain'
      };
    }
    // Favqulodda holat: 102
    if (has(t, EMERGENCY_RE)) {
      return {
        answer: "Diqqat! 102 Tezkor Yordam xizmati xabardor qilinmoqda. Xotirjamlikni saqlang, xodimlar yo'lda! Agar imkoningiz bo'lsa, o'zingiz ham 102 raqamiga qo'ng'iroq qiling.",
        action: 'SOS_102',
        source: 'local_brain'
      };
    }
    if (t === 'yordam') {
      return {
        answer: "Men shu yerdaman. Favqulodda holat bo'lsa, \"yordam bering\" deng yoki 102 raqamiga qo'ng'iroq qiling. Boshqa savolingiz bo'lsa, bemalol so'rang.",
        source: 'local_brain'
      };
    }

    // 4. Harakat buyruqlari (aniq ibora bo'lishi shart: "yurak" yoki "yuribdi" buyruq emas)
    if (has(t, /(^|\s)(patrulni boshla\w*|patrulga chiq\w*|oldinga yur\w*|harakatlan\w*)(\s|$)/)) {
      return { answer: "Avtonom patrul marshruti tasdiqlandi. Harakatlanish boshlanmoqda.", action: 'PATROL_START', source: 'local_brain' };
    }
    if (has(t, /(^|\s)(to'?xta\w*|stop)(\s|$)/)) {
      return { answer: "To'xtash buyrug'i qabul qilindi. Motorlar to'xtatildi.", action: 'PATROL_STOP', source: 'local_brain' };
    }

    // 5. Robot va jamoa haqida aniq savollar
    const local = this.localFacts(t);
    if (local) return { ...local, answer: greet + local.answer };

    // 6. Lokal savol-javob bazasi (oflayn): aniq mos kelsa darhol
    if (qa && qa.score >= QA_STRONG) return { answer: greet + qa.entry.a, source: 'local_brain' };

    // 7. Kesh: oldin Gemini javob bergan shu yoki juda o'xshash savol (internetsiz ham ishlaydi)
    if (!options.skipCache) {
      const cached = answerCache.get(t);
      if (cached) return { answer: greet + cached, source: 'local_cache' };
    }

    // 8. Erkin savol: Gemini (javob keshga yoziladi)
    const geminiKey = this.getGeminiKey();
    if (geminiKey) {
      try {
        const llm = await this.askGemini(raw, geminiKey);
        if (llm) {
          this.lastLlmError = null;
          answerCache.set(t, llm);
          return { answer: llm, source: 'gemini_llm' };
        }
      } catch (err) {
        this.lastLlmError = err instanceof Error ? err.message : String(err);
        console.warn('[AiDialog] Gemini xatosi:', err);
      }
    }

    // 9. Lokal bazadan kamroq ishonchli moslik (Gemini yo'q yoki ishlamadi)
    if (qa && qa.score >= QA_WEAK) return { answer: greet + qa.entry.a, source: 'local_brain' };

    // 10. Savol shaklida bo'lmagan huquqiy mavzu
    const legalLoose = findLegalAnswer(t);
    if (legalLoose) return { answer: greet + legalLoose, source: 'local_brain' };

    // 8. Javob topilmadi: ochiq aytamiz
    return {
      answer:
        greet +
        (geminiKey
          ? "Kechirasiz, hozir sun'iy intellekt serveriga ulana olmadim. Iltimos, birozdan keyin qayta so'rang."
          : "Kechirasiz, bu savolga hozircha javob bera olmayman. Men jamoat xavfsizligi, huquqiy masalalar, 102 yordami va o'zim haqimda gapira olaman."),
      source: 'local_brain'
    };
  }

  /** Robot, jamoa, vaqt kabi aniq faktlar (faqat aniq iboralarda) */
  private localFacts(t: string): DialogResponse | null {
    const r = (answer: string, action?: DialogResponse['action']): DialogResponse => ({ answer, action, source: 'local_brain' });

    if (has(t, /\b(qalaysiz|qandaysiz|qandaysan|ishlar qalay|yaxshimisiz)\b/) && t.split(' ').length <= 4) {
      return r("Rahmat, yaxshi! Hududda tinchlik. Sizga qanday yordam bera olaman?");
    }
    if (has(t, /\b(kimsan|kimsiz|sen kim|siz kim|o'zing haqingda|o'zingiz haqingizda|vazifang|vazifangiz|nima qila olasan|nima qila olasiz|maqsading)\b/)) {
      return r(
        "Men Navoiy viloyati IIB, Navoiy davlat universiteti va Texnika universiteti hamkorligida yaratilgan QALQON jamoat xavfsizligi patrul robotiman. Ko'chalarda tartibni kuzataman, fuqarolarga ma'lumot beraman va favqulodda holatda 102 ga xabar beraman."
      );
    }
    if (has(t, /\basilbek\b/)) return r("Asilbek Ravshanov — loyihaning bosh muhandisi va mexatronika yetakchisi. Robot shassisi va apparat qismlari uning boshchiligida yaratilgan.");
    if (has(t, /\bbobur(jon)?\b/)) return r("Boburjon Bozorov — sun'iy intellekt, backend va kiberxavfsizlik rahbari. Raspberry Pi miyam va LiDAR xaritalash uning ishi.");
    if (has(t, /\bsarvar\b/)) return r("Sarvar Quldoshev — frontend, Android ilova va dispetcherlik interfeysi yetakchisi.");
    if (has(t, /\b(zulfiddin|odilov)\b/)) return r("Zulfiddin Odilov — biometriya va optik masofa o'lchash muhandisi.");
    if (has(t, /\bmuhammadali\b/)) return r("Muhammadali Ravshanov — mexatronika va korpus konstruksiyasi muhandisi.");
    if (has(t, /\b(kim yaratgan|kim yasagan|muallif\w*|jamoang\w*|seni yaratgan\w*)\b/)) {
      return r("Meni Asilbek, Boburjon, Sarvar, Zulfiddin va Muhammadali jamoasi ustozlar bilan hamkorlikda yaratgan.");
    }
    if (has(t, /\b(batareya\w*|akkumulyator\w*|lidar|tizim holati|holating|holatingiz)\b/)) {
      return r("Barcha tizimlar barqaror: quvvat yetarli, LiDAR skaneri va to'rtta ultratovush datchigi faol.", 'STATUS_CHECK');
    }
    if (has(t, /\b(soat ne\w*|vaqt ne\w*|hozir soat)\b/)) {
      const timeStr = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
      return r(`Hozir soat ${timeStr}.`);
    }
    if (has(t, /\b(bugun (nechanchi|qaysi kun|sana)|sana ne\w*|bugungi sana)\b/)) {
      const dateStr = new Date().toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' });
      return r(`Bugun ${dateStr}.`);
    }
    if (has(t, /^(rahmat|katta rahmat|tashakkur|barakalla)\b/) && t.split(' ').length <= 4) {
      return r("Arzimaydi! Xavfsizligingiz — bizning bosh maqsadimiz.");
    }
    if (has(t, /^(xayr|salomat bo'?ling|ko'?rishguncha)\b/)) {
      return r("Xayr, salomat bo'ling! Ehtiyot bo'ling.");
    }
    return null;
  }

  /** Gemini orqali erkin o'zbekcha javob (suhbat tarixi va robot bilimlari bilan) */
  private async askGemini(prompt: string, apiKey: string): Promise<string> {
    const legalRef = [...LEGAL_ENTRIES.map((e) => e.answer), ...RIGHTS_QA.map((e) => e.a)].map((a) => `- ${a}`).join('\n');
    const systemInstruction =
      "Sen QALQON v1.0 — O'zbekistondagi jamoat xavfsizligi patrul robotisan. Seni Navoiy viloyati IIB, Navoiy davlat universiteti va " +
      'Navoiy davlat konchilik va texnologiyalar universiteti talabalari (Asilbek, Boburjon, Sarvar, Zulfiddin, Muhammadali) yaratgan. ' +
      "Ko'chada fuqarolar bilan ovozli gaplashasan, javobing ovoz bilan o'qiladi. Qoidalar:\n" +
      "1. Faqat o'zbek tilida, lotin alifbosida javob ber. Qisqa: 1-3 gap. Markdown, ro'yxat va emoji ishlatma.\n" +
      "2. Xushmuomala, aniq, xavfsizlik xodimi uslubida gapir. Bilmasang, bilmasligingni ayt, to'qib chiqarma.\n" +
      "3. Favqulodda holatda darhol 102 ga qo'ng'iroq qilishni maslahat ber.\n" +
      "4. Huquqiy savollarda faqat quyidagi tekshirilgan ma'lumotlarga tayan, boshqa modda raqamlarini o'ylab topma; aniq holat uchun advokat yoki lex.uz ni tavsiya qil.\n" +
      `${OFFICER_CONDUCT}\n` +
      `Tekshirilgan huquqiy ma'lumotlar:\n${legalRef}`;

    const contents = [
      ...this.history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
      { role: 'user', parts: [{ text: prompt }] }
    ];
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { maxOutputTokens: 400, temperature: 0.5 }
    });

    const models = this.workingModel ? [this.workingModel] : GEMINI_MODELS;
    let lastErr = '';
    for (const model of models) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
      );
      if (res.status === 404) {
        lastErr = `model ${model} topilmadi`;
        continue; // keyingi modelni sinaymiz
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.error?.message || `status ${res.status}`;
        if (res.status === 400 && /api key/i.test(msg)) throw new Error("Gemini API kaliti noto'g'ri");
        if (res.status === 429) throw new Error('Gemini limiti tugadi, birozdan keyin urinib ko\'ring');
        throw new Error(`Gemini: ${msg}`);
      }
      this.workingModel = model;
      const parts: Array<{ text?: string }> = json?.candidates?.[0]?.content?.parts ?? [];
      return parts
        .map((p) => p.text ?? '')
        .join('')
        .replace(/[*#_`]/g, '')
        .trim();
    }
    throw new Error(`Gemini: ${lastErr}`);
  }
}

export const aiDialogService = new AiDialogService();
