/**
 * Property tests: random answer histories must never break scheduler invariants.
 */
import { MAX_EASE, MAX_INTERVAL_DAYS, MIN_EASE, initialSrs, schedule, type SrsFields } from '../../src/domain/srs/sm2';
import { applyAnswer } from '../../src/domain/srs/progress';
import { DAY, T0, USER, seededRng } from '../helpers';

const MIN = 60 * 1000;

it('SM-2 invariants hold for 600 random review histories', () => {
  const rng = seededRng(2026);
  for (let run = 0; run < 600; run++) {
    let s: SrsFields = initialSrs();
    let now = T0.getTime();
    for (let i = 0; i < 40; i++) {
      // review on time, early or late
      const due = s.nextReviewAt ? Date.parse(s.nextReviewAt) : now;
      const jitter = (rng() - 0.3) * Math.max(DAY, (due - now) * 0.5);
      now = Math.max(now + MIN, due + jitter);
      const q = Math.floor(rng() * 6);
      const prev = s;
      const next = schedule(prev, q, new Date(now));
      s = next;

      expect(s.easeFactor).toBeGreaterThanOrEqual(MIN_EASE);
      expect(s.easeFactor).toBeLessThanOrEqual(MAX_EASE);
      expect(s.intervalDays).toBeGreaterThan(0);
      expect(s.intervalDays).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
      expect(Date.parse(s.nextReviewAt!)).toBeGreaterThan(now);
      expect(s.lastReviewedAt).toBe(new Date(now).toISOString());
      expect(s.lapses).toBeGreaterThanOrEqual(prev.lapses);
      if (q < 3) {
        expect(s.repetitions).toBe(0);
        expect(Date.parse(s.nextReviewAt!) - now).toBeLessThanOrEqual(10 * MIN);
      } else if (!next.wasEarly) {
        expect(s.repetitions).toBe(prev.repetitions + 1);
        expect(s.intervalDays).toBeGreaterThanOrEqual(Math.min(prev.intervalDays, MAX_INTERVAL_DAYS));
      }
      if (s.repetitions === 0) expect(['learning', 'relearning']).toContain(s.status);
      else expect(['review', 'mastered']).toContain(s.status);
    }
  }
});

it('progress counters stay consistent for random sessions', () => {
  const rng = seededRng(99);
  for (let run = 0; run < 300; run++) {
    let p = undefined as ReturnType<typeof applyAnswer>['progress'] | undefined;
    let now = T0.getTime();
    const n = 1 + Math.floor(rng() * 30);
    for (let i = 0; i < n; i++) {
      now += Math.floor(rng() * 3 * DAY);
      const isCorrect = rng() < 0.7;
      const types = ['en_to_ja_mc', 'ja_to_en_mc', 'spelling'] as const;
      p = applyAnswer(p, {
        id: `r${i}`,
        userId: USER,
        wordId: 'w',
        sessionId: null,
        questionType: types[Math.floor(rng() * 3)]!,
        userAnswer: '',
        isCorrect,
        responseTimeMs: Math.floor(rng() * 20000),
        quality: Math.floor(rng() * 6),
        now: new Date(now),
      }).progress;
    }
    expect(p!.reviewCount).toBe(n);
    expect(p!.correctCount + p!.incorrectCount).toBe(n);
    const attempts = Object.values(p!.competencyScores).reduce((s, c) => s + (c?.attempts ?? 0), 0);
    expect(attempts).toBe(n);
    for (const c of Object.values(p!.competencyScores)) {
      expect(c!.proficiency).toBeGreaterThanOrEqual(0);
      expect(c!.proficiency).toBeLessThanOrEqual(1);
    }
  }
});
