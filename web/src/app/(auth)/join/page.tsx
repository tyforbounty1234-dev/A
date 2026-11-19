'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Notice, inputClass } from '@/components/ui';
import { authErrorMessage, useAuth } from '@/lib/auth';
import { checkInviteCode } from '@/lib/social';

function JoinForm() {
  const { signUp, userId, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [codeOk, setCodeOk] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!loading && userId) router.replace('/');
  }, [loading, userId, router]);

  // Check the code as the visitor types (debounced).
  useEffect(() => {
    const c = code.trim();
    if (c.length < 6) {
      setCodeOk(null);
      return;
    }
    const t = setTimeout(() => {
      checkInviteCode(c)
        .then(setCodeOk)
        .catch(() => setCodeOk(null));
    }, 300);
    return () => clearTimeout(t);
  }, [code]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!(await checkInviteCode(code.trim()))) {
        setCodeOk(false);
        setError('招待コードが正しくないか、使用回数の上限に達しています。');
        return;
      }
      const { needsConfirmation } = await signUp({ email, password, inviteCode: code, displayName: name });
      if (needsConfirmation) setSent(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Notice tone="ok">
        確認メールを {email} に送りました。メールのリンクを開くと登録が完了します。
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        label="招待コード"
        hint={codeOk === true ? <span className="text-ok">✓ 使える招待コードです</span> : codeOk === false ? <span className="text-bad">このコードは使えません</span> : '招待してくれた友だちに教えてもらったコード'}
      >
        <input
          className={inputClass}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          required
          placeholder="例: 7F3K9QAB"
        />
      </Field>
      <Field label="表示名" hint="ランキングや友だちに表示される名前（20文字まで）">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={20} required autoComplete="nickname" />
      </Field>
      <Field label="メールアドレス">
        <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="パスワード" hint="6文字以上">
        <input className={inputClass} type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <Notice>{error}</Notice>}
      <Button type="submit" loading={busy} disabled={codeOk === false || !name.trim() || !email || password.length < 6 || code.trim().length < 6}>
        登録する
      </Button>
    </form>
  );
}

export default function JoinPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">LexiCoreに参加</h1>
        <p className="text-muted">招待コードを持っている人だけが登録できます。</p>
      </div>
      <Suspense>
        <JoinForm />
      </Suspense>
      <p className="text-center text-sm text-muted">
        登録済みの方は
        <Link href="/login" className="font-semibold text-accent underline">
          ログイン
        </Link>
      </p>
    </>
  );
}
