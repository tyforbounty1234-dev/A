import {
  editDistance,
  gradeToQuality,
  isNearMiss,
  isSpellingCorrect,
  normalizeSpelling,
} from '../../src/domain/assessment/grading';
import { word } from '../helpers';

describe('spelling', () => {
  const w = word('scrutinize');

  it('accepts case, spacing and full-width differences', () => {
    expect(isSpellingCorrect(w, '  Scrutinize ')).toBe(true);
    expect(isSpellingCorrect(w, 'ＳＣＲＵＴＩＮＩＺＥ')).toBe(true);
  });

  it('accepts British -ise variants', () => {
    expect(isSpellingCorrect(w, 'scrutinise')).toBe(true);
    expect(isSpellingCorrect(word('meager'), 'meagre')).toBe(true);
  });

  it('rejects empty and wrong answers', () => {
    expect(isSpellingCorrect(w, '')).toBe(false);
    expect(isSpellingCorrect(w, 'scrutinze')).toBe(false);
  });

  it('detects near misses', () => {
    expect(isNearMiss(w, 'scrutinze')).toBe(true);
    expect(isNearMiss(w, 'scrut')).toBe(false);
  });

  it('normalises quotes and whitespace', () => {
    expect(normalizeSpelling('mull  over')).toBe('mull over');
    expect(normalizeSpelling('it’s')).toBe("it's");
  });

  it('computes edit distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });
});

describe('gradeToQuality', () => {
  it('uses response time for correct answers', () => {
    expect(gradeToQuality({ questionType: 'en_to_ja_mc', isCorrect: true, responseTimeMs: 2000 })).toBe(5);
    expect(gradeToQuality({ questionType: 'en_to_ja_mc', isCorrect: true, responseTimeMs: 6000 })).toBe(4);
    expect(gradeToQuality({ questionType: 'en_to_ja_mc', isCorrect: true, responseTimeMs: 20000 })).toBe(3);
  });

  it('gives spelling more time than multiple choice', () => {
    expect(gradeToQuality({ questionType: 'spelling', isCorrect: true, responseTimeMs: 5000 })).toBe(5);
  });

  it('grades wrong answers below the pass mark', () => {
    expect(gradeToQuality({ questionType: 'spelling', isCorrect: false, responseTimeMs: 1, nearMiss: true })).toBe(2);
    expect(gradeToQuality({ questionType: 'spelling', isCorrect: false, responseTimeMs: 1 })).toBe(1);
    expect(gradeToQuality({ questionType: 'spelling', isCorrect: false, responseTimeMs: 1, gaveUp: true })).toBe(0);
  });

  it('handles negative times defensively', () => {
    expect(gradeToQuality({ questionType: 'ja_to_en_mc', isCorrect: true, responseTimeMs: -5 })).toBe(5);
  });
});
