'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useLearning } from '@/lib/learning';
import { useMe } from '@/lib/me';
import { Icon } from './icons';
import { Loading, cx } from './ui';

const TABS = [
  { href: '/', label: 'ホーム', icon: 'home' },
  { href: '/study', label: '学習', icon: 'study' },
  { href: '/words', label: '単語帳', icon: 'book' },
  { href: '/ranking', label: 'ランキング', icon: 'trophy' },
  { href: '/me', label: 'マイページ', icon: 'user' },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Signed-in frame: sticky header (LP, notifications) and bottom tab bar. Redirects visitors to sign-in. */
export function AppShell({ children }: { children: ReactNode }) {
  const { loading, userId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const snap = useLearning();
  const { member, unread } = useMe();

  useEffect(() => {
    if (!loading && !userId) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, userId, router, pathname]);

  if (loading || !userId) return <Loading />;
  const hideNav = pathname.startsWith('/session');

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between gap-2 px-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            LexiCore
          </Link>
          <div className="flex items-center gap-1">
            {snap.sync === 'offline' && <span className="mr-1 text-xs text-warn">オフライン</span>}
            {snap.pendingCount > 0 && snap.sync !== 'offline' && <span className="mr-1 text-xs text-muted">同期中…</span>}
            <Link
              href="/shop"
              className="tabular flex items-center gap-1 rounded-full bg-warn-soft px-3 py-1 text-sm font-bold text-gold"
              aria-label={`LP ${member?.lpBalance ?? 0}。ショップへ`}
            >
              ★ {member?.lpBalance ?? '–'} LP
            </Link>
            <Link href="/notifications" className="relative rounded-full p-2 text-ink hover:bg-surface-alt" aria-label={`通知${unread ? `（未読${unread}件）` : ''}`}>
              <Icon name="bell" />
              {unread > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-bad px-1 text-[11px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>
      <main className={cx('mx-auto flex max-w-xl flex-col gap-4 px-4 pt-4', hideNav ? 'pb-8' : 'pb-28')}>{children}</main>
      {!hideNav && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur" aria-label="メインメニュー">
          <ul className="mx-auto flex max-w-xl">
            {TABS.map((t) => {
              const active = isActive(pathname, t.href);
              return (
                <li key={t.href} className="flex-1">
                  <Link
                    href={t.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx('flex flex-col items-center gap-0.5 py-2 text-[11px]', active ? 'font-semibold text-accent' : 'text-muted')}
                  >
                    <Icon name={t.icon} />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
