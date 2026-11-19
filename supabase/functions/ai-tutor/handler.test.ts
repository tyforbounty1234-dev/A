// Deno tests for the HTTP layer and the OpenAI client (run: npm run test:edge).
// The OpenAI API is replaced by a local fake server; nothing leaves the machine.
import { createHandler, MAX_BODY_BYTES } from './handler.ts';
import { OpenAiLlm } from './openai.ts';
import type { StoredGeneration, TutorDeps, TutorRepo } from '../_shared/lexicore/domain/ai/tutorCore.ts';
import type { Word } from '../_shared/lexicore/domain/types.ts';
import wordsJson from '../../../src/data/words.json' with { type: 'json' };

const WORDS = wordsJson as unknown as Word[];
const exac = WORDS.find((w) => w.word === 'exacerbate')!;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEquals<T>(a: T, b: T, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const GOOD = {
  examples: [
    { en: 'Rising prices exacerbated the hardship of poor families.', ja: '物価の上昇が貧しい家庭の苦境を悪化させた。', noteJa: '苦境を目的語にとる。' },
    { en: 'Cutting the budget would only exacerbate the problem.', ja: '予算を削っても問題を悪化させるだけだろう。', noteJa: 'problem と相性が良い。' },
  ],
};

function repo(saved: unknown[]): TutorRepo {
  const store = new Map<string, StoredGeneration>();
  return {
    getWords: async () => WORDS,
    getProfile: async () => ({ proficiencyLevel: 3, learningGoal: null }),
    getProgress: async () => [],
    getRecentReviews: async () => [],
    findGeneration: async (k) => store.get(k) ?? null,
    reserveRequest: async () => true,
    saveGeneration: async (g) => {
      saved.push(g);
      store.set(g.cacheKey, { kind: g.kind, content: g.content, model: g.model, promptVersion: g.promptVersion, createdAt: new Date().toISOString() });
    },
  };
}

/** Local stand-in for the OpenAI API. `responses` are consumed in order. */
function fakeOpenAi(responses: { status: number; body: unknown }[]) {
  const seen: { auth: string | null; body: Record<string, unknown> }[] = [];
  const ac = new AbortController();
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: ac.signal, onListen: () => {} }, async (req) => {
    seen.push({ auth: req.headers.get('Authorization'), body: await req.json() });
    const r = responses.shift() ?? { status: 500, body: { error: 'exhausted' } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  const addr = server.addr as Deno.NetAddr;
  return { baseUrl: `http://127.0.0.1:${addr.port}/v1`, seen, close: async () => { ac.abort(); await server.finished; } };
}

const completion = (content: unknown, extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: { model: 'gpt-test', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content), ...extra } }] },
});

function handler(opts: { baseUrl?: string; configured?: boolean; saved?: unknown[] } = {}) {
  const logs: string[] = [];
  const sharedRepo = repo(opts.saved ?? []);
  const h = createHandler({
    authenticate: async (a) => (a === 'Bearer good-token' ? '11111111-1111-1111-1111-111111111111' : null),
    makeDeps: (): TutorDeps | null =>
      opts.configured === false
        ? null
        : {
            repo: sharedRepo,
            llm: new OpenAiLlm({ apiKey: 'sk-test', model: 'gpt-test', baseUrl: opts.baseUrl ?? 'http://127.0.0.1:9/v1', retryDelayMs: 1, timeoutMs: 5000 }),
            now: () => new Date('2026-11-19T00:00:00Z'),
            hash: async (t) => String(t.length) + t.slice(0, 20).replace(/\W/g, '') + 'xxxxxxxxxxxxxxxx',
            dailyLimit: 10,
          },
    log: (e) => logs.push(e),
  });
  return { h, logs };
}

const post = (body: unknown, auth = 'Bearer good-token', raw?: string) =>
  new Request('http://localhost/ai-tutor', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });

Deno.test('CORS preflight and method checks', async () => {
  const { h } = handler();
  const pre = await h(new Request('http://localhost/ai-tutor', { method: 'OPTIONS' }));
  assertEquals(pre.status, 204);
  assert(pre.headers.get('Access-Control-Allow-Headers')?.includes('authorization'), 'allows authorization header');
  assertEquals((await h(new Request('http://localhost/ai-tutor'))).status, 405);
});

Deno.test('rejects missing or invalid sessions', async () => {
  const { h } = handler();
  assertEquals((await h(post({ kind: 'mistakes' }, ''))).status, 401);
  const bad = await h(post({ kind: 'mistakes' }, 'Bearer expired'));
  assertEquals(bad.status, 401);
  assertEquals((await bad.json()).error.code, 'unauthorized');
});

Deno.test('rejects oversized and malformed bodies', async () => {
  const { h } = handler();
  assertEquals((await h(post(null, 'Bearer good-token', 'x'.repeat(MAX_BODY_BYTES + 1)))).status, 413);
  assertEquals((await h(post(null, 'Bearer good-token', '{nope'))).status, 400);
  assertEquals((await h(post({ kind: 'explain', wordId: 'x' }))).status, 400);
});

Deno.test('reports when AI is not configured on the server', async () => {
  const { h } = handler({ configured: false });
  const res = await h(post({ kind: 'mistakes' }));
  assertEquals(res.status, 501);
  assertEquals((await res.json()).error.code, 'not_configured');
});

Deno.test('end to end: sends a strict JSON-schema request and returns validated content', async () => {
  const api = fakeOpenAi([completion(GOOD)]);
  const saved: unknown[] = [];
  try {
    const { h } = handler({ baseUrl: api.baseUrl, saved });
    const res = await h(post({ kind: 'examples', wordId: exac.id }));
    const body = await res.json();
    assertEquals(res.status, 200, JSON.stringify(body));
    assertEquals(body.kind, 'examples');
    assertEquals(body.model, 'gpt-test');
    assertEquals(body.content.examples.length, 2);
    assertEquals(saved.length, 1);
    const sent = api.seen[0]!;
    assertEquals(sent.auth, 'Bearer sk-test');
    const rf = sent.body.response_format as { type: string; json_schema: { name: string; strict: boolean } };
    assertEquals(rf.type, 'json_schema');
    assertEquals(rf.json_schema.strict, true);
    assertEquals(rf.json_schema.name, 'lexicore_examples');
    const messages = sent.body.messages as { role: string; content: string }[];
    assert(messages[1]!.content.includes('悪化させる'), 'dictionary meaning is in the prompt');
    // Same request again is served from the cache without calling OpenAI.
    const again = await (await h(post({ kind: 'examples', wordId: exac.id }))).json();
    assertEquals(again.cached, true);
    assertEquals(api.seen.length, 1);
  } finally {
    await api.close();
  }
});

Deno.test('invalid model output is corrected once, then rejected without saving', async () => {
  const bad = completion({ examples: [{ en: 'It got worse.', ja: 'worse', noteJa: 'x' }] });
  const api = fakeOpenAi([bad, bad]);
  const saved: unknown[] = [];
  try {
    const { h } = handler({ baseUrl: api.baseUrl, saved });
    const res = await h(post({ kind: 'examples', wordId: exac.id }));
    assertEquals(res.status, 502);
    assertEquals((await res.json()).error.code, 'invalid_output');
    assertEquals(api.seen.length, 2);
    const retry = api.seen[1]!.body.messages as { role: string; content: string }[];
    assert(retry.at(-1)!.content.includes('failed validation'), 'validation errors are sent back');
    assertEquals(saved.length, 0);
  } finally {
    await api.close();
  }
});

Deno.test('transient OpenAI errors are retried once; persistent ones become 503', async () => {
  const api = fakeOpenAi([{ status: 500, body: {} }, completion(GOOD), { status: 503, body: {} }, { status: 503, body: {} }]);
  try {
    const { h } = handler({ baseUrl: api.baseUrl });
    assertEquals((await h(post({ kind: 'examples', wordId: exac.id }))).status, 200);
    const res = await h(post({ kind: 'examples', wordId: exac.id, force: true }));
    assertEquals(res.status, 503);
    assertEquals((await res.json()).error.code, 'ai_unavailable');
    assertEquals(api.seen.length, 4);
  } finally {
    await api.close();
  }
});

Deno.test('refusals and auth errors from OpenAI are not retried', async () => {
  const api = fakeOpenAi([completion(null, { content: null, refusal: 'no' }), { status: 401, body: {} }]);
  try {
    const { h } = handler({ baseUrl: api.baseUrl });
    assertEquals((await h(post({ kind: 'examples', wordId: exac.id }))).status, 503);
    assertEquals((await h(post({ kind: 'examples', wordId: exac.id, force: true }))).status, 503);
    assertEquals(api.seen.length, 2);
  } finally {
    await api.close();
  }
});
