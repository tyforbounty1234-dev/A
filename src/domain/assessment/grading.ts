/**
 * Answer checking and conversion of an answer into an SM-2 quality score.
 */
import type { QuestionType, Word } from '../types';
import type { Quality } from '../srs/sm2';

/** Response-time thresholds (ms) per question type: [fast, slow]. */
export const RESPONSE_THRESHOLDS: Record<QuestionType, readonly [number, number]> = {
  en_to_ja_mc: [3000, 8000],
  ja_to_en_mc: [3500, 9000],
  spelling: [6000, 15000],
  listening: [4000, 10000],
  sentence_completion: [6000, 15000],
  context: [8000, 20000],
  production: [30000, 90000],
};

/** Normalise free-text input for spelling comparison. */
export function normalizeSpelling(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function acceptedSpellings(word: Pick<Word, 'word' | 'spellingVariants'>): string[] {
  return [word.word, ...word.spellingVariants].map(normalizeSpelling);
}

export function isSpellingCorrect(word: Pick<Word, 'word' | 'spellingVariants'>, input: string): boolean {
  const answer = normalizeSpelling(input);
  return answer.length > 0 && acceptedSpellings(word).includes(answer);
}

/** Levenshtein edit distance (iterative, O(n*m) time, O(m) memory). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** A wrong spelling that is one edit away from a word of 5+ letters. */
export function isNearMiss(word: Pick<Word, 'word' | 'spellingVariants'>, input: string): boolean {
  const answer = normalizeSpelling(input);
  if (answer.length === 0) return false;
  return acceptedSpellings(word).some((s) => s.length >= 5 && editDistance(s, answer) === 1);
}

export interface GradeInput {
  questionType: QuestionType;
  isCorrect: boolean;
  responseTimeMs: number;
  /** True when no answer was given (skipped / "I don't know"). */
  gaveUp?: boolean;
  /** Spelling only: the wrong answer was one edit away. */
  nearMiss?: boolean;
}

/**
 * Map an answer to SM-2 quality:
 *  5 = correct and fast, 4 = correct, 3 = correct but slow (hesitant),
 *  2 = wrong but nearly right, 1 = wrong, 0 = no answer.
 */
export function gradeToQuality(input: GradeInput): Quality {
  if (input.gaveUp) return 0;
  if (!input.isCorrect) return input.nearMiss ? 2 : 1;
  const [fast, slow] = RESPONSE_THRESHOLDS[input.questionType];
  const rt = Math.max(0, input.responseTimeMs);
  if (rt <= fast) return 5;
  if (rt <= slow) return 4;
  return 3;
}
