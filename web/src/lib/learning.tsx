'use client';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SupabaseApi } from '@/lexicore/data/remote/supabaseApi';
import bundledWords from '@/lexicore/data/words.json';
import type { SessionMode, Word } from '@/lexicore/domain/types';
import { LearningStore, type LearningSnapshot } from '@/lexicore/services/LearningStore';
import { useStudySessionCore } from '@/lexicore/state/studySessionCore';
import { useAuth } from './auth';
import { BrowserStorage } from './browserStorage';
import { getSupabase } from './supabase';

const StoreContext = createContext<LearningStore | null>(null);

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Offline-first learning state shared by every page. Answers are applied
 * locally first and uploaded in order; sync runs when the browser comes back
 * online and when the tab becomes visible.
 */
export function LearningProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [store] = useState(
    () =>
      new LearningStore({
        storage: new BrowserStorage(),
        api: new SupabaseApi(getSupabase()),
        bundledWords: bundledWords as Word[],
        newId,
      }),
  );

  useEffect(() => {
    if (userId) void store.load(userId);
    else void store.unload();
  }, [store, userId]);

  useEffect(() => {
    const online = () => void store.flush();
    const visible = () => document.visibilityState === 'visible' && void store.refresh();
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useLearningStore(): LearningStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useLearningStore must be used inside LearningProvider');
  return s;
}

export function useLearning(): LearningSnapshot {
  const store = useLearningStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useStudySession(mode: SessionMode) {
  return useStudySessionCore(useLearningStore(), useLearning(), mode);
}
