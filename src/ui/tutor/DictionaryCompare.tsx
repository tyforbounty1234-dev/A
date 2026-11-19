import { View } from 'react-native';
import type { Word } from '../../domain/types';
import { Row, T } from '../components';
import { space, usePalette } from '../theme';

/**
 * Offline comparison from dictionary data only (no AI): meaning, definition
 * and synonyms side by side. Words without a dictionary entry are listed as such.
 */
export function DictionaryCompare({ target, others, words }: { target: Word; others: string[]; words: readonly Word[] }) {
  const c = usePalette();
  const byText = new Map(words.map((w) => [w.word.toLowerCase(), w]));
  const rows = [target.word.toLowerCase(), ...others].map((t) => ({ text: t, word: byText.get(t) ?? null }));
  if (others.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      <T variant="small" color={c.muted}>
        辞書データでの比較（AIなし）
      </T>
      {rows.map(({ text, word }) => (
        <View key={text} style={{ gap: 2, borderLeftWidth: 3, borderColor: c.line, paddingLeft: space.md }}>
          <Row gap={space.sm} style={{ alignItems: 'baseline' }}>
            <T variant="heading">{word?.word ?? text}</T>
            {word && (
              <T variant="small" color={c.muted}>
                {word.partOfSpeech}
              </T>
            )}
          </Row>
          {word ? (
            <>
              <T>{word.senses.map((s) => s.ja).join(' / ')}</T>
              {word.senses[0]?.en ? (
                <T variant="small" color={c.muted} style={{ fontStyle: 'italic' }}>
                  {word.senses[0].en}
                </T>
              ) : null}
              {word.synonyms.length > 0 && (
                <T variant="small" color={c.muted}>
                  類義語: {word.synonyms.join(', ')}
                </T>
              )}
            </>
          ) : (
            <T variant="small" color={c.muted}>
              「{target.word}」の類義語として載っている語です（この辞書には項目がありません）。
            </T>
          )}
        </View>
      ))}
    </View>
  );
}
