import {
  accuracyByCompetency,
  dailyHistory,
  dashboardSummary,
  percentile,
  responseTimeStats,
  retentionRate,
  reviewCompletionRate,
  statusCounts,
  studyStreak,
  weakWords,
  weeklyHistory,
} from '../../src/domain/analytics';
import type { ReviewRecord, StudySession } from '../../src/domain/types';
import { DAY, T0, USER, at, progress } from '../helpers';

let n = 0;
const rev = (over: Partial<ReviewRecord>): ReviewRecord => ({
  id: `r${n++}`,
  userId: USER,
  wordId: 'w',
  sessionId: null,
  questionType: 'en_to_ja_mc',
  competency: 'recognition',
  userAnswer: '',
  isCorrect: true,
  responseTimeMs: 1000,
  quality: 5,
  kind: 'scheduled',
  reviewedAt: T0.toISOString(),
  prevIntervalDays: null,
  appliedModifier: null,
  ...over,
});

describe('analytics', () => {
  it('counts statuses', () => {
    const c = statusCounts(
      [
        progress('a', { reviewCount: 3, status: 'mastered' }),
        progress('b', { reviewCount: 3, status: 'review', lapses: 4 }),
        progress('c'),
      ],
      10,
    );
    expect(c).toEqual({ studied: 2, mastered: 1, learning: 1, difficult: 1, unseen: 8 });
  });

  it('computes accuracy per competency', () => {
    const a = accuracyByCompetency([
      rev({ competency: 'spelling', isCorrect: false }),
      rev({ competency: 'spelling' }),
      rev({}),
    ]);
    expect(a.spelling.accuracy).toBe(0.5);
    expect(a.recognition.accuracy).toBe(1);
    expect(a.production.accuracy).toBeNull();
  });

  it('computes response time statistics', () => {
    const rs = [100, 200, 300, 400, 1000].map((t) => rev({ responseTimeMs: t }));
    expect(responseTimeStats(rs)).toEqual({ count: 5, meanMs: 400, medianMs: 300, p90Ms: 1000 });
    expect(responseTimeStats(rs, 'spelling').count).toBe(0);
    expect(percentile([], 0.5)).toBeNull();
  });

  it('builds daily history on local days', () => {
    const rs = [
      rev({ wordId: 'a', reviewedAt: T0.toISOString(), kind: 'new' }),
      rev({ wordId: 'b', reviewedAt: at(T0, -DAY).toISOString(), isCorrect: false, kind: 'new' }),
      // b's spelling introduced today: not a new word today
      rev({ wordId: 'b', reviewedAt: T0.toISOString(), kind: 'new', competency: 'spelling' }),
    ];
    const h = dailyHistory(rs, T0, 3);
    expect(h.map((d) => d.day)).toEqual(['2026-11-17', '2026-11-18', '2026-11-19']);
    expect(h[2]).toMatchObject({ reviews: 2, newWords: 1, accuracy: 1 });
    expect(h[1]).toMatchObject({ reviews: 1, newWords: 1, accuracy: 0 });
  });

  it('builds weekly retention from scheduled reviews only', () => {
    const rs = [rev({}), rev({ isCorrect: false }), rev({ kind: 'new', isCorrect: false })];
    const w = weeklyHistory(rs, T0, 2);
    expect(w[1]!.weekStart).toBe('2026-11-16'); // Monday
    expect(w[1]).toMatchObject({ reviews: 3, scheduledReviews: 2, retention: 0.5 });
    expect(retentionRate(rs).accuracy).toBe(0.5);
  });

  it('ranks weak words', () => {
    const w = weakWords([
      progress('ok', { reviewCount: 5, recentResults: [true, true, true] }),
      progress('bad', { reviewCount: 5, lapses: 3, easeFactor: 1.6, recentResults: [false, false, true] }),
    ]);
    expect(w.map((x) => x.wordId)).toEqual(['bad']);
  });

  it('computes review completion rate', () => {
    const s = (planned: number, done: number) => ({ plannedReviews: planned, completedReviews: done }) as StudySession;
    expect(reviewCompletionRate([s(10, 5), s(10, 10)])).toBe(0.75);
    expect(reviewCompletionRate([s(0, 0)])).toBeNull();
    expect(reviewCompletionRate([s(5, 9)])).toBe(1);
  });

  it('computes study streaks', () => {
    const days = [0, 1, 2, 4].map((d) => rev({ reviewedAt: at(T0, -d * DAY).toISOString() }));
    expect(studyStreak(days, T0)).toBe(3);
    // nothing yet today: streak still counts up to yesterday
    expect(studyStreak(days.slice(1), T0)).toBe(2);
    expect(studyStreak([], T0)).toBe(0);
  });

  it('summarises the dashboard', () => {
    const s = dashboardSummary(
      [progress('a', { reviewCount: 1, status: 'review', repetitions: 1, nextReviewAt: at(T0, -1).toISOString(), firstReviewedAt: T0.toISOString() })],
      [rev({}), rev({ isCorrect: false })],
      203,
      T0,
    );
    expect(s).toMatchObject({ dueNow: 1, reviewedToday: 2, newToday: 1, accuracyToday: 0.5, streak: 1 });
  });
});
