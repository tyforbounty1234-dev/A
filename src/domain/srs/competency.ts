/**
 * Competency-specific scheduling (Phase 2).
 *
 * Each competency (recognition, recall, spelling) of a word has its own SM-2
 * state. A student may recognise "ubiquitous" instantly but be unable to spell
 * it; the two skills are forgotten at different rates and are reviewed on their
 * own timetables.
 *
 * The word-level fields of WordProgress are an aggregate of the active
 * competencies, so the existing queue, database index and analytics keep
 * working: the word is due when its earliest competency is due, and it counts as
 * mastered only when every active competency is.
 */
import type { Competency, CompetencyScores, SrsState, WordProgress } from '../types';
import { PHASE1_COMPETENCIES } from '../types';
import { MASTERED_INTERVAL_DAYS, initialSrs, isDue } from './sm2';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_DAYS = 10 / (24 * 60);
/** Reviewing more than this many competencies of one word per session adds little. */
export const MAX_COMPETENCIES_PER_REVIEW = 2;
/** A competency is introduced once another competency has this many consecutive successes. */
export const INTRODUCE_AFTER_REPETITIONS = 2;

export function competencySrs(p: WordProgress | undefined, c: Competency): SrsState | undefined {
  return p?.competencyScores[c]?.srs;
}

export function isActive(srs: SrsState | undefined): srs is SrsState {
  return !!srs && srs.status !== 'new' && srs.nextReviewAt !== null;
}

export function activeCompetencies(p: WordProgress): Competency[] {
  return (Object.keys(p.competencyScores) as Competency[]).filter((c) => isActive(p.competencyScores[c]?.srs));
}

/** Word-level SM-2 fields derived from the competency schedules. */
export function aggregateSrs(scores: CompetencyScores, fallback: SrsState): SrsState {
  const states = Object.values(scores)
    .map((s) => s?.srs)
    .filter(isActive);
  if (states.length === 0) return fallback;
  const minBy = <K extends keyof SrsState>(k: K) => states.reduce((a, b) => ((b[k] as number) < (a[k] as number) ? b : a))[k];
  const next = states.reduce((a, b) => (b.nextReviewAt! < a.nextReviewAt! ? b : a)).nextReviewAt;
  const last = states.reduce<string | null>((a, b) => (b.lastReviewedAt && (!a || b.lastReviewedAt > a) ? b.lastReviewedAt : a), null);
  const repetitions = minBy('repetitions') as number;
  const intervalDays = minBy('intervalDays') as number;
  const lapses = states.reduce((n, s) => n + s.lapses, 0);
  const learning = states.filter((s) => s.repetitions === 0);
  let status: SrsState['status'];
  if (learning.length > 0) status = learning.some((s) => s.lapses > 0) ? 'relearning' : 'learning';
  else status = states.every((s) => s.intervalDays >= MASTERED_INTERVAL_DAYS) ? 'mastered' : 'review';
  return {
    repetitions,
    lapses,
    easeFactor: minBy('easeFactor') as number,
    intervalDays,
    status,
    lastReviewedAt: last,
    nextReviewAt: next,
  };
}

/**
 * Upgrade progress written before Phase 2: competencies that were tested but
 * have no schedule inherit the word-level schedule. Idempotent and lossless.
 */
export function upgradeProgress(p: WordProgress): WordProgress {
  if (p.reviewCount === 0) return p;
  const wordSrs: SrsState = {
    repetitions: p.repetitions,
    lapses: p.lapses,
    easeFactor: p.easeFactor,
    intervalDays: p.intervalDays,
    status: p.status,
    lastReviewedAt: p.lastReviewedAt,
    nextReviewAt: p.nextReviewAt,
  };
  let changed = false;
  const scores: CompetencyScores = { ...p.competencyScores };
  for (const c of Object.keys(scores) as Competency[]) {
    const s = scores[c];
    if (s && s.attempts > 0 && !s.srs) {
      scores[c] = { ...s, srs: { ...wordSrs } };
      changed = true;
    }
  }
  if (!Object.values(scores).some((s) => s && s.attempts > 0)) {
    // Very old data with no competency stats: attribute the schedule to recognition.
    scores.recognition = {
      attempts: p.reviewCount,
      correct: p.correctCount,
      proficiency: p.reviewCount ? p.correctCount / p.reviewCount : 0,
      avgResponseMs: 0,
      lastAt: p.lastReviewedAt,
      srs: { ...wordSrs },
    };
    changed = true;
  }
  return changed ? { ...p, competencyScores: scores } : p;
}

export function relativeOverdue(srs: SrsState, now: Date): number {
  if (!srs.nextReviewAt) return -Infinity;
  const overdueDays = (now.getTime() - Date.parse(srs.nextReviewAt)) / DAY_MS;
  return overdueDays / Math.max(srs.intervalDays, MIN_INTERVAL_DAYS);
}

/**
 * Competencies to test when a word comes up for review, most urgent first:
 * 1. active competencies that are due, most overdue (relative to interval) first;
 * 2. then, if room is left, one inactive competency whose prerequisites are met
 *    (the word is already known in another competency), so new skills are added
 *    gradually instead of all at once.
 * Falls back to the weakest available competency so a due word always gets a question.
 */
export function competenciesToReview(
  p: WordProgress | undefined,
  now: Date,
  available: readonly Competency[] = PHASE1_COMPETENCIES,
  max = MAX_COMPETENCIES_PER_REVIEW,
): Competency[] {
  if (available.length === 0) throw new Error('competenciesToReview: no competencies available');
  const due = available
    .filter((c) => {
      const srs = competencySrs(p, c);
      return isActive(srs) && isDue(srs, now);
    })
    .sort((a, b) => relativeOverdue(competencySrs(p, b)!, now) - relativeOverdue(competencySrs(p, a)!, now));
  const chosen = due.slice(0, max);
  if (chosen.length < max) {
    const known = available.some((c) => (competencySrs(p, c)?.repetitions ?? 0) >= INTRODUCE_AFTER_REPETITIONS);
    const intro = available.find((c) => !isActive(competencySrs(p, c)) && prerequisitesMet(p, c, known));
    if (intro) chosen.push(intro);
  }
  if (chosen.length === 0) chosen.push(weakestCompetency(p, available));
  return chosen;
}

function prerequisitesMet(p: WordProgress | undefined, c: Competency, knownElsewhere: boolean): boolean {
  if (c === 'recognition') return true;
  if (c === 'recall') return (p?.competencyScores.recognition?.correct ?? 0) > 0;
  // spelling and later competencies require the word to be reasonably known
  return knownElsewhere;
}

/** Lowest-proficiency competency among those available (untested first), for focused practice. */
export function weakestCompetency(p: WordProgress | undefined, available: readonly Competency[]): Competency {
  let best = available[0]!;
  let bestScore = Infinity;
  for (const c of available) {
    const s = p?.competencyScores[c];
    if (c === 'spelling' && (p?.competencyScores.recognition?.correct ?? 0) === 0) continue;
    const score = s && s.attempts > 0 ? s.proficiency : -1;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export { initialSrs };
