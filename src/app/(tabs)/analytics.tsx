import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import {
  accuracyByCompetency,
  dailyHistory,
  responseTimeStats,
  retentionRate,
  reviewCompletionRate,
  statusCounts,
  weakWords,
  weeklyHistory,
} from '../../domain/analytics';
import type { Competency, QuestionType } from '../../domain/types';
import { useLearning } from '../../state/LearningProvider';
import { Card, Loading, Row, Screen, SectionLabel, Stat, T, formatPct, formatSeconds } from '../../ui/components';
import { space, usePalette } from '../../ui/theme';

const COMPETENCY_LABELS: Partial<Record<Competency, string>> = {
  recognition: '認識（英→日）',
  recall: '想起（日→英）',
  spelling: 'つづり',
};
const QT_LABELS: Partial<Record<QuestionType, string>> = {
  en_to_ja_mc: '英→日 選択',
  ja_to_en_mc: '日→英 選択',
  spelling: 'つづり入力',
};

export default function Analytics() {
  const c = usePalette();
  const snap = useLearning();
  const data = useMemo(() => {
    const now = new Date();
    const progress = [...snap.progress.values()];
    return {
      counts: statusCounts(progress, snap.words.length),
      competency: accuracyByCompetency(snap.reviews),
      rtByType: (['en_to_ja_mc', 'ja_to_en_mc', 'spelling'] as QuestionType[]).map((t) => [t, responseTimeStats(snap.reviews, t)] as const),
      daily: dailyHistory(snap.reviews, now, 14),
      weekly: weeklyHistory(snap.reviews, now, 8),
      retention: retentionRate(snap.reviews),
      completion: reviewCompletionRate(snap.sessions),
      weak: weakWords(progress, 10),
    };
  }, [snap.progress, snap.reviews, snap.sessions, snap.words.length]);
  if (!snap.ready) return <Loading />;
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.reviews));

  return (
    <Screen>
      <T variant="title">学習分析</T>

      <Card>
        <SectionLabel>語彙</SectionLabel>
        <Row>
          <Stat value={data.counts.studied} label="学習済み" />
          <Stat value={data.counts.mastered} label="定着" tone="ok" />
          <Stat value={data.counts.learning} label="学習中" tone="accent" />
          <Stat value={data.counts.difficult} label="苦手" tone="bad" />
        </Row>
      </Card>

      <Card>
        <SectionLabel>記憶の保持</SectionLabel>
        <Row>
          <Stat value={formatPct(data.retention.accuracy)} label={`保持率（予定どおりの復習 ${data.retention.attempts}回）`} />
          <Stat value={formatPct(data.completion)} label="復習の完了率" />
        </Row>
        <T variant="small" color={c.muted}>
          保持率は、復習日が来た単語を正しく思い出せた割合です。長期記憶の一番の目安になります。
        </T>
        <WeeklyRetention weeks={data.weekly} />
      </Card>

      <Card>
        <SectionLabel>能力別の正答率</SectionLabel>
        {(Object.keys(COMPETENCY_LABELS) as Competency[]).map((k) => (
          <Row key={k} style={{ justifyContent: 'space-between' }}>
            <T>{COMPETENCY_LABELS[k]}</T>
            <T variant="heading">
              {formatPct(data.competency[k].accuracy)}
              <T variant="small" color={c.muted}>
                {'  '}
                {data.competency[k].attempts}問
              </T>
            </T>
          </Row>
        ))}
        <T variant="small" color={c.muted}>
          文脈理解・作文（産出）は今後のアップデートで追加します。
        </T>
      </Card>

      <Card>
        <SectionLabel>解答時間（中央値 / 遅いほうの10%）</SectionLabel>
        {data.rtByType.map(([t, s]) => (
          <Row key={t} style={{ justifyContent: 'space-between' }}>
            <T>{QT_LABELS[t]}</T>
            <T style={{ fontVariant: ['tabular-nums'] }}>
              {formatSeconds(s.medianMs)} / {formatSeconds(s.p90Ms)}
            </T>
          </Row>
        ))}
      </Card>

      <Card>
        <SectionLabel>直近14日の解答数</SectionLabel>
        <View
          style={{ flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 3 }}
          accessibilityLabel={`直近14日の解答数: ${data.daily.map((d) => d.reviews).join('、')}`}
        >
          {data.daily.map((d) => (
            <View key={d.day} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
              <View style={{ height: `${(d.reviews / maxDaily) * 100}%`, minHeight: d.reviews > 0 ? 3 : 0, backgroundColor: c.accent, borderRadius: 2 }} />
            </View>
          ))}
        </View>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="small" color={c.muted}>
            {data.daily[0]?.day.slice(5).replace('-', '/')}
          </T>
          <T variant="small" color={c.muted}>
            今日
          </T>
        </Row>
      </Card>

      <Card>
        <SectionLabel>苦手な単語</SectionLabel>
        {data.weak.length === 0 ? (
          <T color={c.muted}>まだありません。間違いが重なった単語がここに表示されます。</T>
        ) : (
          data.weak.map((w) => {
            const word = snap.wordsById.get(w.wordId);
            if (!word) return null;
            return (
              <Pressable key={w.wordId} accessibilityRole="link" onPress={() => router.push(`/word/${w.wordId}`)}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="heading">{word.word}</T>
                  <T variant="small" color={c.muted}>
                    忘れた回数 {w.lapses}・直近正答率 {formatPct(w.recentAccuracy)}
                  </T>
                </Row>
              </Pressable>
            );
          })
        )}
      </Card>
    </Screen>
  );
}

function WeeklyRetention({ weeks }: { weeks: ReturnType<typeof weeklyHistory> }) {
  const c = usePalette();
  return (
    <View style={{ gap: space.xs }}>
      <T variant="small" color={c.muted}>
        週ごとの保持率
      </T>
      <View style={{ flexDirection: 'row', gap: 4, alignItems: 'flex-end', height: 60 }}>
        {weeks.map((w) => (
          <View key={w.weekStart} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }} accessibilityLabel={`${w.weekStart}の週 ${formatPct(w.retention)}`}>
            <View
              style={{
                height: w.retention === null ? 2 : `${Math.max(w.retention * 100, 3)}%`,
                backgroundColor: w.retention === null ? c.line : c.ok,
                borderRadius: 2,
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}
