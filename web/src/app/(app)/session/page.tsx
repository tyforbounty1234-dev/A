'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { WordDetails } from '@/components/WordDetails';
import { Button, ButtonLink, Card, Loading, Notice, Pill, ProgressBar, SectionLabel, cx } from '@/components/ui';
import type { SessionMode } from '@/lexicore/domain/types';
import type { Feedback } from '@/lexicore/state/studySessionCore';
import { formatPct, formatWhen } from '@/lib/format';
import { useLearning, useStudySession } from '@/lib/learning';

const MODES: SessionMode[] = ['review', 'learn', 'mixed', 'weak'];
const TITLES: Record<SessionMode, string> = { review: '復習', learn: '新しい単語', mixed: '今日の学習', weak: '苦手を練習' };

function SessionPage() {
  const params = useSearchParams();
  const raw = params.get('mode');
  const mode: SessionMode = MODES.includes(raw as SessionMode) ? (raw as SessionMode) : 'mixed';
  const snap = useLearning();
  if (!snap.ready) return <Loading />;
  return <SessionBody mode={mode} />;
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SessionPage />
    </Suspense>
  );
}

function SessionBody({ mode }: { mode: SessionMode }) {
  const router = useRouter();
  const { view, choose, spell, next, busy, error } = useStudySession(mode);

  // Keyboard: 1–4 choose, Enter / Space continue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (view.kind === 'card' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        next();
      } else if (view.kind === 'question' && view.feedback && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        next();
      } else if (view.kind === 'question' && !view.feedback && view.question.kind === 'choice' && /^[1-4]$/.test(e.key)) {
        choose(Number(e.key) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, next, choose]);

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{TITLES[mode]}</h1>
        <button type="button" onClick={() => router.push('/')} className="text-sm text-muted underline">
          中断する
        </button>
      </div>
      {(view.kind === 'card' || view.kind === 'question') && (
        <div className="flex flex-col gap-1">
          <ProgressBar value={(view.position - 1) / view.total} />
          <span className="tabular text-xs text-muted">
            {view.position} / {view.total}
          </span>
        </div>
      )}
      {error && <Notice>{error}</Notice>}
      {view.kind === 'loading' && <Loading />}

      {view.kind === 'empty' && (
        <Card>
          <p className="text-lg font-bold">
            {mode === 'learn' ? '今日の新しい単語は終わりです' : mode === 'weak' ? '苦手な単語はありません' : 'いま復習する単語はありません'}
          </p>
          <p className="text-muted">
            {mode === 'learn' ? '1日の目標はマイページの学習設定で変えられます。' : '次の復習の時刻になると、ホームに表示されます。'}
          </p>
          <ButtonLink href="/">ホームに戻る</ButtonLink>
        </Card>
      )}

      {view.kind === 'card' && (
        <Card>
          <div className="flex items-center justify-between">
            <Pill tone="accent">NEW</Pill>
            <span className="tabular text-sm text-muted">
              {view.cardNumber} / {view.cardCount}
            </span>
          </div>
          <WordDetails word={view.word} />
          {view.cardNumber < view.cardCount ? (
            <Button onClick={next}>覚えた。次の単語へ</Button>
          ) : (
            <>
              <p className="text-sm text-muted">全部の単語を見ました。ここからまとめてテストします。</p>
              <Button onClick={next}>覚えた。テストを始める</Button>
            </>
          )}
        </Card>
      )}

      {view.kind === 'question' && view.question.kind === 'choice' && (
        <ChoiceView
          key={`${view.position}-${view.word.id}`}
          prompt={view.question.prompt}
          detail={view.question.promptDetail}
          isEnglishPrompt={view.question.type === 'en_to_ja_mc'}
          options={view.question.options}
          answerIndex={view.question.answerIndex}
          feedback={view.feedback}
          busy={busy}
          onChoose={choose}
          onNext={next}
        />
      )}

      {view.kind === 'question' && view.question.kind === 'spelling' && (
        <SpellingView
          key={`${view.position}-${view.word.id}`}
          prompt={view.question.prompt}
          detail={view.question.promptDetail}
          hint={view.question.hint}
          feedback={view.feedback}
          busy={busy}
          onSubmit={spell}
          onNext={next}
        />
      )}

      {view.kind === 'done' && <Done summary={view.summary} />}
    </>
  );
}

function Done({ summary }: { summary: { firstAttemptAccuracy: number | null; wordsStudied: number; questionsAnswered: number; missedWordIds: string[] } }) {
  const snap = useLearning();
  return (
    <Card>
      <SectionLabel>おつかれさまでした</SectionLabel>
      <p className="flex items-baseline gap-2">
        <span className="tabular text-5xl font-bold">{formatPct(summary.firstAttemptAccuracy)}</span>
        <span className="text-muted">初回の正答率</span>
      </p>
      <p className="text-muted">
        {summary.wordsStudied} 語・{summary.questionsAnswered} 問に解答しました。
      </p>
      {summary.missedWordIds.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-bold">間違えた単語</p>
          {summary.missedWordIds.map((id) => {
            const w = snap.wordsById.get(id);
            return w ? (
              <Link key={id} href={`/words/${id}`} className="hover:underline">
                <span className="font-bold">{w.word}</span>
                <span className="text-muted">　{w.senses[0]?.ja}</span>
              </Link>
            ) : null;
          })}
          <p className="text-xs text-muted">間違えた単語は復習間隔が短くなり、近いうちにまた出ます。</p>
        </div>
      )}
      <ButtonLink href="/">ホームに戻る</ButtonLink>
    </Card>
  );
}

function FeedbackPanel({ feedback, onNext }: { feedback: Feedback; onNext: () => void }) {
  const p = feedback.progressAfter;
  const schedule = p.repetitions === 0 ? 'もう一度、このあと出題します' : p.nextReviewAt ? `次の復習: ${formatWhen(p.nextReviewAt)}` : '';
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className={cx('flex flex-col gap-3 rounded-2xl p-4', feedback.isCorrect ? 'bg-ok-soft' : 'bg-bad-soft')} aria-live="polite">
      <p className={cx('text-lg font-bold', feedback.isCorrect ? 'text-ok' : 'text-bad')}>
        {feedback.isCorrect ? '正解' : feedback.gaveUp ? '答え' : feedback.nearMiss ? 'おしい' : '不正解'}
      </p>
      {!feedback.isCorrect && (
        <p>
          正解: <span className="font-bold">{feedback.correctAnswer}</span>
        </p>
      )}
      <WordDetails word={feedback.word} compact />
      <p className="text-sm text-muted">{schedule}</p>
      <Button ref={ref} onClick={onNext}>
        次へ
      </Button>
    </div>
  );
}

function ChoiceView(props: {
  prompt: string;
  detail: string;
  isEnglishPrompt: boolean;
  options: string[];
  answerIndex: number;
  feedback: Feedback | null;
  busy: boolean;
  onChoose: (i: number | null) => void;
  onNext: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = props.feedback !== null;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <SectionLabel>{props.isEnglishPrompt ? '意味を選んでください' : '英単語を選んでください'}</SectionLabel>
        <p className={props.isEnglishPrompt ? 'text-4xl font-bold' : 'text-2xl font-bold'}>{props.prompt}</p>
        <p className="text-sm text-muted">{props.detail}</p>
      </Card>
      {props.options.map((opt, i) => {
        const isAnswer = answered && i === props.answerIndex;
        const isWrongPick = answered && picked === i && i !== props.answerIndex;
        return (
          <button
            key={`${i}-${opt}`}
            type="button"
            disabled={answered || props.busy}
            onClick={() => {
              setPicked(i);
              props.onChoose(i);
            }}
            className={cx(
              'flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left transition',
              isAnswer ? 'border-ok bg-ok-soft' : isWrongPick ? 'border-bad bg-bad-soft' : 'border-line bg-surface enabled:hover:bg-surface-alt',
              !props.isEnglishPrompt && 'text-lg font-semibold',
            )}
          >
            <span className="hidden text-xs text-muted sm:inline">{i + 1}</span>
            {opt}
          </button>
        );
      })}
      {!answered && (
        <Button variant="ghost" onClick={() => props.onChoose(null)} disabled={props.busy}>
          わからない
        </Button>
      )}
      {props.feedback && <FeedbackPanel feedback={props.feedback} onNext={props.onNext} />}
    </div>
  );
}

function SpellingView(props: {
  prompt: string;
  detail: string;
  hint: string;
  feedback: Feedback | null;
  busy: boolean;
  onSubmit: (text: string) => void;
  onNext: () => void;
}) {
  const [text, setText] = useState('');
  const answered = props.feedback !== null;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <SectionLabel>つづりを入力してください</SectionLabel>
        <p className="text-2xl font-bold">{props.prompt}</p>
        <p className="text-sm text-muted">{props.detail}</p>
        <p className="font-mono tracking-widest text-muted">{props.hint}</p>
      </Card>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!answered && text.trim()) props.onSubmit(text);
        }}
      >
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={answered || props.busy}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          inputMode="text"
          enterKeyHint="done"
          placeholder="英単語を入力"
          aria-label="つづりの入力"
          className="min-h-14 rounded-xl border border-line bg-surface px-4 text-2xl font-bold text-ink focus:border-accent focus:outline-none"
        />
        {!answered && (
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={() => props.onSubmit('')} disabled={props.busy}>
              わからない
            </Button>
            <Button type="submit" className="flex-[2]" disabled={text.trim().length === 0} loading={props.busy}>
              答える
            </Button>
          </div>
        )}
      </form>
      {props.feedback && <FeedbackPanel feedback={props.feedback} onNext={props.onNext} />}
    </div>
  );
}
