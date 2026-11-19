import { buildChoiceQuestion, buildSpellingQuestion, primaryJa, spellingHint } from '../../src/domain/assessment/questions';
import {
  MAX_RETRIES_PER_WORD,
  acknowledgeCard,
  answerStep,
  currentStep,
  isFinished,
  planDailySession,
  planLearnSession,
  planReviewSession,
  startSession,
  summarize,
  type SessionState,
} from '../../src/domain/session';
import { DAY, T0, WORDS, at, progress, seededRng, word } from '../helpers';

describe('choice questions', () => {
  it('always has 4 unique options with exactly one correct answer, never a same-group synonym', () => {
    const rng = seededRng(7);
    for (const target of WORDS) {
      for (const type of ['en_to_ja_mc', 'ja_to_en_mc'] as const) {
        const q = buildChoiceQuestion(type, target, WORDS, rng);
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options).size).toBe(4);
        const expected = type === 'en_to_ja_mc' ? primaryJa(target) : target.word;
        expect(q.options[q.answerIndex]).toBe(expected);
        expect(q.options.filter((o) => o === expected)).toHaveLength(1);
        if (target.synonymGroup) {
          const sameGroup = WORDS.filter((w) => w.synonymGroup === target.synonymGroup && w.id !== target.id);
          const texts = sameGroup.map((w) => (type === 'en_to_ja_mc' ? primaryJa(w) : w.word));
          for (const t of texts) expect(q.options).not.toContain(t);
        }
      }
    }
  });

  it('prefers distractors with the same part of speech', () => {
    const q = buildChoiceQuestion('ja_to_en_mc', word('mitigate'), WORDS, seededRng(1));
    const pos = q.options.map((o) => WORDS.find((w) => w.word === o)!.partOfSpeech);
    expect(pos.every((p) => p === 'v.')).toBe(true);
  });

  it('builds spelling hints', () => {
    expect(spellingHint('mull over')).toBe('m _ _ _   _ _ _ _');
    expect(buildSpellingQuestion(word('lucid')).hint).toBe('l _ _ _ _');
  });
});

describe('session planning', () => {
  const profile = { dailyNewWords: 3, dailyReviewLimit: 2 };
  const now = at(T0, 5 * DAY);
  const dueP = (id: string, overdue: number) =>
    progress(id, { reviewCount: 2, repetitions: 1, status: 'review', intervalDays: 1, nextReviewAt: at(now, -overdue * DAY).toISOString(), firstReviewedAt: T0.toISOString() });

  it('learn session: all cards first, then a recognition round, then a recall round', () => {
    const plan = planLearnSession({ words: WORDS, progressByWord: new Map(), profile, now });
    expect(plan.newWordIds).toHaveLength(3);
    expect(plan.steps.map((s) => (s.kind === 'card' ? 'card' : s.questionType))).toEqual([
      'card', 'card', 'card', 'en_to_ja_mc', 'en_to_ja_mc', 'en_to_ja_mc', 'ja_to_en_mc', 'ja_to_en_mc', 'ja_to_en_mc',
    ]);
    const ids = (from: number) => plan.steps.slice(from, from + 3).map((s) => s.wordId);
    expect(ids(0)).toEqual(plan.newWordIds);
    // Each test round covers every new word exactly once.
    expect([...ids(3)].sort()).toEqual([...plan.newWordIds].sort());
    expect([...ids(6)].sort()).toEqual([...plan.newWordIds].sort());
    // Deterministic for the same plan time.
    expect(planLearnSession({ words: WORDS, progressByWord: new Map(), profile, now }).steps).toEqual(plan.steps);
  });

  it('learn session shuffles test order away from card order for some plan time', () => {
    const big = { dailyNewWords: WORDS.length, dailyReviewLimit: 0 };
    const differs = [0, 1, 2, 3, 4].some((h) => {
      const p = planLearnSession({ words: WORDS, progressByWord: new Map(), profile: big, now: at(now, h * 3600_000) });
      const cards = p.steps.filter((s) => s.kind === 'card').map((s) => s.wordId);
      const rec = p.steps.filter((s) => s.kind === 'question' && s.questionType === 'en_to_ja_mc').map((s) => s.wordId);
      return cards.join() !== rec.join();
    });
    expect(differs).toBe(true);
  });

  it('respects the daily new-word target across sessions', () => {
    const today = new Map([[WORDS[0]!.id, progress(WORDS[0]!.id, { reviewCount: 1, firstReviewedAt: now.toISOString(), nextReviewAt: at(now, DAY).toISOString(), status: 'review', repetitions: 1 })]]);
    const plan = planLearnSession({ words: WORDS, progressByWord: today, profile, now });
    expect(plan.newWordIds).toHaveLength(2);
    expect(plan.newWordIds).not.toContain(WORDS[0]!.id);
  });

  it('review session takes the most overdue words up to the limit', () => {
    const map = new Map([
      [WORDS[0]!.id, dueP(WORDS[0]!.id, 1)],
      [WORDS[1]!.id, dueP(WORDS[1]!.id, 3)],
      [WORDS[2]!.id, dueP(WORDS[2]!.id, 2)],
    ]);
    const plan = planReviewSession({ words: WORDS, progressByWord: map, profile, now });
    expect(plan.reviewWordIds).toEqual([WORDS[1]!.id, WORDS[2]!.id]);
  });

  it('ignores progress for words no longer in the library', () => {
    const map = new Map([['deleted-word', dueP('deleted-word', 5)]]);
    expect(planReviewSession({ words: WORDS, progressByWord: map, profile, now }).steps).toHaveLength(0);
  });

  it('daily session puts reviews before new words', () => {
    const map = new Map([[WORDS[0]!.id, dueP(WORDS[0]!.id, 1)]]);
    const plan = planDailySession({ words: WORDS, progressByWord: map, profile, now });
    expect(plan.steps[0]).toMatchObject({ kind: 'question', wordId: WORDS[0]!.id });
    expect(plan.steps[1]!.kind).toBe('card');
  });
});

describe('session progression', () => {
  const plan = planLearnSession({ words: WORDS, progressByWord: new Map(), profile: { dailyNewWords: 2, dailyReviewLimit: 10 }, now: T0 });

  function run(answers: (id: string) => boolean): SessionState {
    let s = startSession(plan);
    let guard = 0;
    while (!isFinished(s) && guard++ < 100) {
      const step = currentStep(s)!;
      s = step.kind === 'card' ? acknowledgeCard(s) : answerStep(s, answers(step.wordId));
    }
    return s;
  }

  it('finishes with all-correct answers and full accuracy', () => {
    const s = run(() => true);
    const sum = summarize(s);
    expect(sum.questionsAnswered).toBe(4);
    expect(sum.firstAttemptAccuracy).toBe(1);
    expect(sum.wordsStudied).toBe(2);
  });

  it('re-queues missed words a bounded number of times', () => {
    const target = plan.newWordIds[0]!;
    const s = run((id) => id !== target);
    const attempts = s.results.filter((r) => r.wordId === target);
    // two first attempts (recognition + recall) and at most MAX_RETRIES_PER_WORD retries in total
    expect(attempts.filter((r) => !r.isRetry)).toHaveLength(2);
    expect(attempts.filter((r) => r.isRetry)).toHaveLength(MAX_RETRIES_PER_WORD);
    const sum = summarize(s);
    expect(sum.missedWordIds).toEqual([target]);
    expect(sum.firstAttemptAccuracy).toBe(0.5);
  });

  it('guards against answering a card or acknowledging a question', () => {
    const s = startSession(plan);
    expect(() => answerStep(s, true)).toThrow();
    let s2 = s;
    while (currentStep(s2)?.kind === 'card') s2 = acknowledgeCard(s2);
    expect(currentStep(s2)?.kind).toBe('question');
    expect(() => acknowledgeCard(s2)).toThrow();
  });
});
