import { router, useLocalSearchParams } from 'expo-router';
import type { Competency } from '../../domain/types';
import { WEAK_REASON_LABELS, detectWeakness } from '../../domain/weakness';
import { useLearning } from '../../state/LearningProvider';
import { Button, Card, Loading, Row, Screen, SectionLabel, Stat, T, formatPct } from '../../ui/components';
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
  const weakness = p ? detectWeakness(p, snap.adaptive.thresholds) : { reasons: [] };

  return (
    <Screen>
      <Card>
        <WordDetails word={word} />
        <Button variant="secondary" label="AI講師に聞く" onPress={() => router.push({ pathname: '/tutor', params: { wordId: word.id } })} />
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
            {weakness.reasons.length > 0 && (
              <T variant="small" color={c.bad}>
                {weakness.reasons.map((r) => WEAK_REASON_LABELS[r]).join('・')}
              </T>
            )}
            {(Object.keys(LABELS) as Competency[]).map((k) => {
              const s = p.competencyScores[k];
              return (
                <Row key={k} style={{ justifyContent: 'space-between' }}>
                  <T>{LABELS[k]}</T>
                  <T variant="small" color={s ? c.ink : c.muted} style={{ textAlign: 'right' }}>
                    {s ? `${s.correct}/${s.attempts} 正解・熟達度 ${Math.round(s.proficiency * 100)}` : '未テスト'}
                    {s?.srs?.nextReviewAt ? `\n次: ${formatWhen(s.srs.nextReviewAt)}（間隔 ${s.srs.intervalDays >= 1 ? `${Math.round(s.srs.intervalDays)}日` : '1日未満'}）` : ''}
                  </T>
                </Row>
              );
            })}
          </>
        )}
      </Card>
    </Screen>
  );
}
