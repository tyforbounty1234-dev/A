'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Chip, Loading, PageTitle, Pill, inputClass } from '@/components/ui';
import { isDifficult } from '@/lexicore/domain/srs/progress';
import type { LearningStatus, WordProgress } from '@/lexicore/domain/types';
import { useLearning } from '@/lib/learning';
import { LEVEL_SHORT } from '@/lib/levels';

type Filter = 'all' | 'unseen' | 'learning' | 'mastered' | 'difficult';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'unseen', label: '未学習' },
  { key: 'learning', label: '学習中' },
  { key: 'mastered', label: '定着' },
  { key: 'difficult', label: '苦手' },
];
const STATUS_LABEL: Record<LearningStatus, string> = { new: '未学習', learning: '学習中', relearning: '再学習', review: '復習中', mastered: '定着' };

function matches(p: WordProgress | undefined, f: Filter): boolean {
  const seen = !!p && p.reviewCount > 0;
  if (f === 'all') return true;
  if (f === 'unseen') return !seen;
  if (f === 'learning') return seen && p!.status !== 'mastered';
  if (f === 'mastered') return seen && p!.status === 'mastered';
  return seen && isDifficult(p!);
}

export default function Words() {
  const snap = useLearning();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [level, setLevel] = useState<number | null>(null);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...snap.words]
      .sort((a, b) => a.word.localeCompare(b.word))
      .filter((w) => matches(snap.progress.get(w.id), filter))
      .filter((w) => level === null || w.difficulty === level)
      .filter((w) => !q || w.word.includes(q) || w.senses.some((s) => s.ja.includes(q)) || w.synonyms.some((s) => s.includes(q)));
  }, [snap.words, snap.progress, query, filter, level]);
  if (!snap.ready) return <Loading />;

  return (
    <>
      <PageTitle right={<span className="text-sm text-muted">{items.length} 語</span>}>単語帳</PageTitle>
      <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="英単語・日本語で検索" aria-label="単語を検索" type="search" />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="難易度">
        <Chip active={level === null} onClick={() => setLevel(null)}>
          全レベル
        </Chip>
        {[1, 2, 3, 4, 5].map((l) => (
          <Chip key={l} active={level === l} onClick={() => setLevel(level === l ? null : l)}>
            Lv.{l} {LEVEL_SHORT[l]}
          </Chip>
        ))}
      </div>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {items.length === 0 && <li className="p-4 text-muted">該当する単語はありません。</li>}
        {items.map((w) => {
          const p = snap.progress.get(w.id);
          const status: LearningStatus = p && p.reviewCount > 0 ? p.status : 'new';
          const tone = status === 'mastered' ? 'ok' : status === 'new' ? 'neutral' : p && isDifficult(p) ? 'bad' : 'accent';
          return (
            <li key={w.id}>
              <Link href={`/words/${w.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-alt">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {w.word} <span className="text-xs font-normal text-muted">Lv.{w.difficulty}</span>
                  </p>
                  <p className="truncate text-sm text-muted">
                    {w.partOfSpeech} {w.senses[0]?.ja}
                  </p>
                </div>
                <Pill tone={tone}>{STATUS_LABEL[status]}</Pill>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
