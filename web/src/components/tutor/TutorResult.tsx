'use client';
import { useState, type ReactNode } from 'react';
import type {
  CompareContent,
  ContextContent,
  ExamplesContent,
  ExercisesContent,
  ExplainContent,
  MistakesContent,
  TutorResponse,
} from '@/lexicore/domain/ai/contract';
import type { Recommendation } from '@/lexicore/domain/ai/mistakes';
import type { Word } from '@/lexicore/domain/types';
import { Pill, SectionLabel, cx } from '../ui';

function Bullets({ items }: { items: string[] }) {
  return items.length ? (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  ) : null;
}

function EnJa({ en, ja, note }: { en: string; ja: string; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-[3px] border-line pl-3">
      <p className="font-medium">{en}</p>
      <p className="text-muted">{ja}</p>
      {note && <p className="text-sm text-accent">{note}</p>}
    </div>
  );
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-accent-soft p-3">
      <p className="text-xs text-accent">{title}</p>
      <p>{children}</p>
    </div>
  );
}

function Explain({ c }: { c: ExplainContent }) {
  return (
    <div className="flex flex-col gap-3">
      <p>{c.nuanceJa}</p>
      {c.personalAdviceJa && <Note title="あなたへのアドバイス">{c.personalAdviceJa}</Note>}
      <SectionLabel>使い方</SectionLabel>
      <Bullets items={c.usageJa} />
      {c.collocations.length > 0 && (
        <>
          <SectionLabel>よく使う組み合わせ</SectionLabel>
          {c.collocations.map((k, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span className="font-semibold">{k.en}</span>
              <span className="text-right text-muted">{k.ja}</span>
            </div>
          ))}
        </>
      )}
      {c.pitfallsJa.length > 0 && (
        <>
          <SectionLabel>間違えやすい点</SectionLabel>
          <Bullets items={c.pitfallsJa} />
        </>
      )}
      {c.memoryTipJa && (
        <>
          <SectionLabel>覚え方</SectionLabel>
          <p>{c.memoryTipJa}</p>
        </>
      )}
    </div>
  );
}

function Compare({ c }: { c: CompareContent }) {
  return (
    <div className="flex flex-col gap-3">
      <p>{c.differenceJa}</p>
      {c.items.map((it) => (
        <div key={it.word} className="flex flex-col gap-1">
          <p>
            <span className="text-lg font-bold">{it.word}</span>　<span className="text-muted">{it.coreJa}</span>
          </p>
          <p className="text-sm">{it.nuanceJa}</p>
          <EnJa en={it.example.en} ja={it.example.ja} />
        </div>
      ))}
      {c.tipJa && <Note title="見分けるコツ">{c.tipJa}</Note>}
    </div>
  );
}

function Context({ c }: { c: ContextContent }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold">{c.meaningJa}</span>
        <Pill tone={c.matchesDictionarySense ? 'ok' : 'warn'}>{c.matchesDictionarySense ? '辞書の意味どおり' : '辞書にない使い方'}</Pill>
      </div>
      <p>{c.explanationJa}</p>
      <p className="text-sm text-muted">言い換え: {c.paraphraseEn}</p>
    </div>
  );
}

function Exercises({ c }: { c: ExercisesContent }) {
  const [chosen, setChosen] = useState<(number | null)[]>(() => c.items.map(() => null));
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">練習用の問題です。結果は復習の予定には影響しません。</p>
      {c.items.map((it, i) => {
        const pick = chosen[i] ?? null;
        const answered = pick !== null;
        return (
          <div key={i} className="flex flex-col gap-2">
            <p className="font-medium">
              {i + 1}. {it.sentence}
            </p>
            {it.options.map((o, j) => (
              <button
                key={j}
                type="button"
                disabled={answered}
                onClick={() => setChosen((prev) => prev.map((p, k) => (k === i ? j : p)))}
                className={cx(
                  'rounded-xl border px-3 py-2 text-left',
                  !answered && 'border-line bg-surface hover:bg-surface-alt',
                  answered && j === it.answerIndex && 'border-ok bg-ok-soft',
                  answered && j === pick && j !== it.answerIndex && 'border-bad bg-bad-soft',
                  answered && j !== pick && j !== it.answerIndex && 'border-line bg-surface',
                )}
              >
                {o}
              </button>
            ))}
            {answered && (
              <div className={cx('rounded-xl p-3', pick === it.answerIndex ? 'bg-ok-soft' : 'bg-bad-soft')}>
                <p className={cx('font-semibold', pick === it.answerIndex ? 'text-ok' : 'text-bad')}>
                  {pick === it.answerIndex ? '正解' : `不正解（正解: ${it.options[it.answerIndex]}）`}
                </p>
                <p className="text-sm">{it.explanationJa}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function RecommendationRow({ rec, onClick }: { rec: Recommendation; onClick: () => void }) {
  const label = rec.action === 'compare' ? '比べる' : rec.action === 'review_word' ? '単語を見る' : '練習する';
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-xl border border-line p-3 text-left text-sm hover:bg-surface-alt">
      <span className="flex-1">{rec.reasonJa}</span>
      <span className="font-semibold text-accent">{label} ›</span>
    </button>
  );
}

function Mistakes({ c, wordsById, onAction }: { c: MistakesContent; wordsById: ReadonlyMap<string, Word>; onAction: (r: Recommendation) => void }) {
  const recs = c.recommendations.filter((r) => r.wordIds.every((id) => wordsById.has(id)));
  return (
    <div className="flex flex-col gap-3">
      <p>{c.summaryJa}</p>
      {c.insights.map((ins, i) => (
        <div key={i}>
          <p className="font-semibold">{ins.titleJa}</p>
          <p className="text-sm">{ins.detailJa}</p>
        </div>
      ))}
      {recs.length > 0 && <SectionLabel>おすすめ</SectionLabel>}
      {recs.map((r, i) => (
        <RecommendationRow key={i} rec={r} onClick={() => onAction(r)} />
      ))}
    </div>
  );
}

export function TutorResultView({ response, wordsById, onAction }: { response: TutorResponse; wordsById: ReadonlyMap<string, Word>; onAction: (r: Recommendation) => void }) {
  switch (response.kind) {
    case 'explain':
      return <Explain c={response.content as ExplainContent} />;
    case 'examples':
      return (
        <div className="flex flex-col gap-3">
          {(response.content as ExamplesContent).examples.map((e, i) => (
            <EnJa key={i} en={e.en} ja={e.ja} note={e.noteJa} />
          ))}
        </div>
      );
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

export function DictionaryCompare({ target, others, words }: { target: Word; others: string[]; words: readonly Word[] }) {
  if (others.length === 0) return null;
  const byText = new Map(words.map((w) => [w.word.toLowerCase(), w]));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">辞書データでの比較（AIなし）</p>
      {[target.word.toLowerCase(), ...others].map((t) => {
        const w = byText.get(t);
        return (
          <div key={t} className="flex flex-col gap-0.5 border-l-[3px] border-line pl-3">
            <p className="text-lg font-bold">
              {w?.word ?? t} <span className="text-xs font-normal text-muted">{w?.partOfSpeech}</span>
            </p>
            {w ? (
              <>
                <p>{w.senses.map((s) => s.ja).join(' / ')}</p>
                {w.senses[0]?.en && <p className="text-sm italic text-muted">{w.senses[0].en}</p>}
              </>
            ) : (
              <p className="text-sm text-muted">「{target.word}」の類義語として載っている語です（辞書に項目がありません）。</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
