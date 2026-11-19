'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Notice, inputClass } from '@/components/ui';
import { authErrorMessage, useAuth } from '@/lib/auth';

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function LoginForm() {
  const { signIn, userId, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && userId) router.replace(next);
  }, [loading, userId, router, next]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="メールアドレス">
        <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="パスワード">
        <input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <Notice>{error}</Notice>}
      <Button type="submit" loading={busy} disabled={!email || password.length < 6}>
        ログイン
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">LexiCore</h1>
        <p className="text-muted">京大・東大レベルの英単語を、忘れる前に復習しよう。</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="text-center text-sm text-muted">
        はじめての方は、友だちからもらった招待リンクを開くか、
        <Link href="/join" className="font-semibold text-accent underline">
          招待コードで登録
        </Link>
        してください。
      </p>
    </>
  );
}
