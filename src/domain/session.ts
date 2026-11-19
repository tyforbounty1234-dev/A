/**
 * Study-session planning and progression (pure state machine).
 *
 * Daily workflow: scheduled reviews first (most overdue first), then new words.
 * A new word is introduced with a card, tested for recognition, and tested for
 * recall at the end of the session. Any wrong answer re-queues the word later in
 * the same session (up to MAX_RETRIES_PER_WORD times), which matches the
 * scheduler's short relearning step.
 */
import type { Competency, QuestionType, UserProfile, Word, WordProgress } from './types';
import { PHASE1_COMPETENCIES } from './types';
import { chooseCompetency, dueProgress, introducedOnDay, unseenWords } from './srs/queue';
import { questionTypeFor } from './assessment/questions';

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

export function planReviewSession(ctx: PlanContext, maxItems = ctx.profile.dailyReviewLimit): SessionPlan {
  const competencies = ctx.competencies ?? PHASE1_COMPETENCIES;
  const wordIds = new Set(ctx.words.map((w) => w.id));
  const due = dueProgress(ctx.progressByWord.values(), ctx.now)
    .filter((p) => wordIds.has(p.wordId))
    .slice(0, Math.max(0, maxItems));
  const steps: SessionStep[] = due.map((p) => ({
    kind: 'question',
    wordId: p.wordId,
    questionType: questionTypeFor(chooseCompetency(p, competencies)),
    isRetry: false,
  }));
  return { steps, reviewWordIds: due.map((p) => p.wordId), newWordIds: [] };
}

export function planLearnSession(ctx: PlanContext, count = remainingNewWordsToday(ctx)): SessionPlan {
  const fresh = unseenWords(ctx.words, ctx.progressByWord).slice(0, Math.max(0, count));
  const steps: SessionStep[] = [];
  for (const w of fresh) {
    steps.push({ kind: 'card', wordId: w.id });
    steps.push({ kind: 'question', wordId: w.id, questionType: 'en_to_ja_mc', isRetry: false });
  }
  for (const w of fresh) {
    steps.push({ kind: 'question', wordId: w.id, questionType: 'ja_to_en_mc', isRetry: false });
  }
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
