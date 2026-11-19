/**
 * Applying a single answered question to a user's word progress.
 * Pure: produces a new WordProgress and the immutable ReviewRecord to persist.
 */
import type {
  Competency,
  CompetencyScores,
  CompetencyStats,
  QuestionType,
  ReviewKind,
  ReviewRecord,
  WordProgress,
} from '../types';
import { QUESTION_COMPETENCY } from '../types';
import { initialSrs, isPassing, schedule, srsFieldsOf } from './sm2';

export const RECENT_RESULTS_CAP = 20;
/** Weight of the newest observation in competency moving averages. */
export const COMPETENCY_EMA_ALPHA = 0.3;

export function newProgress(userId: string, wordId: string): WordProgress {
  return {
    userId,
    wordId,
    reviewCount: 0,
    correctCount: 0,
    incorrectCount: 0,
    ...initialSrs(),
    firstReviewedAt: null,
    recentResults: [],
    competencyScores: {},
  };
}

export interface AnswerInput {
  id: string;
  userId: string;
  wordId: string;
  sessionId: string | null;
  questionType: QuestionType;
  userAnswer: string;
  isCorrect: boolean;
  responseTimeMs: number;
  quality: number;
  now: Date;
}

export interface ApplyResult {
  progress: WordProgress;
  review: ReviewRecord;
}

export function reviewKindFor(prev: WordProgress, now: Date): ReviewKind {
  if (prev.status === 'new' || prev.reviewCount === 0) return 'new';
  if (prev.repetitions === 0) return 'relearn';
  if (prev.nextReviewAt && Date.parse(prev.nextReviewAt) > now.getTime()) return 'practice';
  return 'scheduled';
}

export function updateCompetency(
  prev: CompetencyStats | undefined,
  quality: number,
  isCorrect: boolean,
  responseTimeMs: number,
  nowIso: string,
): CompetencyStats {
  const q01 = Math.min(5, Math.max(0, quality)) / 5;
  const rt = Math.max(0, Math.round(responseTimeMs));
  if (!prev || prev.attempts === 0) {
    return { attempts: 1, correct: isCorrect ? 1 : 0, proficiency: round3(q01), avgResponseMs: rt, lastAt: nowIso };
  }
  const a = COMPETENCY_EMA_ALPHA;
  return {
    attempts: prev.attempts + 1,
    correct: prev.correct + (isCorrect ? 1 : 0),
    proficiency: round3(prev.proficiency * (1 - a) + q01 * a),
    avgResponseMs: Math.round(prev.avgResponseMs * (1 - a) + rt * a),
    lastAt: nowIso,
  };
}

export function applyAnswer(prevOrUndefined: WordProgress | undefined, input: AnswerInput): ApplyResult {
  const prev = prevOrUndefined ?? newProgress(input.userId, input.wordId);
  if (prev.userId !== input.userId || prev.wordId !== input.wordId) {
    throw new Error('applyAnswer: progress does not belong to this user/word');
  }
  const nowIso = input.now.toISOString();
  const competency: Competency = QUESTION_COMPETENCY[input.questionType];
  const kind = reviewKindFor(prev, input.now);
  // Correctness is the source of truth; quality must agree with it.
  const quality = input.isCorrect ? Math.max(3, input.quality) : Math.min(2, input.quality);
  const next = schedule(srsFieldsOf(prev), quality, input.now);

  const competencyScores: CompetencyScores = {
    ...prev.competencyScores,
    [competency]: updateCompetency(
      prev.competencyScores[competency],
      quality,
      input.isCorrect,
      input.responseTimeMs,
      nowIso,
    ),
  };

  const progress: WordProgress = {
    ...prev,
    repetitions: next.repetitions,
    lapses: next.lapses,
    easeFactor: next.easeFactor,
    intervalDays: next.intervalDays,
    status: next.status,
    lastReviewedAt: next.lastReviewedAt,
    nextReviewAt: next.nextReviewAt,
    reviewCount: prev.reviewCount + 1,
    correctCount: prev.correctCount + (input.isCorrect ? 1 : 0),
    incorrectCount: prev.incorrectCount + (input.isCorrect ? 0 : 1),
    firstReviewedAt: prev.firstReviewedAt ?? nowIso,
    recentResults: [...prev.recentResults, input.isCorrect].slice(-RECENT_RESULTS_CAP),
    competencyScores,
  };

  const review: ReviewRecord = {
    id: input.id,
    userId: input.userId,
    wordId: input.wordId,
    sessionId: input.sessionId,
    questionType: input.questionType,
    competency,
    userAnswer: input.userAnswer,
    isCorrect: input.isCorrect,
    responseTimeMs: Math.max(0, Math.round(input.responseTimeMs)),
    quality,
    kind,
    reviewedAt: nowIso,
  };

  return { progress, review };
}

/** Words that need extra attention. */
export function isDifficult(p: WordProgress): boolean {
  if (p.reviewCount === 0) return false;
  if (p.lapses >= 3) return true;
  if (p.easeFactor < 1.8) return true;
  const recent = p.recentResults.slice(-6);
  if (recent.length >= 4) {
    const acc = recent.filter(Boolean).length / recent.length;
    if (acc < 0.5) return true;
  }
  return false;
}

export function proficiencyOf(p: WordProgress, c: Competency): number | null {
  const s = p.competencyScores[c];
  return s && s.attempts > 0 ? s.proficiency : null;
}

export { isPassing };

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
