/**
 * Client for the ai-tutor Edge Function. The app only sends the request and
 * the user's session token; the OpenAI key lives on the server.
 */
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError, type SupabaseClient } from '@supabase/supabase-js';
import type { TutorErrorCode, TutorRequest, TutorResponse } from '../../domain/ai/contract';
import { TUTOR_KINDS } from '../../domain/ai/contract';

export interface TutorApi {
  ask(request: TutorRequest, opts?: { force?: boolean }): Promise<TutorResponse>;
}

export class TutorError extends Error {
  constructor(
    readonly code: TutorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TutorError';
  }
}

const CODES = new Set<TutorErrorCode>([
  'unauthorized',
  'bad_request',
  'not_found',
  'quota_exceeded',
  'ai_unavailable',
  'invalid_output',
  'not_configured',
  'network',
  'server_error',
]);

function codeForStatus(status: number): TutorErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_configured'; // function not deployed
  if (status === 429) return 'quota_exceeded';
  if (status >= 500) return 'server_error';
  return 'bad_request';
}

/** Shape check of a response from the network. Content was validated by the server. */
export function isTutorResponse(x: unknown, kind: TutorRequest['kind']): x is TutorResponse {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return r.kind === kind && TUTOR_KINDS.includes(kind) && !!r.content && typeof r.content === 'object' && typeof r.generatedAt === 'string';
}

export class SupabaseTutorApi implements TutorApi {
  constructor(private readonly db: SupabaseClient) {}

  async ask(request: TutorRequest, opts: { force?: boolean } = {}): Promise<TutorResponse> {
    const { data, error } = await this.db.functions.invoke('ai-tutor', { body: { ...request, force: opts.force === true } });
    if (error) throw await toTutorError(error);
    if (!isTutorResponse(data, request.kind)) throw new TutorError('server_error', 'unexpected response from the AI tutor');
    return data;
  }
}

export async function toTutorError(error: unknown): Promise<TutorError> {
  if (error instanceof TutorError) return error;
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response | undefined;
    let code: TutorErrorCode = res ? codeForStatus(res.status) : 'server_error';
    let message = error.message;
    try {
      const body = (await res?.json()) as { error?: { code?: string; message?: string } } | undefined;
      if (body?.error?.code && CODES.has(body.error.code as TutorErrorCode)) code = body.error.code as TutorErrorCode;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Not a JSON error body (e.g. a gateway page); keep the status-based code.
    }
    return new TutorError(code, message);
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) return new TutorError('network', 'could not reach the AI tutor');
  return new TutorError('network', error instanceof Error ? error.message : String(error));
}
