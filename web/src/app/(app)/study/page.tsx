'use client';
import { useMemo } from 'react';
import { ButtonLink, Card, Loading, PageTitle, SectionLabel } from '@/components/ui';
import { dashboardSummary } from '@/lexicore/domain/analytics';
import { rankWeakWords, remainingNewWordsToday } from '@/lexicore/domain/session';
import { DEFAULT_PROFILE } from '@/lexicore/domain/types';
import { useLearning } from '@/lib/learning';

export default function Study() {
  const snap = useLearning();
  const progress = useMemo(() => [...snap.progress.values()], [snap.progress]);
  const summary = useMemo(() => dashboardSummary(progress, snap.reviews, snap.words.length, new Date()), [progress, snap.reviews, snap.words.length]);
  const weak = useMemo(() => rankWeakWords(progress, snap.adaptive.thresholds).length, [progress, snap.adaptive.thresholds]);
  if (!snap.ready) return <Loading />;
  const profile = snap.profile ?? { id: '', ...DEFAULT_PROFILE };
  const newLeft = remainingNewWordsToday({ words: snap.words, progressByWord: snap.progress, profile, now: new Date() });

  return (
    <>
      <PageTitle>学習</PageTitle>
      <Card>
        <SectionLabel>おすすめ: 今日の学習</SectionLabel>
        <p className="text-sm text-muted">
          復習 {summary.dueNow} 語のあとに、新しい単語 {newLeft} 語を学びます。
        </p>
        <ButtonLink href="/session?mode=mixed" aria-disabled={summary.dueNow + newLeft === 0}>
          今日の学習を始める
        </ButtonLink>
      </Card>
      <Card>
        <SectionLabel>復習</SectionLabel>
        <p className="text-sm text-muted">復習のタイミングが来た単語: {summary.dueNow} 語</p>
        <ButtonLink href="/session?mode=review" variant="secondary">
          復習だけする
        </ButtonLink>
      </Card>
      <Card>
        <SectionLabel>新しい単語</SectionLabel>
        <p className="text-sm text-muted">カードを全部見てから、まとめてテストします（今日はあと {newLeft} 語）。</p>
        <ButtonLink href="/session?mode=learn" variant="secondary">
          新しい単語を学ぶ
        </ButtonLink>
      </Card>
      <Card>
        <SectionLabel>苦手を集中練習</SectionLabel>
        <p className="text-sm text-muted">苦手な単語: {weak} 語。いちばん弱い力（認識・想起・つづり）で練習します。</p>
        <ButtonLink href="/session?mode=weak" variant="secondary">
          苦手を練習する
        </ButtonLink>
      </Card>
    </>
  );
}
