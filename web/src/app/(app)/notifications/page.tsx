'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, Loading, Notice, PageTitle, cx } from '@/components/ui';
import { formatWhen } from '@/lib/format';
import { useMe } from '@/lib/me';
import { SOCIAL_ERROR_MESSAGES, SocialError, fetchNotifications, markAllRead, type AppNotification } from '@/lib/social';

function describe(n: AppNotification): { icon: string; text: string; href?: string } {
  const p = n.payload as Record<string, string | number | undefined>;
  switch (n.kind) {
    case 'reaction':
      return { icon: String(p.emoji ?? '👏'), text: `${p.from_avatar ?? ''} ${p.from_name ?? 'だれか'}さんから ${p.emoji ?? ''} が届きました`, href: p.from_user ? `/members/${p.from_user}` : undefined };
    case 'lp_earned':
      return { icon: '★', text: `「${p.word ?? '単語'}」が定着しました！ +${p.lp ?? 1} LP`, href: p.word_id ? `/words/${p.word_id}` : undefined };
    case 'member_joined':
      return { icon: '🙌', text: `${p.display_name ?? '友だち'}さんがあなたの招待で参加しました`, href: p.member_id ? `/members/${p.member_id}` : undefined };
    case 'welcome':
      return { icon: '🌱', text: 'LexiCoreへようこそ！まずは新しい単語を学んでみましょう。', href: '/session?mode=learn' };
  }
}

export default function Notifications() {
  const { refresh } = useMe();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchNotifications()
      .then(async (list) => {
        if (!active) return;
        setItems(list);
        if (list.some((n) => !n.readAt)) {
          await markAllRead();
          await refresh();
        }
      })
      .catch((e) => active && setError(SOCIAL_ERROR_MESSAGES[e instanceof SocialError ? e.code : 'unknown']));
    return () => {
      active = false;
    };
  }, [refresh]);

  return (
    <>
      <PageTitle>通知</PageTitle>
      {error && <Notice>{error}</Notice>}
      {!items && !error && <Loading />}
      {items && items.length === 0 && <p className="text-muted">通知はまだありません。</p>}
      {items && items.length > 0 && (
        <Card className="gap-0 p-0">
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const d = describe(n);
              const body = (
                <div className={cx('flex items-center gap-3 px-4 py-3', !n.readAt && 'bg-accent-soft')}>
                  <span className="w-8 text-center text-2xl text-gold" aria-hidden>
                    {d.icon}
                  </span>
                  <span className="flex-1">
                    <span className="block">{d.text}</span>
                    <span className="text-xs text-muted">{formatWhen(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="h-2 w-2 rounded-full bg-accent" aria-label="未読" />}
                </div>
              );
              return <li key={n.id}>{d.href ? <Link href={d.href} className="block hover:opacity-80">{body}</Link> : body}</li>;
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
