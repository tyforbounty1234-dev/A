import { applyAnswer, isDifficult, reviewKindFor } from '../../src/domain/srs/progress';
import { chooseCompetency, dueProgress, introducedOnDay, unseenWords } from '../../src/domain/srs/queue';
import { DAY, T0, USER, WORDS, at, progress } from '../helpers';

const answer = (over: Partial<Parameters<typeof applyAnswer>[1]> = {}) => ({
  id: 'r1',
  userId: USER,
  wordId: 'w1',
  sessionId: null,
  questionType: 'en_to_ja_mc' as const,
  userAnswer: 'x',
  isCorrect: true,
  responseTimeMs: 2000,
  quality: 5,
  now: T0,
  ...over,
});

describe('applyAnswer', () => {
  it('creates progress for a new word and a matching review record', () => {
    const { progress: p, review } = applyAnswer(undefined, answer());
    expect(p.reviewCount).toBe(1);
    expect(p.correctCount).toBe(1);
    expect(p.firstReviewedAt).toBe(T0.toISOString());
    expect(p.competencyScores.recognition).toEqual({
      attempts: 1,
      correct: 1,
      proficiency: 1,
      avgResponseMs: 2000,
      lastAt: T0.toISOString(),
    });
    expect(review).toMatchObject({ competency: 'recognition', kind: 'new', quality: 5, isCorrect: true });
  });

  it('keeps quality consistent with correctness', () => {
    const wrong = applyAnswer(undefined, answer({ isCorrect: false, quality: 5 }));
    expect(wrong.review.quality).toBeLessThan(3);
    expect(wrong.progress.repetitions).toBe(0);
    const right = applyAnswer(undefined, answer({ isCorrect: true, quality: 0 }));
    expect(right.review.quality).toBe(3);
  });

  it('tracks competencies independently', () => {
    let p = applyAnswer(undefined, answer()).progress;
    p = applyAnswer(p, answer({ id: 'r2', questionType: 'spelling', isCorrect: false, quality: 1, now: at(T0, 1000) })).progress;
    expect(p.competencyScores.recognition?.proficiency).toBe(1);
    expect(p.competencyScores.spelling?.proficiency).toBe(0.2);
    expect(p.incorrectCount).toBe(1);
    expect(p.recentResults).toEqual([true, false]);
  });

  it('caps the recent results history', () => {
    let p = applyAnswer(undefined, answer()).progress;
    for (let i = 0; i < 30; i++) p = applyAnswer(p, answer({ id: `r${i}`, now: at(T0, i * 1000) })).progress;
    expect(p.recentResults).toHaveLength(20);
    expect(p.reviewCount).toBe(31);
  });

  it('rejects progress belonging to another word', () => {
    expect(() => applyAnswer(progress('other'), answer())).toThrow();
  });

  it('classifies review kinds', () => {
    const p1 = applyAnswer(undefined, answer()).progress;
    expect(reviewKindFor(p1, at(T0, 60_000))).toBe('practice');
    expect(reviewKindFor(p1, at(T0, DAY + 1))).toBe('scheduled');
    const failed = applyAnswer(p1, answer({ id: 'r2', isCorrect: false, quality: 1, now: at(T0, DAY) })).progress;
    expect(reviewKindFor(failed, at(T0, DAY + 600_000))).toBe('relearn');
  });
});

describe('isDifficult', () => {
  it('flags repeated lapses, low ease and poor recent accuracy', () => {
    expect(isDifficult(progress('a'))).toBe(false);
    expect(isDifficult(progress('a', { reviewCount: 5, lapses: 3 }))).toBe(true);
    expect(isDifficult(progress('a', { reviewCount: 5, easeFactor: 1.5 }))).toBe(true);
    expect(isDifficult(progress('a', { reviewCount: 5, recentResults: [false, false, true, false] }))).toBe(true);
    expect(isDifficult(progress('a', { reviewCount: 5, recentResults: [true, true, true, false] }))).toBe(false);
  });
});

describe('review queue', () => {
  const now = at(T0, 10 * DAY);
  const scheduled = (id: string, overdueDays: number, intervalDays: number, over = {}) =>
    progress(id, {
      reviewCount: 3,
      repetitions: 2,
      status: 'review',
      intervalDays,
      nextReviewAt: at(now, -overdueDays * DAY).toISOString(),
      ...over,
    });

  it('returns only due words, most overdue relative to interval first', () => {
    const list = [
      scheduled('long', 3, 60),
      scheduled('short', 3, 2),
      scheduled('future', -1, 5),
      progress('new'),
    ];
    expect(dueProgress(list, now).map((p) => p.wordId)).toEqual(['short', 'long']);
  });

  it('puts relearning words ahead of slightly overdue reviews', () => {
    const list = [
      scheduled('review', 0.5, 6),
      scheduled('relearn', 0.001, 10 / 1440, { status: 'relearning', repetitions: 0 }),
    ];
    expect(dueProgress(list, now)[0]!.wordId).toBe('relearn');
  });

  it('lists unseen words in curriculum order', () => {
    const seen = new Map([[WORDS[0]!.id, progress(WORDS[0]!.id, { reviewCount: 1 })]]);
    const fresh = unseenWords(WORDS, seen);
    expect(fresh[0]!.id).toBe(WORDS[1]!.id);
    expect(fresh).toHaveLength(WORDS.length - 1);
  });

  it('counts words introduced on the local day', () => {
    const list = [
      progress('a', { firstReviewedAt: '2026-11-19T00:30:00Z' }), // 09:30 JST on the 19th
      progress('b', { firstReviewedAt: '2026-11-18T14:59:00Z' }), // 23:59 JST on the 18th
      progress('c', { firstReviewedAt: '2026-11-18T15:00:00Z' }), // 00:00 JST on the 19th
    ];
    expect(introducedOnDay(list, T0)).toBe(2);
  });
});

describe('chooseCompetency', () => {
  const all = ['recognition', 'recall', 'spelling'] as const;
  it('tests recognition first and holds spelling back until recognised', () => {
    expect(chooseCompetency(undefined, all)).toBe('recognition');
    const p = progress('w', {
      competencyScores: { recognition: { attempts: 1, correct: 0, proficiency: 0.2, avgResponseMs: 1, lastAt: null } },
    });
    expect(chooseCompetency(p, all)).toBe('recall');
  });

  it('picks the weakest competency', () => {
    const s = (proficiency: number) => ({ attempts: 2, correct: 1, proficiency, avgResponseMs: 1, lastAt: null });
    const p = progress('w', { competencyScores: { recognition: s(0.9), recall: s(0.7), spelling: s(0.3) } });
    expect(chooseCompetency(p, all)).toBe('spelling');
  });
});
