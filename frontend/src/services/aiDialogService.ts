/**
 * AI Dialog Service - QALQON Patrul Roboti Intellektual Muloqot Tizimi
 * O'zbek tilidagi ovozli savollarni tahlil qilib, rasmiy va mazmunli javob qaytaradi.
 * 
 * Imkoniyatlari:
 * 1. IIV Patrul va Jamoat xavfsizligi qoidalari bo'yicha lokal javoblar.
 * 2. 102 Tezkor yordam va SOS chaqiruvlari.
 * 3. Jamoa a'zolari (Asilbek, Boburjon, Sarvar, Zulfiddin, Muhammadali) haqida ma'lumot.
 * 4. Tizim holati (LiDAR, kameralar, batareya, patrul rejimi).
 * 5. Ixtiyoriy: Tashqi Gemini LLM API kaliti kiritilgan bo'lsa, umumiy mavzularda chuqur muloqot qilish.
 */

import { findLegalAnswer, isLegalQuestion } from './legalKnowledge';

const GEMINI_KEY_STORAGE = 'qalqon_gemini_api_key';

export interface DialogResponse {
  answer: string;
  action?: 'SOS_102' | 'PATROL_START' | 'PATROL_STOP' | 'STATUS_CHECK';
  source: 'local_brain' | 'gemini_llm';
}

class AiDialogService {
  /**
   * Gemini API kalitini olish
   */
  public getGeminiKey(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
  }

  /**
   * Gemini API kalitini saqlash
   */
  public setGeminiKey(key: string): void {
    if (typeof window === 'undefined') return;
    const clean = key.trim();
    if (clean) {
      localStorage.setItem(GEMINI_KEY_STORAGE, clean);
    } else {
      localStorage.removeItem(GEMINI_KEY_STORAGE);
    }
  }

  /**
   * Foydalanuvchi nutqi (matn) ga robot nomidan javob tayyorlash
   */
  public async respond(userText: string): Promise<DialogResponse> {
    const raw = userText.trim();
    const clean = raw.toLowerCase().replace(/['`’]/g, "'");

    if (!clean) {
      return {
        answer: "Kechirasiz, gapingizni yaxshi eshitmadim. Iltimos, qaytadan gapirib bering.",
        source: 'local_brain'
      };
    }

    // 0. HUQUQIY SAVOLLAR (Konstitutsiya, kodekslar, IIO qonuni, PQ-155, PQ-59). Savol shaklida bo'lsa va
    // haqiqiy favqulodda chaqiruv bo'lmasa, SOS dan oldin tekshiriladi ("bezorilik uchun qanday jazo?" SOS emas)
    const legalAnswer = isLegalQuestion(raw) ? findLegalAnswer(raw) : null;
    if (legalAnswer) {
      return { answer: legalAnswer, source: 'local_brain' };
    }

    // 1. SOS VA FAVQULODDA YORDAM (102)
    if (
      clean.includes('102') ||
      clean.includes('yordam') ||
      /xavf(?!siz)/.test(clean) || // "xavfsizlik" so'zi SOS emas
      clean.includes('bezori') ||
      clean.includes('ogri') ||
      clean.includes("o'g'ri") ||
      clean.includes('hujum') ||
      clean.includes('qutqar')
    ) {
      return {
        answer: "Diqqat! 102 Tezkor Yordam xizmati xabardor qilinmoqda. Koordinatalaringiz IIB Navbatchilik qismiga uzatildi. Xotirjamlikni saqlang, xodimlar yo'lda!",
        action: 'SOS_102',
        source: 'local_brain'
      };
    }

    // 2. SALOMLASHISH VA TANISHUV
    if (
      clean.includes('salom') ||
      clean.includes('assalom') ||
      clean.includes('qalaysiz') ||
      clean.includes('qandaysan') ||
      clean.includes('ishlar qalay')
    ) {
      return {
        answer: "Assalomu alaykum! Men QALQON avtonom patrul robotiman. Sizga qanday yordam bera olaman?",
        source: 'local_brain'
      };
    }

    // 3. KIMSAN / VAZIFANG NIMA
    if (
      clean.includes('kimsan') ||
      clean.includes('nima bu') ||
      clean.includes('vazifang') ||
      clean.includes('nima qilasan') ||
      clean.includes('nima qila olasan') ||
      clean.includes('maqsading')
    ) {
      return {
        answer: "Men Navoiy viloyati IIB, Navoiy davlat universiteti va Texnika universiteti hamkorligida yaratilgan 'QALQON v1.0' jamoat xavfsizligi patrul robotiman. Asosiy vazifam — ko'chalarda tinchlikni saqlash, 360 darajali lidar orqali monitoring olib borish va fuqarolarga tezkor yordam ko'rsatish.",
        source: 'local_brain'
      };
    }

    // 4. JAMOA VA MUHANDISLAR HAQIDA
    if (clean.includes('asilbek')) {
      return {
        answer: "Asilbek Ravshanov — loyihaning bosh muhandisi va mexatronika yetakchisi. Robot shassisi, 4WD mexanizmi va apparat integratsiyasi uning boshchiligida yaratilgan.",
        source: 'local_brain'
      };
    }

    if (clean.includes('boburjon') || clean.includes('bobur')) {
      return {
        answer: "Boburjon Bozorov — sun'iy intellekt, backend va kiberxavfsizlik rahbari. Mening 360 darajali LiDAR xaritalashim, biometrik Face ID va Raspberry Pi miyam Boburjon tomonidan dasturlangan.",
        source: 'local_brain'
      };
    }

    if (clean.includes('sarvar')) {
      return {
        answer: "Sarvar Quldoshev — frontend, Android APK va dispetcherlik interfeysi yetakchisi. Taktik boshqaruv paneli va mobil ilovamiz Sarvar tomonidan ishlab chiqilgan.",
        source: 'local_brain'
      };
    }

    if (clean.includes('zulfiddin') || clean.includes('odilov')) {
      return {
        answer: "Zulfiddin Odilov — biometriya va optik masofa o'lchash muhandisi. Yuzni aniqlash va kadr bo'yicha masofani santimetrlargacha hisoblash algoritmlarini u ishlab chiqqan.",
        source: 'local_brain'
      };
    }

    if (clean.includes('muhammadali')) {
      return {
        answer: "Muhammadali Ravshanov — mexatronika va korpus konstruktsiyasi muhandisi. 4WD metall shassi va mexanik qismlar ustida faol ish olib borgan.",
        source: 'local_brain'
      };
    }

    if (clean.includes('kim yaratgan') || clean.includes('muallif') || /jamoa(?!t)/.test(clean)) { // "jamoat" emas
      return {
        answer: "Men Navoiy iqtidorli talaba va muhandislari: Asilbek, Boburjon, Sarvar, Zulfiddin, Muhammadali va ustozlarimiz hamkorligida loyihalashtirilganman.",
        source: 'local_brain'
      };
    }

    // 5. TIZIM VA PATRUL HOLATI
    if (
      clean.includes('status') ||
      clean.includes('holat') ||
      clean.includes('lidar') ||
      clean.includes('batareya') ||
      clean.includes('akkumulyator')
    ) {
      return {
        answer: "Barcha xavfsizlik tizimlari barqaror: 12V LiFePO4 quvvati yetarli, 360 darajali LiDAR skaneri va to'rtta ultratovush datchigi faol holatda patrullik qilmoqda.",
        action: 'STATUS_CHECK',
        source: 'local_brain'
      };
    }

    // 6. HARAKAT BUYRUQLARI
    if (clean.includes('patrulni boshla') || clean.includes('yur') || clean.includes('harakatlan')) {
      return {
        answer: "Avtonom patrul marshruti tasdiqlandi. Belgilangan perimetr bo'ylab harakatlanish boshlanmoqda.",
        action: 'PATROL_START',
        source: 'local_brain'
      };
    }

    if (clean.includes("to'xta") || clean.includes('stop') || clean.includes('toxta')) {
      return {
        answer: "Favqulodda to'xtash buyrug'i qabul qilindi. Barcha to'rtta motor bloklandi.",
        action: 'PATROL_STOP',
        source: 'local_brain'
      };
    }

    // 7. VAQT VA SANA
    if (clean.includes('soat') || clean.includes('vaqt')) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
      return {
        answer: `Hozirgi vaqt: soat ${timeStr}. Patrul jadvali bo'yicha monitoring davom etmoqda.`,
        source: 'local_brain'
      };
    }

    if (clean.includes('bugun') || clean.includes('sana') || clean.includes('kun')) {
      const now = new Date();
      const dateStr = now.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' });
      return {
        answer: `Bugun: ${dateStr}. Tinchlik va osoyishtalik nazorat ostida.`,
        source: 'local_brain'
      };
    }

    // 8. MINNATDORCHILIK VA XAYRLASHUV
    if (clean.includes('rahmat') || clean.includes('tashakkur') || clean.includes('barakalla')) {
      return {
        answer: "Xizmatingizga doimo tayyorman! Xavfsizligingiz — bizning bosh maqsadimiz.",
        source: 'local_brain'
      };
    }

    if (clean.includes('xayr') || clean.includes('salomat bol') || clean.includes("ko'rishguncha")) {
      return {
        answer: "Xayr, salomat bo'ling! Jamoat tartibiga rioya qilishingizni so'raymiz.",
        source: 'local_brain'
      };
    }

    // 8.5. Savol shaklida bo'lmagan, lekin huquqiy mavzudagi gap (masalan, "shaxsiy ma'lumotlarim")
    const legalLoose = findLegalAnswer(raw);
    if (legalLoose) {
      return { answer: legalLoose, source: 'local_brain' };
    }

    // 9. AGAR GEMINI API KALITI MAVJUD BO'LSA, LLM ORQALI KENGAYTIRILGAN JAVOB
    const geminiKey = this.getGeminiKey();
    if (geminiKey) {
      try {
        const llmAnswer = await this.askGemini(raw, geminiKey);
        if (llmAnswer) {
          return {
            answer: llmAnswer,
            source: 'gemini_llm'
          };
        }
      } catch (err) {
        console.warn('[AiDialog] Gemini LLM xatosi:', err);
      }
    }

    // 10. DEFAULT POLICE PATROL JAVOBI
    return {
      answer: "Tushundim. Men Navoiy IIB 'QALQON' avtonom roboti sifatida hududda xavfsizlikni ta'minlamoqdaman. Agar yordam kerak bo'lsa, 'Yordam' yoki '102' deb ayting.",
      source: 'local_brain'
    };
  }

  /**
   * Gemini 1.5 Flash API orqali erkin o'zbekcha javob olish
   */
  private async askGemini(prompt: string, apiKey: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const systemInstruction = 
      "Sen 'QALQON v1.0' avtonom jamoat xavfsizligi patrul robotisan. " +
      "O'zbekistonda, Navoiy viloyati IIB, NDU va NDKvaTU tomonidan yaratilgansan. " +
      "Javoblaring o'zbek tilida (lotin alifbosi), qisqa (1-3 gap), xushmuomala, aniq va jamoat xavfsizligi xodimi uslubida bo'lsin.";

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemInstruction}\n\nFuqaroning gapi: "${prompt}"\nRobot javobi:` }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 120,
        temperature: 0.5
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`Gemini status: ${res.status}`);
    const json = await res.json();
    const candidate = json.candidates?.[0]?.content?.parts?.[0]?.text;
    return candidate ? candidate.trim() : '';
  }
}

export const aiDialogService = new AiDialogService();
