'use client';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Button, Card, Field, Notice, PageTitle, SectionLabel, cx, inputClass } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useLearning, useLearningStore } from '@/lib/learning';
import { useMe } from '@/lib/me';
import {
  SOCIAL_ERROR_MESSAGES,
  SocialError,
  createInviteCode,
  fetchMyInviteCodes,
  inviteLink,
  updateMyProfile,
  type InviteCode,
  type Member,
} from '@/lib/social';
import { DEFAULT_PROFILE } from '@/lexicore/domain/types';
import { LEVEL_LABELS } from '@/lib/levels';
import { IS_LOCAL } from '@/lib/supabase';

const AVATARS = ['🙂', '😎', '🤓', '🦊', '🐻', '🐼', '🐱', '🐶', '🐧', '🦉', '🐢', '🌸', '🍀', '⚡', '🔥', '🌙', '🚀', '🎧', '📚', '✏️'];

export default function Me() {
  const { userId, email, signOut } = useAuth();
  const { member, setMember } = useMe();
  return (
    <>
      <PageTitle>マイページ</PageTitle>
      {member && userId && <ProfileCard key={member.id} userId={userId} initial={member} onSaved={setMember} />}
      <div className="grid grid-cols-2 gap-3">
        <Link href={userId ? `/members/${userId}` : '/'} className="rounded-2xl border border-line bg-surface p-4 text-center font-semibold text-accent hover:bg-surface-alt">
          公開プロフィール
        </Link>
        <Link href="/analytics" className="rounded-2xl border border-line bg-surface p-4 text-center font-semibold text-accent hover:bg-surface-alt">
          学習分析
        </Link>
      </div>
      {IS_LOCAL ? (
        <Card>
          <SectionLabel>友だちを招待</SectionLabel>
          <p className="text-sm text-muted">いまはローカルモードです。サーバー（Supabase）を設定すると、招待リンクとQRコードで友だちを招待できます。</p>
        </Card>
      ) : (
        <InviteCard />
      )}
      <StudySettings />
      <SyncCard />
      {IS_LOCAL ? (
        <Card>
          <SectionLabel>データ</SectionLabel>
          <p className="text-sm text-muted">
            ローカルモードでは、学習の記録・LP・エモートはこのブラウザだけに保存されます。ほかの端末とは同期されず、ブラウザのサイトデータを消すと消えます。
          </p>
        </Card>
      ) : (
        <Card>
          <SectionLabel>アカウント</SectionLabel>
          <p className="text-sm text-muted">{email}</p>
          <Button variant="danger" onClick={() => void signOut()}>
            ログアウト
          </Button>
        </Card>
      )}
    </>
  );
}

function ProfileCard({ userId, initial, onSaved }: { userId: string; initial: { displayName: string; avatar: string; bio: string }; onSaved: (m: Member) => void }) {
  const [name, setName] = useState(initial.displayName);
  const [avatar, setAvatar] = useState(initial.avatar);
  const [bio, setBio] = useState(initial.bio);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const dirty = name !== initial.displayName || avatar !== initial.avatar || bio !== initial.bio;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const m = await updateMyProfile(userId, { displayName: name, avatar, bio });
      onSaved(m);
      setMsg({ tone: 'ok', text: '保存しました。' });
    } catch (e) {
      setMsg({ tone: 'bad', text: SOCIAL_ERROR_MESSAGES[e instanceof SocialError ? e.code : 'unknown'] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionLabel>プロフィール</SectionLabel>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="アイコン">
        {AVATARS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={avatar === a}
            onClick={() => setAvatar(a)}
            className={cx('h-11 w-11 rounded-xl border text-2xl', avatar === a ? 'border-accent bg-accent-soft' : 'border-line bg-surface')}
          >
            {a}
          </button>
        ))}
      </div>
      <Field label="表示名">
        <input className={inputClass} value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="ひとこと" hint="120文字まで（例: 京大文学部志望）">
        <input className={inputClass} value={bio} maxLength={120} onChange={(e) => setBio(e.target.value)} />
      </Field>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Button onClick={save} loading={busy} disabled={!dirty || !name.trim()}>
        保存する
      </Button>
    </Card>
  );
}

function InviteCard() {
  const [codes, setCodes] = useState<InviteCode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  useEffect(() => {
    fetchMyInviteCodes()
      .then((c) => {
        setCodes(c);
        const usable = c.find((x) => x.uses < x.maxUses && (!x.expiresAt || new Date(x.expiresAt) > new Date()));
        if (usable) setSelected(usable.code);
      })
      .catch(() => setCodes([]));
  }, []);

  useEffect(() => {
    if (!selected) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(inviteLink(selected), { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [selected]);

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      const code = await createInviteCode();
      setCodes(await fetchMyInviteCodes());
      setSelected(code);
    } catch (e) {
      setMsg({ tone: 'bad', text: SOCIAL_ERROR_MESSAGES[e instanceof SocialError ? e.code : 'unknown'] });
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!selected) return;
    const url = inviteLink(selected);
    try {
      if (navigator.share) await navigator.share({ title: 'LexiCore', text: `LexiCoreで一緒に英単語を勉強しよう！招待コード: ${selected}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setMsg({ tone: 'ok', text: 'リンクをコピーしました。' });
      }
    } catch {
      // Share sheet dismissed.
    }
  }

  async function copy() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(inviteLink(selected));
      setMsg({ tone: 'ok', text: 'リンクをコピーしました。' });
    } catch {
      setMsg({ tone: 'bad', text: 'コピーできませんでした。リンクを長押ししてコピーしてください。' });
    }
  }

  return (
    <Card>
      <SectionLabel>友だちを招待</SectionLabel>
      <p className="text-sm text-muted">招待リンクかQRコードを友だちに送ると、その人が登録できます。1つのコードは14日間・5人まで使えます。</p>
      {selected && (
        <div className="flex flex-col items-center gap-2">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={`招待コード ${selected} のQRコード`} width={200} height={200} className="rounded-xl bg-white p-2" />
          )}
          <p className="tabular text-2xl font-bold tracking-widest">{selected}</p>
          <p className="break-all text-center text-xs text-muted">{inviteLink(selected)}</p>
          <div className="flex w-full gap-2">
            <Button variant="secondary" className="flex-1" onClick={copy}>
              リンクをコピー
            </Button>
            <Button className="flex-1" onClick={share}>
              送る
            </Button>
          </div>
        </div>
      )}
      {codes && codes.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {codes.map((c) => {
            const expired = (c.expiresAt && new Date(c.expiresAt) <= new Date()) || c.uses >= c.maxUses;
            return (
              <li key={c.code}>
                <button type="button" onClick={() => !expired && setSelected(c.code)} className={cx('flex w-full justify-between rounded-lg px-2 py-1 text-left', selected === c.code && 'bg-accent-soft', expired && 'opacity-50')}>
                  <span className="tabular font-semibold">{c.code}</span>
                  <span className="text-muted">
                    {c.uses}/{c.maxUses}人{expired ? '・使用終了' : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Button variant="ghost" onClick={create} loading={busy}>
        新しい招待コードを作る
      </Button>
    </Card>
  );
}

function StudySettings() {
  const snap = useLearning();
  const store = useLearningStore();
  const profile = snap.profile ?? { id: '', ...DEFAULT_PROFILE };
  const [newWords, setNewWords] = useState(profile.dailyNewWords);
  const [reviewLimit, setReviewLimit] = useState(profile.dailyReviewLimit);
  const [level, setLevel] = useState(profile.proficiencyLevel);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNewWords(profile.dailyNewWords);
    setReviewLimit(profile.dailyReviewLimit);
    setLevel(profile.proficiencyLevel);
  }, [profile.dailyNewWords, profile.dailyReviewLimit, profile.proficiencyLevel]);

  async function save() {
    await store.updateProfile({ dailyNewWords: newWords, dailyReviewLimit: reviewLimit, proficiencyLevel: level });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card>
      <SectionLabel>学習設定</SectionLabel>
      <Field label={`1日の新しい単語: ${newWords} 語`}>
        <input type="range" min={0} max={50} step={1} value={newWords} onChange={(e) => setNewWords(Number(e.target.value))} className="accent-[var(--accent)]" />
      </Field>
      <Field label={`1日の復習の上限: ${reviewLimit} 語`}>
        <input type="range" min={10} max={500} step={10} value={reviewLimit} onChange={(e) => setReviewLimit(Number(e.target.value))} className="accent-[var(--accent)]" />
      </Field>
      <Field label="英語のレベル" hint="新しく学ぶ単語は、このレベルの単語から順に出ます（AI講師の例文の難しさにも使います）。">
        <select className={inputClass} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
          {Object.entries(LEVEL_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              Lv.{v}: {label}
            </option>
          ))}
        </select>
      </Field>
      <Button variant="secondary" onClick={save}>
        {saved ? '保存しました ✓' : '設定を保存'}
      </Button>
    </Card>
  );
}

function SyncCard() {
  const snap = useLearning();
  const store = useLearningStore();
  if (snap.failedCount === 0 && snap.sync !== 'error') return null;
  return (
    <Card>
      <SectionLabel>同期</SectionLabel>
      <Notice tone="warn">サーバーに保存できなかった記録が {snap.failedCount} 件あります。</Notice>
      <Button variant="ghost" onClick={() => void store.retryFailed()}>
        もう一度送る
      </Button>
    </Card>
  );
}
