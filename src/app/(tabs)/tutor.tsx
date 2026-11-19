import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { TutorKind, TutorRequest } from '../../domain/ai/contract';
import { MAX_CONTEXT_SENTENCE_CHARS } from '../../domain/ai/contract';
import { usesWord } from '../../domain/ai/lexical';
import { analyzeMistakes, SPELLING_PATTERN_LABELS, type Recommendation } from '../../domain/ai/mistakes';
import { weakWords } from '../../domain/analytics';
import type { Word } from '../../domain/types';
import { useLearning } from '../../state/LearningProvider';
import { TUTOR_ERROR_MESSAGES, useTutorRequest, type TutorState } from '../../state/TutorProvider';
import { Button, Card, Loading, Pill, Row, Screen, SectionLabel, T } from '../../ui/components';
import { radius, space, usePalette } from '../../ui/theme';
import { DictionaryCompare } from '../../ui/tutor/DictionaryCompare';
import { compareCandidates } from '../../ui/tutor/compareCandidates';
import { RecommendationRow, TutorResultView } from '../../ui/tutor/TutorResult';
import { WordDetails } from '../../ui/WordDetails';

type WordAction = Exclude<TutorKind, 'mistakes'>;
const ACTIONS: { kind: WordAction; label: string }[] = [
  { kind: 'explain', label: '解説' },
  { kind: 'examples', label: '例文' },
  { kind: 'compare', label: '似た語と比べる' },
  { kind: 'exercises', label: '練習問題' },
  { kind: 'context', label: '文の中の意味' },
];

const KIND_TITLES: Record<TutorKind, string> = {
  explain: '意味とニュアンス',
  examples: 'あなたのレベルの例文',
  compare: '使い分け',
  context: '文の中での意味',
  exercises: '練習問題',
  mistakes: 'AIの学習アドバイス',
};

export default function Tutor() {
  const c = usePalette();
  const snap = useLearning();
  const params = useLocalSearchParams<{ wordId?: string }>();
  const tutor = useTutorRequest();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<WordAction | null>(null);
  const [compareWith, setCompareWith] = useState<string[]>([]);
  const [sentence, setSentence] = useState('');
  const [origin, setOrigin] = useState<'mistakes' | 'word'>('word');

  useEffect(() => {
    if (params.wordId && snap.wordsById.has(params.wordId)) selectWord(params.wordId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.wordId, snap.wordsById]);

  const analysis = useMemo(() => analyzeMistakes(snap.reviews, snap.words), [snap.reviews, snap.words]);
  const selected = selectedId ? (snap.wordsById.get(selectedId) ?? null) : null;

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return snap.words.filter((w) => w.word.toLowerCase().startsWith(q) || w.senses.some((s) => s.ja.includes(query.trim()))).slice(0, 8);
    }
    const ids = [
      ...weakWords([...snap.progress.values()], 6, snap.adaptive.thresholds).map((w) => w.wordId),
      ...analysis.confusions.flatMap((x) => [x.wordId, x.confusedWithId]),
    ];
    return [...new Set(ids)].map((id) => snap.wordsById.get(id)).filter((w): w is Word => !!w).slice(0, 8);
  }, [query, snap.words, snap.wordsById, snap.progress, snap.adaptive.thresholds, analysis]);

  const candidates = useMemo(() => (selected ? compareCandidates(selected, snap.words, analysis.confusions) : []), [selected, snap.words, analysis]);

  if (!snap.ready) return <Loading />;

  function selectWord(id: string) {
    setSelectedId(id);
    setAction(null);
    setCompareWith([]);
    setSentence('');
    setQuery('');
    if (origin === 'word') tutor.reset();
  }

  function ask(request: TutorRequest, from: 'mistakes' | 'word', force = false) {
    setOrigin(from);
    void tutor.run(request, { force });
  }

  function chooseAction(kind: WordAction) {
    if (!selected) return;
    setAction(kind);
    setOrigin('word');
    if (kind === 'compare') {
      const first = candidates[0]?.text;
      const initial = compareWith.length ? compareWith : first ? [first] : [];
      setCompareWith(initial);
      if (tutor.available && initial.length) ask({ kind, wordId: selected.id, others: initial }, 'word');
      else tutor.reset();
      return;
    }
    if (kind === 'context') {
      tutor.reset();
      return;
    }
    if (tutor.available) ask({ kind, wordId: selected.id }, 'word');
  }

  function onRecommendation(r: Recommendation) {
    if (r.action === 'weak_session') router.push('/session?mode=weak');
    else if (r.action === 'review_word' && r.wordIds[0]) router.push(`/word/${r.wordIds[0]}`);
    else if (r.action === 'compare' && r.wordIds.length === 2) {
      const [a, b] = r.wordIds as [string, string];
      const other = snap.wordsById.get(b);
      setSelectedId(a);
      setAction('compare');
      setQuery('');
      setCompareWith(other ? [other.word.toLowerCase()] : []);
      if (tutor.available && other) ask({ kind: 'compare', wordId: a, others: [other.word.toLowerCase()] }, 'word');
      else tutor.reset();
    }
  }

  const contextOk = selected ? usesWord(sentence, selected) : false;
  const hasHistory = analysis.reviewsAnalyzed > 0;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <T variant="title">AI講師</T>
        <Pill label={tutor.available ? 'AI 接続' : 'AIはオフ'} tone={tutor.available ? 'accent' : 'neutral'} />
      </Row>
      {!tutor.available && (
        <T variant="small" color={c.muted}>
          AIを使うには、アカウント（Supabase）とサーバーのAI設定が必要です。間違いの分析と辞書での比較は、このままでも使えます。
        </T>
      )}

      <Card>
        <SectionLabel>間違いの分析</SectionLabel>
        {!hasHistory ? (
          <T color={c.muted}>まだ解答の記録がありません。学習すると、ここに間違いの傾向が表示されます。</T>
        ) : analysis.mistakes === 0 ? (
          <T color={c.muted}>直近 {analysis.reviewsAnalyzed} 問で間違いはありません。この調子で復習を続けましょう。</T>
        ) : (
          <View style={{ gap: space.md }}>
            <T variant="small" color={c.muted}>
              直近 {analysis.reviewsAnalyzed} 問中 {analysis.mistakes} 問の間違いから
            </T>
            {analysis.confusions.length > 0 && (
              <View style={{ gap: space.xs }}>
                <T style={{ fontWeight: '600' }}>取り違えている単語</T>
                {analysis.confusions.slice(0, 5).map((x) => (
                  <Row key={`${x.wordId}-${x.confusedWithId}`} style={{ justifyContent: 'space-between' }}>
                    <T>
                      {snap.wordsById.get(x.wordId)?.word} ⇄ {snap.wordsById.get(x.confusedWithId)?.word}
                    </T>
                    <T variant="small" color={c.bad}>
                      {x.count}回
                    </T>
                  </Row>
                ))}
              </View>
            )}
            {analysis.spelling.length > 0 && (
              <View style={{ gap: space.xs }}>
                <T style={{ fontWeight: '600' }}>つづりの間違い</T>
                {analysis.spelling.slice(0, 5).map((s, i) => (
                  <Row key={i} style={{ justifyContent: 'space-between' }}>
                    <T>
                      <T color={c.bad} style={{ textDecorationLine: 'line-through' }}>
                        {s.attempt}
                      </T>
                      {'  →  '}
                      {snap.wordsById.get(s.wordId)?.word}
                    </T>
                    <T variant="small" color={c.muted}>
                      {SPELLING_PATTERN_LABELS[s.pattern]}
                    </T>
                  </Row>
                ))}
              </View>
            )}
            {analysis.gaveUp.length > 0 && (
              <T variant="small">
                「わからない」が多い単語: {analysis.gaveUp.map((g) => snap.wordsById.get(g.wordId)?.word).filter(Boolean).join('、')}
              </T>
            )}
            {analysis.recommendations.map((r, i) => (
              <RecommendationRow key={i} rec={r} onPress={() => onRecommendation(r)} />
            ))}
            {tutor.available && (
              <Button variant="secondary" label="AIに学習アドバイスをもらう" onPress={() => ask({ kind: 'mistakes' }, 'mistakes')} />
            )}
          </View>
        )}
      </Card>
      {origin === 'mistakes' && <ResultCard state={tutor.state} wordsById={snap.wordsById} onRetry={(force) => ask({ kind: 'mistakes' }, 'mistakes', force)} onAction={onRecommendation} />}

      <Card>
        <SectionLabel>単語について聞く</SectionLabel>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="英単語・日本語で探す"
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="単語を探す"
          style={[styles.input, { borderColor: c.line, backgroundColor: c.surface, color: c.ink }]}
        />
        {(query.trim() || !selected) && (
          <View style={styles.chips}>
            {suggestions.length === 0 ? (
              <T variant="small" color={c.muted}>
                {query.trim() ? '見つかりませんでした。' : '単語を検索するか、単語帳の単語ページから開いてください。'}
              </T>
            ) : (
              suggestions.map((w) => <Chip key={w.id} label={w.word} active={w.id === selectedId} onPress={() => selectWord(w.id)} />)
            )}
          </View>
        )}
        {selected && (
          <View style={{ gap: space.md }}>
            <WordDetails word={selected} compact />
            <View style={styles.chips}>
              {ACTIONS.map((a) => (
                <Chip
                  key={a.kind}
                  label={a.label}
                  active={action === a.kind}
                  disabled={!tutor.available && a.kind !== 'compare'}
                  onPress={() => chooseAction(a.kind)}
                />
              ))}
            </View>
            {action === 'compare' && (
              <View style={{ gap: space.sm }}>
                <T variant="small" color={c.muted}>
                  比べる単語を選んでください（3つまで）
                </T>
                <View style={styles.chips}>
                  {candidates.length === 0 && (
                    <T variant="small" color={c.muted}>
                      比べる候補がありません。
                    </T>
                  )}
                  {candidates.map((k) => (
                    <Chip
                      key={k.text}
                      label={k.confused ? `${k.label}（取り違え）` : k.label}
                      active={compareWith.includes(k.text)}
                      onPress={() =>
                        setCompareWith((prev) => (prev.includes(k.text) ? prev.filter((p) => p !== k.text) : prev.length >= 3 ? prev : [...prev, k.text]))
                      }
                    />
                  ))}
                </View>
                {tutor.available ? (
                  <Button
                    label="AIに使い分けを聞く"
                    disabled={compareWith.length === 0}
                    onPress={() => ask({ kind: 'compare', wordId: selected.id, others: compareWith }, 'word')}
                  />
                ) : (
                  <DictionaryCompare target={selected} others={compareWith} words={snap.words} />
                )}
              </View>
            )}
            {action === 'context' && (
              <View style={{ gap: space.sm }}>
                <T variant="small" color={c.muted}>
                  「{selected.word}」を含む英文を入力してください。問題文や長文の一文をそのまま貼り付けられます。
                </T>
                <TextInput
                  value={sentence}
                  onChangeText={setSentence}
                  placeholder={`「${selected.word}」を含む英文`}
                  placeholderTextColor={c.muted}
                  multiline
                  maxLength={MAX_CONTEXT_SENTENCE_CHARS}
                  autoCapitalize="sentences"
                  accessibilityLabel="英文"
                  style={[styles.input, styles.multiline, { borderColor: c.line, backgroundColor: c.surface, color: c.ink }]}
                />
                {sentence.trim().length > 0 && !contextOk && (
                  <T variant="small" color={c.bad}>
                    文に「{selected.word}」（またはその変化形）が含まれていません。
                  </T>
                )}
                <Button label="意味を聞く" disabled={!contextOk} onPress={() => ask({ kind: 'context', wordId: selected.id, sentence }, 'word')} />
              </View>
            )}
          </View>
        )}
      </Card>
      {origin === 'word' && tutor.state.status !== 'idle' && (
        <ResultCard
          state={tutor.state}
          wordsById={snap.wordsById}
          onRetry={(force) => tutor.state.status !== 'idle' && ask(tutor.state.request, 'word', force)}
          onAction={onRecommendation}
        />
      )}
    </Screen>
  );
}

function ResultCard({
  state,
  wordsById,
  onRetry,
  onAction,
}: {
  state: TutorState;
  wordsById: ReadonlyMap<string, Word>;
  onRetry: (force: boolean) => void;
  onAction: (r: Recommendation) => void;
}) {
  const c = usePalette();
  if (state.status === 'idle') return null;
  const kind = state.request.kind;
  const shown = state.status === 'done' ? state.response : state.previous;
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionLabel>{KIND_TITLES[kind]}</SectionLabel>
        {state.status === 'loading' && <ActivityIndicator color={c.accent} accessibilityLabel="AIが考えています" />}
      </Row>
      {state.status === 'loading' && !shown && <T color={c.muted}>AIが考えています…（辞書データとあなたの記録をもとに作成します）</T>}
      {state.status === 'error' && (
        <View style={[styles.notice, { backgroundColor: c.badSoft }]}>
          <T color={c.bad}>{TUTOR_ERROR_MESSAGES[state.error.code]}</T>
        </View>
      )}
      {state.status === 'done' && state.offlineCopy && (
        <View style={[styles.notice, { backgroundColor: c.warnSoft }]}>
          <T variant="small" color={c.warn}>
            オフラインのため、前に保存した答えを表示しています。
          </T>
        </View>
      )}
      {shown && <TutorResultView response={shown} wordsById={wordsById} onAction={onAction} />}
      {state.status !== 'loading' && (
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <T variant="small" color={c.muted} style={{ flex: 1 }}>
            {shown ? '辞書データをもとにAIが作成し、自動チェックを通った内容です。AIの説明には誤りが含まれることがあります。' : ''}
          </T>
          <Pressable accessibilityRole="button" onPress={() => onRetry(state.status === 'done')} hitSlop={8}>
            <T variant="small" color={c.accent} style={{ fontWeight: '600' }}>
              {state.status === 'done' ? '作り直す' : 'もう一度'}
            </T>
          </Pressable>
        </Row>
      )}
    </Card>
  );
}

function Chip({ label, active, disabled, onPress }: { label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.chip,
        { borderColor: active ? c.accent : c.line, backgroundColor: active ? c.accentSoft : c.surface, opacity: disabled ? 0.45 : 1 },
      ]}
    >
      <T variant="small" color={active ? c.accent : c.ink} style={{ fontWeight: active ? '600' : '400' }}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 6 },
  notice: { borderRadius: radius.sm, padding: space.md },
});
