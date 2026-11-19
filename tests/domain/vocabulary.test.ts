import { buildQuestion } from '../../src/domain/assessment/questions';
import { unseenWords } from '../../src/domain/srs/queue';
import { planLearnSession } from '../../src/domain/session';
import { T0, WORDS, progress, seededRng } from '../helpers';

describe('vocabulary data', () => {
  it('has 100+ words at every difficulty level', () => {
    for (const level of [1, 2, 3, 4, 5]) expect(WORDS.filter((w) => w.difficulty === level).length).toBeGreaterThanOrEqual(100);
    expect(new Set(WORDS.map((w) => w.word)).size).toBe(WORDS.length);
    expect(new Set(WORDS.map((w) => w.id)).size).toBe(WORDS.length);
  });

  it('builds unambiguous multiple-choice questions for every word', () => {
    const rng = seededRng(7);
    for (const w of WORDS) {
      for (const type of ['en_to_ja_mc', 'ja_to_en_mc'] as const) {
        const q = buildQuestion(type, w, WORDS, rng);
        if (q.kind !== 'choice') throw new Error('expected choice');
        expect(new Set(q.options).size).toBe(4);
        // No distractor may be a near-synonym (same group) of the answer.
        const optionWords = q.options.map((o) => WORDS.find((x) => (type === 'ja_to_en_mc' ? x.word === o : x.senses[0]?.ja === o)));
        optionWords.forEach((ow, i) => {
          if (i !== q.answerIndex && ow && w.synonymGroup) expect(ow.synonymGroup).not.toBe(w.synonymGroup);
        });
      }
    }
  });
});

describe('new words follow the learner level', () => {
  const levelOf = (ids: string[]) => ids.map((id) => WORDS.find((w) => w.id === id)!.difficulty);

  it('introduces words at the chosen level first', () => {
    for (const level of [1, 3, 5]) {
      const plan = planLearnSession({ words: WORDS, progressByWord: new Map(), profile: { dailyNewWords: 10, dailyReviewLimit: 100, proficiencyLevel: level }, now: T0 });
      expect(levelOf(plan.newWordIds)).toEqual(Array(10).fill(level));
    }
  });

  it('moves to the nearest level (harder first) when a level is used up', () => {
    const seen = new Map(WORDS.filter((w) => w.difficulty === 3).map((w) => [w.id, progress(w.id, { reviewCount: 1 })]));
    const next = unseenWords(WORDS, seen, 3);
    expect(next[0]!.difficulty).toBe(4);
    const levels = next.map((w) => w.difficulty);
    expect(levels.indexOf(2)).toBeGreaterThan(levels.lastIndexOf(4));
  });

  it('keeps curriculum order without a level', () => {
    const order = unseenWords(WORDS, new Map()).map((w) => w.rank);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
