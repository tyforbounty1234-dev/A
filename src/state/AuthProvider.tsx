import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSupabase, isSupabaseConfigured } from '../data/remote/supabaseClient';

/** User id used when no backend is configured; all data stays on the device. */
export const LOCAL_USER_ID = 'local';

export interface AuthState {
  /** false = local-only mode (Supabase env vars not set). */
  cloud: boolean;
  loading: boolean;
  userId: string | null;
  email: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Map Supabase auth errors to messages a student can act on. */
export function authErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? '';
  if (/invalid login credentials/i.test(msg)) return 'メールアドレスかパスワードが違います。';
  if (/email not confirmed/i.test(msg)) return '確認メールのリンクを開いてから、もう一度ログインしてください。';
  if (/already registered/i.test(msg)) return 'このメールアドレスはすでに登録されています。ログインしてください。';
  if (/password should be at least/i.test(msg)) return 'パスワードは6文字以上にしてください。';
  if (/network|fetch/i.test(msg)) return 'インターネットに接続できません。通信状況を確認してください。';
  return msg ? `エラー: ${msg}` : 'うまくいきませんでした。もう一度お試しください。';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .finally(() => active && setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AuthState>(() => {
    if (!supabase) {
      return {
        cloud: false,
        loading: false,
        userId: LOCAL_USER_ID,
        email: null,
        signIn: async () => {},
        signUp: async () => ({ needsConfirmation: false }),
        signOut: async () => {},
      };
    }
    return {
      cloud: true,
      loading,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      },
      async signUp(email, password) {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    };
  }, [supabase, session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
