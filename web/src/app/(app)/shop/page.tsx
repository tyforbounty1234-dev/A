'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Loading, Notice, PageTitle, Pill, cx } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMe } from '@/lib/me';
import { SOCIAL_ERROR_MESSAGES, SocialError, fetchOwned, fetchShop, purchase, type ShopItem } from '@/lib/social';

export default function Shop() {
  const { userId } = useAuth();
  const { member, refresh } = useMe();
  const [items, setItems] = useState<ShopItem[] | null>(null);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [buying, setBuying] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [justBought, setJustBought] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    fetchShop()
      .then(async (shop) => {
        setItems(shop);
        setOwned(await fetchOwned(userId, shop));
      })
      .catch((e) => setMessage({ tone: 'bad', text: SOCIAL_ERROR_MESSAGES[e instanceof SocialError ? e.code : 'unknown'] }));
  }, [userId]);

  async function buy(item: ShopItem) {
    setBuying(item.id);
    setMessage(null);
    try {
      await purchase(item.id);
      setOwned((prev) => new Set([...prev, item.id]));
      setJustBought(item.id);
      setMessage({ tone: 'ok', text: `${item.emoji} ${item.name} を手に入れました！友だちのプロフィールから送れます。` });
      await refresh();
    } catch (e) {
      setMessage({ tone: 'bad', text: SOCIAL_ERROR_MESSAGES[e instanceof SocialError ? e.code : 'unknown'] });
    } finally {
      setBuying(null);
    }
  }

  const balance = member?.lpBalance ?? 0;
  return (
    <>
      <PageTitle right={<span className="tabular rounded-full bg-warn-soft px-3 py-1 font-bold text-gold">★ {member?.lpBalance ?? '–'} LP</span>}>ショップ</PageTitle>
      <p className="text-sm text-muted">エモートを手に入れて、がんばっている友だちに送ろう。単語をはじめて定着させるたびに ★1 LP もらえます。</p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {!items ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item) => {
            const has = owned.has(item.id);
            const affordable = balance >= item.price;
            return (
              <Card key={item.id} className="items-center text-center">
                <span className={cx('text-5xl', justBought === item.id && 'animate-pop')} aria-hidden>
                  {item.emoji}
                </span>
                <span className="font-semibold">{item.name}</span>
                {has ? (
                  <Pill tone="ok">{item.price === 0 ? '無料・使える' : '持っている'}</Pill>
                ) : (
                  <Button
                    className="w-full"
                    variant={affordable ? 'primary' : 'ghost'}
                    disabled={!affordable}
                    loading={buying === item.id}
                    onClick={() => buy(item)}
                    aria-label={`${item.name}を${item.price} LPで買う`}
                  >
                    ★ {item.price}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
