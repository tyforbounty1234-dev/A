import { ApiError, type RemoteApi } from '../../src/data/remote/api';
import { MemoryStorage } from '../../src/data/storage';
import { LearningStore, type AnswerParams } from '../../src/services/LearningStore';
import type { ReviewRecord, StudySession, UserProfile, WordProgress } from '../../src/domain/types';
import { DEFAULT_PROFILE } from '../../src/domain/types';
import { newProgress } from '../../src/domain/srs/progress';
import { DAY, T0, WORDS, at } from '../helpers';

/** In-memory fake of the server with the same idempotency / ordering rules as submit_review. */
class FakeApi implements RemoteApi {
  reviews = new Map<string, ReviewRecord>();
  progress = new Map<string, WordProgress>();
  sessions = new Map<string, StudySession>();
  profile: UserProfile = { id: 'u1', ...DEFAULT_PROFILE };
  online = true;
  failNextWith: unknown = null;
  submitCalls = 0;

  private check() {
    if (!this.online) throw new TypeError('Network request failed');
    if (this.failNextWith) {
      const e = this.failNextWith;
      this.failNextWith = null;
      throw e;
    }
  }
  async fetchWords() {
    this.check();
    return WORDS;
  }
  async fetchProfile() {
    this.check();
    return this.profile;
  }
  async updateProfile(_: string, patch: Partial<UserProfile>) {
    this.check();
    this.profile = { ...this.profile, ...patch };
    return this.profile;
  }
  async fetchProgress() {
    this.check();
    return [...this.progress.values()];
  }
  async fetchReviews() {
    this.check();
    return [...this.reviews.values()];
  }
  async fetchSessions() {
    this.check();
    return [...this.sessions.values()];
  }
  async submitReview(review: ReviewRecord, progress: WordProgress) {
    this.submitCalls++;
    this.check();
    if (this.reviews.has(review.id)) return;
    this.reviews.set(review.id, review);
    const cur = this.progress.get(progress.wordId);
    if (!cur || (cur.lastReviewedAt ?? '') <= (progress.lastReviewedAt ?? '')) this.progress.set(progress.wordId, progress);
  }
  async upsertSession(s: StudySession) {
    this.check();
    this.sessions.set(s.id, s);
  }
}

function setup(opts: { api?: FakeApi | null; storage?: MemoryStorage; start?: Date } = {}) {
  let clock = opts.start ?? T0;
  let id = 0;
  const api = opts.api === undefined ? new FakeApi() : opts.api;
  const storage = opts.storage ?? new MemoryStorage();
  const store = new LearningStore({
    storage,
    api,
    bundledWords: WORDS,
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => clock,
  });
  return { store, api, storage, tick: (ms: number) => (clock = at(clock, ms)) };
}

const answerFor = (wordId: string, isCorrect = true): AnswerParams => ({
  wordId,
  sessionId: null,
  questionType: 'en_to_ja_mc',
  userAnswer: 'x',
  isCorrect,
  responseTimeMs: 2000,
  quality: isCorrect ? 5 : 1,
});

const w0 = WORDS[0]!.id;
const w1 = WORDS[1]!.id;

describe('LearningStore', () => {
  it('loads bundled words and default profile for a new user', async () => {
    const { store } = setup({ api: null });
    await store.load('u1');
    const s = store.getSnapshot();
    expect(s.ready).toBe(true);
    expect(s.words).toHaveLength(WORDS.length);
    expect(s.profile?.dailyNewWords).toBe(10);
    expect(s.sync).toBe('local');
  });

  it('local mode: answers are applied and persisted without a server', async () => {
    const storage = new MemoryStorage();
    const { store } = setup({ api: null, storage });
    await store.load('u1');
    await store.recordAnswer(answerFor(w0));
    expect(store.getSnapshot().progress.get(w0)?.repetitions).toBe(1);
    expect(store.getSnapshot().pendingCount).toBe(0);

    const again = setup({ api: null, storage }).store;
    await again.load('u1');
    expect(again.getSnapshot().progress.get(w0)?.repetitions).toBe(1);
    expect(again.getSnapshot().reviews).toHaveLength(1);
  });

  it('uploads answers to the server', async () => {
    const { store, api } = setup();
    await store.load('u1');
    await store.refresh();
    await store.recordAnswer(answerFor(w0));
    await store.flush();
    expect(api!.reviews.size).toBe(1);
    expect(api!.progress.get(w0)?.repetitions).toBe(1);
    expect(store.getSnapshot().pendingCount).toBe(0);
    expect(store.getSnapshot().sync).toBe('idle');
  });

  it('works offline and syncs everything in order when back online', async () => {
    const { store, api, storage, tick } = setup();
    api!.online = false;
    await store.load('u1');
    await store.recordAnswer(answerFor(w0));
    tick(1000);
    await store.recordAnswer(answerFor(w1, false));
    await store.flush();
    expect(store.getSnapshot().pendingCount).toBe(2);
    expect(store.getSnapshot().sync).toBe('offline');
    expect(api!.reviews.size).toBe(0);

    // App restarts while still offline: the queue survives.
    const restarted = setup({ api: api!, storage });
    await restarted.store.load('u1');
    expect(restarted.store.getSnapshot().pendingCount).toBe(2);

    api!.online = true;
    await restarted.store.refresh();
    expect(api!.reviews.size).toBe(2);
    expect(restarted.store.getSnapshot().pendingCount).toBe(0);
    expect(restarted.store.getSnapshot().progress.get(w1)?.status).toBe('learning');
  });

  it('retrying after an ambiguous failure does not duplicate reviews', async () => {
    const { store, api } = setup();
    await store.load('u1');
    await store.refresh();
    // Server stores the review, but the response is lost.
    const original = api!.submitReview.bind(api);
    api!.submitReview = async (r, p) => {
      await original(r, p);
      throw new TypeError('Network request failed');
    };
    await store.recordAnswer(answerFor(w0));
    await store.flush();
    expect(store.getSnapshot().pendingCount).toBe(1);
    api!.submitReview = original;
    await store.flush();
    expect(api!.reviews.size).toBe(1);
    expect(store.getSnapshot().pendingCount).toBe(0);
  });

  it('moves permanently failing operations aside instead of blocking the queue', async () => {
    const { store, api, tick } = setup();
    await store.load('u1');
    await store.refresh();
    api!.failNextWith = { message: 'violates check constraint', code: '23514' };
    await store.recordAnswer(answerFor(w0));
    tick(1000);
    await store.recordAnswer(answerFor(w1));
    await store.flush();
    expect(api!.reviews.size).toBe(1);
    expect(store.getSnapshot().failedCount).toBe(1);
    expect(store.getSnapshot().pendingCount).toBe(0);
    await store.retryFailed();
    expect(api!.reviews.size).toBe(2);
    expect(store.getSnapshot().failedCount).toBe(0);
  });

  it('refresh keeps local changes that are still pending upload', async () => {
    const { store, api } = setup();
    // Server knows an older state of w0.
    api!.progress.set(w0, { ...(await seedProgress()), lastReviewedAt: at(T0, -DAY).toISOString(), repetitions: 5 });
    api!.online = false;
    await store.load('u1');
    await store.recordAnswer(answerFor(w0, false));
    api!.online = true;
    // Upload fails once more, then the pull happens: local relearning state must survive.
    api!.failNextWith = new TypeError('Network request failed');
    await store.refresh();
    expect(store.getSnapshot().progress.get(w0)?.status).not.toBe('review');
    expect(store.getSnapshot().progress.get(w0)?.repetitions).toBe(0);
    await store.refresh();
    expect(api!.progress.get(w0)?.repetitions).toBe(0);
  });

  it('pulls progress made on another device', async () => {
    const { store, api } = setup();
    const remote = { ...(await seedProgress()), repetitions: 3, intervalDays: 15, status: 'review' as const };
    api!.progress.set(w0, remote);
    await store.load('u1');
    await store.refresh();
    expect(store.getSnapshot().progress.get(w0)?.intervalDays).toBe(15);
  });

  it('records study sessions and collapses unsent updates', async () => {
    const { store, api } = setup();
    api!.online = false;
    await store.load('u1');
    const s = await store.startSession('review', 5);
    await store.completeSession(s.id, { wordsStudied: 3, questionsAnswered: 4, correctAnswers: 3, accuracy: 0.75, completedReviews: 9 });
    expect(store.getSnapshot().pendingCount).toBe(1);
    api!.online = true;
    await store.flush();
    const saved = api!.sessions.get(s.id)!;
    expect(saved.completedAt).not.toBeNull();
    expect(saved.completedReviews).toBe(5);
  });

  it('does not lose a session update made while the first upload is in flight', async () => {
    const { store, api } = setup();
    await store.load('u1');
    await store.refresh();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = api!.upsertSession.bind(api);
    api!.upsertSession = async (x) => {
      await gate;
      return original(x);
    };
    const s = await store.startSession('learn', 0); // flush starts and blocks on the gate
    const completing = store.completeSession(s.id, { wordsStudied: 1, questionsAnswered: 2, correctAnswers: 2, accuracy: 1, completedReviews: 0 });
    release();
    await completing;
    await store.flush();
    await store.flush();
    expect(api!.sessions.get(s.id)?.completedAt).not.toBeNull();
  });

  it('updates the profile on the server and locally', async () => {
    const { store, api } = setup();
    await store.load('u1');
    await store.updateProfile({ dailyNewWords: 20 });
    expect(api!.profile.dailyNewWords).toBe(20);
    expect(store.getSnapshot().profile?.dailyNewWords).toBe(20);
  });

  it('keeps users separate on a shared device', async () => {
    const storage = new MemoryStorage();
    const a = setup({ api: null, storage }).store;
    await a.load('alice');
    await a.recordAnswer(answerFor(w0));
    await a.unload();
    const b = setup({ api: null, storage }).store;
    await b.load('bob');
    expect(b.getSnapshot().progress.size).toBe(0);
  });

  it('rejects answers for unknown words', async () => {
    const { store } = setup({ api: null });
    await store.load('u1');
    await expect(store.recordAnswer(answerFor('nope'))).rejects.toThrow('Unknown word');
  });

  it('survives corrupt cached data', async () => {
    const storage = new MemoryStorage();
    await storage.setItem('lexicore:v1:u1:progress', '{not json');
    const { store } = setup({ api: null, storage });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await store.load('u1');
    warn.mockRestore();
    expect(store.getSnapshot().progress.size).toBe(0);
  });
});

async function seedProgress(): Promise<WordProgress> {
  return { ...newProgress('u1', w0), reviewCount: 1, correctCount: 1, repetitions: 1, intervalDays: 1, status: 'review', lastReviewedAt: T0.toISOString(), nextReviewAt: at(T0, DAY).toISOString(), firstReviewedAt: T0.toISOString() };
}

test('ApiError classification', () => {
  const { classifyError } = jest.requireActual('../../src/data/remote/api') as typeof import('../../src/data/remote/api');
  expect(classifyError(new TypeError('Network request failed')).retryable).toBe(true);
  expect(classifyError({ code: '23505', message: 'dup' }).retryable).toBe(false);
  expect(classifyError({ status: 401, message: 'jwt expired' }).retryable).toBe(true);
  expect(classifyError({ status: 403, message: 'forbidden' }).retryable).toBe(false);
  expect(classifyError(new ApiError('x', false)).retryable).toBe(false);
});
