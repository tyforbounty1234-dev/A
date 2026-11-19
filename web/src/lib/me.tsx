'use client';
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from './auth';
import { useLearning } from './learning';
import { localSocial } from './localSocial';
import { countUnread, fetchMember, localMember, type Member } from './social';
import { IS_LOCAL } from './supabase';

interface MeState {
  member: Member | null;
  unread: number;
  refresh(): Promise<void>;
  setMember(m: Member): void;
}

const Ctx = createContext<MeState | null>(null);
const POLL_MS = 60_000;

/** The signed-in member's public profile (LP etc.) and unread notification count. */
export function MeProvider({ children }: { children: ReactNode }) {
  return IS_LOCAL ? <LocalMeProvider>{children}</LocalMeProvider> : <CloudMeProvider>{children}</CloudMeProvider>;
}

/** Local mode: the player's profile and LP live in this browser; LP is awarded here on first mastery. */
function LocalMeProvider({ children }: { children: ReactNode }) {
  const snap = useLearning();
  const version = useSyncExternalStore(localSocial.subscribe, () => localSocial.get(), () => null);
  const [member, setMemberState] = useState<Member | null>(null);

  useEffect(() => {
    if (version) setMemberState(localMember());
  }, [version]);

  useEffect(() => {
    if (!snap.ready) return;
    const mastered = [...snap.progress.values()].filter((p) => p.status === 'mastered').map((p) => p.wordId);
    localSocial.awardMastered(mastered);
  }, [snap.ready, snap.progress]);

  const refresh = useCallback(async () => setMemberState(localMember()), []);
  return <Ctx.Provider value={{ member, unread: 0, refresh, setMember: setMemberState }}>{children}</Ctx.Provider>;
}

function CloudMeProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const snap = useLearning();
  const [member, setMember] = useState<Member | null>(null);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const [m, n] = await Promise.all([fetchMember(userId), countUnread()]);
      setMember(m);
      setUnread(n);
    } catch {
      // Offline: keep showing the last known values.
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setMember(null);
      setUnread(0);
      return;
    }
    void refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, refresh]);

  // LP is awarded by the server when an uploaded answer completes a mastery,
  // so re-read the balance after each successful sync.
  useEffect(() => {
    if (snap.lastSyncAt) void refresh();
  }, [snap.lastSyncAt, refresh]);

  return <Ctx.Provider value={{ member, unread, refresh, setMember }}>{children}</Ctx.Provider>;
}

export function useMe(): MeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMe must be used inside MeProvider');
  return v;
}
