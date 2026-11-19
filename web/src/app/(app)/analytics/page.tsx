'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { Card, Loading, PageTitle, SectionLabel, Stat } from '@/components/ui';
import { MIN_RETENTION_SAMPLES, MIN_TIMING_SAMPLES, TARGET_RETENTION } from '@/lexicore/domain/adaptive';
import {
  accuracyByCompetency,
  dailyHistory,
  dueByCompetency,
  responseTimeStats,
  retentionRate,
  reviewCompletionRate,
  reviewForecast,
  statusCounts,
  weakWords,
  weeklyHistory,
} from '@/lexicore/domain/analytics';
import type { Competency, QuestionType } from '@/lexicore/domain/types';
import { WEAK_REASON_LABELS } from '@/lexicore/domain/weakness';
import { formatPct, formatSeconds } from '@/lib/format';
import { useLearning } from '@/lib/learning';

const COMPETENCY_LABELS: Partial<Record<Competency, string>> = { recognition: '認識（英→日）', recall: '想起（日→英）', spelling: 'つづり' };
const QT_LABELS: Partial<Record<QuestionType, string>> = { en_to_ja_mc: '英→日 選択', ja_to_en_mc: '日→英 選択', spelling: 'つづり入力' };
const QTS: QuestionType[] = ['en_to_ja_mc', 'ja_to_en_mc', 'spelling'];

export default function Analytics() {
  const snap = useLearning();
  const data = useMemo(() => {
    const now = new Date();
    const progress = [...snap.progress.values()];
    return {
      counts: statusCounts(progress, snap.words.length, snap.adaptive.thresholds),
      dueByComp: dueByCompetency(progress, now),
      competency: accuracyByCompetency(snap.reviews),
      rt: QTS.map((t) => [t, responseTimeStats(snap.reviews, t)] as const),
      daily: dailyHistory(snap.reviews, now, 14),
      weekly: weeklyHistory(snap.reviews, now, 8),
      forecast: reviewForecast(progress, now, 7),
      retention: retentionRate(snap.reviews),
      completion: reviewCompletionRate(snap.sessions),
      weak: weakWords(progress, 10, snap.adaptive.thresholds),
    };
  }, [snap.progress, snap.reviews, snap.sessions, snap.words.length, snap.adaptive.thresholds]);
  if (!snap.ready) return <Loading />;
  const ad = snap.adaptive;
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.reviews));
  const maxForecast = Math.max(1, ...data.forecast);

  return (
    <>
      <PageTitle>学習分析</PageTitle>
      <Card>
        <SectionLabel>語彙</SectionLabel>
        <div className="flex gap-3">
          <Stat value={data.counts.studied} label="学習済み" />
          <Stat value={data.counts.mastered} label="定着" tone="ok" />
          <Stat value={data.counts.learning} label="学習中" tone="accent" />
          <Stat value={data.counts.difficult} label="苦手" tone="bad" />
        </div>
      </Card>

      <Card>
        <SectionLabel>記憶の保持</SectionLabel>
        <div className="flex gap-3">
          <Stat value={formatPct(data.retention.accuracy)} label={`保持率（予定どおりの復習 ${data.retention.attempts}回）`} />
          <Stat value={formatPct(data.completion)} label="復習の完了率" />
        </div>
        <p className="text-xs text-muted">保持率は、復習日が来た単語を正しく思い出せた割合です。長期記憶の一番の目安になります。</p>
        <p className="text-xs text-muted">週ごとの保持率</p>
        <div className="flex h-16 items-end gap-1">
          {data.weekly.map((w) => (
            <div key={w.weekStart} className="flex h-full flex-1 items-end" title={`${w.weekStart}の週 ${formatPct(w.retention)}`}>
              <div className={w.retention === null ? 'h-0.5 w-full rounded bg-line' : 'w-full rounded bg-ok'} style={w.retention === null ? undefined : { height: `${Math.max(w.retention * 100, 3)}%` }} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionLabel>あなたに合わせた調整</SectionLabel>
        <div className="flex items-center justify-between">
          <span>復習間隔の補正</span>
          <span className="tabular text-lg font-bold">×{ad.intervalModifier.toFixed(2)}</span>
        </div>
        <p className="text-xs text-muted">
          {ad.retentionSamples < MIN_RETENTION_SAMPLES
            ? `データを集めています（予定どおりの復習 ${ad.retentionSamples} / ${MIN_RETENTION_SAMPLES} 回）。それまでは標準の間隔です。`
            : ad.intervalModifier > 1
              ? `よく覚えられているので、復習の間隔を長めにしています（目標の保持率 ${Math.round(TARGET_RETENTION * 100)}%）。`
              : ad.intervalModifier < 1
                ? `忘れやすい傾向があるので、復習の間隔を短めにしています（目標の保持率 ${Math.round(TARGET_RETENTION * 100)}%）。`
                : `保持率が目標の ${Math.round(TARGET_RETENTION * 100)}% 前後なので、標準の間隔です。`}
        </p>
        {QTS.map((t) => {
          const [fast, slow] = ad.thresholds[t];
          return (
            <div key={t} className="flex justify-between gap-2 text-sm">
              <span>{QT_LABELS[t]}のスピード</span>
              <span className={ad.personalTiming[t] ? 'tabular' : 'text-muted'}>
                {ad.personalTiming[t] ? `速い ${formatSeconds(fast)}以内・迷い ${formatSeconds(slow)}以上` : `標準（正解 ${MIN_TIMING_SAMPLES} 回で個人化）`}
              </span>
            </div>
          );
        })}
      </Card>

      <Card>
        <SectionLabel>能力別の正答率</SectionLabel>
        {(Object.keys(COMPETENCY_LABELS) as Competency[]).map((k) => (
          <div key={k} className="flex items-baseline justify-between">
            <span>{COMPETENCY_LABELS[k]}</span>
            <span>
              <span className="tabular text-lg font-bold">{formatPct(data.competency[k].accuracy)}</span>
              <span className="text-xs text-muted">
                {'  '}
                {data.competency[k].attempts}問・復習待ち {data.dueByComp[k] ?? 0}
              </span>
            </span>
          </div>
        ))}
      </Card>

      <Card>
        <SectionLabel>解答時間（中央値 / 遅いほうの10%）</SectionLabel>
        {data.rt.map(([t, s]) => (
          <div key={t} className="flex justify-between text-sm">
            <span>{QT_LABELS[t]}</span>
            <span className="tabular">
              {formatSeconds(s.medianMs)} / {formatSeconds(s.p90Ms)}
            </span>
          </div>
        ))}
      </Card>

      <Card>
        <SectionLabel>直近14日の解答数</SectionLabel>
        <div className="flex h-24 items-end gap-1" aria-label={`直近14日の解答数: ${data.daily.map((d) => d.reviews).join('、')}`}>
          {data.daily.map((d) => (
            <div key={d.day} className="flex h-full flex-1 items-end" title={`${d.day}: ${d.reviews}問`}>
              <div className="w-full rounded bg-accent" style={{ height: `${(d.reviews / maxDaily) * 100}%`, minHeight: d.reviews > 0 ? 3 : 0 }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted">
          <span>{data.daily[0]?.day.slice(5).replace('-', '/')}</span>
          <span>今日</span>
        </div>
      </Card>

      <Card>
        <SectionLabel>これから7日間の復習予定</SectionLabel>
        <div className="flex h-20 items-end gap-2">
          {data.forecast.map((n, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="tabular text-xs text-muted">{n}</span>
              <div className="w-full rounded bg-accent-soft" style={{ height: `${(n / maxForecast) * 70}%`, minHeight: n > 0 ? 3 : 0 }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted">
          <span>今日</span>
          <span>6日後</span>
        </div>
      </Card>

      <Card>
        <SectionLabel>苦手な単語</SectionLabel>
        {data.weak.length === 0 ? (
          <p className="text-muted">まだありません。間違いが重なった単語がここに表示されます。</p>
        ) : (
          data.weak.map((w) => {
            const word = snap.wordsById.get(w.wordId);
            if (!word) return null;
            return (
              <Link key={w.wordId} href={`/words/${w.wordId}`} className="flex flex-col gap-0.5 hover:opacity-80">
                <span className="flex justify-between gap-2">
                  <span className="font-bold">{word.word}</span>
                  <span className="text-xs text-muted">
                    忘れた回数 {w.lapses}・直近正答率 {formatPct(w.recentAccuracy)}
                  </span>
                </span>
                <span className="text-xs text-bad">
                  {w.reasons.map((r) => WEAK_REASON_LABELS[r]).join('・')}
                  {w.weakestCompetency ? `（弱い力: ${COMPETENCY_LABELS[w.weakestCompetency] ?? w.weakestCompetency}）` : ''}
                </span>
              </Link>
            );
          })
        )}
      </Card>
    </>
  );
}
