/**
 * Turn a raw user response into a graded answer ready for the scheduler.
 */
import type { Word } from '../types';
import type { ChoiceQuestion, SpellingQuestion } from './questions';
import { gradeToQuality, isNearMiss, isSpellingCorrect } from './grading';

export interface EvaluatedAnswer {
  isCorrect: boolean;
  quality: number;
  userAnswer: string;
  correctAnswer: string;
  nearMiss: boolean;
  gaveUp: boolean;
}

/** `choice` null means the learner pressed "わからない" (don't know). */
export function evaluateChoice(q: ChoiceQuestion, choice: number | null, responseTimeMs: number): EvaluatedAnswer {
  const gaveUp = choice === null;
  const isCorrect = !gaveUp && choice === q.answerIndex;
  return {
    isCorrect,
    quality: gradeToQuality({ questionType: q.type, isCorrect, responseTimeMs, gaveUp }),
    userAnswer: gaveUp ? '' : (q.options[choice] ?? ''),
    correctAnswer: q.options[q.answerIndex] ?? '',
    nearMiss: false,
    gaveUp,
  };
}

export function evaluateSpelling(q: SpellingQuestion, word: Word, input: string, responseTimeMs: number): EvaluatedAnswer {
  if (q.wordId !== word.id) throw new Error('evaluateSpelling: word does not match question');
  const gaveUp = input.trim().length === 0;
  const isCorrect = !gaveUp && isSpellingCorrect(word, input);
  const nearMiss = !isCorrect && !gaveUp && isNearMiss(word, input);
  return {
    isCorrect,
    quality: gradeToQuality({ questionType: 'spelling', isCorrect, responseTimeMs, gaveUp, nearMiss }),
    userAnswer: input.trim().slice(0, 500),
    correctAnswer: word.word,
    nearMiss,
    gaveUp,
  };
}
