import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { remainingNewWordsToday } from '../../domain/session';
import { unseenWords } from '../../domain/srs/queue';
import { DEFAULT_PROFILE } from '../../domain/types';
import { useLearning } from '../../state/LearningProvider';
import { Button, Card, Loading, Screen, SectionLabel, T } from '../../ui/components';
import { space, usePalette } from '../../ui/theme';

export default function Learn() {
  const c = usePalette();
  const snap = useLearning();
  const upcoming = useMemo(() => unseenWords(snap.words, snap.progress), [snap.words, snap.progress]);
  if (!snap.ready) return <Loading />;
  const profile = snap.profile ?? { id: '', ...DEFAULT_PROFILE };
  const left = remainingNewWordsToday({ words: snap.words, progressByWord: snap.progress, profile, now: new Date() });
  const preview = upcoming.slice(0, Math.max(left, 0));

  return (
    <Screen>
      <T variant="title">新しい単語を学ぶ</T>
      <Card>
        <SectionLabel>今日の新出語</SectionLabel>
        <T>
          あと <T variant="heading">{left}</T> 語 ／ 1日 {profile.dailyNewWords} 語
        </T>
        <T variant="small" color={c.muted}>
          1語ずつカードで確認 → 意味を選ぶテスト → 最後に英単語を思い出すテスト、の順に進みます。
        </T>
        <Button
          label={left > 0 ? `${Math.min(left, upcoming.length)} 語を学ぶ` : '今日の目標を達成しました'}
          disabled={left === 0 || upcoming.length === 0}
          onPress={() => router.push('/session?mode=learn')}
        />
      </Card>
      {preview.length > 0 && (
        <Card>
          <SectionLabel>次に学ぶ単語</SectionLabel>
          <View style={{ gap: space.xs }}>
            {preview.map((w) => (
              <T key={w.id}>
                {w.word}
                <T variant="small" color={c.muted}>
                  {'  '}
                  {w.partOfSpeech}
                </T>
              </T>
            ))}
          </View>
        </Card>
      )}
      {upcoming.length === 0 && (
        <Card>
          <T variant="heading">すべての単語を学習しました</T>
          <T color={c.muted}>あとは復習で定着させましょう。</T>
        </Card>
      )}
    </Screen>
  );
}
