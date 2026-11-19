/**
 * Core domain types. These are platform-independent and contain no I/O.
 * Static vocabulary data (Word) is kept strictly separate from per-user
 * learning state (WordProgress, ReviewRecord, StudySession).
 */

export type Competency = 'recognition' | 'recall' | 'spelling' | 'context' | 'production';

export const COMPETENCIES: readonly Competency[] = [
  'recognition',
  'recall',
  'spelling',
  'context',
  'production',
] as const;

/** Competencies with question types implemented in Phase 1. */
export const PHASE1_COMPETENCIES: readonly Competency[] = ['recognition', 'recall', 'spelling'];

export type QuestionType =
  | 'en_to_ja_mc' // English word shown, choose the Japanese meaning (recognition)
  | 'ja_to_en_mc' // Japanese meaning shown, choose the English word (recall)
  | 'spelling' // Japanese meaning + English definition shown, type the word (spelling)
  | 'listening' // audio played, choose the meaning (recognition) — Phase 2+
  | 'sentence_completion' // fill the blank in a sentence (context) — Phase 2+
  | 'context' // meaning of the word in a given sentence (context) — Phase 2+
  | 'production'; // write an original sentence (production) — Phase 3 (AI graded)

export const QUESTION_COMPETENCY: Record<QuestionType, Competency> = {
  en_to_ja_mc: 'recognition',
  ja_to_en_mc: 'recall',
  spelling: 'spelling',
  listening: 'recognition',
  sentence_completion: 'context',
  context: 'context',
  production: 'production',
};

export type LearningStatus = 'new' | 'learning' | 'review' | 'relearning' | 'mastered';

export type PartOfSpeech = 'n.' | 'v.' | 'adj.' | 'adv.' | 'prep.' | 'conj.' | 'phr.';

export interface WordSense {
  partOfSpeech: PartOfSpeech;
  ja: string;
  en?: string;
}

export interface ExampleSentence {
  en: string;
  ja?: string;
}

export interface Derivative {
  word: string;
  partOfSpeech: PartOfSpeech;
  ja?: string;
}

/** Static, shared dictionary entry. Never contains user data. */
export interface Word {
  id: string;
  word: string;
  ipa: string | null;
  audioUrl: string | null;
  partOfSpeech: PartOfSpeech;
  /** First sense is the primary meaning used for questions. */
  senses: WordSense[];
  examples: ExampleSentence[];
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  derivatives: Derivative[];
  etymology: string | null;
  /** 1 (easiest) .. 5 (hardest). */
  difficulty: number;
  /** Free-form tags such as "kyoto", "todai", "academic". */
  examTags: string[];
  /** Words in the same group are near-synonyms and are never used as each other's distractors. */
  synonymGroup: string | null;
  /** Accepted alternative spellings (e.g. British forms). */
  spellingVariants: string[];
  /** Order in the curriculum; lower values are introduced first. */
  rank: number;
}

/** SM-2 scheduling state. Used per word and, since Phase 2, per competency. */
export interface SrsState {
  repetitions: number;
  lapses: number;
  easeFactor: number;
  intervalDays: number;
  status: LearningStatus;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  /** Interval modifier used when the current interval was scheduled (Phase 2). */
  modifier?: number;
}

export interface CompetencyStats {
  attempts: number;
  correct: number;
  /** Exponential moving average of answer quality, normalised to 0..1. */
  proficiency: number;
  /** Exponential moving average of response time in ms (correct and incorrect). */
  avgResponseMs: number;
  lastAt: string | null;
  /** Independent schedule for this competency (absent in data written before Phase 2). */
  srs?: SrsState;
}

export type CompetencyScores = Partial<Record<Competency, CompetencyStats>>;

/** Per-user, per-word spaced-repetition state. */
export interface WordProgress {
  userId: string;
  wordId: string;
  reviewCount: number;
  correctCount: number;
  incorrectCount: number;
  /** Consecutive successful recalls since the last lapse (SM-2 "n"). */
  repetitions: number;
  lapses: number;
  easeFactor: number;
  intervalDays: number;
  status: LearningStatus;
  /** ISO timestamps. */
  firstReviewedAt: string | null;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  /** Most recent results, newest last, capped at RECENT_RESULTS_CAP. */
  recentResults: boolean[];
  competencyScores: CompetencyScores;
}

export type ReviewKind = 'new' | 'scheduled' | 'relearn' | 'practice';

/** One answered question. Immutable once created; id is generated on the client for idempotent sync. */
export interface ReviewRecord {
  id: string;
  userId: string;
  wordId: string;
  sessionId: string | null;
  questionType: QuestionType;
  competency: Competency;
  userAnswer: string;
  isCorrect: boolean;
  responseTimeMs: number;
  /** SM-2 quality 0..5 derived from correctness and response time. */
  quality: number;
  kind: ReviewKind;
  reviewedAt: string;
  /** Interval (days) of the tested competency that this review concluded; null for a first test. */
  prevIntervalDays: number | null;
  /** Interval modifier that scheduled that interval; null when unknown. */
  appliedModifier: number | null;
}

export type SessionMode = 'review' | 'learn' | 'mixed' | 'weak';

export interface StudySession {
  id: string;
  userId: string;
  mode: SessionMode;
  startedAt: string;
  completedAt: string | null;
  wordsStudied: number;
  questionsAnswered: number;
  correctAnswers: number;
  accuracy: number | null;
  plannedReviews: number;
  completedReviews: number;
}

export interface UserProfile {
  id: string;
  learningGoal: string | null;
  /** 1..5 */
  proficiencyLevel: number;
  /** Suggested daily study time in minutes. */
  dailyTargetMinutes: number;
  dailyNewWords: number;
  dailyReviewLimit: number;
}

export const DEFAULT_PROFILE: Omit<UserProfile, 'id'> = {
  learningGoal: null,
  proficiencyLevel: 3,
  dailyTargetMinutes: 20,
  dailyNewWords: 10,
  dailyReviewLimit: 100,
};
