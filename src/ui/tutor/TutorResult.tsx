import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type {
  CompareContent,
  ContextContent,
  ExamplesContent,
  ExercisesContent,
  ExplainContent,
  MistakesContent,
  TutorResponse,
} from '../../domain/ai/contract';
import type { Recommendation } from '../../domain/ai/mistakes';
import type { Word } from '../../domain/types';
import { Pill, Row, SectionLabel, T } from '../components';
import { radius, space, usePalette } from '../theme';

function Bullets({ items }: { items: string[] }) {
  const c = usePalette();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: space.xs }}>
      {items.map((t, i) => (
        <Row key={i} gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <T color={c.muted}>・</T>
          <T style={{ flex: 1 }}>{t}</T>
        </Row>
      ))}
    </View>
  );
}

function EnJa({ en, ja, note }: { en: string; ja: string; note?: string }) {
  const c = usePalette();
  return (
    <View style={[styles.example, { borderColor: c.line }]}>
      <T variant="heading" style={{ fontWeight: '500' }}>
        {en}
      </T>
      <T color={c.muted}>{ja}</T>
      {note ? (
        <T variant="small" color={c.accent}>
          {note}
        </T>
      ) : null}
    </View>
  );
}

function Explain({ c: x }: { c: ExplainContent }) {
  const c = usePalette();
  return (
    <View style={{ gap: space.md }}>
      <T>{x.nuanceJa}</T>
      {x.personalAdviceJa ? (
        <View style={[styles.note, { backgroundColor: c.accentSoft }]}>
          <T variant="small" color={c.accent}>
            あなたへのアドバイス
          </T>
          <T>{x.personalAdviceJa}</T>
        </View>
      ) : null}
      <SectionLabel>使い方</SectionLabel>
      <Bullets items={x.usageJa} />
      {x.collocations.length > 0 && (
        <>
          <SectionLabel>よく使う組み合わせ</SectionLabel>
          {x.collocations.map((k, i) => (
            <Row key={i} style={{ justifyContent: 'space-between' }}>
              <T style={{ fontWeight: '600', flexShrink: 1 }}>{k.en}</T>
              <T color={c.muted} style={{ flexShrink: 1, textAlign: 'right' }}>
                {k.ja}
              </T>
            </Row>
          ))}
        </>
      )}
      {x.pitfallsJa.length > 0 && (
        <>
          <SectionLabel>間違えやすい点</SectionLabel>
          <Bullets items={x.pitfallsJa} />
        </>
      )}
      {x.memoryTipJa ? (
        <>
          <SectionLabel>覚え方</SectionLabel>
          <T>{x.memoryTipJa}</T>
        </>
      ) : null}
    </View>
  );
}

function Examples({ c: x }: { c: ExamplesContent }) {
  return (
    <View style={{ gap: space.sm }}>
      {x.examples.map((e, i) => (
        <EnJa key={i} en={e.en} ja={e.ja} note={e.noteJa} />
      ))}
    </View>
  );
}

function Compare({ c: x }: { c: CompareContent }) {
  const c = usePalette();
  return (
    <View style={{ gap: space.md }}>
      <T>{x.differenceJa}</T>
      {x.items.map((it) => (
        <View key={it.word} style={{ gap: space.xs }}>
          <Row gap={space.sm} style={{ alignItems: 'baseline' }}>
            <T variant="heading">{it.word}</T>
            <T color={c.muted}>{it.coreJa}</T>
          </Row>
          <T variant="small">{it.nuanceJa}</T>
          <EnJa en={it.example.en} ja={it.example.ja} />
        </View>
      ))}
      {x.tipJa ? (
        <View style={[styles.note, { backgroundColor: c.accentSoft }]}>
          <T variant="small" color={c.accent}>
            見分けるコツ
          </T>
          <T>{x.tipJa}</T>
        </View>
      ) : null}
    </View>
  );
}

function Context({ c: x }: { c: ContextContent }) {
  const c = usePalette();
  return (
    <View style={{ gap: space.sm }}>
      <Row gap={space.sm} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <T variant="heading">{x.meaningJa}</T>
        <Pill label={x.matchesDictionarySense ? '辞書の意味どおり' : '辞書にない使い方'} tone={x.matchesDictionarySense ? 'ok' : 'warn'} />
      </Row>
      <T>{x.explanationJa}</T>
      <T variant="small" color={c.muted}>
        言い換え: {x.paraphraseEn}
      </T>
    </View>
  );
}

function Exercises({ c: x }: { c: ExercisesContent }) {
  const c = usePalette();
  const [chosen, setChosen] = useState<(number | null)[]>(() => x.items.map(() => null));
  return (
    <View style={{ gap: space.lg }}>
      <T variant="small" color={c.muted}>
        練習用の問題です。結果は復習の予定には影響しません。
      </T>
      {x.items.map((it, i) => {
        const pick = chosen[i] ?? null;
        const answered = pick !== null;
        return (
          <View key={i} style={{ gap: space.sm }}>
            <T variant="heading" style={{ fontWeight: '500' }}>
              {i + 1}. {it.sentence}
            </T>
            {it.options.map((o, j) => {
              const isAnswer = j === it.answerIndex;
              const bg = !answered ? c.surface : isAnswer ? c.okSoft : j === pick ? c.badSoft : c.surface;
              const border = !answered ? c.line : isAnswer ? c.ok : j === pick ? c.bad : c.line;
              return (
                <Pressable
                  key={j}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: answered, selected: j === pick }}
                  onPress={answered ? undefined : () => setChosen((prev) => prev.map((p, k) => (k === i ? j : p)))}
                  style={[styles.option, { backgroundColor: bg, borderColor: border }]}
                >
                  <T>{o}</T>
                </Pressable>
              );
            })}
            {answered && (
              <View style={[styles.note, { backgroundColor: pick === it.answerIndex ? c.okSoft : c.badSoft }]}>
                <T style={{ fontWeight: '600' }} color={pick === it.answerIndex ? c.ok : c.bad}>
                  {pick === it.answerIndex ? '正解' : `不正解（正解: ${it.options[it.answerIndex]}）`}
                </T>
                <T variant="small">{it.explanationJa}</T>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Mistakes({ c: x, wordsById, onAction }: { c: MistakesContent; wordsById: ReadonlyMap<string, Word>; onAction: (r: Recommendation) => void }) {
  const c = usePalette();
  // Only act on words the app knows; the server already restricted ids to the analysis.
  const recs = x.recommendations.filter((r) => r.wordIds.every((id) => wordsById.has(id)));
  return (
    <View style={{ gap: space.md }}>
      <T>{x.summaryJa}</T>
      {x.insights.map((ins, i) => (
        <View key={i} style={{ gap: 2 }}>
          <T style={{ fontWeight: '600' }}>{ins.titleJa}</T>
          <T variant="small">{ins.detailJa}</T>
        </View>
      ))}
      {recs.length > 0 && <SectionLabel>おすすめ</SectionLabel>}
      {recs.map((r, i) => (
        <RecommendationRow key={i} rec={r} onPress={() => onAction(r)} />
      ))}
      <T variant="small" color={c.muted}>
        分析のもとになるのは、あなたの解答記録です。
      </T>
    </View>
  );
}

export function RecommendationRow({ rec, onPress }: { rec: Recommendation; onPress: () => void }) {
  const c = usePalette();
  const label = rec.action === 'compare' ? '比べる' : rec.action === 'review_word' ? '単語を見る' : '練習する';
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.rec, { borderColor: c.line, opacity: pressed ? 0.7 : 1 }]}>
      <T variant="small" style={{ flex: 1 }}>
        {rec.reasonJa}
      </T>
      <T variant="small" color={c.accent} style={{ fontWeight: '600' }}>
        {label} ›
      </T>
    </Pressable>
  );
}

export function TutorResultView({
  response,
  wordsById,
  onAction,
}: {
  response: TutorResponse;
  wordsById: ReadonlyMap<string, Word>;
  onAction: (r: Recommendation) => void;
}) {
  switch (response.kind) {
    case 'explain':
      return <Explain c={response.content as ExplainContent} />;
    case 'examples':
      return <Examples c={response.content as ExamplesContent} />;
    case 'compare':
      return <Compare c={response.content as CompareContent} />;
    case 'context':
      return <Context c={response.content as ContextContent} />;
    case 'exercises':
      return <Exercises key={response.generatedAt} c={response.content as ExercisesContent} />;
    case 'mistakes':
      return <Mistakes c={response.content as MistakesContent} wordsById={wordsById} onAction={onAction} />;
  }
}

const styles = StyleSheet.create({
  example: { borderLeftWidth: 3, paddingLeft: space.md, gap: 2 },
  note: { borderRadius: radius.sm, padding: space.md, gap: 2 },
  option: { borderWidth: 1, borderRadius: radius.sm, paddingVertical: space.sm, paddingHorizontal: space.md },
  rec: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.sm, padding: space.md },
});
