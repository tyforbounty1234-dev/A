/**
 * Review queue construction: which words to review now, in which order.
 */
import type { Competency, Word, WordProgress } from '../types';
import { isDue } from './sm2';
import { isDifficult } from './progress';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_DAYS = 10 / (24 * 60);

/**
 * Priority of a due item. Higher is more urgent.
 * Overdue items are ranked by how late they are relative to their interval
 * (an item 3 days late on a 2-day interval is at higher risk of being forgotten
 * than one 3 days late on a 60-day interval). Relearning items and difficult
 * items get a boost; lower ease breaks ties.
 */
export function duePriority(p: WordProgress, now: Date): number {
  if (!p.nextReviewAt) return -Infinity;
  const overdueDays = (now.getTime() - Date.parse(p.nextReviewAt)) / DAY_MS;
  const relative = overdueDays / Math.max(p.intervalDays, MIN_INTERVAL_DAYS);
  let score = Math.min(relative, 50);
  if (p.status === 'relearning' || p.status === 'learning') score += 2;
  if (isDifficult(p)) score += 1;
  score += (3 - p.easeFactor) * 0.1;
  return score;
}

export function dueProgress(progress: Iterable<WordProgress>, now: Date): WordProgress[] {
  const due: WordProgress[] = [];
  for (const p of progress) if (isDue(p, now)) due.push(p);
  return due.sort((a, b) => {
    const d = duePriority(b, now) - duePriority(a, now);
    if (d !== 0) return d;
    return a.wordId < b.wordId ? -1 : a.wordId > b.wordId ? 1 : 0;
  });
}

export function countDue(progress: Iterable<WordProgress>, now: Date): number {
  let n = 0;
  for (const p of progress) if (isDue(p, now)) n++;
  return n;
}

/** Words never studied, in curriculum order. */
export function unseenWords(words: readonly Word[], progressByWord: ReadonlyMap<string, WordProgress>): Word[] {
  return words
    .filter((w) => {
      const p = progressByWord.get(w.id);
      return !p || p.reviewCount === 0;
    })
    .sort((a, b) => a.rank - b.rank || a.difficulty - b.difficulty || a.word.localeCompare(b.word));
}

/** Count of words whose first review happened on the same local day as `now`. */
export function introducedOnDay(progress: Iterable<WordProgress>, now: Date): number {
  const key = localDayKey(now);
  let n = 0;
  for (const p of progress) if (p.firstReviewedAt && localDayKey(new Date(p.firstReviewedAt)) === key) n++;
  return n;
}

export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Choose which competency to test for a review item: the weakest of the
 * available competencies. Untested competencies come first, in the order given.
 * Spelling is only tested after the word has been recognised correctly at least once.
 */
export function chooseCompetency(p: WordProgress | undefined, available: readonly Competency[]): Competency {
  if (available.length === 0) throw new Error('chooseCompetency: no competencies available');
  const candidates = available.filter((c) => {
    if (c !== 'spelling') return true;
    return (p?.competencyScores.recognition?.correct ?? 0) > 0;
  });
  const pool = candidates.length > 0 ? candidates : [available[0]!];
  let best = pool[0]!;
  let bestScore = Infinity;
  for (const c of pool) {
    const s = p?.competencyScores[c];
    const score = s && s.attempts > 0 ? s.proficiency : -1;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
