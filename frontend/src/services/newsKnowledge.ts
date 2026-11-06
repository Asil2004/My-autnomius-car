/**
 * Kun.uz yangiliklari bo'yicha lokal bilim bazasi (oflayn kesh).
 *
 * Manba: https://kun.uz (RSS lentasi va "Jahon", "O'zbekiston", "Sport" bo'limlari), 2026-yil 6-noyabr, soat 12:30 holati.
 * Xabarlar qisqa, o'z so'zlarimiz bilan bayon qilingan (kun.uz matni ko'chirilmagan) va manba sifatida kun.uz aytiladi.
 *
 * Eslatma: kun.uz RSS da CORS ruxsati yo'q, shuning uchun saytdagi brauzer yangiliklarni o'zi yuklay olmaydi.
 * Yangilash uchun shu fayldagi NEWS ro'yxati va NEWS_SNAPSHOT yangilanadi.
 */

import { normalizeText, tokens, tokenMatch } from './textMatch';

export type NewsCategory = 'jahon' | 'uzbekiston' | 'iqtisodiyot' | 'sport' | 'fan';

export interface NewsItem {
  /** YYYY-MM-DD */
  date: string;
  cat: NewsCategory;
  /** Ovoz bilan o'qiladigan qisqa xabar (1 gap) */
  text: string;
  /** Qidiruv uchun kalit so'zlar (kichik harf, apostrofsiz) */
  keys: string[];
}

/** Ma'lumotlar olingan vaqt */
export const NEWS_SNAPSHOT = { date: '2026-11-06', time: '12:30', source: 'kun.uz' };

export const NEWS: NewsItem[] = [
  // ------------------------------------------------------------------ Jahon
  {
    date: '2026-11-06', cat: 'jahon',
    text: "Paragvay prezidenti Santyago Penya o'ziga aloqador «Ueno Bank» bankrot bo'lib, mamlakatda namoyishlar boshlangach, iste'foga chiqdi.",
    keys: ['paragvay', 'penya', 'bank', 'bankrot', 'kasod', 'prezident', 'istefo', 'lotin amerika']
  },
  {
    date: '2026-11-06', cat: 'jahon',
    text: "Melaniya Tramp Oq uyda Rossiya va Ukraina vakillari bilan uchrashib, Putin va Zelenskiyga shaxsiy maktub yo'llashini aytdi va Oleshkidagi olti kunlik sulh mustahkam tinchlikka aylanishiga umid bildirdi.",
    keys: ['melaniya', 'tramp', 'putin', 'zelenskiy', 'maktub', 'sulh', 'tinchlik', 'rossiya', 'ukraina', 'oq uy']
  },
  {
    date: '2026-11-05', cat: 'jahon',
    text: "AQShdagi oraliq saylovlarda Demokratlar partiyasi g'alaba qozonib, Kongressning ikkala palatasida ham ko'pchilikni egalladi.",
    keys: ['aqsh', 'amerika', 'saylov', 'oraliq', 'demokrat', 'respublikachi', 'kongress', 'tramp']
  },
  {
    date: '2026-11-06', cat: 'jahon',
    text: "Tahlilchilarga ko'ra, Kongressdagi yangi demokrat ko'pchilik yangi yildan Trampning tashqi siyosatiga, jumladan Ukraina urushi bo'yicha pozitsiyasiga ta'sir qiladi; Pentagon rahbari Pit Xegsetning iste'fosi talab qilinishi aytilmoqda.",
    keys: ['tramp', 'kongress', 'ukraina', 'urush', 'pentagon', 'xegset', 'hegset', 'aqsh', 'rossiya']
  },
  {
    date: '2026-11-05', cat: 'jahon',
    text: "Ilon Mask saylovda respublikachi nomzodlarga qariyb yarim milliard dollar sarflagan, ammo ularning deyarli hammasi yutqazdi.",
    keys: ['ilon', 'mask', 'elon', 'musk', 'saylov', 'respublikachi', 'aqsh']
  },
  {
    date: '2026-11-05', cat: 'jahon',
    text: "Oq uy demokratlar Tramp siyosatiga to'sqinlik qila olmasligini bayon qildi.",
    keys: ['oq uy', 'tramp', 'demokrat', 'bayonot', 'aqsh']
  },
  {
    date: '2026-11-06', cat: 'jahon',
    text: "Fransiyada yuz minglab odam maoshlarni oshirishni talab qilib ko'chalarga chiqdi.",
    keys: ['fransiya', 'namoyish', 'maosh', 'ish haqi', 'norozilik', 'yevropa']
  },
  {
    date: '2026-11-06', cat: 'jahon',
    text: "Italiya bosh vaziri Meloni Yevropa rahbarlarini Ukraina masalasida o'zaro kelishmasdan harakat qilishda aybladi.",
    keys: ['meloni', 'italiya', 'yevropa', 'ukraina']
  },
  {
    date: '2026-11-06', cat: 'jahon',
    text: "Zelenskiy Ispaniya qiroli bilan uchrashib, havo mudofaasi uchun yordam so'radi; Yevropa Ittifoqi esa Ukrainaga 4,36 milliard yevro o'tkazdi.",
    keys: ['zelenskiy', 'ispaniya', 'qirol', 'havo mudofaasi', 'yevropa ittifoqi', 'yei', 'ukraina', 'yevro']
  },
  {
    date: '2026-11-05', cat: 'jahon',
    text: "Yevropa aviakompaniyalari samolyotlarda bomba bor degan xabarlar to'lqiniga duch keldi.",
    keys: ['aviakompaniya', 'samolyot', 'bomba', 'yevropa', 'parvoz']
  },
  {
    date: '2026-11-06', cat: 'jahon',
    text: "Italiyaning Dolomit Alp tog'larida muzliklar erib, Birinchi jahon urushidan qolgan snaryadlar chiqdi; harbiylar 250 dan ortiq portlovchi buyumni zararsizlantirdi.",
    keys: ['alp', 'dolomit', 'italiya', 'snaryad', 'muzlik', 'birinchi jahon urushi', 'portlovchi']
  },
  {
    date: '2026-11-06', cat: 'jahon',
    text: "Rossiyaning Krasnoyarsk o'lkasida «Rosatom» 500 metrdan chuqurda radioaktiv chiqindilarni minglab yilga izolyatsiya qilishni sinaydigan yerosti laboratoriyasini qurmoqda.",
    keys: ['rossiya', 'rosatom', 'radioaktiv', 'chiqindi', 'krasnoyarsk', 'atom']
  },

  // ------------------------------------------------------------------ O'zbekiston
  {
    date: '2026-11-06', cat: 'uzbekiston',
    text: "Dam olish kunlari O'zbekistonning katta qismida quruq va iliq havo saqlanib, kunduzi 27–30 darajagacha isiydi; faqat Qoraqalpog'iston va Xorazmning ayrim joylarida yomg'ir kutilmoqda.",
    keys: ['ob havo', 'harorat', 'dam olish', 'hafta oxiri', 'yomgir', 'issiq', 'qoraqalpogiston', 'xorazm']
  },
  {
    date: '2026-11-05', cat: 'uzbekiston',
    text: "Prezident Shavkat Mirziyoyevning Qozog'istonga amaliy tashrifi boshlandi.",
    keys: ['mirziyoyev', 'prezident', 'qozogiston', 'tashrif']
  },
  {
    date: '2026-11-05', cat: 'uzbekiston',
    text: "O'zbekistonda bu yil 5 million tonnadan ortiq paxta terib olindi.",
    keys: ['paxta', 'hosil', 'terim', 'qishloq xojaligi']
  },
  {
    date: '2026-11-05', cat: 'uzbekiston',
    text: "Toshkent metrosi so'nggi 10 yilda 21 ta yangi bekat va 33 kilometr yo'lga ega bo'ldi, poyezdlar oralig'i 2 daqiqagacha qisqardi.",
    keys: ['metro', 'toshkent', 'bekat', 'transport', 'poyezd']
  },
  {
    date: '2026-11-05', cat: 'uzbekiston',
    text: "Yandex Uzbekistan yil oxirigacha Toshkentda robotlar orqali yetkazib berish xizmatini yo'lga qo'yishni rejalashtirmoqda.",
    keys: ['yandex', 'robot', 'yetkazib berish', 'toshkent', 'dostavka']
  },
  {
    date: '2026-11-05', cat: 'uzbekiston',
    text: "Toshkentdagi besh qavatli uyda gaz portlagani xabar qilindi.",
    keys: ['gaz', 'portlash', 'portladi', 'toshkent', 'uy']
  },
  {
    date: '2026-11-06', cat: 'uzbekiston',
    text: "Oqtovda og'ir ahvolga tushib qolgan uch nafar o'zbekistonlik ayol va ularning to'rt farzandi diplomatlar yordamida vatanga qaytarildi, qaytish hujjatlari bepul rasmiylashtirildi.",
    keys: ['oqtov', 'qozogiston', 'diplomat', 'vatanga', 'ayol', 'farzand', 'migrant']
  },
  {
    date: '2026-11-04', cat: 'uzbekiston',
    text: "Tojikiston prezidentining o'g'li Rustam Imomali O'zbekistonning «Fidokorona xizmatlari uchun» ordeni bilan taqdirlandi.",
    keys: ['rustam', 'imomali', 'tojikiston', 'orden', 'mukofot']
  },

  // ------------------------------------------------------------------ Iqtisodiyot
  {
    date: '2026-11-06', cat: 'iqtisodiyot',
    text: "Piyoz ichki talabdan 35 foiz ko'p yetishtirilsa ham, Surxondaryo kabi hududlarda chakana narxi 4500 so'mgacha oshdi; vazirlik buni ertapishar zaxira tugagani, tashish xarajatlari va olibsotarlar ustamasi bilan izohladi.",
    keys: ['piyoz', 'narx', 'qimmat', 'surxondaryo', 'bozor', 'vazirlik', 'qishloq xojaligi']
  },
  {
    date: '2026-11-06', cat: 'iqtisodiyot',
    text: "Oktabr oyida O'zbekistonda narxlar o'rtacha 0,6 foizga oshdi, yillik inflyatsiya 6,5 foiz bo'ldi: kartoshka va tuxum qimmatladi, shakar va mevalar arzonladi.",
    keys: ['inflyatsiya', 'narx', 'kartoshka', 'tuxum', 'shakar', 'meva', 'qimmat', 'arzon', 'oktabr']
  },

  // ------------------------------------------------------------------ Sport
  {
    date: '2026-11-04', cat: 'sport',
    text: "Osiyo chempionlar ligasi-2 da «Nasaf» hisobda ortda qolib turib, «Al-Kuvayt»ni mag'lub etdi.",
    keys: ['nasaf', 'al kuvayt', 'ochl', 'chempionlar ligasi', 'futbol']
  },
  {
    date: '2026-11-02', cat: 'sport',
    text: "«Paxtakor» Ronaldusiz kelgan «An-Nasr»ga katta hisobda yutqazdi.",
    keys: ['paxtakor', 'an nasr', 'ronaldu', 'futbol', 'ochl']
  },
  {
    date: '2026-11-02', cat: 'sport',
    text: "Elit Osiyo chempionlar ligasida «Neftchi» so'nggi daqiqada gol o'tkazib, g'alabani boy berdi.",
    keys: ['neftchi', 'chempionlar ligasi', 'futbol', 'ochl']
  },
  {
    date: '2026-11-05', cat: 'sport',
    text: "Kun.uz xabariga ko'ra, Krishtianu Ronaldu Portugaliyadagi faoliyatini yakunladi.",
    keys: ['ronaldu', 'portugaliya', 'futbol']
  },
  {
    date: '2026-11-03', cat: 'sport',
    text: "O'zbekiston futbol assotsiatsiyasi bosh murabbiy Kannavaro ketishi mumkinligi haqidagi xabarni rad etdi.",
    keys: ['kannavaro', 'ofa', 'terma jamoa', 'murabbiy', 'futbol']
  },
  {
    date: '2026-11-03', cat: 'sport',
    text: "Osiyo kubogi kechiktirilgani e'lon qilindi.",
    keys: ['osiyo kubogi', 'futbol']
  },
  {
    date: '2026-11-02', cat: 'sport',
    text: "20 yoshli Kimi Antonelli «Formula-1» tarixidagi eng yosh chempion bo'ldi.",
    keys: ['formula', 'antonelli', 'chempion', 'poyga']
  },
  {
    date: '2026-11-05', cat: 'sport',
    text: "Italiya chempionatida «Komo» bir o'yinda 9 ta gol urib, rekord o'rnatdi.",
    keys: ['komo', 'italiya', 'rekord', 'futbol', 'seriya a']
  },

  // ------------------------------------------------------------------ Fan va texnologiya
  {
    date: '2026-11-06', cat: 'fan',
    text: "Xitoyning Yunnan provinsiyasida taxminan 190–199 million yillik dinozavr embrionlari va tuxumining yumshoq qobig'i topildi.",
    keys: ['dinozavr', 'tuxum', 'xitoy', 'yunnan', 'paleontologiya']
  },
  {
    date: '2026-11-06', cat: 'fan',
    text: "Pompeyda arxeologlar ayolning pardoz buyumlari, tumorlar va 38 ta bronza tanga saqlangan yog'och shkaf qoldiqlarini topdi.",
    keys: ['pompey', 'arxeolog', 'pardoz', 'tanga', 'vezuviy']
  },
  {
    date: '2026-11-06', cat: 'fan',
    text: "Qadimiy DNK tahlili Yevropadagi «ulkan turna» alohida tur emas, kulrang turnaning yirik vakillari bo'lganini ko'rsatdi.",
    keys: ['turna', 'dnk', 'qush', 'muzlik davri', 'yevropa']
  },
  {
    date: '2026-11-06', cat: 'fan',
    text: "Olimlar Yerga o'xshash oltita sayyorani tahlil qildi: birida yil atigi 6,1 kun davom etadi, ammo hech birida hayot borligi tasdiqlanmagan.",
    keys: ['sayyora', 'koinot', 'kosmos', 'ekzosayyora', 'yerga oxshash']
  },
  {
    date: '2026-11-06', cat: 'fan',
    text: "Arabistondagi Rub' al-Xoli cho'lida qadimiy ko'llar atrofidagi 55 ta joyda inson yashaganiga dalil topilmadi.",
    keys: ['arabiston', 'chol', 'kol', 'arxeolog', 'qadimiy']
  },
  {
    date: '2026-11-06', cat: 'fan',
    text: "Mo'g'ulistonda fotograf qoyalar orasida yashiringan manul (yovvoyi mushuk) bolalarini suratga oldi.",
    keys: ['manul', 'mushuk', 'mogoliston', 'hayvon', 'tabiat']
  }
];

const CAT_NAMES: Record<NewsCategory, string> = {
  jahon: 'dunyoda',
  uzbekiston: "O'zbekistonda",
  iqtisodiyot: 'iqtisodiyotda',
  sport: 'sportda',
  fan: 'fan olamida'
};

// Savol yangilik haqidami
// ("nima gap" bu yerda yo'q: u ko'pincha shunchaki salomlashuv)
const NEWS_INTENT = /yangilik|xabarlar|nima xabar|qanday xabar|voqealar|news|dayjest|dunyoda nima|olamda nima/;

const CAT_PATTERNS: Array<[NewsCategory, RegExp]> = [
  ['sport', /sport|futbol|ronaldu|paxtakor|nasaf|neftchi|formula|chempion|terma jamoa/],
  ['iqtisodiyot', /iqtisod|narx|inflyatsiya|qimmat|arzon|bozor|piyoz|kartoshka|dollar|kurs/],
  ['fan', /\bfan\b|texnologiya|ilm|olim|kashfiyot|arxeolog|dinozavr|kosmos|koinot|sayyora/],
  ['uzbekiston', /ozbekiston|yurtimiz|mamlakatimiz|ichki yangilik|toshkent|respublikamiz|mahalliy/],
  ['jahon', /dunyo|jahon|xorij|chet el|olam|xalqaro|aqsh|amerika|rossiya|ukraina|yevropa|xitoy/]
];

function months(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  const names = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  return `${d}-${names[m - 1]}`;
}

/** "Kun.uz ning 6-noyabrdagi xabarlariga ko'ra" (eskirgan bo'lsa ochiq aytiladi) */
function sourcePhrase(): string {
  const ageDays = Math.floor((Date.now() - new Date(`${NEWS_SNAPSHOT.date}T12:00:00`).getTime()) / 86400000);
  const when = months(NEWS_SNAPSHOT.date);
  return ageDays >= 2
    ? `Menda kun.uz ning ${when} holatidagi yangiliklari bor, ular biroz eskirgan bo'lishi mumkin.`
    : `Kun.uz ning ${when} holatidagi xabarlariga ko'ra,`;
}

function listCategory(cat: NewsCategory, n: number): string {
  const items = NEWS.filter((x) => x.cat === cat)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
  return items.map((x) => x.text).join(' ');
}

// Savoldagi ma'nosiz so'zlar ("haqida" o'zagi "haqi" bo'lib, "ish haqi" kalitiga mos kelib qolardi)
const SEARCH_STOP = new Set(
  ['haqida', 'haqidagi', 'haqda', 'gap', 'xabar', 'xabarlar', 'yangilik', 'yangiliklar', 'eshitdingmi', 'bilasanmi', 'bormi',
    'malumot', 'ber', 'bering', 'boldi', 'qildi', 'deyapti', 'bugun', 'bugungi', 'songgi', 'qanday', 'voqea'].map((w) => tokens(w)[0] ?? w)
);
// Umumiy joy nomlari: "Toshkent haqida ma'lumot ber" yangilik savoli emas (faqat "yangilik" so'zi bilan ishlaydi)
const GENERIC_PLACES = new Set(['toshkent', 'ozbekiston', 'navoiy', 'yevropa', 'uy']);

interface Scored {
  item: NewsItem;
  score: number;
  specific: boolean;
}

/** Mavzu bo'yicha qidiruv: aniq so'z mosligi 2 ball, qisman (o'zak) 1 ball */
function searchItems(text: string): Scored[] {
  const user = tokens(text).filter((u) => u.length >= 3 && !SEARCH_STOP.has(u));
  if (user.length === 0) return [];
  const scored = NEWS.map((item) => {
    const keyToks = item.keys.flatMap((k) => tokens(k));
    let score = 0;
    let specific = false;
    for (const u of user) {
      const exact = keyToks.includes(u);
      if (exact || keyToks.some((k) => tokenMatch(u, k))) {
        score += exact ? 2 : 1;
        if (!GENERIC_PLACES.has(u)) specific = true;
      }
    }
    return { item, score, specific };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.item.date.localeCompare(a.item.date));
  if (scored.length === 0) return [];
  const best = scored[0].score;
  return scored.filter((s) => s.score === best).slice(0, 2);
}

// Mavzu so'rovi belgilari: "Tramp haqida nima gap", "Paragvayda nima bo'ldi"
const TOPIC_ASK = /haqida|nima boldi|nima gap|nima qildi|nima deyapti|nima yangilik|qanday voqea|eshitdingmi|bilasanmi/;

/**
 * Yangiliklar savoliga javob. null: savol yangilik haqida emas.
 *  - "Dunyoda nima yangiliklar?" -> 3 ta jahon xabari
 *  - "O'zbekistonda nima gap?", "Sport yangiliklari" -> shu bo'lim
 *  - "Bugun nima yangiliklar?" -> har bo'limdan bittadan
 *  - "Tramp haqida nima yangilik?" -> mavzu bo'yicha
 */
export function newsAnswer(raw: string): string | null {
  const t = normalizeText(raw);
  const intent = NEWS_INTENT.test(t);
  const topical = TOPIC_ASK.test(t);
  if (!intent && !topical) return null;

  // Aniq mavzu (shaxs, davlat, jamoa) so'ralgan bo'lsa, avval shu bo'yicha qidiramiz
  const scored = searchItems(t);
  const found = scored.map((s) => s.item);
  // "Yangilik" so'zi bo'lmasa ("Paragvayda nima bo'ldi?") faqat aniq mavzu (shaxs, davlat, jamoa) topilsa javob beramiz:
  // "Toshkent haqida ma'lumot ber" kabi umumiy savollar yangilikka aylanib ketmasin
  if (!intent) {
    return scored.length && scored.every((s) => s.specific) ? `${sourcePhrase()} ${found.map((f) => f.text).join(' ')}` : null;
  }

  const cat = CAT_PATTERNS.find(([, re]) => re.test(t))?.[0] ?? null;
  const generic = /^(bugun|bugungi|songgi|eng songgi|yangi|qanday|nima|qanaqa)?\s*(nima|qanday|qanaqa)?\s*(yangilik|xabar)/.test(t);

  if (found.length > 0 && !generic && (!cat || found.every((f) => f.cat === cat))) {
    return `${sourcePhrase()} ${found.map((f) => f.text).join(' ')}`;
  }
  if (cat) {
    return `${sourcePhrase()} ${CAT_NAMES[cat]}: ${listCategory(cat, cat === 'jahon' ? 3 : 2)}`;
  }
  const pick = (c: NewsCategory) => listCategory(c, 1);
  return (
    `${sourcePhrase()} dunyoda: ${pick('jahon')} O'zbekistonda: ${pick('uzbekiston')} ` +
    `Iqtisodiyotda: ${pick('iqtisodiyot')} Sportda: ${pick('sport')} ` +
    "Qaysi bo'lim qiziq: dunyo, O'zbekiston, iqtisodiyot, sport yoki fan?"
  );
}

/** Gemini uchun qisqa yangiliklar ro'yxati (savolga shu ma'lumotlar bilan javob bersin) */
export function newsContextForAi(): string {
  return (
    `Kun.uz yangiliklari (${months(NEWS_SNAPSHOT.date)} holati):\n` +
    NEWS.map((x) => `- [${months(x.date)}, ${x.cat}] ${x.text}`).join('\n')
  );
}

export function newsCount(): number {
  return NEWS.length;
}
