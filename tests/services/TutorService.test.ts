import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import type { TutorRequest, TutorResponse } from '../../src/domain/ai/contract';
import { MemoryStorage } from '../../src/data/storage';
import { SupabaseTutorApi, TutorError, isTutorResponse, toTutorError, type TutorApi } from '../../src/data/remote/tutorApi';
import { DEVICE_CACHE_LIMIT, TutorService } from '../../src/services/TutorService';

const req: TutorRequest = { kind: 'examples', wordId: '04470a99-784e-59e7-b599-259351980ab8' };
const resp = (n = 1): TutorResponse => ({
  kind: 'examples',
  content: { examples: [{ en: `Example ${n}.`, ja: '例', noteJa: '注' }] },
  model: 'm',
  promptVersion: 'p3.1',
  generatedAt: '2026-11-19T00:00:00Z',
  cached: false,
});

function api(impl: TutorApi['ask']): TutorApi & { calls: number } {
  const a = { calls: 0, ask: async (...args: Parameters<TutorApi['ask']>) => (a.calls++, impl(...args)) };
  return a;
}

describe('TutorService', () => {
  it('is unavailable without an API', async () => {
    const s = new TutorService({ api: null, storage: new MemoryStorage() });
    expect(s.available).toBe(false);
    await expect(s.ask('u', req)).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('syncs pending reviews first, then saves the answer on the device', async () => {
    const order: string[] = [];
    const a = api(async () => (order.push('ask'), resp()));
    const s = new TutorService({ api: a, storage: new MemoryStorage(), beforeRequest: async () => void order.push('flush') });
    const r = await s.ask('u', req);
    expect(order).toEqual(['flush', 'ask']);
    expect(r.offlineCopy).toBe(false);
    expect(await s.saved('u', req)).toEqual(resp());
    expect(await s.saved('other-user', req)).toBeNull();
  });

  it('still asks when the sync fails', async () => {
    const s = new TutorService({ api: api(async () => resp()), storage: new MemoryStorage(), beforeRequest: async () => { throw new Error('offline'); } });
    await expect(s.ask('u', req)).resolves.toMatchObject({ offlineCopy: false });
  });

  it('falls back to the saved answer only for network errors', async () => {
    const storage = new MemoryStorage();
    let fail: Error | null = null;
    const s = new TutorService({ api: api(async () => { if (fail) throw fail; return resp(); }), storage });
    await s.ask('u', req);
    fail = new TutorError('network', 'down');
    await expect(s.ask('u', req)).resolves.toMatchObject({ offlineCopy: true, response: resp() });
    fail = new TutorError('quota_exceeded', 'limit');
    await expect(s.ask('u', req)).rejects.toMatchObject({ code: 'quota_exceeded' });
    await expect(s.ask('u', { kind: 'mistakes' })).rejects.toMatchObject({ code: 'quota_exceeded' });
    fail = new TutorError('network', 'down');
    await expect(s.ask('u', { kind: 'mistakes' })).rejects.toMatchObject({ code: 'network' });
  });

  it('keeps at most DEVICE_CACHE_LIMIT answers, newest first', async () => {
    const storage = new MemoryStorage();
    const s = new TutorService({ api: api(async (r) => ({ ...resp(), kind: r.kind } as TutorResponse)), storage });
    for (let i = 0; i < DEVICE_CACHE_LIMIT + 5; i++) {
      await s.ask('u', { kind: 'context', wordId: req.kind === 'examples' ? req.wordId : '', sentence: `s ${i}` });
    }
    const saved = JSON.parse(storage.data.get('lexicore:tutor:u')!) as unknown[];
    expect(saved).toHaveLength(DEVICE_CACHE_LIMIT);
    expect(await s.saved('u', { kind: 'context', wordId: '04470a99-784e-59e7-b599-259351980ab8', sentence: 's 0' })).toBeNull();
  });
});

describe('tutor API client', () => {
  it('passes force and returns a well-formed response', async () => {
    let body: unknown;
    const db = { functions: { invoke: async (_name: string, opts: { body: unknown }) => ((body = opts.body), { data: resp(), error: null }) } };
    const r = await new SupabaseTutorApi(db as never).ask(req, { force: true });
    expect(body).toEqual({ ...req, force: true });
    expect(r.kind).toBe('examples');
  });

  it('rejects responses of the wrong kind', async () => {
    const db = { functions: { invoke: async () => ({ data: { ...resp(), kind: 'explain' }, error: null }) } };
    await expect(new SupabaseTutorApi(db as never).ask(req)).rejects.toMatchObject({ code: 'server_error' });
    expect(isTutorResponse(null, 'examples')).toBe(false);
  });

  it('maps server error bodies and transport errors to codes', async () => {
    const http = (status: number, body: unknown) =>
      new FunctionsHttpError(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
    expect((await toTutorError(http(429, { error: { code: 'quota_exceeded', message: 'limit' } }))).code).toBe('quota_exceeded');
    expect((await toTutorError(http(502, { error: { code: 'invalid_output', message: 'x' } }))).code).toBe('invalid_output');
    expect((await toTutorError(http(401, '<html>'))).code).toBe('unauthorized');
    expect((await toTutorError(http(404, 'not found'))).code).toBe('not_configured');
    expect((await toTutorError(http(400, { error: { code: 'made_up', message: 'x' } }))).code).toBe('bad_request');
    expect((await toTutorError(new FunctionsFetchError('boom'))).code).toBe('network');
  });
});
