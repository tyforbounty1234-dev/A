import type { Word } from '@/lexicore/domain/types';
import { LEVEL_SHORT } from '@/lib/levels';

/** Dictionary entry. Empty fields are omitted. */
export function WordDetails({ word, compact = false }: { word: Word; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={compact ? 'text-2xl font-bold' : 'text-4xl font-bold'}>{word.word}</span>
        <span className="text-sm text-muted">
          {word.partOfSpeech}
          {word.ipa ? `  /${word.ipa}/` : ''}
        </span>
        <span className="rounded-full bg-surface-alt px-2 py-0.5 text-xs font-semibold text-muted">
          Lv.{word.difficulty} {LEVEL_SHORT[word.difficulty] ?? ''}
        </span>
      </div>
      {word.senses.map((s, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <span className="text-lg font-bold">
            {word.senses.length > 1 ? `${i + 1}. ` : ''}
            {s.ja}
          </span>
          {s.en && <span className="italic text-muted">{s.en}</span>}
        </div>
      ))}
      {word.synonyms.length > 0 && (
        <p className="text-sm">
          <span className="text-muted">類義語　</span>
          {word.synonyms.join(', ')}
        </p>
      )}
      {word.antonyms.length > 0 && (
        <p className="text-sm">
          <span className="text-muted">反意語　</span>
          {word.antonyms.join(', ')}
        </p>
      )}
      {!compact && word.collocations.length > 0 && (
        <p className="text-sm">
          <span className="text-muted">コロケーション　</span>
          {word.collocations.join(' / ')}
        </p>
      )}
      {!compact &&
        word.examples.map((e, i) => (
          <div key={i} className="border-l-2 border-line pl-3 text-sm">
            <p>{e.en}</p>
            {e.ja && <p className="text-muted">{e.ja}</p>}
          </div>
        ))}
      {!compact && word.etymology && <p className="text-sm text-muted">語源: {word.etymology}</p>}
    </div>
  );
}
