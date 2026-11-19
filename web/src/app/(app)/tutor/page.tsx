'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { WordDetails } from '@/components/WordDetails';
import { DictionaryCompare, RecommendationRow, TutorResultView } from '@/components/tutor/TutorResult';
import { Button, Card, Chip, Loading, Notice, PageTitle, SectionLabel, Spinner, inputClass } from '@/components/ui';
import { MAX_CONTEXT_SENTENCE_CHARS, type TutorKind, type TutorRequest } from '@/lexicore/domain/ai/contract';
import { usesWord } from '@/lexicore/domain/ai/lexical';
import { analyzeMistakes, SPELLING_PATTERN_LABELS, type Recommendation } from '@/lexicore/domain/ai/mistakes';
import { weakWords } from '@/lexicore/domain/analytics';
import type { Word } from '@/lexicore/domain/types';
import { compareCandidates } from '@/lexicore/ui/tutor/compareCandidates';
import { useLearning } from '@/lib/learning';
import { TUTOR_ERROR_MESSAGES, useTutorRequest, type TutorState } from '@/lib/tutor';

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

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Tutor />
    </Suspense>
  );
}

function Tutor() {
  const snap = useLearning();
  const router = useRouter();
  const params = useSearchParams();
  const tutor = useTutorRequest();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<WordAction | null>(null);
  const [compareWith, setCompareWith] = useState<string[]>([]);
  const [sentence, setSentence] = useState('');
  const [origin, setOrigin] = useState<'mistakes' | 'word'>('word');

  const paramWord = params.get('wordId');
  useEffect(() => {
    if (paramWord && snap.wordsById.has(paramWord)) {
      setSelectedId(paramWord);
      setAction(null);
    }
  }, [paramWord, snap.wordsById]);

  const analysis = useMemo(() => analyzeMistakes(snap.reviews, snap.words), [snap.reviews, snap.words]);
  const selected = selectedId ? (snap.wordsById.get(selectedId) ?? null) : null;
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return snap.words.filter((w) => w.word.toLowerCase().startsWith(q) || w.senses.some((s) => s.ja.includes(query.trim()))).slice(0, 8);
    const ids = [...weakWords([...snap.progress.values()], 6, snap.adaptive.thresholds).map((w) => w.wordId), ...analysis.confusions.flatMap((x) => [x.wordId, x.confusedWithId])];
    return [...new Set(ids)]
      .map((id) => snap.wordsById.get(id))
      .filter((w): w is Word => !!w)
      .slice(0, 8);
  }, [query, snap.words, snap.wordsById, snap.progress, snap.adaptive.thresholds, analysis]);
  const candidates = useMemo(() => (selected ? compareCandidates(selected, snap.words, analysis.confusions) : []), [selected, snap.words, analysis]);

  if (!snap.ready) return <Loading />;

  function ask(request: TutorRequest, from: 'mistakes' | 'word', force = false) {
    setOrigin(from);
    void tutor.run(request, { force });
  }

  function selectWord(id: string) {
    setSelectedId(id);
    setAction(null);
    setCompareWith([]);
    setSentence('');
    setQuery('');
    if (origin === 'word') tutor.reset();
  }

  function chooseAction(kind: WordAction) {
    if (!selected) return;
    setAction(kind);
    setOrigin('word');
    if (kind === 'compare') {
      const initial = compareWith.length ? compareWith : candidates[0] ? [candidates[0].text] : [];
      setCompareWith(initial);
      tutor.reset();
      return;
    }
    if (kind === 'context') {
      tutor.reset();
      return;
    }
    ask({ kind, wordId: selected.id }, 'word');
  }

  function onRecommendation(r: Recommendation) {
    if (r.action === 'weak_session') router.push('/session?mode=weak');
    else if (r.action === 'review_word' && r.wordIds[0]) router.push(`/words/${r.wordIds[0]}`);
    else if (r.action === 'compare' && r.wordIds.length === 2) {
      const [a, b] = r.wordIds as [string, string];
      const other = snap.wordsById.get(b);
      setSelectedId(a);
      setAction('compare');
      setQuery('');
      setCompareWith(other ? [other.word.toLowerCase()] : []);
      tutor.reset();
      window.scrollTo({ top: document.getElementById('ask')?.offsetTop ?? 0, behavior: 'smooth' });
    }
  }

  const contextOk = selected ? usesWord(sentence, selected) : false;

  return (
    <>
      <PageTitle>AI講師</PageTitle>
      <Card>
        <SectionLabel>間違いの分析</SectionLabel>
        {analysis.reviewsAnalyzed === 0 ? (
          <p className="text-muted">まだ解答の記録がありません。学習すると、ここに間違いの傾向が表示されます。</p>
        ) : analysis.mistakes === 0 ? (
          <p className="text-muted">直近 {analysis.reviewsAnalyzed} 問で間違いはありません。この調子で復習を続けましょう。</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              直近 {analysis.reviewsAnalyzed} 問中 {analysis.mistakes} 問の間違いから
            </p>
            {analysis.confusions.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="font-semibold">取り違えている単語</p>
                {analysis.confusions.slice(0, 5).map((x) => (
                  <p key={`${x.wordId}-${x.confusedWithId}`} className="flex justify-between">
                    <span>
                      {snap.wordsById.get(x.wordId)?.word} ⇄ {snap.wordsById.get(x.confusedWithId)?.word}
                    </span>
                    <span className="text-sm text-bad">{x.count}回</span>
                  </p>
                ))}
              </div>
            )}
            {analysis.spelling.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="font-semibold">つづりの間違い</p>
                {analysis.spelling.slice(0, 5).map((s, i) => (
                  <p key={i} className="flex justify-between gap-2">
                    <span>
                      <span className="text-bad line-through">{s.attempt}</span> → {snap.wordsById.get(s.wordId)?.word}
                    </span>
                    <span className="text-xs text-muted">{SPELLING_PATTERN_LABELS[s.pattern]}</span>
                  </p>
                ))}
              </div>
            )}
            {analysis.gaveUp.length > 0 && (
              <p className="text-sm">
                「わからない」が多い単語:{' '}
                {analysis.gaveUp
                  .map((g) => snap.wordsById.get(g.wordId)?.word)
                  .filter(Boolean)
                  .join('、')}
              </p>
            )}
            {analysis.recommendations.map((r, i) => (
              <RecommendationRow key={i} rec={r} onClick={() => onRecommendation(r)} />
            ))}
            <Button variant="secondary" onClick={() => ask({ kind: 'mistakes' }, 'mistakes')}>
              AIに学習アドバイスをもらう
            </Button>
          </div>
        )}
      </Card>
      {origin === 'mistakes' && <ResultCard state={tutor.state} wordsById={snap.wordsById} onRetry={(force) => ask({ kind: 'mistakes' }, 'mistakes', force)} onAction={onRecommendation} />}

      <Card>
        <span id="ask" />
        <SectionLabel>単語について聞く</SectionLabel>
        <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="英単語・日本語で探す" aria-label="単語を探す" type="search" />
        {(query.trim() || !selected) && (
          <div className="flex flex-wrap gap-2">
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted">{query.trim() ? '見つかりませんでした。' : '単語を検索するか、単語帳の単語ページから開いてください。'}</p>
            ) : (
              suggestions.map((w) => (
                <Chip key={w.id} active={w.id === selectedId} onClick={() => selectWord(w.id)}>
                  {w.word}
                </Chip>
              ))
            )}
          </div>
        )}
        {selected && (
          <div className="flex flex-col gap-3">
            <WordDetails word={selected} compact />
            <div className="flex flex-wrap gap-2">
              {ACTIONS.map((a) => (
                <Chip key={a.kind} active={action === a.kind} onClick={() => chooseAction(a.kind)}>
                  {a.label}
                </Chip>
              ))}
            </div>
            {action === 'compare' && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted">比べる単語を選んでください（3つまで）</p>
                <div className="flex flex-wrap gap-2">
                  {candidates.length === 0 && <p className="text-sm text-muted">比べる候補がありません。</p>}
                  {candidates.map((k) => (
                    <Chip
                      key={k.text}
                      active={compareWith.includes(k.text)}
                      onClick={() => setCompareWith((prev) => (prev.includes(k.text) ? prev.filter((p) => p !== k.text) : prev.length >= 3 ? prev : [...prev, k.text]))}
                    >
                      {k.confused ? `${k.label}（取り違え）` : k.label}
                    </Chip>
                  ))}
                </div>
                <Button disabled={compareWith.length === 0} onClick={() => ask({ kind: 'compare', wordId: selected.id, others: compareWith }, 'word')}>
                  AIに使い分けを聞く
                </Button>
                {tutor.state.status === 'error' && tutor.state.request.kind === 'compare' && <DictionaryCompare target={selected} others={compareWith} words={snap.words} />}
              </div>
            )}
            {action === 'context' && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted">「{selected.word}」を含む英文を入力してください。問題文や長文の一文をそのまま貼り付けられます。</p>
                <textarea
                  value={sentence}
                  onChange={(e) => setSentence(e.target.value)}
                  maxLength={MAX_CONTEXT_SENTENCE_CHARS}
                  rows={3}
                  aria-label="英文"
                  placeholder={`「${selected.word}」を含む英文`}
                  className={`${inputClass} py-2`}
                />
                {sentence.trim().length > 0 && !contextOk && <p className="text-sm text-bad">文に「{selected.word}」（またはその変化形）が含まれていません。</p>}
                <Button disabled={!contextOk} onClick={() => ask({ kind: 'context', wordId: selected.id, sentence }, 'word')}>
                  意味を聞く
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
      {origin === 'word' && (
        <ResultCard
          state={tutor.state}
          wordsById={snap.wordsById}
          onRetry={(force) => tutor.state.status !== 'idle' && ask(tutor.state.request, 'word', force)}
          onAction={onRecommendation}
        />
      )}
    </>
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
  if (state.status === 'idle') return null;
  const shown = state.status === 'done' ? state.response : state.previous;
  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionLabel>{KIND_TITLES[state.request.kind]}</SectionLabel>
        {state.status === 'loading' && (
          <span className="text-accent">
            <Spinner small />
          </span>
        )}
      </div>
      {state.status === 'loading' && !shown && <p className="text-muted">AIが考えています…（辞書データとあなたの記録をもとに作成します）</p>}
      {state.status === 'error' && <Notice>{TUTOR_ERROR_MESSAGES[state.error.code]}</Notice>}
      {state.status === 'done' && state.offlineCopy && <Notice tone="warn">オフラインのため、前に保存した答えを表示しています。</Notice>}
      {shown && <TutorResultView response={shown} wordsById={wordsById} onAction={onAction} />}
      {state.status !== 'loading' && (
        <div className="flex items-center justify-between gap-3">
          <p className="flex-1 text-xs text-muted">{shown ? '辞書データをもとにAIが作成し、自動チェックを通った内容です。AIの説明には誤りが含まれることがあります。' : ''}</p>
          <button type="button" className="text-sm font-semibold text-accent" onClick={() => onRetry(state.status === 'done')}>
            {state.status === 'done' ? '作り直す' : 'もう一度'}
          </button>
        </div>
      )}
    </Card>
  );
}
