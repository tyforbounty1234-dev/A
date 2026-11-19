import { useLocalSearchParams } from 'expo-router';
import type { Competency } from '../../domain/types';
import { useLearning } from '../../state/LearningProvider';
import { Card, Loading, Row, Screen, SectionLabel, Stat, T, formatPct } from '../../ui/components';
import { WordDetails } from '../../ui/WordDetails';
import { formatWhen } from '../../ui/format';
import { usePalette } from '../../ui/theme';

const LABELS: Partial<Record<Competency, string>> = { recognition: '認識', recall: '想起', spelling: 'つづり' };

export default function WordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = usePalette();
  const snap = useLearning();
  if (!snap.ready) return <Loading />;
  const word = id ? snap.wordsById.get(id) : undefined;
  if (!word) {
    return (
      <Screen>
        <T>この単語は見つかりませんでした。</T>
      </Screen>
    );
  }
  const p = snap.progress.get(word.id);
  const seen = !!p && p.reviewCount > 0;

  return (
    <Screen>
      <Card>
        <WordDetails word={word} />
      </Card>
      <Card>
        <SectionLabel>あなたの記録</SectionLabel>
        {!seen ? (
          <T color={c.muted}>まだ学習していません。</T>
        ) : (
          <>
            <Row>
              <Stat value={p.reviewCount} label="解答回数" />
              <Stat value={formatPct(p.correctCount / p.reviewCount)} label="正答率" />
              <Stat value={p.lapses} label="忘れた回数" />
            </Row>
            <T variant="small" color={c.muted}>
              {p.nextReviewAt ? `次の復習: ${formatWhen(p.nextReviewAt)}` : ''}
              {`　復習間隔 ${p.intervalDays >= 1 ? `${Math.round(p.intervalDays)}日` : '1日未満'}　覚えやすさ ${p.easeFactor.toFixed(2)}`}
            </T>
            {(Object.keys(LABELS) as Competency[]).map((k) => {
              const s = p.competencyScores[k];
              return (
                <Row key={k} style={{ justifyContent: 'space-between' }}>
                  <T>{LABELS[k]}</T>
                  <T color={s ? c.ink : c.muted}>{s ? `${s.correct}/${s.attempts} 正解・熟達度 ${Math.round(s.proficiency * 100)}` : '未テスト'}</T>
                </Row>
              );
            })}
          </>
        )}
      </Card>
    </Screen>
  );
}
