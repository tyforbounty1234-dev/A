import {
  INITIAL_EASE,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  RELEARN_MINUTES,
  initialSrs,
  isDue,
  nextEase,
  schedule,
  type SrsFields,
} from '../../src/domain/srs/sm2';
import { DAY, T0, at } from '../helpers';

const due = (s: SrsFields) => new Date(Date.parse(s.nextReviewAt!));

describe('nextEase (SM-2 formula)', () => {
  it.each([
    [5, 2.6],
    [4, 2.5],
    [3, 2.36],
    [2, 2.18],
    [1, 1.96],
    [0, 1.7],
  ])('quality %i from 2.5 -> %f', (q, expected) => {
    expect(nextEase(2.5, q)).toBeCloseTo(expected, 2);
  });

  it('never drops below the minimum ease', () => {
    let e = INITIAL_EASE;
    for (let i = 0; i < 20; i++) e = nextEase(e, 0);
    expect(e).toBe(MIN_EASE);
  });

  it('treats invalid quality as a total failure', () => {
    expect(nextEase(2.5, Number.NaN)).toBe(nextEase(2.5, 0));
    expect(nextEase(2.5, 9)).toBe(nextEase(2.5, 5));
  });
});

describe('schedule', () => {
  it('first success -> 1 day, second -> 6 days, then interval * ease', () => {
    const s1 = schedule(initialSrs(), 4, T0);
    expect(s1.repetitions).toBe(1);
    expect(s1.intervalDays).toBe(1);
    expect(s1.status).toBe('review');
    expect(s1.nextReviewAt).toBe(at(T0, DAY).toISOString());

    const s2 = schedule(s1, 4, due(s1));
    expect(s2.intervalDays).toBe(6);

    const s3 = schedule(s2, 4, due(s2));
    expect(s3.intervalDays).toBe(Math.round(6 * s3.easeFactor));
    expect(s3.intervalDays).toBe(15); // 6 * 2.5
  });

  it('extends intervals monotonically on repeated success', () => {
    let s: SrsFields = initialSrs();
    let now = T0;
    const intervals: number[] = [];
    for (let i = 0; i < 8; i++) {
      s = schedule(s, 4, now);
      intervals.push(s.intervalDays);
      now = due(s);
    }
    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i - 1]! < MAX_INTERVAL_DAYS) expect(intervals[i]!).toBeGreaterThan(intervals[i - 1]!);
      else expect(intervals[i]).toBe(MAX_INTERVAL_DAYS);
    }
    expect(intervals[intervals.length - 1]).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
  });

  it('marks long intervals as mastered', () => {
    let s: SrsFields = initialSrs();
    let now = T0;
    while (s.intervalDays < 21) {
      s = schedule(s, 5, now);
      now = due(s);
    }
    expect(s.status).toBe('mastered');
  });

  it('caps intervals', () => {
    const s = schedule({ ...initialSrs(), repetitions: 10, intervalDays: 300, easeFactor: 3, status: 'mastered', nextReviewAt: T0.toISOString() }, 5, T0);
    expect(s.intervalDays).toBe(MAX_INTERVAL_DAYS);
  });

  it('a failure resets repetitions, lowers ease, counts a lapse and relearns in minutes', () => {
    let s = schedule(initialSrs(), 5, T0);
    s = schedule(s, 5, due(s));
    const failAt = due(s);
    const f = schedule(s, 1, failAt);
    expect(f.repetitions).toBe(0);
    expect(f.lapses).toBe(1);
    expect(f.easeFactor).toBeLessThan(s.easeFactor);
    expect(f.status).toBe('relearning');
    expect(f.nextReviewAt).toBe(at(failAt, RELEARN_MINUTES * 60 * 1000).toISOString());
    expect(f.intervalDays).toBeLessThan(s.intervalDays);
  });

  it('after a lapse the interval restarts at 1 day', () => {
    let s = schedule(initialSrs(), 5, T0);
    s = schedule(s, 5, due(s));
    s = schedule(s, 1, due(s));
    const r = schedule(s, 4, due(s));
    expect(r.intervalDays).toBe(1);
    expect(r.status).toBe('review');
  });

  it('does not change ease while a word is first being learned or relearned', () => {
    const f1 = schedule(initialSrs(), 0, T0);
    const f2 = schedule(f1, 1, at(T0, 10 * 60 * 1000));
    expect(f2.easeFactor).toBe(INITIAL_EASE);
    const ok = schedule(f2, 5, at(T0, 20 * 60 * 1000));
    expect(ok.easeFactor).toBe(INITIAL_EASE);
    expect(ok.intervalDays).toBe(1);
    // a lapse on a learned word lowers ease once; the relearning success does not raise it back
    const s2 = schedule(ok, 4, due(ok));
    const lapse = schedule(s2, 1, due(s2));
    expect(lapse.easeFactor).toBeLessThan(s2.easeFactor);
    expect(schedule(lapse, 5, due(lapse)).easeFactor).toBe(lapse.easeFactor);
  });

  it('does not count a lapse when the word was never learned', () => {
    const f = schedule(initialSrs(), 1, T0);
    expect(f.lapses).toBe(0);
    expect(f.status).toBe('learning');
  });

  it('early correct practice does not change the schedule', () => {
    const s1 = schedule(initialSrs(), 4, T0);
    const early = schedule(s1, 5, at(T0, 2 * 60 * 60 * 1000));
    expect(early.wasEarly).toBe(true);
    expect(early.intervalDays).toBe(s1.intervalDays);
    expect(early.nextReviewAt).toBe(s1.nextReviewAt);
    expect(early.repetitions).toBe(s1.repetitions);
    expect(early.easeFactor).toBe(s1.easeFactor);
  });

  it('early failure still counts as a lapse', () => {
    const s1 = schedule(initialSrs(), 4, T0);
    const f = schedule(s1, 1, at(T0, 2 * 60 * 60 * 1000));
    expect(f.lapses).toBe(1);
    expect(f.repetitions).toBe(0);
  });

  it('a slow correct answer (quality 3) grows the interval less than a fast one', () => {
    let base = schedule(initialSrs(), 5, T0);
    base = schedule(base, 5, due(base));
    const slow = schedule(base, 3, due(base));
    const fast = schedule(base, 5, due(base));
    expect(slow.intervalDays).toBeLessThan(fast.intervalDays);
  });

  it('is pure', () => {
    const s = initialSrs();
    const copy = JSON.stringify(s);
    schedule(s, 4, T0);
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe('isDue', () => {
  it('new words are never due; scheduled words are due at or after next review', () => {
    expect(isDue(initialSrs(), T0)).toBe(false);
    const s = schedule(initialSrs(), 4, T0);
    expect(isDue(s, at(T0, DAY - 1))).toBe(false);
    expect(isDue(s, at(T0, DAY))).toBe(true);
  });
});
