/**
 * AI javoblari keshi (brauzer xotirasida, internetsiz ham ishlaydi).
 *
 * Gemini bir marta javob bergan savol saqlanadi. Keyingi safar xuddi shu yoki juda o'xshash savol berilsa,
 * javob internetga chiqmasdan, darhol keshdan olinadi. Internet yoki kalit bo'lmasa ham ishlaydi.
 * Eng ko'p 600 ta yozuv; to'lganda eng uzoq vaqt ishlatilmagani o'chiriladi.
 */

import { normalizeText, tokens, tokenMatch } from './textMatch';

interface CacheEntry {
  q: string; // asl savol
  key: string; // normallashtirilgan savol
  toks: string[];
  a: string;
  hits: number;
  used: number; // oxirgi ishlatilgan vaqt
}

const STORAGE_KEY = 'qalqon.answerCache.v1';
const MAX_ENTRIES = 600;
const SIMILARITY = 0.8;

function load(): CacheEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CacheEntry[]) : [];
  } catch {
    return [];
  }
}

let entries: CacheEntry[] = load();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Xotira to'lgan bo'lsa, yarmini o'chirib qayta urinamiz
    entries = entries.sort((a, b) => b.used - a.used).slice(0, Math.floor(entries.length / 2));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* xotira mavjud emas */
    }
  }
}

/** Ikki savol o'zaklari bo'yicha o'xshashligi (Jaccard, qisman moslik bilan) */
function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const common = a.filter((x) => b.some((y) => tokenMatch(x, y))).length;
  return common / (a.length + b.length - common);
}

export const answerCache = {
  /** Savolga keshdagi javob (aynan yoki juda o'xshash savol) */
  get(question: string): string | null {
    const key = normalizeText(question);
    if (!key) return null;
    let hit = entries.find((e) => e.key === key);
    if (!hit) {
      const toks = tokens(question);
      let best = 0;
      for (const e of entries) {
        const s = similarity(toks, e.toks);
        if (s > best) {
          best = s;
          hit = e;
        }
      }
      if (best < SIMILARITY) hit = undefined;
    }
    if (!hit) return null;
    hit.hits++;
    hit.used = Date.now();
    persist();
    return hit.a;
  },

  set(question: string, answer: string) {
    const key = normalizeText(question);
    if (!key || !answer.trim()) return;
    const existing = entries.find((e) => e.key === key);
    if (existing) {
      existing.a = answer;
      existing.used = Date.now();
    } else {
      entries.push({ q: question.trim(), key, toks: tokens(question), a: answer, hits: 0, used: Date.now() });
      if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => b.used - a.used);
        entries = entries.slice(0, MAX_ENTRIES);
      }
    }
    persist();
  },

  size(): number {
    return entries.length;
  },

  clear() {
    entries = [];
    persist();
  }
};
