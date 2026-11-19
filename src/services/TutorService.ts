/**
 * AI tutor client service: calls the server, keeps a small per-user device
 * cache so answers already seen are available offline, and syncs pending
 * reviews first so the server personalizes with up-to-date history.
 */
import { requestKey, type TutorRequest, type TutorResponse } from '../domain/ai/contract';
import { readJson, writeJson, type KeyValueStorage } from '../data/storage';
import { TutorError, toTutorError, type TutorApi } from '../data/remote/tutorApi';

export const DEVICE_CACHE_LIMIT = 50;

interface CacheEntry {
  key: string;
  savedAt: string;
  response: TutorResponse;
}

export interface TutorResult {
  response: TutorResponse;
  /** True when the network failed and a previously saved answer is shown instead. */
  offlineCopy: boolean;
}

export interface TutorServiceOptions {
  api: TutorApi | null;
  storage: KeyValueStorage;
  /** Called before each request, e.g. to upload pending reviews. Errors are ignored. */
  beforeRequest?: () => Promise<void>;
  now?: () => Date;
}

export class TutorService {
  constructor(private readonly opts: TutorServiceOptions) {}

  get available(): boolean {
    return this.opts.api !== null;
  }

  private cacheKey(userId: string) {
    return `lexicore:tutor:${userId}`;
  }

  async saved(userId: string, request: TutorRequest): Promise<TutorResponse | null> {
    const entries = await readJson<CacheEntry[]>(this.opts.storage, this.cacheKey(userId), []);
    return entries.find((e) => e.key === requestKey(request))?.response ?? null;
  }

  async ask(userId: string, request: TutorRequest, opts: { force?: boolean } = {}): Promise<TutorResult> {
    const api = this.opts.api;
    if (!api) throw new TutorError('not_configured', 'AI tutor is not configured');
    try {
      await this.opts.beforeRequest?.();
    } catch {
      // Personalization may be slightly stale; the request still works.
    }
    try {
      const response = await api.ask(request, opts);
      await this.remember(userId, request, response);
      return { response, offlineCopy: false };
    } catch (e) {
      const err = await toTutorError(e);
      if (err.code === 'network') {
        const copy = await this.saved(userId, request);
        if (copy) return { response: copy, offlineCopy: true };
      }
      throw err;
    }
  }

  private async remember(userId: string, request: TutorRequest, response: TutorResponse) {
    const key = requestKey(request);
    const entries = await readJson<CacheEntry[]>(this.opts.storage, this.cacheKey(userId), []);
    const next = [{ key, savedAt: (this.opts.now?.() ?? new Date()).toISOString(), response }, ...entries.filter((e) => e.key !== key)].slice(0, DEVICE_CACHE_LIMIT);
    try {
      await writeJson(this.opts.storage, this.cacheKey(userId), next);
    } catch (e) {
      console.warn('[tutor] could not save answer on device', e);
    }
  }

  /** Remove a user's saved answers (sign-out). */
  async clear(userId: string): Promise<void> {
    await this.opts.storage.removeItem(this.cacheKey(userId));
  }
}
