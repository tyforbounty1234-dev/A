/**
 * Compact, factual summary of the learner for the AI prompt: proficiency,
 * overall accuracy, the target word's history and recent mistakes. Pure.
 * Everything here is computed from stored data; nothing is inferred by the AI.
 */
import type { Competency, ReviewRecord, UserProfile, Word, WordProgress } from '../types';
import { detectWeakness, WEAK_REASON_LABELS } from '../weakness';
import type { MistakeAnalysis } from './mistakes';
import { SPELLING_PATTERN_LABELS } from './mistakes';

export interface TargetWordContext {
  word: string;
  status: string;
  timesAnswered: number;
  accuracy: number | null;
  timesForgotten: number;
  weakPoints: string[];
  weakestSkill: string | null;
  /** Recent wrong answers on this word, newest first. */
  recentWrongAnswers: { question: string; answered: string }[];
  /** Words the learner has mixed this one up with. */
  confusedWith: string[];
}

export interface LearnerContext {
  proficiencyLevel: number;
  learningGoal: string | null;
  wordsStudied: number;
  overallAccuracy: number | null;
  accuracyBySkill: Partial<Record<'recognition' | 'recall' | 'spelling', number>>;
  weakWords: string[];
  target: TargetWordContext | null;
}

const SKILL_LABEL: Partial<Record<Competency, string>> = {
  recognition: 'recognition (English → Japanese)',
  recall: 'recall (Japanese → English)',
  spelling: 'spelling',
};

const QUESTION_LABEL: Record<string, string> = {
  en_to_ja_mc: 'choose the Japanese meaning',
  ja_to_en_mc: 'choose the English word',
  spelling: 'spell the word',
};

const round2 = (x: number) => Math.round(x * 100) / 100;

export function buildLearnerContext(input: {
  profile: Pick<UserProfile, 'proficiencyLevel' | 'learningGoal'> | null;
  progress: readonly WordProgress[];
  reviews: readonly ReviewRecord[];
  words: readonly Word[];
  analysis: MistakeAnalysis;
  targetWordId?: string;
}): LearnerContext {
  const { progress, reviews, words, analysis, targetWordId } = input;
  const byId = new Map(words.map((w) => [w.id, w]));
  const studied = progress.filter((p) => p.reviewCount > 0);
  const answered = studied.reduce((n, p) => n + p.reviewCount, 0);
  const correct = studied.reduce((n, p) => n + p.correctCount, 0);

  const accuracyBySkill: LearnerContext['accuracyBySkill'] = {};
  for (const c of ['recognition', 'recall', 'spelling'] as const) {
    const s = analysis.byCompetency[c];
    if (s && s.attempts >= 5) accuracyBySkill[c] = round2(1 - s.wrong / s.attempts);
  }

  const weakWords = studied
    .map((p) => ({ p, w: detectWeakness(p) }))
    .filter((x) => x.w.isWeak)
    .sort((a, b) => b.w.score - a.w.score)
    .slice(0, 5)
    .map((x) => byId.get(x.p.wordId)?.word)
    .filter((w): w is string => !!w);

  let target: TargetWordContext | null = null;
  const tw = targetWordId ? byId.get(targetWordId) : undefined;
  if (tw) {
    const p = progress.find((x) => x.wordId === tw.id);
    const weak = p ? detectWeakness(p) : null;
    const wrong = reviews
      .filter((r) => r.wordId === tw.id && !r.isCorrect)
      .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
      .slice(0, 5)
      .map((r) => ({
        question: QUESTION_LABEL[r.questionType] ?? r.questionType,
        answered:
          r.userAnswer.trim() === ''
            ? "(said they didn't know)"
            : r.questionType === 'spelling'
              ? `${r.userAnswer.slice(0, 40)} (${SPELLING_PATTERN_LABELS[analysis.spelling.find((s) => s.wordId === tw.id && s.attempt === r.userAnswer)?.pattern ?? 'other']})`
              : r.userAnswer.slice(0, 60),
      }));
    const confusedWith = analysis.confusions
      .filter((c) => c.wordId === tw.id || c.confusedWithId === tw.id)
      .map((c) => byId.get(c.wordId === tw.id ? c.confusedWithId : c.wordId)?.word)
      .filter((w): w is string => !!w);
    target = {
      word: tw.word,
      status: p && p.reviewCount > 0 ? p.status : 'not studied yet',
      timesAnswered: p?.reviewCount ?? 0,
      accuracy: p && p.reviewCount > 0 ? round2(p.correctCount / p.reviewCount) : null,
      timesForgotten: p?.lapses ?? 0,
      weakPoints: weak ? weak.reasons.map((r) => WEAK_REASON_LABELS[r]) : [],
      weakestSkill: weak?.weakestCompetency ? (SKILL_LABEL[weak.weakestCompetency] ?? null) : null,
      recentWrongAnswers: wrong,
      confusedWith,
    };
  }

  return {
    proficiencyLevel: input.profile?.proficiencyLevel ?? 3,
    learningGoal: input.profile?.learningGoal ?? null,
    wordsStudied: studied.length,
    overallAccuracy: answered > 0 ? round2(correct / answered) : null,
    accuracyBySkill,
    weakWords,
    target,
  };
}
