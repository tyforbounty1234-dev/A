import type { Word, WordProgress } from '../src/domain/types';
import { newProgress } from '../src/domain/srs/progress';
import wordsJson from '../src/data/words.json';

export const WORDS = wordsJson as Word[];
export const USER = 'user-1';

/** Deterministic pseudo-random generator (mulberry32). */
export function seededRng(seed = 42): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function word(name: string): Word {
  const w = WORDS.find((x) => x.word === name);
  if (!w) throw new Error(`no word ${name}`);
  return w;
}

export function progress(wordId: string, over: Partial<WordProgress> = {}): WordProgress {
  return { ...newProgress(USER, wordId), ...over };
}

export const T0 = new Date('2026-11-19T01:00:00Z'); // 10:00 in Asia/Tokyo
export const DAY = 24 * 60 * 60 * 1000;
export const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
