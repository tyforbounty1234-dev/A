import { adaptiveContext, intervalModifierFor, personalThresholds, TARGET_RETENTION, MIN_TIMING_SAMPLES } from '../../src/domain/adaptive';
import { RESPONSE_THRESHOLDS } from '../../src/domain/assessment/grading';
import { evaluateChoice } from '../../src/domain/assessment/evaluate';
import { dueByCompetency, responseTimeTrend, weakWords } from '../../src/domain/analytics';
import { planReviewSession, planWeakSession } from '../../src/domain/session';
import { aggregateSrs, competenciesToReview, upgradeProgress } from '../../src/domain/srs/competency';
import { applyAnswer, newProgress, type AnswerInput } from '../../src/domain/srs/progress';
import { initialSrs, schedule, type SrsFields } from '../../src/domain/srs/sm2';
import type { ReviewRecord, WordProgress } from '../../src/domain/types';
import { detectWeakness } from '../../src/domain/weakness';
import { DAY, T0, USER, WORDS, at, progress, seededRng } from '../helpers';

let n = 0;
const answer = (wordId: string, over: Partial<AnswerInput> = {}): AnswerInput => ({
  id: `a${n++}`,
  userId: USER,
  wordId,
  sessionId: null,
  questionType: 'en_to_ja_mc',
  userAnswer: '',
  isCorrect: true,
  responseTimeMs: 2000,
  quality: 5,
  now: T0,
  ...over,
});
const rev = (over: Partial<ReviewRecord>): ReviewRecord => ({
  id: `r${n++}`, userId: USER, wordId: 'w', sessionId: null, questionType: 'en_to_ja_mc', competency: 'recognition',
  userAnswer: '', isCorrect: true, responseTimeMs: 1000, quality: 5, kind: 'scheduled', reviewedAt: T0.toISOString(), prevIntervalDays: 6, appliedModifier: 1, ...over,
});

describe('competency-specific scheduling', () => {
  it('schedules each competency independently and aggregates the word', () => {
    let p = applyAnswer(undefined, answer('w')).progress; // recognition ok -> 1 day
    p = applyAnswer(p, answer('w', { questionType: 'ja_to_en_mc', isCorrect: false, quality: 1, now: at(T0, 60_000) })).progress;
    const rec = p.competencyScores.recognition!.srs!;
    const recall = p.competencyScores.recall!.srs!;
    expect(rec.intervalDays).toBe(1);
    expect(recall.repetitions).toBe(0);
    // word is due when its earliest competency (recall, 10 min) is due, and is still learning
    expect(p.nextReviewAt).toBe(recall.nextReviewAt);
    expect(p.status).toBe('learning');
    // recognition schedule unaffected by the recall miss
    expect(rec.nextReviewAt).toBe(at(T0, DAY).toISOString());
  });

  it('a word is mastered only when every active competency is', () => {
    const s = (interval: number) => ({ ...initialSrs(), repetitions: 4, intervalDays: interval, status: 'review' as const, nextReviewAt: T0.toISOString(), lastReviewedAt: T0.toISOString() });
    const stat = (srs: SrsFields) => ({ attempts: 4, correct: 4, proficiency: 1, avgResponseMs: 1, lastAt: null, srs });
    expect(aggregateSrs({ recognition: stat(s(30)), recall: stat(s(40)) }, initialSrs()).status).toBe('mastered');
    expect(aggregateSrs({ recognition: stat(s(30)), spelling: stat(s(8)) }, initialSrs()).status).toBe('review');
  });

  it('reviews the most overdue competencies and introduces spelling once the word is known', () => {
    const now = at(T0, 30 * DAY);
    const srs = (overdueDays: number, interval: number, reps = 3) => ({
      ...initialSrs(), repetitions: reps, intervalDays: interval, status: 'review' as const,
      lastReviewedAt: T0.toISOString(), nextReviewAt: at(now, -overdueDays * DAY).toISOString(),
    });
    const stat = (s: SrsFields) => ({ attempts: 3, correct: 3, proficiency: 0.9, avgResponseMs: 1000, lastAt: null, srs: s });
    const p = progress('w', {
      reviewCount: 6,
      competencyScores: { recognition: stat(srs(1, 20)), recall: stat(srs(2, 4)) },
    });
    expect(competenciesToReview(p, now)).toEqual(['recall', 'recognition']);
    const onlyRecallDue = progress('w', {
      reviewCount: 6,
      competencyScores: { recognition: stat(srs(-5, 20)), recall: stat(srs(1, 4)) },
    });
    expect(competenciesToReview(onlyRecallDue, now)).toEqual(['recall', 'spelling']);
    const notKnownYet = progress('w', {
      reviewCount: 2,
      competencyScores: { recognition: stat(srs(1, 1, 1)), recall: stat(srs(-1, 1, 1)) },
    });
    expect(competenciesToReview(notKnownYet, now)).toEqual(['recognition']);
  });

  it('upgrades pre-Phase-2 progress losslessly and idempotently', () => {
    const legacy: WordProgress = {
      ...newProgress(USER, 'w'), reviewCount: 3, correctCount: 3, repetitions: 3, intervalDays: 15, easeFactor: 2.6,
      status: 'review', lastReviewedAt: T0.toISOString(), nextReviewAt: at(T0, 15 * DAY).toISOString(), firstReviewedAt: T0.toISOString(),
      competencyScores: { recognition: { attempts: 2, correct: 2, proficiency: 1, avgResponseMs: 1500, lastAt: null }, recall: { attempts: 1, correct: 1, proficiency: 0.8, avgResponseMs: 3000, lastAt: null } },
    };
    const up = upgradeProgress(legacy);
    expect(up.competencyScores.recognition!.srs!.intervalDays).toBe(15);
    expect(up.competencyScores.recall!.srs!.nextReviewAt).toBe(legacy.nextReviewAt);
    expect(up.competencyScores.recognition!.attempts).toBe(2);
    expect(upgradeProgress(up)).toBe(up);
    // the word-level schedule is unchanged by the upgrade
    expect(aggregateSrs(up.competencyScores, initialSrs()).nextReviewAt).toBe(legacy.nextReviewAt);
    const ancient = upgradeProgress({ ...legacy, competencyScores: {} });
    expect(ancient.competencyScores.recognition!.srs!.intervalDays).toBe(15);
    expect(upgradeProgress(newProgress(USER, 'x'))).toEqual(newProgress(USER, 'x'));
  });

  it('review plan interleaves competencies of different words', () => {
    const now = at(T0, 30 * DAY);
    const srs = (overdue: number) => ({ ...initialSrs(), repetitions: 3, intervalDays: 10, status: 'review' as const, lastReviewedAt: T0.toISOString(), nextReviewAt: at(now, -overdue * DAY).toISOString() });
    const stat = (s: SrsFields) => ({ attempts: 3, correct: 3, proficiency: 0.9, avgResponseMs: 1000, lastAt: null, srs: s });
    const mk = (id: string) => {
      const scores = { recognition: stat(srs(1)), recall: stat(srs(2)) };
      return progress(id, { reviewCount: 6, competencyScores: scores, ...aggregateSrs(scores, initialSrs()) });
    };
    const [a, b] = [WORDS[0]!.id, WORDS[1]!.id];
    const plan = planReviewSession({ words: WORDS, progressByWord: new Map([[a, mk(a)], [b, mk(b)]]), profile: { dailyNewWords: 0, dailyReviewLimit: 10 }, now });
    const [first, second] = plan.reviewWordIds;
    const seq = plan.steps.map((s) => (s.kind === 'question' ? `${s.wordId === first ? 1 : s.wordId === second ? 2 : 0}:${s.questionType}` : ''));
    // recall (more overdue) for both words first, then recognition: tests of one word are spaced apart
    expect(seq).toEqual(['1:ja_to_en_mc', '2:ja_to_en_mc', '1:en_to_ja_mc', '2:en_to_ja_mc']);
  });
});

describe('adaptive scheduling', () => {
  it('scales intervals by the modifier, within bounds, never below growth', () => {
    let s = schedule(initialSrs(), 4, T0);
    s = schedule(s, 4, at(T0, DAY));
    const third = (m: number) => schedule(s, 4, at(T0, 7 * DAY), { intervalModifier: m }).intervalDays;
    expect(third(1)).toBe(15);
    expect(third(1.4)).toBe(21);
    expect(third(5)).toBe(21); // clamped to 1.4
    expect(third(0.6)).toBe(9);
    expect(third(0.01)).toBe(9); // clamped to 0.6
  });

  it('credits successful late reviews', () => {
    let s = schedule(initialSrs(), 4, T0);
    s = schedule(s, 4, at(T0, DAY)); // 6-day interval
    const onTime = schedule(s, 4, at(T0, 7 * DAY)).intervalDays;
    const late = schedule(s, 4, at(T0, 17 * DAY)).intervalDays; // 10 days late
    expect(late).toBeGreaterThan(onTime);
    expect(late).toBe(Math.round((6 + 10 / 2) * 2.5));
  });

  it('fuzz is deterministic, small, and spreads identical schedules', () => {
    let s = schedule(initialSrs(), 4, T0);
    s = schedule(s, 4, at(T0, DAY));
    s = schedule(s, 4, at(T0, 7 * DAY)); // 15 days
    const at4 = at(T0, 22 * DAY);
    const intervals = WORDS.slice(0, 40).map((w) => schedule(s, 4, at4, { fuzzKey: w.id }).intervalDays);
    const plain = schedule(s, 4, at4).intervalDays;
    for (const i of intervals) expect(Math.abs(i - plain)).toBeLessThanOrEqual(Math.ceil(plain * 0.05));
    expect(new Set(intervals).size).toBeGreaterThan(1);
    expect(schedule(s, 4, at4, { fuzzKey: 'x' }).intervalDays).toBe(schedule(s, 4, at4, { fuzzKey: 'x' }).intervalDays);
  });

  it('derives the interval modifier from observed retention with a prior', () => {
    expect(intervalModifierFor(10, 10)).toBe(1); // too few samples: keep the modifier in effect
    expect(intervalModifierFor(10, 10, 1.2)).toBe(1.2);
    expect(intervalModifierFor(100, 90)).toBe(1);
    expect(intervalModifierFor(100, 95)).toBeGreaterThan(1);
    expect(intervalModifierFor(100, 80)).toBeLessThan(1);
    expect(intervalModifierFor(1000, 1000)).toBe(1.4);
    expect(intervalModifierFor(1000, 0)).toBe(0.6);
    // more evidence -> stronger adjustment for the same observed rate
    expect(intervalModifierFor(400, 340)).toBeLessThan(intervalModifierFor(40, 34));
    // relative to the modifier that produced the data: on-target retention keeps it
    expect(intervalModifierFor(200, 180, 0.7)).toBe(0.7);
    expect(intervalModifierFor(200, 180, 1.3)).toBe(1.3);
    // damping: a single estimate moves only part of the way
    const full = Math.log(0.9) / Math.log((170 + 18) / 220);
    expect(intervalModifierFor(200, 170)).toBeGreaterThan(Math.round(full * 100) / 100);
  });

  it('personalises response-time thresholds only with enough data', () => {
    const few = Array.from({ length: MIN_TIMING_SAMPLES - 1 }, () => rev({ responseTimeMs: 1000 }));
    expect(personalThresholds(few).thresholds.en_to_ja_mc).toEqual(RESPONSE_THRESHOLDS.en_to_ja_mc);
    const fast = Array.from({ length: 40 }, () => rev({ responseTimeMs: 1500 }));
    const t = personalThresholds(fast);
    expect(t.thresholds.en_to_ja_mc).toEqual([1500, 4000]); // 0.8*1.5s floored at 0.5*3s; slow 2*1.5s raised to 0.5*8s
    expect(t.personalTiming.en_to_ja_mc).toEqual({ medianMs: 1500, samples: 40 });
    const slow = Array.from({ length: 40 }, () => rev({ responseTimeMs: 6000 }));
    expect(personalThresholds(slow).thresholds.en_to_ja_mc).toEqual([4800, 12000]);
    // a 4-second answer is "fast" for the slow learner, merely "correct" for the default
    const q = { kind: 'choice' as const, type: 'en_to_ja_mc' as const, wordId: 'w', prompt: '', promptDetail: '', options: ['a', 'b', 'c', 'd'], answerIndex: 0 };
    expect(evaluateChoice(q, 0, 4000).quality).toBe(4);
    expect(evaluateChoice(q, 0, 4000, personalThresholds(slow).thresholds).quality).toBe(5);
    // wrong answers and incorrect-answer times are not used
    const ignored = Array.from({ length: 40 }, () => rev({ responseTimeMs: 100, isCorrect: false }));
    expect(personalThresholds(ignored).personalTiming.en_to_ja_mc).toBeUndefined();
  });

  it('ignores immature reviews when estimating the modifier', () => {
    const young = Array.from({ length: 60 }, () => rev({ isCorrect: false, prevIntervalDays: 1 }));
    expect(adaptiveContext(young, T0).intervalModifier).toBe(1);
    const legacy = Array.from({ length: 60 }, () => rev({ isCorrect: false, prevIntervalDays: null, appliedModifier: null }));
    expect(adaptiveContext(legacy, T0).intervalModifier).toBe(1);
  });

  it('builds the context from the recent window only', () => {
    const old = Array.from({ length: 50 }, () => rev({ isCorrect: false, reviewedAt: at(T0, -90 * DAY).toISOString() }));
    const recent = Array.from({ length: 50 }, (_, i) => rev({ isCorrect: i % 10 !== 0 }));
    const ctx = adaptiveContext([...old, ...recent], T0);
    expect(ctx.retentionSamples).toBe(50);
    expect(ctx.observedRetention).toBeCloseTo(TARGET_RETENTION);
    expect(ctx.intervalModifier).toBe(1);
  });
});

describe('simulated learners (120 days)', () => {
  /**
   * Ground-truth memory model: recall probability exp(-elapsed / stability).
   * Stability starts at s0 days, multiplies by `growth` after each success and
   * halves after a failure. Retention is measured on mature scheduled reviews.
   */
  function simulate(growth: number, s0: number, adaptive: boolean) {
    const runs = [1, 2, 3, 4].map((seed) => simulateOnce(growth, s0, adaptive, seed));
    const avg = (k: 'retention' | 'reviews' | 'modifier') => runs.reduce((a, r) => a + r[k], 0) / runs.length;
    return { retention: avg('retention'), reviews: avg('reviews'), modifier: avg('modifier') };
  }

  function simulateOnce(growth: number, s0: number, adaptive: boolean, seed: number) {
    const rng = seededRng(seed * 7919 + (adaptive ? 1 : 0));
    const words = WORDS.slice(0, 60).map((w) => w.id);
    const truth = new Map(words.map((id) => [id, { stability: s0, last: T0.getTime() }]));
    const map = new Map<string, WordProgress>();
    const reviews: ReviewRecord[] = [];
    let modifier = 1;
    for (const id of words) map.set(id, applyAnswer(undefined, answer(id)).progress);
    for (let day = 1; day <= 120; day++) {
      const now = at(T0, day * DAY);
      if (adaptive) modifier = adaptiveContext(reviews, now).intervalModifier;
      for (const id of words) {
        const p = map.get(id)!;
        if (!p.nextReviewAt || Date.parse(p.nextReviewAt) > now.getTime()) continue;
        const t = truth.get(id)!;
        const ok = rng() < Math.exp(-(now.getTime() - t.last) / DAY / t.stability);
        t.stability = ok ? t.stability * growth : Math.max(0.5, t.stability / 2);
        t.last = now.getTime();
        const r = applyAnswer(p, answer(id, { isCorrect: ok, quality: ok ? 4 : 1, now }), { intervalModifier: modifier, fuzz: false });
        map.set(id, r.progress);
        reviews.push(r.review);
      }
    }
    const mature = reviews.filter((r) => r.kind === 'scheduled' && (r.prevIntervalDays ?? 0) >= 3);
    return { retention: mature.filter((r) => r.isCorrect).length / mature.length, reviews: reviews.length, modifier };
  }

  it.each([
    [4, 1.5],
    [3, 3],
  ])('a student who forgets faster than SM-2 assumes (growth %f, s0 %f) is brought to the 90%% target', (g, s0) => {
    const fixed = simulate(g, s0, false);
    const adapted = simulate(g, s0, true);
    expect(fixed.retention).toBeLessThan(0.87);
    expect(Math.abs(adapted.retention - TARGET_RETENTION)).toBeLessThan(0.03);
  });

  it('a student who forgets very quickly gets clearly higher retention', () => {
    const fixed = simulate(2.2, 1.5, false);
    const adapted = simulate(2.2, 1.5, true);
    expect(adapted.modifier).toBeLessThan(1);
    expect(adapted.retention - fixed.retention).toBeGreaterThan(0.1);
  });

  it.each([
    [4, 8],
    [5, 10],
  ])('a strong student (growth %f, s0 %f) keeps retention near target and learns longer intervals', (g, s0) => {
    const fixed = simulate(g, s0, false);
    const adapted = simulate(g, s0, true);
    expect(adapted.retention).toBeGreaterThan(0.9);
    expect(adapted.retention).toBeLessThan(0.96);
    expect(adapted.modifier).toBeGreaterThan(1);
    // 120 days is too short for longer intervals to save reviews; bound the cost instead
    expect(adapted.reviews).toBeLessThanOrEqual(fixed.reviews * 1.08);
  });
});

describe('weak-word detection', () => {
  const stat = (attempts: number, proficiency: number, avgResponseMs = 2000) => ({ attempts, correct: attempts, proficiency, avgResponseMs, lastAt: null });

  it('explains why a word is weak', () => {
    expect(detectWeakness(progress('a', { reviewCount: 6, lapses: 3 })).reasons).toEqual(['forgetting']);
    const hesitant = detectWeakness(progress('a', { reviewCount: 6, competencyScores: { recognition: stat(4, 0.8, 20000) } }));
    expect(hesitant.reasons).toEqual(['hesitant']);
    expect(hesitant.isWeak).toBe(false);
    const gap = detectWeakness(progress('a', { reviewCount: 6, lapses: 2, competencyScores: { recognition: stat(3, 0.95), spelling: stat(3, 0.3) } }));
    expect(gap.reasons).toEqual(['forgetting', 'competency_gap']);
    expect(gap.weakestCompetency).toBe('spelling');
    expect(gap.isWeak).toBe(true);
  });

  it('uses personal thresholds for hesitation', () => {
    const p = progress('a', { reviewCount: 6, competencyScores: { recognition: stat(4, 0.8, 6000) } });
    expect(detectWeakness(p).reasons).not.toContain('hesitant');
    const fastLearner = personalThresholds(Array.from({ length: 40 }, () => rev({ responseTimeMs: 1500 }))).thresholds;
    expect(detectWeakness(p, fastLearner).reasons).toContain('hesitant');
  });

  it('weak session targets the weakest competency of the weakest words', () => {
    const [a, b, c] = WORDS.map((w) => w.id);
    const map = new Map([
      [a!, progress(a!, { reviewCount: 8, lapses: 4, competencyScores: { recognition: stat(4, 0.9), spelling: stat(4, 0.2) } })],
      [b!, progress(b!, { reviewCount: 8, lapses: 3, competencyScores: { recognition: stat(4, 0.4), recall: stat(4, 0.5) } })],
      [c!, progress(c!, { reviewCount: 8, competencyScores: { recognition: stat(4, 0.9) } })],
    ]);
    const plan = planWeakSession({ words: WORDS, progressByWord: map, profile: { dailyNewWords: 0, dailyReviewLimit: 10 }, now: T0 });
    expect(plan.steps.map((s) => (s.kind === 'question' ? [s.wordId, s.questionType] : null))).toEqual([
      [a, 'spelling'],
      [b, 'en_to_ja_mc'],
    ]);
    expect(weakWords([...map.values()]).map((w) => w.wordId)).toEqual([a, b]);
  });
});

describe('analytics additions', () => {
  it('reports response-time trend and competency due counts', () => {
    const trend = responseTimeTrend([rev({ responseTimeMs: 1000 }), rev({ responseTimeMs: 3000 }), rev({ responseTimeMs: 9000, isCorrect: false })], T0, 2);
    expect(trend[1]).toEqual({ weekStart: '2026-11-16', medianMs: 1000, count: 2 });
    const srs = { ...initialSrs(), repetitions: 1, intervalDays: 1, status: 'review' as const, nextReviewAt: at(T0, -1).toISOString() };
    const due = dueByCompetency([progress('a', { competencyScores: { spelling: { ...stat2(), srs }, recall: { ...stat2(), srs: { ...srs, nextReviewAt: at(T0, DAY).toISOString() } } } })], T0);
    expect(due).toEqual({ spelling: 1 });
  });
});

function stat2() {
  return { attempts: 1, correct: 1, proficiency: 1, avgResponseMs: 1, lastAt: null };
}
