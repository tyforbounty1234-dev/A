import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { reviewForecast } from '../../domain/analytics';
import { countDue } from '../../domain/srs/queue';
import { useLearning } from '../../state/LearningProvider';
import { Button, Card, Loading, Row, Screen, SectionLabel, T } from '../../ui/components';
import { space, usePalette } from '../../ui/theme';

const DAY_LABELS = ['今日', '明日', '2日後', '3日後', '4日後', '5日後', '6日後'];

export default function Review() {
  const c = usePalette();
  const snap = useLearning();
  const progress = useMemo(() => [...snap.progress.values()], [snap.progress]);
  const forecast = useMemo(() => reviewForecast(progress, new Date(), 7), [progress]);
  if (!snap.ready) return <Loading />;
  const due = countDue(progress, new Date());
  const max = Math.max(1, ...forecast);
  const limit = snap.profile?.dailyReviewLimit ?? 100;

  return (
    <Screen>
      <T variant="title">復習</T>
      <Card>
        <SectionLabel>いま復習する単語</SectionLabel>
        <T variant="display" color={due > 0 ? c.accent : c.ink}>
          {due}
        </T>
        <T variant="small" color={c.muted}>
          予定日を過ぎた単語ほど先に出ます。1回の上限は {limit} 語です。
        </T>
        <Button label={due > 0 ? '復習を始める' : '復習はすべて完了'} disabled={due === 0} onPress={() => router.push('/session?mode=review')} />
      </Card>
      <Card>
        <SectionLabel>今後7日間の復習予定</SectionLabel>
        <View style={{ gap: space.sm }} accessibilityLabel={`今後7日間の復習予定: ${forecast.join('、')}語`}>
          {forecast.map((n, i) => (
            <Row key={i} gap={space.sm} style={{ flexWrap: 'nowrap' }}>
              <T variant="small" color={c.muted} style={{ width: 48 }}>
                {DAY_LABELS[i]}
              </T>
              <View style={{ flex: 1, height: 14, justifyContent: 'center' }}>
                <View style={{ width: `${(n / max) * 100}%`, minWidth: n > 0 ? 4 : 0, height: 10, borderRadius: 3, backgroundColor: i === 0 ? c.accent : c.accentSoft }} />
              </View>
              <T variant="small" style={{ width: 36, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                {n}
              </T>
            </Row>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
