import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { dashboardSummary, nextReviewTime } from '../../domain/analytics';
import { remainingNewWordsToday } from '../../domain/session';
import { DEFAULT_PROFILE } from '../../domain/types';
import { useLearning } from '../../state/LearningProvider';
import { Button, Card, Loading, ProgressBar, Row, Screen, SectionLabel, Stat, T, formatPct } from '../../ui/components';
import { SyncBadge } from '../../ui/SyncBadge';
import { formatWhen } from '../../ui/format';
import { space, usePalette } from '../../ui/theme';

export default function Home() {
  const c = usePalette();
  const snap = useLearning();
  const now = new Date();
  const progress = useMemo(() => [...snap.progress.values()], [snap.progress]);
  const summary = useMemo(
    () => dashboardSummary(progress, snap.reviews, snap.words.length, new Date()),
    [progress, snap.reviews, snap.words.length],
  );
  if (!snap.ready) return <Loading />;

  const profile = snap.profile ?? { id: '', ...DEFAULT_PROFILE };
  const newLeft = remainingNewWordsToday({ words: snap.words, progressByWord: snap.progress, profile, now });
  const nextAt = nextReviewTime(progress);
  const { counts } = summary;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ gap: space.xs }}>
          <T variant="title">今日の学習</T>
          <SyncBadge />
        </View>
        <Link href="/settings" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="学習設定" hitSlop={12}>
            <Ionicons name="settings-outline" size={24} color={c.muted} />
          </Pressable>
        </Link>
      </Row>

      {/* Active review queue first: reviewing due words matters most for retention. */}
      <Card style={{ borderColor: summary.dueNow > 0 ? c.accent : c.line, borderWidth: summary.dueNow > 0 ? 1.5 : undefined }}>
        <SectionLabel>復習キュー</SectionLabel>
        {summary.dueNow > 0 ? (
          <>
            <Row gap={space.sm} style={{ alignItems: 'baseline' }}>
              <T variant="display" color={c.accent}>
                {summary.dueNow}
              </T>
              <T color={c.muted}>語が復習のタイミングです</T>
            </Row>
            <T variant="small" color={c.muted}>
              忘れかけている単語から順に出します。
            </T>
            <Button label="復習を始める" onPress={() => router.push('/session?mode=review')} />
          </>
        ) : (
          <>
            <T variant="heading">いま復習する単語はありません</T>
            <T variant="small" color={c.muted}>
              {nextAt ? `次の復習: ${formatWhen(nextAt, now)}` : '新しい単語を学ぶと、ここに復習が表示されます。'}
            </T>
          </>
        )}
      </Card>

      <Card>
        <SectionLabel>新しい単語</SectionLabel>
        <T>
          今日はあと <T variant="heading">{newLeft}</T> 語（1日の目標 {profile.dailyNewWords} 語）
        </T>
        <Button
          variant={summary.dueNow > 0 ? 'secondary' : 'primary'}
          label={newLeft > 0 ? '新しい単語を学ぶ' : '今日の目標を達成しました'}
          disabled={newLeft === 0 || counts.unseen === 0}
          onPress={() => router.push('/session?mode=learn')}
        />
      </Card>

      <Card>
        <Row>
          <Stat value={summary.streak} label="連続学習日数" />
          <Stat value={summary.reviewedToday} label="今日の解答数" />
          <Stat value={formatPct(summary.accuracyToday)} label="今日の正答率" />
        </Row>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <SectionLabel>語彙の定着</SectionLabel>
          <T variant="small" color={c.muted}>
            {counts.mastered} / {snap.words.length} 語が定着
          </T>
        </Row>
        <ProgressBar value={snap.words.length ? counts.mastered / snap.words.length : 0} color={c.ok} />
        <ProgressBar value={snap.words.length ? counts.studied / snap.words.length : 0} />
        <T variant="small" color={c.muted}>
          緑: 定着（復習間隔21日以上）　青: 学習済み {counts.studied} 語
        </T>
      </Card>
    </Screen>
  );
}
