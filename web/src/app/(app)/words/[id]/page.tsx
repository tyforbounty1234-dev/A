'use client';
import { useParams } from 'next/navigation';
import { ButtonLink, Card, Loading, SectionLabel, Stat } from '@/components/ui';
import { WordDetails } from '@/components/WordDetails';
import type { Competency } from '@/lexicore/domain/types';
import { WEAK_REASON_LABELS, detectWeakness } from '@/lexicore/domain/weakness';
import { formatPct, formatWhen } from '@/lib/format';
import { useLearning } from '@/lib/learning';

const LABELS: Partial<Record<Competency, string>> = { recognition: '認識（英→日）', recall: '想起（日→英）', spelling: 'つづり' };
const days = (d: number) => (d >= 1 ? `${Math.round(d)}日` : '1日未満');

export default function WordPage() {
  const { id } = useParams<{ id: string }>();
  const snap = useLearning();
  if (!snap.ready) return <Loading />;
  const word = snap.wordsById.get(id);
  if (!word) return <p className="text-muted">この単語は見つかりませんでした。</p>;
  const p = snap.progress.get(word.id);
  const seen = !!p && p.reviewCount > 0;
  const weakness = p ? detectWeakness(p, snap.adaptive.thresholds) : null;

  return (
    <>
      <Card>
        <WordDetails word={word} />
        <ButtonLink href={`/tutor?wordId=${word.id}`} variant="secondary">
          AI講師に聞く
        </ButtonLink>
      </Card>
      <Card>
        <SectionLabel>あなたの記録</SectionLabel>
        {!seen || !p ? (
          <p className="text-muted">まだ学習していません。</p>
        ) : (
          <>
            <div className="flex gap-3">
              <Stat value={p.reviewCount} label="解答回数" />
              <Stat value={formatPct(p.correctCount / p.reviewCount)} label="正答率" />
              <Stat value={p.lapses} label="忘れた回数" />
            </div>
            <p className="text-sm text-muted">
              {p.nextReviewAt ? `次の復習: ${formatWhen(p.nextReviewAt)}　` : ''}復習間隔 {days(p.intervalDays)}　覚えやすさ {p.easeFactor.toFixed(2)}
            </p>
            {weakness && weakness.reasons.length > 0 && <p className="text-sm text-bad">{weakness.reasons.map((r) => WEAK_REASON_LABELS[r]).join('・')}</p>}
            <ul className="flex flex-col gap-2">
              {(Object.keys(LABELS) as Competency[]).map((k) => {
                const s = p.competencyScores[k];
                return (
                  <li key={k} className="flex justify-between gap-3 text-sm">
                    <span>{LABELS[k]}</span>
                    <span className={s ? 'text-right' : 'text-right text-muted'}>
                      {s ? `${s.correct}/${s.attempts} 正解・熟達度 ${Math.round(s.proficiency * 100)}` : '未テスト'}
                      {s?.srs?.nextReviewAt && (
                        <span className="block text-muted">
                          次: {formatWhen(s.srs.nextReviewAt)}（間隔 {days(s.srs.intervalDays)}）
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}
