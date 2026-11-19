/**
 * Study-session planning and progression (pure state machine).
 *
 * Daily workflow: scheduled reviews first (most overdue first), then new words.
 * New words: every card is shown first, then all of them are tested for
 * recognition, then all for recall (each test round in a shuffled order, so the
 * answer cannot be guessed from the card order). Any wrong answer re-queues the word later in
 * the same session (up to MAX_RETRIES_PER_WORD times), which matches the
 * scheduler's short relearning step.
 */
import type { Competency, QuestionType, UserProfile, Word, WordProgress } from './types';
import { PHASE1_COMPETENCIES } from './types';
import { dueProgress, introducedOnDay, unseenWords } from './srs/queue';
import { competenciesToReview, upgradeProgress, weakestCompetency } from './srs/competency';
import { questionTypeFor } from './assessment/questions';
import { hash01 } from './srs/sm2';
import { detectWeakness, type Weakness } from './weakness';
import type { Thresholds } from './adaptive';

export const MAX_RETRIES_PER_WORD = 2;
/** Re-test a missed word after this many other steps (or at the end). */
export const RETRY_GAP = 3;

export type SessionStep =
  | { kind: 'card'; wordId: string }
  | { kind: 'question'; wordId: string; questionType: QuestionType; isRetry: boolean };

export interface SessionPlan {
  steps: SessionStep[];
  reviewWordIds: string[];
  newWordIds: string[];
}

export interface PlanContext {
  words: readonly Word[];
  progressByWord: ReadonlyMap<string, WordProgress>;
  profile: Pick<UserProfile, 'dailyNewWords' | 'dailyReviewLimit'>;
  now: Date;
  competencies?: readonly Competency[];
}

export function remainingNewWordsToday(ctx: PlanContext): number {
  const introduced = introducedOnDay(ctx.progressByWord.values(), ctx.now);
  return Math.max(0, ctx.profile.dailyNewWords - introduced);
}

/**
 * Due reviews. Each word gets one question per due competency (at most two);
 * all first questions come before all second questions so the two tests of the
 * same word are spaced apart.
 */
export function planReviewSession(ctx: PlanContext, maxItems = ctx.profile.dailyReviewLimit): SessionPlan {
  const competencies = ctx.competencies ?? PHASE1_COMPETENCIES;
  const wordIds = new Set(ctx.words.map((w) => w.id));
  const due = dueProgress(ctx.progressByWord.values(), ctx.now)
    .filter((p) => wordIds.has(p.wordId))
    .slice(0, Math.max(0, maxItems));
  const perWord = due.map((p) => competenciesToReview(upgradeProgress(p), ctx.now, competencies));
  const rounds = Math.max(0, ...perWord.map((c) => c.length));
  const steps: SessionStep[] = [];
  for (let r = 0; r < rounds; r++) {
    due.forEach((p, i) => {
      const c = perWord[i]![r];
      if (c) steps.push({ kind: 'question', wordId: p.wordId, questionType: questionTypeFor(c), isRetry: false });
    });
  }
  return { steps, reviewWordIds: due.map((p) => p.wordId), newWordIds: [] };
}

export const WEAK_SESSION_SIZE = 10;

/** Lowest-proficiency competency the learner has actually been tested on. */
function weakestTested(p: WordProgress, competencies: readonly Competency[]): Competency {
  const tested = competencies.filter((c) => (p.competencyScores[c]?.attempts ?? 0) > 0);
  if (tested.length === 0) return weakestCompetency(p, competencies);
  return tested.reduce((a, b) => (p.competencyScores[b]!.proficiency < p.competencyScores[a]!.proficiency ? b : a));
}

/** Weak words ranked by weakness score, strongest evidence first. */
export function rankWeakWords(
  progress: Iterable<WordProgress>,
  thresholds?: Thresholds,
): { progress: WordProgress; weakness: Weakness }[] {
  const out: { progress: WordProgress; weakness: Weakness }[] = [];
  for (const p of progress) {
    const weakness = detectWeakness(p, thresholds);
    if (weakness.isWeak) out.push({ progress: p, weakness });
  }
  return out.sort((a, b) => b.weakness.score - a.weakness.score || a.progress.wordId.localeCompare(b.progress.wordId));
}

/**
 * Focused practice on weak words, testing each word's weakest competency.
 * Correct answers before a word is due are practice and do not lengthen its
 * schedule; wrong answers still shorten it.
 */
export function planWeakSession(ctx: PlanContext & { thresholds?: Thresholds }, size = WEAK_SESSION_SIZE): SessionPlan {
  const competencies = ctx.competencies ?? PHASE1_COMPETENCIES;
  const wordIds = new Set(ctx.words.map((w) => w.id));
  const weak = rankWeakWords(ctx.progressByWord.values(), ctx.thresholds)
    .filter((x) => wordIds.has(x.progress.wordId))
    .slice(0, Math.max(0, size));
  const steps: SessionStep[] = weak.map(({ progress, weakness }) => {
    const c =
      weakness.weakestCompetency && competencies.includes(weakness.weakestCompetency)
        ? weakness.weakestCompetency
        : weakestTested(progress, competencies);
    return { kind: 'question', wordId: progress.wordId, questionType: questionTypeFor(c), isRetry: false };
  });
  return { steps, reviewWordIds: [], newWordIds: [] };
}

export function planLearnSession(ctx: PlanContext, count = remainingNewWordsToday(ctx)): SessionPlan {
  const fresh = unseenWords(ctx.words, ctx.progressByWord).slice(0, Math.max(0, count));
  const seed = ctx.now.toISOString();
  const shuffled = (round: string) =>
    fresh
      .map((w) => ({ w, k: hash01(`${seed}:${round}:${w.id}`) }))
      .sort((a, b) => a.k - b.k)
      .map(({ w }) => w);
  const steps: SessionStep[] = [
    ...fresh.map((w): SessionStep => ({ kind: 'card', wordId: w.id })),
    ...shuffled('recognition').map((w): SessionStep => ({ kind: 'question', wordId: w.id, questionType: 'en_to_ja_mc', isRetry: false })),
    ...shuffled('recall').map((w): SessionStep => ({ kind: 'question', wordId: w.id, questionType: 'ja_to_en_mc', isRetry: false })),
  ];
  return { steps, reviewWordIds: [], newWordIds: fresh.map((w) => w.id) };
}

/** Today's recommended session: due reviews, then new words. */
export function planDailySession(ctx: PlanContext): SessionPlan {
  const review = planReviewSession(ctx);
  const learn = planLearnSession(ctx);
  return {
    steps: [...review.steps, ...learn.steps],
    reviewWordIds: review.reviewWordIds,
    newWordIds: learn.newWordIds,
  };
}

export interface StepResult {
  wordId: string;
  questionType: QuestionType;
  isCorrect: boolean;
  isRetry: boolean;
}

export interface SessionState {
  steps: SessionStep[];
  index: number;
  results: StepResult[];
  retries: Record<string, number>;
}

export function startSession(plan: SessionPlan): SessionState {
  return { steps: plan.steps.slice(), index: 0, results: [], retries: {} };
}

export function currentStep(s: SessionState): SessionStep | null {
  return s.steps[s.index] ?? null;
}

export function isFinished(s: SessionState): boolean {
  return s.index >= s.steps.length;
}

/** Move past a card step. */
export function acknowledgeCard(s: SessionState): SessionState {
  const step = currentStep(s);
  if (!step || step.kind !== 'card') throw new Error('acknowledgeCard: current step is not a card');
  return { ...s, index: s.index + 1 };
}

/** Record the answer to the current question and advance. */
export function answerStep(s: SessionState, isCorrect: boolean): SessionState {
  const step = currentStep(s);
  if (!step || step.kind !== 'question') throw new Error('answerStep: current step is not a question');
  const results = [
    ...s.results,
    { wordId: step.wordId, questionType: step.questionType, isCorrect, isRetry: step.isRetry },
  ];
  let steps = s.steps;
  let retries = s.retries;
  const used = s.retries[step.wordId] ?? 0;
  if (!isCorrect && used < MAX_RETRIES_PER_WORD) {
    const retry: SessionStep = { kind: 'question', wordId: step.wordId, questionType: step.questionType, isRetry: true };
    const at = Math.min(s.index + 1 + RETRY_GAP, steps.length);
    steps = [...steps.slice(0, at), retry, ...steps.slice(at)];
    retries = { ...retries, [step.wordId]: used + 1 };
  }
  return { steps, index: s.index + 1, results, retries };
}

export interface SessionSummary {
  questionsAnswered: number;
  correctAnswers: number;
  /** Accuracy on first attempts only (retries excluded), 0..1, or null if none. */
  firstAttemptAccuracy: number | null;
  wordsStudied: number;
  missedWordIds: string[];
}

export function summarize(s: SessionState): SessionSummary {
  const first = s.results.filter((r) => !r.isRetry);
  const correctFirst = first.filter((r) => r.isCorrect).length;
  const missed = new Set<string>();
  for (const r of first) if (!r.isCorrect) missed.add(r.wordId);
  return {
    questionsAnswered: s.results.length,
    correctAnswers: s.results.filter((r) => r.isCorrect).length,
    firstAttemptAccuracy: first.length ? correctFirst / first.length : null,
    wordsStudied: new Set(s.results.map((r) => r.wordId)).size,
    missedWordIds: [...missed],
  };
}
