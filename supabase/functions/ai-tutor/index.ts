/**
 * ai-tutor Edge Function entry point.
 *
 * Secrets (set with `supabase secrets set`, never in the app):
 *   OPENAI_API_KEY   required for AI answers
 *   OPENAI_MODEL     optional, default below
 *   AI_DAILY_LIMIT   optional, requests per user per 24 hours (default 30)
 * SUPABASE_URL, the anon/publishable key and the service-role/secret key are
 * provided by the Supabase runtime.
 */
import { createClient } from '@supabase/supabase-js';
import { createHandler } from './handler.ts';
import { OpenAiLlm } from './openai.ts';
import { SupabaseTutorRepo } from './repo.ts';

const DEFAULT_MODEL = 'gpt-5-mini';

const env = (k: string) => Deno.env.get(k) || undefined;
const url = env('SUPABASE_URL')!;
const publicKey = env('SUPABASE_ANON_KEY') ?? env('SUPABASE_PUBLISHABLE_KEY')!;
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY');
const openAiKey = env('OPENAI_API_KEY');
const model = env('OPENAI_MODEL') ?? DEFAULT_MODEL;
const dailyLimit = Math.max(0, Math.floor(Number(env('AI_DAILY_LIMIT') ?? 30))) || 30;

const service = serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const llm = openAiKey ? new OpenAiLlm({ apiKey: openAiKey, model }) : null;

function userClient(authorization: string) {
  return createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(
  createHandler({
    async authenticate(authorization) {
      const token = authorization.replace(/^Bearer\s+/i, '');
      const { data, error } = await userClient(authorization).auth.getUser(token);
      if (error || !data.user) return null;
      return data.user.id;
    },
    makeDeps(userId, authorization) {
      if (!llm || !service) return null;
      return {
        repo: new SupabaseTutorRepo(userClient(authorization), service, userId),
        llm,
        now: () => new Date(),
        hash: sha256,
        dailyLimit,
      };
    },
  }),
);
