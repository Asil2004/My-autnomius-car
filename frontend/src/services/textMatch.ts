/**
 * O'zbekcha matnni solishtirish uchun yordamchi funksiyalar (oflayn, kutubxonasiz).
 * Kirill -> lotin, apostroflarni birxillashtirish, qo'shimchalarni kesish (yengil stemming) va o'xshashlik bahosi.
 */

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '',
  ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h'
};

export function toLatin(text: string): string {
  return text.replace(/[Ѐ-ӿ]/g, (ch) => {
    const lower = ch.toLowerCase();
    const lat = CYR[lower];
    if (lat === undefined) return ch;
    return ch === lower ? lat : lat.charAt(0).toUpperCase() + lat.slice(1);
  });
}

/** Kichik harf, apostrofsiz, tinish belgilarisiz (solishtirish uchun) */
export function normalizeText(text: string): string {
  return toLatin(text)
    .toLowerCase()
    .replace(/[ʻʼ'`’‘]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Uzundan qisqaga: avval eng uzun qo'shimcha kesiladi
const SUFFIXES = [
  'larimizning', 'laringizni', 'laringizga', 'laringiz', 'larimizni', 'larimiz', 'larining', 'laridan', 'larida', 'lariga',
  'larini', 'larning', 'lardagi', 'lardan', 'larda', 'larga', 'larni', 'lari', 'lar',
  'imizning', 'ingizning', 'ingizni', 'ingizga', 'ingizda', 'ingiz', 'imizni', 'imiz', 'imning', 'imni', 'imga', 'imda',
  'ning', 'dagi', 'gacha', 'dan', 'dek', 'day', 'niki', 'mizni', 'miz',
  'yapti', 'yapman', 'yapsiz', 'moqda', 'ayapti', 'gan', 'kan', 'qan', 'ish', 'adi', 'aman', 'asiz', 'ydi',
  'ga', 'ka', 'qa', 'da', 'ni', 'im', 'ing', 'iz', 'si', 'mi', 'chi'
];

/** Yengil stemming: so'z kamida 3 harf qolguncha qo'shimchalarni kesadi (2 qadamgacha) */
export function stem(word: string): string {
  let w = word;
  for (let pass = 0; pass < 2; pass++) {
    const suf = SUFFIXES.find((s) => w.endsWith(s) && w.length - s.length >= 3);
    if (!suf) break;
    w = w.slice(0, -suf.length);
  }
  return w;
}

// Ma'no bermaydigan so'zlar (savol so'zlari va bog'lovchilar)
const STOP = new Set([
  'va', 'bilan', 'uchun', 'ham', 'endi', 'bu', 'shu', 'u', 'men', 'sen', 'siz', 'biz', 'ular', 'mening', 'sizning',
  'qanday', 'qanaqa', 'nima', 'nimaga', 'nega', 'qachon', 'qayer', 'qayerda', 'qayerga', 'kim', 'qaysi', 'necha', 'nechta',
  'mi', 'chi', 'edi', 'ekan', 'bor', 'yoq', 'kerak', 'mumkin', 'qilsam', 'qilish', 'qilay', 'boladi', 'bolsa', 'bolib',
  'iltimos', 'aytib', 'bering', 'ber', 'ayt', 'ayting', 'menga', 'sizga', 'bizga', 'agar', 'yoki', 'lekin', 'juda',
  'bitta', 'biror', 'har', 'hamma', 'qil', 'qiling', 'qildi', 'deb', 'degan', 'emas', 'ha', 'xo', 'ok', 'qalqon', 'robot'
]);

/** Matndan ma'noli so'z o'zaklari to'plami */
export function tokens(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Qisman moslik: o'zaklar bir-birining boshi bo'lsa ham hisoblanadi (pasport ~ pasportim) */
export function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.startsWith(s);
}
