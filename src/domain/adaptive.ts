/**
 * Adaptive parameters learned from the user's own history (Phase 2). Pure.
 *
 * 1. Personal response-time thresholds. A "fast" answer for one student is a
 *    hesitant one for another. Once there is enough data, the fast / slow cut-offs
 *    used to turn correctness into SM-2 quality follow the user's own median
 *    time for correct answers, bounded around the defaults.
 *
 * 2. Interval modifier. SM-2 intervals assume a typical forgetting rate. If the
 *    user's observed retention on scheduled reviews is above the target, intervals
 *    can safely be longer (fewer reviews); if below, they must be shorter.
 *    With exponential forgetting R = exp(-t / S), the interval that hits target
 *    retention scales by ln(R_target) / ln(R_observed).
 *
 *    Three safeguards make this a stable controller rather than an oscillator:
 *    - Only mature reviews (tested interval >= MATURE_INTERVAL_DAYS) are used:
 *      first-day retention says little about spaced intervals.
 *    - The update is relative to the modifier that actually produced the observed
 *      retention (recorded on each review), not computed from scratch.
 *    - A Bayesian prior centred on the target and a damping exponent keep small
 *      samples and noise from swinging the schedule.
 */
import type { QuestionType, ReviewRecord } from './types';
import { RESPONSE_THRESHOLDS } from './assessment/grading';
import { MAX_INTERVAL_MODIFIER, MIN_INTERVAL_MODIFIER } from './srs/sm2';

export type Thresholds = Record<QuestionType, readonly [number, number]>;

export const TARGET_RETENTION = 0.9;
export const ADAPTIVE_WINDOW_DAYS = 60;
export const MIN_TIMING_SAMPLES = 20;
export const MIN_RETENTION_SAMPLES = 30;
/** Pseudo-observations at the target retention (strength of the prior). */
export const RETENTION_PRIOR = 20;
export const MATURE_INTERVAL_DAYS = 3;
/** Fraction of the computed correction applied per estimate (0..1]. */
export const MODIFIER_DAMPING = 0.6;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AdaptiveContext {
  thresholds: Thresholds;
  /** Per question type: whether thresholds are personalised (enough data). */
  personalTiming: Partial<Record<QuestionType, { medianMs: number; samples: number }>>;
  intervalModifier: number;
  /** Observed retention on scheduled reviews in the window, or null when there were none. */
  observedRetention: number | null;
  retentionSamples: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveContext = {
  thresholds: RESPONSE_THRESHOLDS,
  personalTiming: {},
  intervalModifier: 1,
  observedRetention: null,
  retentionSamples: 0,
};

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function personalThresholds(reviews: readonly ReviewRecord[]): Pick<AdaptiveContext, 'thresholds' | 'personalTiming'> {
  const thresholds = { ...RESPONSE_THRESHOLDS } as Record<QuestionType, readonly [number, number]>;
  const personalTiming: AdaptiveContext['personalTiming'] = {};
  for (const type of Object.keys(RESPONSE_THRESHOLDS) as QuestionType[]) {
    const times = reviews
      .filter((r) => r.questionType === type && r.isCorrect && r.responseTimeMs > 0)
      .map((r) => r.responseTimeMs)
      .sort((a, b) => a - b);
    if (times.length < MIN_TIMING_SAMPLES) continue;
    const m = median(times);
    const [defFast, defSlow] = RESPONSE_THRESHOLDS[type];
    const fast = clamp(m * 0.8, defFast * 0.5, defFast * 2);
    const slow = Math.max(clamp(m * 2, defSlow * 0.5, defSlow * 2), fast * 1.5);
    thresholds[type] = [Math.round(fast), Math.round(slow)];
    personalTiming[type] = { medianMs: Math.round(m), samples: times.length };
  }
  return { thresholds, personalTiming };
}

/**
 * @param scheduled  mature scheduled reviews in the window
 * @param correct    how many of them were answered correctly
 * @param inEffect   mean modifier that scheduled those reviews' intervals
 */
export function intervalModifierFor(scheduled: number, correct: number, inEffect = 1): number {
  const base = clamp(inEffect, MIN_INTERVAL_MODIFIER, MAX_INTERVAL_MODIFIER);
  if (scheduled < MIN_RETENTION_SAMPLES) return Math.round(base * 100) / 100;
  const r = Math.min(0.995, (correct + TARGET_RETENTION * RETENTION_PRIOR) / (scheduled + RETENTION_PRIOR));
  const correction = Math.log(TARGET_RETENTION) / Math.log(r);
  const m = base * Math.pow(correction, MODIFIER_DAMPING);
  return Math.round(clamp(m, MIN_INTERVAL_MODIFIER, MAX_INTERVAL_MODIFIER) * 100) / 100;
}

/** Build the adaptive context from reviews in the last ADAPTIVE_WINDOW_DAYS. */
export function adaptiveContext(reviews: readonly ReviewRecord[], now: Date): AdaptiveContext {
  const since = new Date(now.getTime() - ADAPTIVE_WINDOW_DAYS * DAY_MS).toISOString();
  const recent = reviews.filter((r) => r.reviewedAt >= since);
  const scheduled = recent.filter((r) => r.kind === 'scheduled');
  const correct = scheduled.filter((r) => r.isCorrect).length;
  const mature = scheduled.filter((r) => (r.prevIntervalDays ?? 0) >= MATURE_INTERVAL_DAYS);
  const matureCorrect = mature.filter((r) => r.isCorrect).length;
  const inEffect = mature.length ? mature.reduce((s, r) => s + (r.appliedModifier ?? 1), 0) / mature.length : 1;
  return {
    ...personalThresholds(recent),
    intervalModifier: intervalModifierFor(mature.length, matureCorrect, inEffect),
    observedRetention: scheduled.length ? correct / scheduled.length : null,
    retentionSamples: scheduled.length,
  };
}
