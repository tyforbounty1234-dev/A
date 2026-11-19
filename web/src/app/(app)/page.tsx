'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { ButtonLink, Card, Loading, ProgressBar, SectionLabel, Stat } from '@/components/ui';
import { Icon } from '@/components/icons';
import { dashboardSummary, nextReviewTime } from '@/lexicore/domain/analytics';
import { rankWeakWords, remainingNewWordsToday } from '@/lexicore/domain/session';
import { DEFAULT_PROFILE } from '@/lexicore/domain/types';
import { formatPct, formatWhen } from '@/lib/format';
import { useLearning } from '@/lib/learning';
import { useMe } from '@/lib/me';

export default function Home() {
  const snap = useLearning();
  const { member } = useMe();
  const progress = useMemo(() => [...snap.progress.values()], [snap.progress]);
  const summary = useMemo(() => dashboardSummary(progress, snap.reviews, snap.words.length, new Date()), [progress, snap.reviews, snap.words.length]);
  const weakCount = useMemo(() => rankWeakWords(progress, snap.adaptive.thresholds).length, [progress, snap.adaptive.thresholds]);
  if (!snap.ready) return <Loading />;

  const now = new Date();
  const profile = snap.profile ?? { id: '', ...DEFAULT_PROFILE };
  const newLeft = remainingNewWordsToday({ words: snap.words, progressByWord: snap.progress, profile, now });
  const nextAt = nextReviewTime(progress);
  const { counts } = summary;

  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-muted">{member ? `${member.avatar} ${member.displayName}さん` : ''}</p>
          <h1 className="text-2xl font-bold">今日の学習</h1>
        </div>
        {snap.sync === 'error' && <span className="text-xs text-bad">同期エラー</span>}
      </div>

      {/* The active review queue comes first: reviewing due words matters most for retention. */}
      <Card className={summary.dueNow > 0 ? 'border-2 border-accent' : undefined}>
        <SectionLabel>復習キュー</SectionLabel>
        {summary.dueNow > 0 ? (
          <>
            <p className="flex items-baseline gap-2">
              <span className="tabular text-5xl font-bold text-accent">{summary.dueNow}</span>
              <span className="text-muted">語が復習のタイミングです</span>
            </p>
            <p className="text-sm text-muted">忘れかけている単語から順に出します。</p>
            <ButtonLink href="/session?mode=review">復習を始める</ButtonLink>
          </>
        ) : (
          <>
            <p className="text-lg font-bold">いま復習する単語はありません</p>
            <p className="text-sm text-muted">{nextAt ? `次の復習: ${formatWhen(nextAt, now)}` : '新しい単語を学ぶと、ここに復習が表示されます。'}</p>
          </>
        )}
      </Card>

      <Card>
        <SectionLabel>新しい単語</SectionLabel>
        <p>
          今日はあと <span className="text-lg font-bold">{newLeft}</span> 語（1日の目標 {profile.dailyNewWords} 語）
        </p>
        {newLeft > 0 && counts.unseen > 0 ? (
          <ButtonLink href="/session?mode=learn" variant={summary.dueNow > 0 ? 'secondary' : 'primary'}>
            新しい単語を学ぶ
          </ButtonLink>
        ) : (
          <p className="text-sm font-semibold text-ok">今日の目標を達成しました 🎉</p>
        )}
      </Card>

      {weakCount > 0 && (
        <Card>
          <SectionLabel>苦手な単語</SectionLabel>
          <p>
            <span className="text-lg font-bold">{weakCount}</span> 語が苦手として見つかりました
          </p>
          <ButtonLink href="/session?mode=weak" variant="secondary">
            苦手を集中練習
          </ButtonLink>
        </Card>
      )}

      <Card>
        <div className="flex gap-3">
          <Stat value={summary.streak} label="連続学習日数" />
          <Stat value={summary.reviewedToday} label="今日の解答数" />
          <Stat value={formatPct(summary.accuracyToday)} label="今日の正答率" />
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <SectionLabel>語彙の定着</SectionLabel>
          <span className="text-sm text-muted">
            {counts.mastered} / {snap.words.length} 語
          </span>
        </div>
        <ProgressBar value={snap.words.length ? counts.mastered / snap.words.length : 0} tone="ok" />
        <ProgressBar value={snap.words.length ? counts.studied / snap.words.length : 0} />
        <p className="text-xs text-muted">緑: 定着（復習間隔21日以上）・青: 学習済み {counts.studied} 語。単語がはじめて定着すると ★1 LP もらえます。</p>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <QuickLink href="/tutor" icon="spark" label="AI講師" />
        <QuickLink href="/analytics" icon="chart" label="学習分析" />
        <QuickLink href="/shop" icon="shop" label="ショップ" />
      </div>
    </>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1 rounded-2xl border border-line bg-surface py-4 text-sm font-semibold text-accent hover:bg-surface-alt">
      <Icon name={icon} />
      {label}
    </Link>
  );
}
