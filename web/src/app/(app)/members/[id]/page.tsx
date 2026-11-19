'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ButtonLink, Card, LocalOnlyNotice, Loading, Notice, SectionLabel, Stat, cx } from '@/components/ui';
import { useMe } from '@/lib/me';
import { IS_LOCAL } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  SOCIAL_ERROR_MESSAGES,
  SocialError,
  fetchMember,
  fetchOwned,
  fetchReactionCounts,
  fetchShop,
  sendReaction,
  type Member,
  type ShopItem,
} from '@/lib/social';

export default function Page() {
  return IS_LOCAL ? <LocalProfile /> : <MemberPage />;
}

function LocalProfile() {
  const { member } = useMe();
  const [owned, setOwned] = useState<ShopItem[]>([]);
  useEffect(() => {
    fetchShop().then(async (shop) => {
      const mine = await fetchOwned('local', shop);
      setOwned(shop.filter((i) => mine.has(i.id) && i.price > 0));
    });
  }, [member]);
  if (!member) return <Loading />;
  return (
    <>
      <Card className="items-center text-center">
        <span className="text-6xl">{member.avatar}</span>
        <h1 className="text-2xl font-bold">{member.displayName}</h1>
        {member.bio && <p className="text-muted">{member.bio}</p>}
        <div className="flex w-full gap-3 pt-2">
          <Stat value={`★ ${member.lpEarned}`} label="獲得LP" tone="gold" />
          <Stat value={member.masteredCount} label="定着した単語" tone="ok" />
        </div>
      </Card>
      <Card>
        <SectionLabel>コレクション</SectionLabel>
        {owned.length === 0 ? <p className="text-sm text-muted">まだショップのエモートを持っていません。</p> : <div className="flex flex-wrap gap-2 text-3xl">{owned.map((i) => <span key={i.id} title={i.name}>{i.emoji}</span>)}</div>}
      </Card>
      <LocalOnlyNotice feature="エモートを送る" />
    </>
  );
}

function MemberPage() {
  const { id } = useParams<{ id: string }>();
  const { userId } = useAuth();
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [shop, setShop] = useState<ShopItem[]>([]);
  const [theirs, setTheirs] = useState<Set<string>>(new Set());
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [received, setReceived] = useState<{ itemId: string; emoji: string; received: number }[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: string; n: number } | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const isMe = id === userId;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      try {
        const [m, items, counts] = await Promise.all([fetchMember(id), fetchShop(), fetchReactionCounts(id)]);
        if (!active) return;
        setMember(m);
        setShop(items);
        setReceived(counts);
        const [t, me] = await Promise.all([fetchOwned(id, items), fetchOwned(userId, items)]);
        if (!active) return;
        setTheirs(t);
        setMine(me);
      } catch (e) {
        if (active) setMessage({ tone: 'bad', text: SOCIAL_ERROR_MESSAGES[e instanceof SocialError ? e.code : 'unknown'] });
      }
    })();
    return () => {
      active = false;
    };
  }, [id, userId]);

  async function send(item: ShopItem) {
    setSending(item.id);
    setMessage(null);
    try {
      await sendReaction(id, item.id);
      setSent((prev) => ({ id: item.id, n: (prev?.n ?? 0) + 1 }));
      setMessage({ tone: 'ok', text: `${item.emoji} を ${member?.displayName ?? ''} さんに送りました！` });
      setReceived((prev) => {
        const found = prev.find((r) => r.itemId === item.id);
        return found ? prev.map((r) => (r.itemId === item.id ? { ...r, received: r.received + 1 } : r)) : [...prev, { itemId: item.id, emoji: item.emoji, received: 1 }];
      });
    } catch (e) {
      setMessage({ tone: 'bad', text: SOCIAL_ERROR_MESSAGES[e instanceof SocialError ? e.code : 'unknown'] });
    } finally {
      setSending(null);
    }
  }

  if (member === undefined && !message) return <Loading />;
  if (!member) return <p className="text-muted">メンバーが見つかりませんでした。</p>;
  const collection = shop.filter((i) => theirs.has(i.id) && i.price > 0);
  const sendable = shop.filter((i) => mine.has(i.id));

  return (
    <>
      <Card className="items-center text-center">
        <span className="text-6xl" aria-hidden>
          {member.avatar}
        </span>
        <h1 className="text-2xl font-bold">{member.displayName}</h1>
        {member.bio && <p className="text-muted">{member.bio}</p>}
        <div className="flex w-full gap-3 pt-2">
          <Stat value={`★ ${member.lpEarned}`} label="獲得LP" tone="gold" />
          <Stat value={member.masteredCount} label="定着した単語" tone="ok" />
          <Stat value={received.reduce((n, r) => n + r.received, 0)} label="もらったエモート" />
        </div>
      </Card>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {!isMe ? (
        <Card>
          <SectionLabel>エモートを送る</SectionLabel>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {sendable.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={sending !== null}
                onClick={() => send(item)}
                className="flex flex-col items-center gap-1 rounded-xl border border-line bg-surface py-2 hover:bg-surface-alt disabled:opacity-50"
                aria-label={`${item.name}を送る`}
              >
                <span className={cx('text-3xl', sent?.id === item.id && 'animate-pop')} key={sent?.id === item.id ? `${item.id}-${sent.n}` : item.id}>
                  {item.emoji}
                </span>
                <span className="text-[11px] text-muted">{item.name}</span>
              </button>
            ))}
          </div>
          <ButtonLink href="/shop" variant="ghost">
            ショップでエモートを増やす
          </ButtonLink>
        </Card>
      ) : (
        <ButtonLink href="/me" variant="secondary">
          プロフィールを編集
        </ButtonLink>
      )}

      {received.length > 0 && (
        <Card>
          <SectionLabel>もらったエモート</SectionLabel>
          <div className="flex flex-wrap gap-3">
            {received.map((r) => (
              <span key={r.itemId} className="tabular flex items-center gap-1 rounded-full bg-surface-alt px-3 py-1">
                <span className="text-xl">{r.emoji}</span>× {r.received}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionLabel>コレクション</SectionLabel>
        {collection.length === 0 ? (
          <p className="text-sm text-muted">まだショップのエモートを持っていません。</p>
        ) : (
          <div className="flex flex-wrap gap-2 text-3xl">
            {collection.map((i) => (
              <span key={i.id} title={i.name}>
                {i.emoji}
              </span>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
