import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TutorRequest, TutorResponse } from '../domain/ai/contract';
import { requestKey } from '../domain/ai/contract';
import { getSupabase } from '../data/remote/supabaseClient';
import { SupabaseTutorApi, TutorError } from '../data/remote/tutorApi';
import { TutorService } from '../services/TutorService';
import { useAuth } from './AuthProvider';
import { useLearningStore } from './LearningProvider';

const Ctx = createContext<TutorService | null>(null);

export function TutorProvider({ children }: { children: ReactNode }) {
  const store = useLearningStore();
  const [service] = useState(() => {
    const db = getSupabase();
    return new TutorService({
      api: db ? new SupabaseTutorApi(db) : null,
      storage: AsyncStorage,
      // Upload pending answers first so the tutor sees the latest mistakes.
      beforeRequest: () => store.flush(),
    });
  });
  return <Ctx.Provider value={service}>{children}</Ctx.Provider>;
}

export function useTutorService(): TutorService {
  const s = useContext(Ctx);
  if (!s) throw new Error('useTutorService must be used inside TutorProvider');
  return s;
}

export type TutorState =
  | { status: 'idle' }
  | { status: 'loading'; request: TutorRequest; previous: TutorResponse | null }
  | { status: 'done'; request: TutorRequest; response: TutorResponse; offlineCopy: boolean }
  | { status: 'error'; request: TutorRequest; error: TutorError; previous: TutorResponse | null };

export const TUTOR_ERROR_MESSAGES: Record<TutorError['code'], string> = {
  unauthorized: 'ログインの有効期限が切れました。ログインし直してください。',
  bad_request: '入力内容を確認してください。',
  not_found: 'この単語はサーバーの辞書にありません。',
  quota_exceeded: '今日のAIの利用回数の上限に達しました。24時間後にまた使えます。',
  ai_unavailable: 'AIが混み合っているか、一時的に使えません。少し待ってからもう一度お試しください。',
  invalid_output: 'AIの答えが品質チェックに通らなかったため、表示しませんでした。もう一度お試しください。',
  not_configured: 'AI講師はまだサーバーに設定されていません。',
  network: 'インターネットに接続できません。接続を確認してください。',
  server_error: 'エラーが発生しました。しばらくしてからもう一度お試しください。',
};

/** One active tutor request at a time; later requests win over earlier ones. */
export function useTutorRequest() {
  const service = useTutorService();
  const { userId } = useAuth();
  const [state, setState] = useState<TutorState>({ status: 'idle' });
  const seq = useRef(0);
  useEffect(() => () => void (seq.current += 1), []);

  const run = useCallback(
    async (request: TutorRequest, opts: { force?: boolean } = {}) => {
      if (!userId) return;
      const id = ++seq.current;
      const previous = opts.force ? null : await service.saved(userId, request);
      if (id !== seq.current) return;
      setState({ status: 'loading', request, previous });
      try {
        const { response, offlineCopy } = await service.ask(userId, request, opts);
        if (id === seq.current) setState({ status: 'done', request, response, offlineCopy });
      } catch (e) {
        const error = e instanceof TutorError ? e : new TutorError('server_error', String(e));
        if (id === seq.current) setState({ status: 'error', request, error, previous });
      }
    },
    [service, userId],
  );

  const reset = useCallback(() => {
    seq.current += 1;
    setState({ status: 'idle' });
  }, []);

  return { state, run, reset, available: service.available };
}

export function sameRequest(a: TutorRequest | undefined, b: TutorRequest): boolean {
  return !!a && requestKey(a) === requestKey(b);
}
