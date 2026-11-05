/**
 * QALQON robotining lokal savol-javob bazasi (oflayn "miya").
 *
 * Har bir mavzuda bir nechta namunaviy savol bor. Fuqaro gapi namunalar bilan so'z o'zaklari bo'yicha solishtiriladi
 * (kam uchraydigan so'zlar og'irroq: IDF). Shuning uchun savol boshqacha so'zlar bilan berilsa ham topiladi.
 * Javoblar qisqa (ovoz bilan o'qiladi), umumiy va xavfsiz maslahatlar; aniq raqam va qoidalar faqat ishonchli bo'lganda.
 */

import { tokens, tokenMatch } from './textMatch';
import { RIGHTS_QA } from './rightsKnowledge';

export interface QaEntry {
  id: string;
  /** Namunaviy savollar (turli shakllarda) */
  q: string[];
  a: string;
}

const BASE_QA: QaEntry[] = [
  // ---------------- Favqulodda raqamlar va yordam ----------------
  {
    id: 'raqamlar',
    q: ['favqulodda raqamlar qaysi', 'qaysi raqamga qongiroq qilay', 'tez yordam raqami nechchi', 'yongin raqami', 'politsiya raqami', 'gaz xizmati raqami', 'telefon raqamlar'],
    a: "Favqulodda raqamlar: 101 — yong'in xizmati, 102 — politsiya, 103 — tez tibbiy yordam, 104 — gaz avariya xizmati. Qo'ng'iroq bepul."
  },
  {
    id: 'yongin',
    q: ['yongin chiqdi', 'uy yonyapti', 'tutun chiqyapti', 'olov ketdi', 'yongin bolsa nima qilish kerak'],
    a: "Yong'in bo'lsa, darhol 101 raqamiga qo'ng'iroq qiling. Binodan tez chiqing, liftdan foydalanmang, tutunda engashib, og'iz-burningizni ho'l mato bilan yoping."
  },
  {
    id: 'gaz',
    q: ['gaz hidi kelyapti', 'gaz chiqyapti', 'gaz sizib chiqdi', 'gaz hidi bolsa nima qilay'],
    a: "Gaz hidi kelsa, chiroq va elektr asboblarini yoqmang, gaz jo'mragini yoping, derazalarni oching va xonadan chiqib, 104 raqamiga qo'ng'iroq qiling."
  },
  {
    id: 'avariya',
    q: ['avtohalokat boldi', 'mashina urib ketdi', 'yol hodisasi boldi', 'avariya boldi', 'mashina urildi'],
    a: "Yo'l-transport hodisasida avval jabrlanganlarga e'tibor bering: 103 ga, keyin 102 ga qo'ng'iroq qiling. Avariya belgisini qo'ying va xodimlar kelguncha hodisa joyini o'zgartirmang."
  },
  {
    id: 'qongiroq-102',
    q: ['102 ga qanday qongiroq qilaman', 'politsiyaga qanday xabar beraman', 'militsiya chaqirish', 'politsiyani chaqir'],
    a: "Istalgan telefondan 102 raqamini tering. Navbatchiga nima bo'lganini, aniq manzilni va ismingizni ayting. Men ham hozir navbatchilik qismiga xabar bera olaman."
  },

  // ---------------- Yo'qolishlar va hujjatlar ----------------
  {
    id: 'pasport',
    q: ['pasportim yoqoldi', 'id kartam yoqoldi', 'hujjatlarim yoqoldi', 'pasportimni yoqotib qoydim', 'pasport yoqotdim nima qilay', 'guvohnomam yoqoldi', 'pasport yangilash'],
    a: "Pasport yoki ID-karta yo'qolsa, eng yaqin ichki ishlar bo'limiga yoki Davlat xizmatlari markaziga murojaat qiling. Yo'qolgan hujjat haqida ariza yoziladi va yangisini olish tartibi tushuntiriladi."
  },
  {
    id: 'haydovchilik',
    q: ['haydovchilik guvohnomasi yoqoldi', 'prava yoqoldi', 'texpasport yoqoldi', 'mashina hujjati yoqoldi'],
    a: "Haydovchilik guvohnomasi yoki texpasport yo'qolsa, Davlat xizmatlari markaziga yoki my.gov.uz portali orqali dublikat olish uchun murojaat qiling."
  },
  {
    id: 'bola-yoqoldi',
    q: ['bolam yoqoldi', 'farzandim adashib qoldi', 'bola yoqolib qoldi', 'oglim yoqolib qoldi', 'qizim yoqoldi', 'bolam topilmayapti', 'ukam topilmayapti', 'oglim topolmayapman'],
    a: "Darhol 102 raqamiga qo'ng'iroq qiling va bolaning ismi, yoshi, kiyimi va oxirgi ko'rilgan joyini ayting. Kutib turmang: qidiruv qancha erta boshlansa, shuncha yaxshi."
  },
  {
    id: 'adashdim',
    q: ['men adashib qoldim', 'yolni topa olmayapman', 'qayerdaman', 'yolni bilmayman', 'adashdim'],
    a: "Xavotir olmang. Yaqin atrofdagi do'kon yoki bino nomini ayting, telefoningizda xaritani oching yoki 102 ga qo'ng'iroq qiling. Men shu yerda kuzatib turaman."
  },
  {
    id: 'telefon-yoqoldi',
    q: ['telefonim yoqoldi', 'telefonimni ogirlashdi', 'sumkam yoqoldi', 'hamyonim yoqoldi', 'narsam yoqoldi'],
    a: "Narsangiz o'g'irlangan bo'lsa, 102 ga qo'ng'iroq qiling yoki yaqin ichki ishlar bo'limiga ariza bering. Telefon yo'qolsa, SIM-kartani va bank kartalarini darhol bloklating."
  },
  {
    id: 'topilma',
    q: ['narsa topib oldim', 'hamyon topdim', 'telefon topib oldim', 'topilgan narsani qayerga beraman', 'egasiz sumka'],
    a: "Topilgan narsani yaqin ichki ishlar bo'limiga topshiring. Egasiz qolgan shubhali sumka yoki quti ko'rsangiz, unga tegmang va darhol 102 ga xabar bering."
  },

  // ---------------- Firibgarlik va kiberxavfsizlik ----------------
  {
    id: 'sms-kod',
    q: ['sms kodni sorashdi', 'bankdan qongiroq qilib kod sorayapti', 'kartamdagi kodni so‘rashdi', 'kod yuborishimni sorashdi'],
    a: "Hech qachon SMS kod, karta PIN-kodi yoki CVV raqamini hech kimga aytmang, hatto o'zini bank xodimi deb tanishtirsa ham. Bu firibgarlik belgisi. Shubha bo'lsa, bankingizga o'zingiz qo'ng'iroq qiling."
  },
  {
    id: 'firibgarlik',
    q: ['firibgarlar aldadi', 'pulimni aldab olishdi', 'internetda aldashdi', 'firibgarlik qurboni boldim', 'pul yutdingiz deyishdi'],
    a: "Firibgarlik qurboni bo'lsangiz, darhol bankingizga qo'ng'iroq qilib kartani bloklating va 102 ga xabar bering. Yozishmalar va to'lov cheklarini dalil sifatida saqlab qo'ying."
  },
  {
    id: 'akkaunt',
    q: ['telegramimni buzishdi', 'telegram akkauntimni buzib qoyishdi', 'akkauntimni ogirlashdi', 'sahifamni xakerlar buzdi', 'instagramimni buzishdi', 'parolimni bilib olishdi'],
    a: "Parolni darhol o'zgartiring, ikki bosqichli himoyani yoqing va do'stlaringizni sizning nomingizdan kelgan xabarlarga ishonmaslik haqida ogohlantiring. Pul talab qilinsa, 102 ga xabar bering."
  },
  {
    id: 'kiber-maslahat',
    q: ['internetda qanday xavfsiz bolish mumkin', 'kiberxavfsizlik maslahat', 'xakerlardan qanday himoyalanaman', 'parol qanday bolishi kerak'],
    a: "Har xil saytlarda har xil murakkab parol ishlating, ikki bosqichli himoyani yoqing, notanish havolalarni ochmang va ilovalarni faqat rasmiy do'kondan o'rnating."
  },

  // ---------------- Shaxsiy xavfsizlik ----------------
  {
    id: 'kuzatyapti',
    q: ['meni kimdir kuzatib kelyapti', 'orqamdan yuribdi', 'notanish odam ergashyapti', 'qorqyapman'],
    a: "Odam ko'p, yorug' joyga o'ting, yaqinlaringizga qo'ng'iroq qiling va zarur bo'lsa 102 ga xabar bering. Men shu yerdaman, siz xavfsiz hududdasiz."
  },
  {
    id: 'kechasi',
    q: ['kechasi yolgiz yurish xavflimi', 'tunda qanday ehtiyot bolish kerak', 'kechqurun uyga yolgiz qaytaman'],
    a: "Kechasi yorug' va gavjum ko'chalardan yuring, telefoningiz quvvatli bo'lsin, yaqinlaringizga qayerdaligingizni ayting va qorong'i xilvat joylardan qoching."
  },
  {
    id: 'bolalar-xavfsizlik',
    q: ['bolalarni qanday himoya qilish kerak', 'bola xavfsizligi', 'bolaga nimani orgatish kerak', 'notanish odam bolaga yaqinlashdi'],
    a: "Bolaga notanish odam bilan ketmaslikni, uy manzili va ota-onasining telefon raqamini yod bilishni, adashsa xodim yoki do'kon sotuvchisidan yordam so'rashni o'rgating."
  },
  {
    id: 'oiladagi-zoravonlik',
    q: ['erim uradi', 'uyda zoravonlik', 'oilada kaltaklashyapti', 'menga tazyiq otkazishyapti', 'xotinimni urishdi'],
    a: "Zo'ravonlik — jinoyat. Xavf ostida bo'lsangiz, darhol 102 ga qo'ng'iroq qiling. Profilaktika inspektoriga yoki ichki ishlar bo'limiga murojaat qilib, himoya orderi so'rashingiz mumkin."
  },

  // ---------------- Yo'l harakati ----------------
  {
    id: 'piyoda',
    q: ['yoldan qanday otish kerak', 'piyodalar otish joyi', 'svetofor qoidasi', 'yol kesib otish'],
    a: "Yo'lni faqat piyodalar o'tish joyidan va svetoforning yashil chirog'ida kesib o'ting. O'tishdan oldin chap va o'ngga qarang, telefonga qarab yurmang."
  },
  {
    id: 'mast-haydovchi',
    q: ['mast haydovchi', 'ichib mashina haydayapti', 'xavfli haydayapti', 'tezlikni oshirib haydayapti'],
    a: "Xavfli haydayotgan yoki mast haydovchini ko'rsangiz, mashina raqamini, rusumini va yo'nalishini eslab qolib, 102 ga xabar bering."
  },
  {
    id: 'jarima',
    q: ['jarimani qayerda tolayman', 'jarimani qayerdan tolasa boladi', 'jarimamni qanday bilaman', 'yol harakati jarimasi', 'shtraf tolash'],
    a: "Yo'l harakati jarimalarini my.gov.uz portali, bank ilovalari yoki to'lov terminallari orqali tekshirib to'lashingiz mumkin."
  },

  // ---------------- Robot haqida ----------------
  {
    id: 'qanday-ishlaysan',
    q: ['qanday ishlaysan', 'qanday korasan', 'qanday tushunasan', 'sen qanday ishlaysan', 'miyang qanday'],
    a: "Men kameralar va 360 darajali LiDAR skaneri bilan atrofni ko'raman, ultratovush datchiklari bilan to'siqlarni sezaman, Raspberry Pi kompyuterim esa sun'iy intellekt yordamida qaror qabul qiladi."
  },
  {
    id: 'yuz-tanish',
    q: ['yuzimni taniysanmi', 'meni taniysanmi', 'yuzimni saqlaysanmi', 'kamera meni yozyaptimi', 'face id'],
    a: "Men faqat rozilik bergan xodimlarning yuzini taniyman. Begona fuqarolarning yuzi bazaga qo'shilmaydi. Video yozuvlar esa xavfsizlik uchun cheklangan muddat saqlanadi va eskisi avtomatik o'chadi."
  },
  {
    id: 'qayerdan',
    q: ['qayerda yasalgansan', 'qayerdansan', 'qaysi universitet', 'seni kim yaratdi', 'sen qayerlik'],
    a: "Meni Navoiy viloyatida, Navoiy viloyati IIB va Navoiy universitetlari talabalari hamkorligida yaratishdi."
  },
  {
    id: 'yosh',
    q: ['necha yoshdasan', 'qachon yaratilgansan', 'qachon tugilgansan'],
    a: "Men 2026-yilda yaratilgan QALQON v1.0 patrul robotiman. Hali yoshman, lekin har kuni yangi narsalarni o'rganaman."
  },
  {
    id: 'ism',
    q: ['isming nima', 'ismingiz nima', 'seni nima deb chaqiraman', 'otingiz nima'],
    a: "Mening ismim QALQON. Men jamoat xavfsizligini ta'minlovchi patrul robotiman."
  },
  {
    id: 'robot-odammi',
    q: ['sen odammisan', 'sen tirikmisan', 'sen haqiqiy politsiyachimisan', 'sening hissing bormi'],
    a: "Men robotman, odam emasman. Politsiya xodimlariga yordamchi sifatida ishlayman va murakkab vaziyatlarda ularni chaqiraman."
  },
  {
    id: 'ozgarish',
    q: ['nimalar qila olasan', 'qanday yordam bera olasan', 'imkoniyatlaring', 'sendan nima sorasam boladi'],
    a: "Men favqulodda holatda 102 va 103 ga yo'naltiraman, huquqiy savollarga qisqa javob beraman, xavfsizlik bo'yicha maslahat beraman va hududni kuzataman. Bemalol so'rang."
  },
  {
    id: 'batareya',
    q: ['batareyang qancha ishlaydi', 'qancha vaqt ishlaysan', 'zaryadka qayerdan olasan', 'quvvating qancha'],
    a: "Men 12 voltli LiFePO4 akkumulyatorda ishlayman. Quvvat kamaysa, navbatchi xodimlar meni zaryadlashadi."
  },
  {
    id: 'tezlik',
    q: ['qanchalik tez yurasan', 'tezliging qancha', 'yugura olasanmi'],
    a: "Men piyodalar tezligida, xavfsiz va ehtiyotkor harakatlanaman. Oldimda to'siq bo'lsa, avtomatik to'xtayman."
  },

  // ---------------- Kundalik suhbat ----------------
  {
    id: 'hazil',
    q: ['hazil ayt', 'latifa ayt', 'meni kuldir', 'qiziq narsa ayt'],
    a: "Robotlar nima uchun hech qachon adashmaydi? Chunki bizda LiDAR bor! Lekin baribir, yo'l so'rashdan uyalmang."
  },
  {
    id: 'kayfiyat',
    q: ['zerikdim', 'kayfiyatim yomon', 'xafaman', 'charchadim'],
    a: "Tushunaman. Biroz dam oling, yaqinlaringiz bilan gaplashing. Agar o'zingizni juda yomon his qilsangiz, mutaxassisga murojaat qilishdan uyalmang. Sog'ligingiz muhim."
  },
  {
    id: 'yaxshi-gap',
    q: ['sen zorsan', 'sen aqllisan', 'senga yoqdim', 'sen yaxshi robotsan', 'baraka top'],
    a: "Rahmat, iliq so'zlaringiz uchun! Sizga xizmat qilish men uchun sharaf."
  },
  {
    id: 'haqorat',
    q: ['sen ahmoqsan', 'sen keraksizsan', 'jim bol', 'yoqol bu yerdan', 'sen tentaksan'],
    a: "Hurmatli fuqaro, keling, bir-birimizni hurmat qilib gaplashaylik. Biror narsa yoqmagan bo'lsa, uzr. Men sizga yordam berish uchun shu yerdaman."
  },
  {
    id: 'kim-kuzatyapti',
    q: ['seni kim boshqaradi', 'seni kim kuzatib turadi', 'operator bormi', 'seni masofadan boshqarishadimi'],
    a: "Meni ichki ishlar organlarining navbatchi operatorlari masofadan kuzatib turishadi. Zarur bo'lsa, ular darhol aralashadi."
  },

  // ---------------- Davlat xizmatlari ----------------
  {
    id: 'davlat-xizmat',
    q: ['davlat xizmatlari markazi qayerda', 'my gov uz nima', 'ariza qayerga beraman', 'malumotnoma olish'],
    a: "Ko'plab davlat xizmatlaridan my.gov.uz portali orqali onlayn yoki tumaningizdagi Davlat xizmatlari markazida foydalanishingiz mumkin."
  },
  {
    id: 'profilaktika',
    q: ['profilaktika inspektori kim', 'uchastka inspektori qayerda', 'mahalla inspektori', 'mahalla posboni'],
    a: "Profilaktika inspektori mahallangizda huquqbuzarliklarning oldini olish bilan shug'ullanadi. U odatda mahalla huquq-tartibot maskanida qabul qiladi."
  },
  {
    id: 'ariza-politsiya',
    q: ['politsiyaga ariza yozmoqchiman', 'shikoyat qilmoqchiman', 'qonunbuzarlik haqida xabar bermoqchiman', 'qoshnim bezovta qilyapti'],
    a: "Arizani yaqin ichki ishlar bo'limiga yoki mahalla profilaktika inspektoriga berishingiz mumkin. Shoshilinch holatda 102 ga qo'ng'iroq qiling."
  },

  // ---------------- Sog'liq va tabiiy hodisalar ----------------
  {
    id: 'birinchi-yordam',
    q: ['birinchi yordam qanday korsatiladi', 'odam yiqildi', 'hushidan ketdi nima qilay', 'qon oqyapti'],
    a: "Avval 103 ga qo'ng'iroq qiling. Odamni xavfsiz joyga yotqizing, nafas olayotganini tekshiring, qon oqsa toza mato bilan bosib turing va shifokorlar kelguncha yonida bo'ling."
  },
  {
    id: 'issiq',
    q: ['issiq urdi', 'quyosh urdi', 'havo juda issiq', 'jazirama'],
    a: "Issiq urganda odamni soya va salqin joyga olib o'ting, yuziga suv seping va suv bering. Holati og'ir bo'lsa, 103 ga qo'ng'iroq qiling."
  },
  {
    id: 'zilzila',
    q: ['zilzila bolsa nima qilish kerak', 'yer silkindi', 'zilzila boldi'],
    a: "Zilzilada derazalardan uzoqlashing, mustahkam stol ostiga yoki ichki devor yoniga o'ting. Silkinish to'xtagach, liftsiz binodan chiqing va ochiq joyga o'ting."
  },
  {
    id: 'muz',
    q: ['yol muz', 'sirpanchiq', 'qishda ehtiyot', 'yiqilib tushmaslik'],
    a: "Muzli yo'lda sekin, kichik qadamlar bilan yuring, qo'llaringizni cho'ntakda ushlamang va sirpanchiq poyabzal kiymang."
  }
];

/** Umumiy mavzular + fuqarolar va xodimlarning huquq-burchlari (rightsKnowledge) */
export const QA_ENTRIES: QaEntry[] = [...BASE_QA, ...RIGHTS_QA];

const RIGHTS_IDS = new Set(RIGHTS_QA.map((e) => e.id));
/** Mavzu huquq-burchlar bazasidanmi */
export const isRightsEntry = (entry: QaEntry) => RIGHTS_IDS.has(entry.id);

// ---------------------------------------------------------------------------
// Moslash: so'z o'zaklari + IDF og'irligi
// ---------------------------------------------------------------------------
interface IndexedSample {
  entry: QaEntry;
  toks: string[];
}

let index: IndexedSample[] | null = null;
let idf: Map<string, number> = new Map();

function buildIndex() {
  index = [];
  const df = new Map<string, number>();
  for (const entry of QA_ENTRIES) {
    for (const q of entry.q) {
      const toks = Array.from(new Set(tokens(q)));
      index.push({ entry, toks });
      for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const n = index.length;
  idf = new Map(Array.from(df.entries()).map(([t, c]) => [t, Math.log(1 + n / c)]));
}

const weight = (t: string) => idf.get(t) ?? Math.log(1 + (index?.length ?? 1)); // noma'lum so'z — kam uchraydi

export interface QaMatch {
  entry: QaEntry;
  /** 0..1: namunaviy savolning qancha qismi fuqaro gapida bor (og'irlik bilan) */
  score: number;
}

/** Eng mos mavzuni topish */
export function findQa(text: string): QaMatch | null {
  if (!index) buildIndex();
  const user = Array.from(new Set(tokens(text)));
  if (user.length === 0) return null;
  let best: QaMatch | null = null;
  for (const s of index!) {
    if (s.toks.length === 0) continue;
    let hit = 0;
    let total = 0;
    for (const t of s.toks) {
      const w = weight(t);
      total += w;
      if (user.some((u) => tokenMatch(u, t))) hit += w;
    }
    // Fuqaro gapidagi ortiqcha so'zlar uchun yengil jarima (uzun boshqa mavzudagi gapga tasodifiy moslik bo'lmasin)
    const extra = user.filter((u) => !s.toks.some((t) => tokenMatch(u, t))).length;
    const score = (hit / total) * (1 / (1 + 0.08 * extra));
    if (!best || score > best.score) best = { entry: s.entry, score };
  }
  return best;
}

export function qaCount(): { topics: number; samples: number } {
  return { topics: QA_ENTRIES.length, samples: QA_ENTRIES.reduce((s, e) => s + e.q.length, 0) };
}
