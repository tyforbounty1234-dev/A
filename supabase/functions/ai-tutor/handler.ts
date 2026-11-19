/**
 * HTTP layer of the ai-tutor function: CORS, method and size checks,
 * authentication, JSON parsing and error mapping. Business logic lives in the
 * shared handleTutorRequest.
 */
import { TUTOR_ERROR_STATUS, type TutorErrorCode } from '../_shared/lexicore/domain/ai/contract.ts';
import { handleTutorRequest, type TutorDeps } from '../_shared/lexicore/domain/ai/tutorCore.ts';

export const MAX_BODY_BYTES = 8 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export interface HandlerEnv {
  /** Returns the caller's user id for a valid access token, else null. */
  authenticate(authorization: string): Promise<string | null>;
  /** Builds dependencies for one authenticated call, or null when AI is not configured. */
  makeDeps(userId: string, authorization: string): TutorDeps | null;
  log?: (event: string, data: Record<string, unknown>) => void;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}

function error(code: TutorErrorCode, message: string): Response {
  return json(TUTOR_ERROR_STATUS[code], { error: { code, message } });
}

export function createHandler(env: HandlerEnv): (req: Request) => Promise<Response> {
  const log = env.log ?? ((event, data) => console.log(JSON.stringify({ event, ...data })));
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { error: { code: 'bad_request', message: 'use POST' } });

    const authorization = req.headers.get('Authorization') ?? '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) return error('unauthorized', 'sign in to use the AI tutor');

    const declared = Number(req.headers.get('Content-Length') ?? '0');
    if (declared > MAX_BODY_BYTES) return json(413, { error: { code: 'bad_request', message: 'request too large' } });
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json(413, { error: { code: 'bad_request', message: 'request too large' } });

    let userId: string | null;
    try {
      userId = await env.authenticate(authorization);
    } catch (e) {
      log('auth_error', { message: e instanceof Error ? e.message : String(e) });
      return error('server_error', 'could not verify the session');
    }
    if (!userId) return error('unauthorized', 'session expired; sign in again');

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return error('bad_request', 'body must be JSON');
    }

    const deps = env.makeDeps(userId, authorization);
    if (!deps) return error('not_configured', 'the AI tutor is not configured on this server');

    try {
      const result = await handleTutorRequest(body, { ...deps, log: deps.log ?? log });
      return json(result.status, result.body);
    } catch (e) {
      log('tutor_error', { message: e instanceof Error ? e.message : String(e) });
      return error('server_error', 'something went wrong; try again later');
    }
  };
}
