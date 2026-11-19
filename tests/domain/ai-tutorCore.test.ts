import { createHash } from 'node:crypto';
import { PROMPT_VERSION, type TutorErrorBody, type TutorResponse } from '../../src/domain/ai/contract';
import { handleTutorRequest, LlmError, type Llm, type StoredGeneration, type TutorDeps, type TutorRepo } from '../../src/domain/ai/tutorCore';
import { T0, WORDS, progress, review, word } from '../helpers';

const exac = word('exacerbate');
const deter = word('deteriorate');

const GOOD_EXAMPLES = JSON.stringify({
  examples: [
    { en: 'Rising prices exacerbated the hardship of poor families.', ja: '物価の上昇が貧しい家庭の苦境を悪化させた。', noteJa: '問題や苦境を目的語にとる。' },
    { en: 'Cutting the budget would only exacerbate the problem.', ja: '予算を削っても問題を悪化させるだけだろう。', noteJa: 'problem と相性が良い。' },
  ],
});
const BAD_EXAMPLES = JSON.stringify({ examples: [{ en: 'It got worse.', ja: 'worse', noteJa: '' }] });

function fakeRepo(over: Partial<TutorRepo> = {}) {
  const saved: Parameters<TutorRepo['saveGeneration']>[0][] = [];
  const store = new Map<string, StoredGeneration>();
  let reserved = 0;
  const repo: TutorRepo = {
    getWords: async () => WORDS,
    getProfile: async () => ({ proficiencyLevel: 4, learningGoal: null }),
    getProgress: async () => [progress(exac.id, { reviewCount: 3, correctCount: 1, lapses: 1, status: 'relearning' })],
    getRecentReviews: async () => [review(exac.id, 'en_to_ja_mc', false, deter.senses[0]!.ja)],
    findGeneration: async (key) => store.get(key) ?? null,
    reserveRequest: async (_kind, limit) => (reserved < limit ? (reserved++, true) : false),
    saveGeneration: async (g) => {
      saved.push(g);
      store.set(g.cacheKey, { kind: g.kind, content: g.content, model: g.model, promptVersion: g.promptVersion, createdAt: T0.toISOString() });
    },
    ...over,
  };
  return { repo, saved, reservedCount: () => reserved };
}

function fakeLlm(outputs: (string | Error)[]) {
  const calls: Parameters<Llm['complete']>[0][] = [];
  const llm: Llm = {
    complete: async (req) => {
      calls.push(structuredClone(req));
      const next = outputs.shift();
      if (next === undefined) throw new Error('no more outputs');
      if (next instanceof Error) throw next;
      return { text: next, model: 'test-model' };
    },
  };
  return { llm, calls };
}

function deps(repo: TutorRepo, llm: Llm, over: Partial<TutorDeps> = {}): TutorDeps {
  return { repo, llm, now: () => T0, hash: async (t) => createHash('sha256').update(t).digest('hex'), dailyLimit: 5, ...over };
}

const ok = (b: TutorResponse | TutorErrorBody) => b as TutorResponse;
const err = (b: TutorResponse | TutorErrorBody) => (b as TutorErrorBody).error;

describe('handleTutorRequest', () => {
  it('generates, validates, saves and returns content', async () => {
    const { repo, saved } = fakeRepo();
    const { llm, calls } = fakeLlm([GOOD_EXAMPLES]);
    const res = await handleTutorRequest({ kind: 'examples', wordId: exac.id }, deps(repo, llm));
    expect(res.status).toBe(200);
    expect(ok(res.body)).toMatchObject({ kind: 'examples', cached: false, model: 'test-model', promptVersion: PROMPT_VERSION });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ kind: 'examples', wordId: exac.id });
    // Personalized: the learner's confusion and the dictionary meaning are in the prompt.
    expect(calls[0]!.messages[1]!.content).toContain('deteriorate');
    expect(calls[0]!.messages[1]!.content).toContain(exac.senses[0]!.ja);
    expect(calls[0]!.schemaName).toBe('lexicore_examples');
  });

  it('retries once with the validation errors, then succeeds', async () => {
    const { repo, saved } = fakeRepo();
    const { llm, calls } = fakeLlm([BAD_EXAMPLES, GOOD_EXAMPLES]);
    const res = await handleTutorRequest({ kind: 'examples', wordId: exac.id }, deps(repo, llm));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    const feedback = calls[1]!.messages.at(-1)!.content;
    expect(feedback).toContain('failed validation');
    expect(feedback).toContain('must use "exacerbate"');
    expect(saved).toHaveLength(1);
  });

  it('never saves or returns output that fails validation twice', async () => {
    const { repo, saved } = fakeRepo();
    const { llm } = fakeLlm([BAD_EXAMPLES, 'not json']);
    const res = await handleTutorRequest({ kind: 'examples', wordId: exac.id }, deps(repo, llm));
    expect(res.status).toBe(502);
    expect(err(res.body).code).toBe('invalid_output');
    expect(saved).toHaveLength(0);
  });

  it('serves a cached generation without calling the model or using quota', async () => {
    const { repo, reservedCount } = fakeRepo();
    const first = fakeLlm([GOOD_EXAMPLES]);
    await handleTutorRequest({ kind: 'examples', wordId: exac.id }, deps(repo, first.llm));
    const second = fakeLlm([]);
    const res = await handleTutorRequest({ kind: 'examples', wordId: exac.id }, deps(repo, second.llm));
    expect(ok(res.body).cached).toBe(true);
    expect(second.calls).toHaveLength(0);
    expect(reservedCount()).toBe(1);
    // force=true regenerates.
    const third = fakeLlm([GOOD_EXAMPLES]);
    const forced = await handleTutorRequest({ kind: 'examples', wordId: exac.id, force: true }, deps(repo, third.llm));
    expect(ok(forced.body).cached).toBe(false);
    expect(third.calls).toHaveLength(1);
  });

  it('misses the cache when the learner data changed', async () => {
    const { repo } = fakeRepo();
    await handleTutorRequest({ kind: 'examples', wordId: exac.id }, deps(repo, fakeLlm([GOOD_EXAMPLES]).llm));
    repo.getProgress = async () => [progress(exac.id, { reviewCount: 9, correctCount: 8, lapses: 1, status: 'review' })];
    const again = fakeLlm([GOOD_EXAMPLES]);
    const res = await handleTutorRequest({ kind: 'examples', wordId: exac.id }, deps(repo, again.llm));
    expect(ok(res.body).cached).toBe(false);
    expect(again.calls).toHaveLength(1);
  });

  it('enforces the daily limit before calling the model', async () => {
    const { repo } = fakeRepo();
    const { llm, calls } = fakeLlm([GOOD_EXAMPLES]);
    const res = await handleTutorRequest({ kind: 'examples', wordId: exac.id }, deps(repo, llm, { dailyLimit: 0 }));
    expect(res.status).toBe(429);
    expect(err(res.body).code).toBe('quota_exceeded');
    expect(calls).toHaveLength(0);
  });

  it('maps model failures to ai_unavailable', async () => {
    const { repo, saved } = fakeRepo();
    const { llm } = fakeLlm([new LlmError('timeout', true)]);
    const res = await handleTutorRequest({ kind: 'examples', wordId: exac.id }, deps(repo, llm));
    expect(res.status).toBe(503);
    expect(saved).toHaveLength(0);
  });

  it('rejects bad input before touching the model', async () => {
    const { repo } = fakeRepo();
    const { llm, calls } = fakeLlm([]);
    const d = deps(repo, llm);
    expect((await handleTutorRequest({ kind: 'examples', wordId: '00000000-0000-4000-8000-000000000000' }, d)).status).toBe(404);
    expect((await handleTutorRequest({ kind: 'explain' }, d)).status).toBe(400);
    const notListed = await handleTutorRequest({ kind: 'compare', wordId: exac.id, others: ['banana'] }, d);
    expect(err(notListed.body).message).toContain('neither a dictionary word nor a listed synonym');
    const noWord = await handleTutorRequest({ kind: 'context', wordId: exac.id, sentence: 'This sentence lacks the word.' }, d);
    expect(err(noWord.body).message).toContain('must contain "exacerbate"');
    expect(calls).toHaveLength(0);
  });

  it('builds a comparison from dictionary entries and listed synonyms', async () => {
    const { repo } = fakeRepo();
    const out = JSON.stringify({
      items: [
        { word: 'exacerbate', coreJa: '悪化させる', nuanceJa: '他動詞。', example: { en: 'The cuts exacerbated the crisis.', ja: '削減が危機を悪化させた。' } },
        { word: 'deteriorate', coreJa: '悪化する', nuanceJa: '自動詞。', example: { en: 'His health deteriorated after the accident.', ja: '事故の後、健康が悪化した。' } },
        { word: 'aggravate', coreJa: '悪化させる', nuanceJa: 'いらだたせる意味もある。', example: { en: 'Scratching will aggravate the rash.', ja: 'かくと発疹が悪化する。' } },
      ],
      differenceJa: 'exacerbate と aggravate は他動詞、deteriorate は自動詞です。',
      tipJa: '目的語の有無で見分けましょう。',
    });
    const { llm, calls } = fakeLlm([out]);
    const res = await handleTutorRequest({ kind: 'compare', wordId: exac.id, others: ['deteriorate', 'Aggravate'] }, deps(repo, llm));
    expect(res.status).toBe(200);
    expect(calls[0]!.messages[1]!.content).toContain('OTHER_WORDS_WITHOUT_DICTIONARY_ENTRY');
  });
});
