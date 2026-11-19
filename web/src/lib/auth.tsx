'use client';
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IS_LOCAL, getSupabase, isSupabaseConfigured } from './supabase';

/** User id used for everything stored in local mode. */
export const LOCAL_USER_ID = 'local';

export interface AuthState {
  loading: boolean;
  userId: string | null;
  email: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: { email: string; password: string; inviteCode: string; displayName: string }): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

/** Japanese message for a Supabase auth error. */
export function authErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string; status?: number } | null;
  const msg = err?.message ?? String(e);
  if (/invalid login credentials/i.test(msg)) return 'メールアドレスかパスワードが違います。';
  if (/email not confirmed/i.test(msg)) return 'メールアドレスの確認がまだです。届いたメールのリンクを開いてください。';
  if (/already registered|already been registered/i.test(msg)) return 'このメールアドレスはすでに登録されています。ログインしてください。';
  if (/password/i.test(msg) && /(least|short|characters)/i.test(msg)) return 'パスワードは6文字以上にしてください。';
  if (/database error saving new user|invite/i.test(msg)) return '招待コードが正しくないか、使用回数の上限に達しています。';
  if (/rate limit|too many/i.test(msg)) return '試行回数が多すぎます。しばらく待ってからお試しください。';
  if (/fetch|network/i.test(msg)) return 'サーバーに接続できません。インターネット接続を確認してください。';
  return `エラーが発生しました（${msg}）`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => active && setSession(data.session))
      .finally(() => active && setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      userId: IS_LOCAL ? LOCAL_USER_ID : (session?.user.id ?? null),
      email: session?.user.email ?? null,
      async signIn(email, password) {
        const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      },
      async signUp({ email, password, inviteCode, displayName }) {
        const { data, error } = await getSupabase().auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { invite_code: inviteCode.trim(), display_name: displayName.trim() },
            emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : undefined,
          },
        });
        if (error) throw error;
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        await getSupabase().auth.signOut();
      },
    }),
    [loading, session],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
