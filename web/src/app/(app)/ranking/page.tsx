'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, Chip, LocalOnlyNotice, Loading, Notice, PageTitle, cx } from '@/components/ui';
import { useMe } from '@/lib/me';
import { IS_LOCAL } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { SOCIAL_ERROR_MESSAGES, SocialError, fetchLeaderboard, type LeaderboardRow } from '@/lib/social';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Page() {
  return IS_LOCAL ? <LocalRanking /> : <Ranking />;
}

function LocalRanking() {
  const { member } = useMe();
  return (
    <>
      <PageTitle>ランキング</PageTitle>
      <Card className="items-center text-center">
        <span className="text-5xl">{member?.avatar}</span>
        <p className="text-lg font-bold">{member?.displayName}</p>
        <p className="tabular text-3xl font-bold text-gold">★ {member?.lpEarned ?? 0} LP</p>
        <p className="text-sm text-muted">定着した単語 {member?.masteredCount ?? 0} 語</p>
      </Card>
      <LocalOnlyNotice feature="ランキング" />
    </>
  );
}

function Ranking() {
  const { userId } = useAuth();
  const [period, setPeriod] = useState<'all' | 'week'>('all');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    fetchLeaderboard(period)
      .then((r) => active && setRows(r))
      .catch((e) => active && setError(SOCIAL_ERROR_MESSAGES[e instanceof SocialError ? e.code : 'unknown']));
    return () => {
      active = false;
    };
  }, [period]);

  return (
    <>
      <PageTitle>ランキング</PageTitle>
      <div className="flex gap-2">
        <Chip active={period === 'all'} onClick={() => setPeriod('all')}>
          累計
        </Chip>
        <Chip active={period === 'week'} onClick={() => setPeriod('week')}>
          この7日間
        </Chip>
      </div>
      <p className="text-xs text-muted">単語をはじめて「定着」させると 1 LP。ショップでLPを使っても順位は下がりません。</p>
      {error && <Notice>{error}</Notice>}
      {!rows && !error && <Loading />}
      {rows && (
        <Card className="gap-0 p-0">
          <ol className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.memberId}>
                <Link
                  href={`/members/${r.memberId}`}
                  className={cx('flex items-center gap-3 px-4 py-3 hover:bg-surface-alt', r.memberId === userId && 'bg-accent-soft')}
                  aria-label={`${r.rank}位 ${r.displayName} ${r.lp} LP`}
                >
                  <span className="tabular w-8 text-center text-lg font-bold">{r.rank <= 3 && r.lp > 0 ? MEDALS[r.rank - 1] : r.rank}</span>
                  <span className="text-2xl" aria-hidden>
                    {r.avatar}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {r.displayName}
                      {r.memberId === userId && <span className="ml-1 text-xs text-accent">（あなた）</span>}
                    </span>
                    <span className="text-xs text-muted">定着 {r.mastered} 語</span>
                  </span>
                  <span className="tabular font-bold text-gold">★ {r.lp}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}
