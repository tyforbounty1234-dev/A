/**
 * Data access for the tutor. Learner data is read with the caller's own JWT,
 * so Row Level Security applies exactly as in the app. Only the usage log and
 * the validated-content insert use the service role.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  progressFromRow,
  profileFromRow,
  reviewFromRow,
  wordFromRow,
  type ProfileRow,
  type ProgressRow,
  type ReviewRow,
  type WordRow,
} from '../_shared/lexicore/data/remote/mappers.ts';
import type { Word } from '../_shared/lexicore/domain/types.ts';
import type { StoredGeneration, TutorRepo } from '../_shared/lexicore/domain/ai/tutorCore.ts';

const PAGE = 1000;
const WORD_CACHE_MS = 10 * 60_000;
let wordCache: { at: number; words: Word[] } | null = null;

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = 20_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export class SupabaseTutorRepo implements TutorRepo {
  constructor(
    private readonly user: SupabaseClient,
    private readonly service: SupabaseClient,
    private readonly userId: string,
  ) {}

  async getWords(): Promise<Word[]> {
    if (wordCache && Date.now() - wordCache.at < WORD_CACHE_MS) return wordCache.words;
    const rows = await fetchAll<WordRow>((a, b) => this.user.from('words').select('*').order('rank').range(a, b));
    const words = rows.map(wordFromRow).filter((w): w is Word => w !== null);
    wordCache = { at: Date.now(), words };
    return words;
  }

  async getProfile() {
    const { data, error } = await this.user.from('profiles').select('*').eq('id', this.userId).maybeSingle<ProfileRow>();
    if (error) throw new Error(error.message);
    return data ? profileFromRow(data) : null;
  }

  async getProgress() {
    const rows = await fetchAll<ProgressRow>((a, b) => this.user.from('word_progress').select('*').eq('user_id', this.userId).order('word_id').range(a, b));
    return rows.map(progressFromRow);
  }

  async getRecentReviews(limit: number) {
    const { data, error } = await this.user
      .from('reviews')
      .select('*')
      .eq('user_id', this.userId)
      .order('reviewed_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data as ReviewRow[]).map(reviewFromRow);
  }

  async findGeneration(cacheKey: string, notBefore: string): Promise<StoredGeneration | null> {
    const { data, error } = await this.user
      .from('ai_generations')
      .select('kind, content, model, prompt_version, created_at')
      .eq('user_id', this.userId)
      .eq('cache_key', cacheKey)
      .gte('created_at', notBefore)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { kind: data.kind, content: data.content, model: data.model, promptVersion: data.prompt_version, createdAt: data.created_at };
  }

  async reserveRequest(kind: string, dailyLimit: number): Promise<boolean> {
    const { data, error } = await this.service.rpc('reserve_ai_request', { p_user: this.userId, p_kind: kind, p_daily_limit: dailyLimit });
    if (error) throw new Error(error.message);
    return data === true;
  }

  async saveGeneration(g: Parameters<TutorRepo['saveGeneration']>[0]): Promise<void> {
    const { error } = await this.service.from('ai_generations').insert({
      user_id: this.userId,
      kind: g.kind,
      word_id: g.wordId,
      cache_key: g.cacheKey,
      prompt_version: g.promptVersion,
      model: g.model,
      request: g.request,
      content: g.content,
    });
    if (error) throw new Error(error.message);
  }
}
