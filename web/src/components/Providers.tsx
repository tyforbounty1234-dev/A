'use client';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { LearningProvider } from '@/lib/learning';
import { MeProvider } from '@/lib/me';
import { isSupabaseConfigured } from '@/lib/supabase';
import { TutorProvider } from '@/lib/tutor';

export function Providers({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
        <h1 className="text-2xl font-bold">LexiCore</h1>
        <p className="text-muted">
          サーバーの設定がまだです。管理者は環境変数 <code>NEXT_PUBLIC_SUPABASE_URL</code> と <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> を設定してください。
        </p>
      </main>
    );
  }
  return (
    <AuthProvider>
      <LearningProvider>
        <TutorProvider>
          <MeProvider>{children}</MeProvider>
        </TutorProvider>
      </LearningProvider>
    </AuthProvider>
  );
}
