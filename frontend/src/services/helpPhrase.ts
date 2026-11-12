/**
 * Fuqaro yordam so'rayaptimi: "yordam bering" (o'zbekcha), "help me" (inglizcha), "pomosh / помогите" (ruscha).
 * Nutq UzbekVoice.ai (o'zbek modeli) orqali matnga aylanadi, shuning uchun inglizcha va ruscha so'zlar
 * o'zbek lotinida ham kelishi mumkin ("xelp mi", "pamosh"); kirill harflari ham lotinga o'giriladi.
 */
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h'
};

export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => CYR[ch] ?? ch)
    .join('')
    .replace(/[ʻʼ'`‘’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PATTERNS: RegExp[] = [
  // O'zbekcha: "yordam bering", "yordam ber", "yordam kerak", "yordamga", yoki faqat "yordam!"; "qutqaring"
  /\byordam\s*(ber|bering|beringlar|qiling|qilinglar|kerak)\b/,
  /\byordamga\b/,
  /^(iltimos\s+)?yordam(\s+iltimos)?$/,
  /\bqutqar(ing|inglar|ib)?\b/,
  // Inglizcha: "help", "help me", "xelp mi"
  /\b[hx]elp(\s*m[ie]+)?\b/,
  // Ruscha: "pomosh", "pomoshch", "pomogite", "помогите" (lotinga o'girilgan)
  /\bp[ao]m[ao](sh|shch|sch|shi|shu)\b/,
  /\bp[ao]m[ao]g[iy]te\b/
];

export function isHelpRequest(text: string): boolean {
  const t = normalizeSpeech(text);
  if (!t) return false;
  return PATTERNS.some((p) => p.test(t));
}
