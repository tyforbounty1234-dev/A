import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isDifficult } from '../../domain/srs/progress';
import type { LearningStatus, Word, WordProgress } from '../../domain/types';
import { useLearning } from '../../state/LearningProvider';
import { Loading, Pill, T } from '../../ui/components';
import { radius, space, usePalette } from '../../ui/theme';

type Filter = 'all' | 'unseen' | 'learning' | 'mastered' | 'difficult';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'unseen', label: '未学習' },
  { key: 'learning', label: '学習中' },
  { key: 'mastered', label: '定着' },
  { key: 'difficult', label: '苦手' },
];

const STATUS_LABEL: Record<LearningStatus, string> = {
  new: '未学習',
  learning: '学習中',
  relearning: '再学習',
  review: '復習中',
  mastered: '定着',
};

export function matchesFilter(p: WordProgress | undefined, f: Filter): boolean {
  const seen = !!p && p.reviewCount > 0;
  switch (f) {
    case 'all':
      return true;
    case 'unseen':
      return !seen;
    case 'learning':
      return seen && p!.status !== 'mastered';
    case 'mastered':
      return seen && p!.status === 'mastered';
    case 'difficult':
      return seen && isDifficult(p!);
  }
}

export default function Library() {
  const c = usePalette();
  const snap = useLearning();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...snap.words]
      .sort((a, b) => a.word.localeCompare(b.word))
      .filter((w) => matchesFilter(snap.progress.get(w.id), filter))
      .filter((w) => !q || w.word.includes(q) || w.senses.some((s) => s.ja.includes(q)) || w.synonyms.some((s) => s.includes(q)));
  }, [snap.words, snap.progress, query, filter]);

  if (!snap.ready) return <Loading />;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.header}>
        <T variant="title">単語帳</T>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="英単語・日本語で検索"
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="単語を検索"
          style={[styles.search, { borderColor: c.line, backgroundColor: c.surface, color: c.ink }]}
        />
        <View style={styles.filters}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === f.key }}
              style={[styles.filter, { borderColor: filter === f.key ? c.accent : c.line, backgroundColor: filter === f.key ? c.accent : 'transparent' }]}
            >
              <T variant="small" color={filter === f.key ? c.accentInk : c.ink}>
                {f.label}
              </T>
            </Pressable>
          ))}
        </View>
        <T variant="small" color={c.muted}>
          {items.length} 語
        </T>
      </View>
      <FlatList
        data={items}
        keyExtractor={(w) => w.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line }} />}
        renderItem={({ item }) => <WordRow word={item} progress={snap.progress.get(item.id)} />}
        ListEmptyComponent={<T color={c.muted}>該当する単語はありません。</T>}
      />
    </SafeAreaView>
  );
}

function WordRow({ word, progress }: { word: Word; progress: WordProgress | undefined }) {
  const c = usePalette();
  const status = progress && progress.reviewCount > 0 ? progress.status : 'new';
  const tone = status === 'mastered' ? 'ok' : status === 'new' ? 'neutral' : progress && isDifficult(progress) ? 'bad' : 'accent';
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(`/word/${word.id}`)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="heading">{word.word}</T>
        <T variant="small" color={c.muted} numberOfLines={1}>
          {word.partOfSpeech} {word.senses[0]?.ja}
        </T>
      </View>
      <Pill label={STATUS_LABEL[status]} tone={tone} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, gap: space.sm },
  search: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 16 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  filter: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
