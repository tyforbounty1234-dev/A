/**
 * Small, dependency-free text helpers used to validate AI output against the
 * dictionary (does a sentence really use the target word? is a field Japanese?).
 * Pure; shared with the ai-tutor Edge Function.
 */
import type { Word } from '../types';

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

function inflect(base: string): string[] {
  const w = base.toLowerCase();
  const forms = new Set<string>([w, `${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`, `${w}er`, `${w}est`, `${w}r`, `${w}st`]);
  const last = w.charAt(w.length - 1);
  const prev = w.charAt(w.length - 2);
  if (last === 'y' && prev && !VOWELS.has(prev)) {
    const stem = w.slice(0, -1);
    for (const s of ['ies', 'ied', 'ier', 'iest', 'ily']) forms.add(stem + s);
  }
  if (last === 'e') {
    const stem = w.slice(0, -1);
    forms.add(`${stem}ing`);
    forms.add(`${stem}ation`);
  }
  if (last === 'e' && prev === 'i') forms.add(`${w.slice(0, -2)}ying`);
  // Consonant doubling (e.g. "compel" -> "compelled").
  if (/[bcdfgklmnprstvz]$/.test(w) && VOWELS.has(prev) && !VOWELS.has(w.charAt(w.length - 3) || 'a')) {
    forms.add(`${w}${last}ed`);
    forms.add(`${w}${last}ing`);
    forms.add(`${w}${last}er`);
  }
  return [...forms];
}

/** Lower-case surface forms that count as "using" the word. Multi-word entries inflect their first token. */
export function wordForms(word: Pick<Word, 'word' | 'spellingVariants'>): string[] {
  const out = new Set<string>();
  for (const base of [word.word, ...word.spellingVariants]) {
    const tokens = base.trim().toLowerCase().split(/\s+/);
    const [head, ...rest] = tokens;
    if (!head) continue;
    for (const f of inflect(head)) out.add([f, ...rest].join(' '));
  }
  return [...out];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `text` contains one of the forms as a whole word (case-insensitive). */
export function containsForm(text: string, forms: readonly string[]): boolean {
  const t = text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'");
  return forms.some((f) => new RegExp(`(^|[^a-z])${escapeRegExp(f).replace(/ /g, '\\s+')}([^a-z]|$)`).test(t));
}

export function usesWord(text: string, word: Pick<Word, 'word' | 'spellingVariants'>): boolean {
  return containsForm(text, wordForms(word));
}

/** Is `text` exactly one form of the word (an exercise answer option, for instance)? */
export function isFormOf(text: string, word: Pick<Word, 'word' | 'spellingVariants'>): boolean {
  const t = text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  return wordForms(word).includes(t);
}

const JAPANESE = /[぀-ヿ㐀-鿿]/;
export function hasJapanese(text: string): boolean {
  return JAPANESE.test(text);
}

const URL_LIKE = /(https?:\/\/|www\.|<\/?[a-z][^>]*>)/i;
/** Links and markup are never valid in tutor output. */
export function hasLinkOrMarkup(text: string): boolean {
  return URL_LIKE.test(text);
}

export function wordCount(en: string): number {
  return en.trim().split(/\s+/).filter(Boolean).length;
}
