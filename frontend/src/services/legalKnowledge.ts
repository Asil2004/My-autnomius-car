/**
 * QALQON robotining huquqiy bilimlar bazasi (oflayn).
 *
 * Manbalar (lex.uz, 2026-yil noyabrdagi tahrirlar bo'yicha o'rganilgan):
 *  - O'zbekiston Respublikasi Konstitutsiyasi (30.04.2023)            https://lex.uz/docs/6445145
 *  - "Ichki ishlar organlari to'g'risida" Qonun, O'RQ-407 (16.09.2016) https://lex.uz/uz/docs/3027843
 *  - Jinoyat kodeksi (22.09.1994)                                     https://lex.uz/uz/docs/111453
 *  - Jinoyat-protsessual kodeksi (22.09.1994)                         https://lex.uz/uz/docs/111460
 *  - Jinoyat-ijroiya kodeksi (25.04.1997)                             https://lex.uz/docs/163629
 *  - Oila kodeksi (30.04.1998)                                        https://lex.uz/uz/docs/104720
 *  - PQ-155: IIO tizimini raqamli transformatsiya qilish (30.04.2025) https://lex.uz/docs/7511360
 *  - PQ-59: startaplarni qo'llab-quvvatlash ekotizimi (11.02.2026)    https://lex.uz/docs/8046189
 *
 * Javoblar qisqa (ovoz bilan o'qiladi) va faqat shu hujjatlarda tekshirilgan moddalarga tayanadi.
 * Robot yuridik maslahat bermaydi: aniq holat uchun advokat yoki lex.uz ga yo'naltiradi.
 */

export interface LegalEntry {
  id: string;
  /** Kalit iboralar: kichik harf, apostrofsiz (matn ham shunday normallashtiriladi) */
  keys: string[];
  answer: string;
}

export const LEGAL_DISCLAIMER = "Bu umumiy ma'lumot. Aniq holatingiz bo'yicha advokatga murojaat qiling yoki lex.uz saytini ko'ring.";

export const LEGAL_ENTRIES: LegalEntry[] = [
  {
    id: 'robot-asos',
    keys: [
      'kuzatishga haqqing', 'kuzatishga haqing', 'suratga olyapsan', 'videoga olyapsan', 'video yozyapsan',
      'yozib olyapsan', 'qaysi qonun asosida', 'qanday huquq bilan', 'huquqing bormi', 'ruxsating bormi', 'kamerang'
    ],
    answer:
      "\"Ichki ishlar organlari to'g'risida\"gi qonunning 12-moddasiga ko'ra, ichki ishlar organlari jamoat joylarida audio, foto va video yozish vositalaridan foydalanishi mumkin. Prezidentning 2025-yil 30-apreldagi PQ-155-son qarori esa jamoat xavfsizligida sun'iy intellekt va robototexnikani joriy etishni belgilaydi."
  },
  {
    id: 'shaxsiy-malumot',
    keys: [
      'shaxsiy malumot', 'shaxsga doir', 'malumotlarim', 'yuzimni saqla', 'yuzimni yoz', 'biometr', 'face id',
      'rasmimni', 'malumotimni ochir', 'malumotni ochir'
    ],
    answer:
      "Konstitutsiyaning 31-moddasiga ko'ra, har kim o'z shaxsiy ma'lumotlarining himoya qilinishini, noto'g'ri ma'lumotlarni tuzatishni va qonunga xilof yig'ilganlarini o'chirishni talab qilish huquqiga ega. Men faqat rozilik bergan xodimlarning yuzini taniyman, begona fuqarolarning yuzi bazaga qo'shilmaydi."
  },
  {
    id: 'shaxsiy-hayot',
    keys: ['shaxsiy hayot', 'daxlsizlik', 'telefon suhbat', 'yozishmalar', 'xatlarim', 'josuslik'],
    answer:
      "Konstitutsiyaning 31-moddasi shaxsiy hayot, yozishmalar, telefon suhbatlari va elektron xabarlar sirligini kafolatlaydi. Bu huquqni cheklash faqat qonun va sud qarori asosida mumkin. Shaxsiy hayot daxlsizligini buzganlik uchun Jinoyat kodeksining 141¹-moddasida javobgarlik bor."
  },
  {
    id: 'ushlab-turish',
    keys: ['ushlab tur', 'ushlay olasan', 'ushlaysanmi', 'qamoqqa ol', 'hibsga', 'meni olib ket', '48 soat'],
    answer:
      "Konstitutsiyaning 27-moddasiga ko'ra, ushlab turish va qamoqqa olish faqat sud qarori bilan mumkin, sud qarorisiz 48 soatdan ortiq ushlab turish taqiqlanadi. Ushlangan shaxsga uning huquqlari va ushlash asoslari tushunarli tilda tushuntirilishi shart. Men robotman va hech kimni ushlab turmayman."
  },
  {
    id: 'huquq-cheklash',
    keys: ['huquqlarim chekla', 'huquqimni chekla', 'erkinligimni chekla', 'huquqlarim qanday'],
    answer:
      "Konstitutsiyaning 21-moddasiga ko'ra, inson huquq va erkinliklari faqat qonunga muvofiq va konstitutsiyaviy tuzum, aholi salomatligi, jamoat xavfsizligi va tartibini ta'minlash uchun zarur doirada cheklanishi mumkin."
  },
  {
    id: 'bezorilik',
    keys: ['bezori', 'jamoat tartibini buz', 'janjal', 'mushtlash', 'urishyapti', 'urishdi'],
    answer:
      "Bezorilik Jinoyat kodeksining 277-moddasi bilan jinoyat deb belgilangan. Agar hozir kimgadir xavf tug'ilgan bo'lsa, darhol 102 raqamiga qo'ng'iroq qiling yoki menga \"Yordam\" deng."
  },
  {
    id: 'qarshilik',
    keys: ['politsiyaga qarshilik', 'xodimga qarshilik', 'militsiyaga qarshilik', 'hokimiyat vakiliga'],
    answer:
      "Hokimiyat vakiliga yoki fuqarolik burchini bajarayotgan shaxsga qarshilik ko'rsatish Jinoyat kodeksining 219-moddasiga ko'ra jinoiy javobgarlikka sabab bo'ladi."
  },
  {
    id: 'kiber',
    keys: ['firibgar', 'xaker', 'akkauntimni', 'kartamdan pul', 'internet orqali aldash', 'kiber', 'kompyuter jinoyat', 'parolimni'],
    answer:
      "Axborot texnologiyalari sohasidagi jinoyatlar, jumladan kompyuter axborotiga ruxsatsiz kirish va zararli dasturlar tarqatish uchun javobgarlik Jinoyat kodeksining 278¹–278⁹-moddalarida belgilangan. Firibgarlik qurboni bo'lsangiz, bankingizga va 102 raqamiga darhol xabar bering."
  },
  {
    id: 'miting',
    keys: ['miting', 'namoyish', 'yigilish otkaz', 'piket'],
    answer:
      "Konstitutsiyaning 38-moddasiga ko'ra, fuqarolar qonunga muvofiq mitinglar, yig'ilishlar va namoyishlar o'tkazish huquqiga ega. Ularni tashkil etish yoki o'tkazish tartibini buzganlik uchun Jinoyat kodeksining 217-moddasida javobgarlik nazarda tutilgan."
  },
  {
    id: 'dron',
    keys: ['dron', 'uchuvchisiz', 'kvadrokopter'],
    answer:
      "Uchuvchisiz uchadigan apparatlarni qonunga xilof olib kirish, ulardan foydalanish yoki saqlash tartibini buzish uchun Jinoyat kodeksining 244⁴ va 248¹-moddalarida javobgarlik bor. Dron uchirishdan oldin tegishli ruxsatni oling."
  },
  {
    id: 'iio-vazifa',
    keys: ['politsiya vazifa', 'militsiya vazifa', 'ichki ishlar vazifa', 'ichki ishlar organlari', 'profilaktika inspektor', 'uchastka'],
    answer:
      "\"Ichki ishlar organlari to'g'risida\"gi qonun 2016-yil 16-sentabrda qabul qilingan (O'RQ-407). Uning 16-moddasiga ko'ra, ichki ishlar organlari ko'chalar, bog'lar, vokzallar va ommaviy tadbirlarda fuqarolar xavfsizligini ta'minlaydi. 15¹-moddaga ko'ra, mahalla huquq-tartibot maskanlarida patrul-post xizmati xodimlari ham ishlaydi."
  },
  {
    id: 'konstitutsiya',
    keys: ['konstitutsiya'],
    answer:
      "Yangi tahrirdagi Konstitutsiya 2023-yil 30-aprelda umumxalq referendumida qabul qilingan va 1-maydan kuchga kirgan. Unda inson huquq va erkinliklari oliy qadriyat deb e'lon qilingan, Konstitutsiya va qonunlarning ustunligi tan olingan."
  },
  {
    id: 'oila',
    keys: ['nikoh', 'ajrash', 'aliment', 'farzandlikka', 'vasiylik', 'oila kodeksi', 'zags', 'fhdyo'],
    answer:
      "Nikoh, ajrashish, aliment, farzandlikka olish va vasiylik masalalari Oila kodeksi bilan tartibga solinadi. U 1998-yil 30-aprelda qabul qilingan. Bunday masalalar bo'yicha FHDYo organiga, sudga yoki advokatga murojaat qiling."
  },
  {
    id: 'jinoyat-xabar',
    keys: ['ariza yoz', 'arizam', 'jinoyat haqida xabar', 'shikoyat qil', 'tergov', 'advokat'],
    answer:
      "Jinoyat ishlarini tergov qilish va sudda ko'rish tartibi Jinoyat-protsessual kodeksi bilan belgilanadi. Jinoyat haqida xabar berish uchun 102 raqamiga qo'ng'iroq qiling yoki eng yaqin ichki ishlar bo'limiga murojaat qiling. Huquqlaringizni himoya qilish uchun advokat yordamidan foydalanishingiz mumkin."
  },
  {
    id: 'jazo-ijro',
    keys: ['mahkum', 'jazoni otash', 'probatsiya', 'koloniya', 'qamoqxona'],
    answer:
      "Jazolarni ijro etish tartibi va mahkumlarning huquqlari Jinoyat-ijroiya kodeksida belgilangan. Masalan, 111-moddaga ko'ra, mahkumning roziligisiz unga nisbatan tibbiy yoki ilmiy tajriba o'tkazish mumkin emas."
  },
  {
    id: 'startap',
    keys: ['startap', 'grant', 'venchur', 'mvp', 'it park', 'itpark'],
    answer:
      "Prezidentning 2026-yil 11-fevraldagi PQ-59-son qarori startaplarni qo'llab-quvvatlaydi. Oliy ta'lim muassasalaridagi startaplarga MVP vaucheri beriladi: xarajatning 50 foizigacha, 50 ming dollargacha. \"Raqamli startaplar\" dasturi ishtirokchilari IT-park rezidenti maqomini oladi."
  },
  {
    id: 'sun-iy-intellekt',
    keys: ['suniy intellekt', 'robot politsiya', 'politsiya roboti', 'robototexnika', 'raqamlashtir'],
    answer:
      "Prezidentning PQ-155-son qarori bilan ichki ishlar organlarida sun'iy intellektni joriy etish konsepsiyasi tasdiqlangan. Unda kompyuter ko'rish, nutqni aniqlash, \"aqlli\" videokuzatuv, keyingi bosqichda esa avtonom dronlar va robotlar nazarda tutilgan. QALQON shu yo'nalishdagi loyiha."
  }
];

/** Umumiy huquqiy savol (aniq mavzu topilmasa) uchun belgi so'zlar */
const LEGAL_INTENT = ['qonun', 'modda', 'kodeks', 'huquq', 'javobgarlik', 'jarima', 'jazo', 'taqiqlan', 'qonuniy'];

export const LEGAL_GENERAL_ANSWER =
  "Men Konstitutsiya, Jinoyat, Jinoyat-protsessual, Jinoyat-ijroiya va Oila kodekslari, \"Ichki ishlar organlari to'g'risida\"gi qonun hamda Prezidentning PQ-155 va PQ-59 qarorlari bo'yicha qisqa ma'lumot bera olaman. Masalan, politsiya to'xtatganda huquqlaringiz, ushlab turish, fuqarolarning burchlari yoki xodim ustidan shikoyat haqida so'rang.";

/** Savol (ma'lumot so'rash) belgilari: shunda "bezorilik" kabi so'z SOS emas, huquqiy savol deb tushuniladi */
const QUESTION_HINTS = ['qanday', 'nima', 'qaysi', 'mumkinmi', 'haqida', 'bormi', 'nechta', 'qachon', 'kim ', 'qonun', 'modda', 'jazo', 'huquq'];
/** Haqiqiy favqulodda holat: bunda huquqiy ma'lumot emas, darhol SOS */
const HARD_EMERGENCY = /102|qutqar|hujum|yordam ber|tez yordam|xavf ostida|urishyapti|pichoq|qurol/;

/** Matn savol shaklidami (favqulodda so'zlarni tekshirmaydi) */
export function looksLikeQuestion(text: string): boolean {
  const t = normalizeForLegal(text);
  return QUESTION_HINTS.some((w) => t.includes(w)) || t.endsWith('mi');
}

/** Matn ma'lumot so'rash (savol) bo'lib, favqulodda chaqiruv emasmi */
export function isLegalQuestion(text: string): boolean {
  if (HARD_EMERGENCY.test(normalizeForLegal(text))) return false;
  return looksLikeQuestion(text);
}

/** Matnni solishtirish uchun normallashtirish: kichik harf, apostroflarsiz, ortiqcha bo'shliqlarsiz */
export function normalizeForLegal(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ʻʼ'`’‘]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Savolga mos huquqiy javobni topish. Eng ko'p kalit iborasi mos kelgan mavzu tanlanadi.
 * Mavzu topilmasa, lekin savol huquqiy bo'lsa, umumiy javob qaytadi. Aks holda null.
 */
export function findLegalAnswer(text: string): string | null {
  const t = normalizeForLegal(text);
  if (!t) return null;
  let best: LegalEntry | null = null;
  let bestScore = 0;
  for (const entry of LEGAL_ENTRIES) {
    let score = 0;
    for (const k of entry.keys) if (t.includes(k)) score += k.length; // uzunroq ibora aniqroq
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  if (best) return `${best.answer} ${LEGAL_DISCLAIMER}`;
  if (LEGAL_INTENT.some((w) => t.includes(w))) return LEGAL_GENERAL_ANSWER;
  return null;
}
