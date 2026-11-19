import { View } from 'react-native';
import type { Word } from '../domain/types';
import { Row, T } from './components';
import { space, usePalette } from './theme';

/** Dictionary entry view. Fields that are empty for a word are omitted. */
export function WordDetails({ word, compact = false }: { word: Word; compact?: boolean }) {
  const c = usePalette();
  return (
    <View style={{ gap: space.sm }}>
      <Row gap={space.sm} style={{ alignItems: 'baseline' }}>
        <T variant={compact ? 'title' : 'display'}>{word.word}</T>
        <T variant="small" color={c.muted}>
          {word.partOfSpeech}
          {word.ipa ? `  /${word.ipa}/` : ''}
        </T>
      </Row>
      {word.senses.map((s, i) => (
        <View key={i} style={{ gap: 2 }}>
          <T variant="heading">
            {word.senses.length > 1 ? `${i + 1}. ` : ''}
            {s.ja}
          </T>
          {s.en && (
            <T color={c.muted} style={{ fontStyle: 'italic' }}>
              {s.en}
            </T>
          )}
        </View>
      ))}
      {word.synonyms.length > 0 && (
        <T variant="small">
          <T variant="small" color={c.muted}>
            類義語{'  '}
          </T>
          {word.synonyms.join(', ')}
        </T>
      )}
      {!compact && word.antonyms.length > 0 && (
        <T variant="small">
          <T variant="small" color={c.muted}>
            反意語{'  '}
          </T>
          {word.antonyms.join(', ')}
        </T>
      )}
      {!compact && word.collocations.length > 0 && (
        <T variant="small">
          <T variant="small" color={c.muted}>
            コロケーション{'  '}
          </T>
          {word.collocations.join(' / ')}
        </T>
      )}
      {!compact &&
        word.examples.map((e, i) => (
          <View key={i}>
            <T style={{ fontStyle: 'italic' }}>{e.en}</T>
            {e.ja && (
              <T variant="small" color={c.muted}>
                {e.ja}
              </T>
            )}
          </View>
        ))}
      {!compact && word.derivatives.length > 0 && (
        <T variant="small">
          <T variant="small" color={c.muted}>
            派生語{'  '}
          </T>
          {word.derivatives.map((d) => `${d.word} (${d.partOfSpeech})`).join(', ')}
        </T>
      )}
      {!compact && word.etymology && (
        <T variant="small" color={c.muted}>
          語源: {word.etymology}
        </T>
      )}
    </View>
  );
}
