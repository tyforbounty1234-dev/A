import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { getSupabase } from '../data/remote/supabaseClient';
import { SupabaseApi } from '../data/remote/supabaseApi';
import type { Word } from '../domain/types';
import { LearningStore, type LearningSnapshot } from '../services/LearningStore';
import bundledWords from '../data/words.json';
import { useAuth } from './AuthProvider';

const StoreContext = createContext<LearningStore | null>(null);

function createStore(): LearningStore {
  const supabase = getSupabase();
  return new LearningStore({
    storage: AsyncStorage,
    api: supabase ? new SupabaseApi(supabase) : null,
    bundledWords: bundledWords as Word[],
    newId: randomUUID,
  });
}

export function LearningProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [store] = useState(createStore);

  // Load the signed-in user's data; drop it from memory on sign-out.
  useEffect(() => {
    if (userId) void store.load(userId);
    else void store.unload();
  }, [store, userId]);

  // Sync when connectivity returns and when the app comes to the foreground.
  useEffect(() => {
    const unsubNet = NetInfo.addEventListener((s) => {
      if (s.isConnected && s.isInternetReachable !== false) void store.flush();
    });
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void store.refresh();
    });
    return () => {
      unsubNet();
      appSub.remove();
    };
  }, [store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useLearningStore(): LearningStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useLearningStore must be used inside LearningProvider');
  return store;
}

export function useLearning(): LearningSnapshot {
  const store = useLearningStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
