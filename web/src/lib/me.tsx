'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import { useLearning } from './learning';
import { countUnread, fetchMember, type Member } from './social';

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
