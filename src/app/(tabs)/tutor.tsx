import { View } from 'react-native';
import { Card, Screen, SectionLabel, T } from '../../ui/components';
import { space, usePalette } from '../../ui/theme';

/**
 * Placeholder for the AI Tutor (Phase 3). The tutor will call a server-side
 * Supabase Edge Function that holds the OpenAI key; no AI key ever ships in the app.
 */
export default function Tutor() {
  const c = usePalette();
  const planned = [
    '単語の意味やニュアンスの解説',
    '似た意味の単語の使い分け',
    'レベルに合った例文の作成',
    'よく間違える単語の分析と、おすすめの学習',
  ];
  return (
    <Screen>
      <T variant="title">AI講師</T>
      <Card>
        <SectionLabel>準備中</SectionLabel>
        <T>AI講師は今後のアップデートで追加します。いまは復習を続けることが一番の近道です。</T>
        <View style={{ gap: space.xs }}>
          {planned.map((p) => (
            <T key={p} color={c.muted}>
              ・{p}
            </T>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
