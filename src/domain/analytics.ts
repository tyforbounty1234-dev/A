/**
 * Learning analytics computed from progress and review history. Pure.
 */
import type { Competency, QuestionType, ReviewRecord, StudySession, WordProgress } from './types';
import { COMPETENCIES } from './types';
import { isDifficult } from './srs/progress';
import { countDue, localDayKey } from './srs/queue';

export interface StatusCounts {
  studied: number;
  mastered: number;
  learning: number;
  difficult: number;
  unseen: number;
}

export function statusCounts(progress: readonly WordProgress[], totalWords: number): StatusCounts {
  const studied = progress.filter((p) => p.reviewCount > 0);
  const mastered = studied.filter((p) => p.status === 'mastered').length;
  return {
    studied: studied.length,
    mastered,
    learning: studied.length - mastered,
    difficult: studied.filter(isDifficult).length,
    unseen: Math.max(0, totalWords - studied.length),
  };
}

export interface AccuracyStat {
  attempts: number;
  correct: number;
  accuracy: number | null;
}

function acc(rs: readonly ReviewRecord[]): AccuracyStat {
  const correct = rs.filter((r) => r.isCorrect).length;
  return { attempts: rs.length, correct, accuracy: rs.length ? correct / rs.length : null };
}

export function accuracyByCompetency(reviews: readonly ReviewRecord[]): Record<Competency, AccuracyStat> {
  const out = {} as Record<Competency, AccuracyStat>;
  for (const c of COMPETENCIES) out[c] = acc(reviews.filter((r) => r.competency === c));
  return out;
}

export interface ResponseTimeStat {
  count: number;
  meanMs: number | null;
  medianMs: number | null;
  p90Ms: number | null;
}

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

export function responseTimeStats(reviews: readonly ReviewRecord[], type?: QuestionType): ResponseTimeStat {
  const times = reviews
    .filter((r) => (type ? r.questionType === type : true))
    .map((r) => r.responseTimeMs)
    .sort((a, b) => a - b);
  if (times.length === 0) return { count: 0, meanMs: null, medianMs: null, p90Ms: null };
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  return { count: times.length, meanMs: Math.round(mean), medianMs: percentile(times, 0.5), p90Ms: percentile(times, 0.9) };
}

export interface DayStat {
  day: string;
  reviews: number;
  correct: number;
  accuracy: number | null;
  newWords: number;
}

/** Per-day activity for the `days` local days ending at `now` (oldest first). */
export function dailyHistory(reviews: readonly ReviewRecord[], now: Date, days = 14): DayStat[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12);
    keys.push(localDayKey(d));
  }
  const map = new Map<string, DayStat>(
    keys.map((k) => [k, { day: k, reviews: 0, correct: 0, accuracy: null, newWords: 0 }]),
  );
  for (const r of reviews) {
    const s = map.get(localDayKey(new Date(r.reviewedAt)));
    if (!s) continue;
    s.reviews++;
    if (r.isCorrect) s.correct++;
    if (r.kind === 'new') s.newWords++;
  }
  for (const s of map.values()) s.accuracy = s.reviews ? s.correct / s.reviews : null;
  return keys.map((k) => map.get(k)!);
}

export interface WeekStat {
  /** Local date (YYYY-MM-DD) of the Monday starting the week. */
  weekStart: string;
  reviews: number;
  /** Accuracy on scheduled reviews only: the retention rate. */
  retention: number | null;
  scheduledReviews: number;
}

function mondayOf(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day, 12);
}

/** Weekly totals and retention for the `weeks` weeks ending with the week containing `now`. */
export function weeklyHistory(reviews: readonly ReviewRecord[], now: Date, weeks = 8): WeekStat[] {
  const thisMonday = mondayOf(now);
  const keys: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    keys.push(localDayKey(new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7 * i, 12)));
  }
  const buckets = new Map<string, ReviewRecord[]>(keys.map((k) => [k, []]));
  for (const r of reviews) {
    const k = localDayKey(mondayOf(new Date(r.reviewedAt)));
    buckets.get(k)?.push(r);
  }
  return keys.map((k) => {
    const rs = buckets.get(k)!;
    const scheduled = rs.filter((r) => r.kind === 'scheduled');
    const ok = scheduled.filter((r) => r.isCorrect).length;
    return {
      weekStart: k,
      reviews: rs.length,
      scheduledReviews: scheduled.length,
      retention: scheduled.length ? ok / scheduled.length : null,
    };
  });
}

/** Overall retention: share of scheduled (due) reviews answered correctly. */
export function retentionRate(reviews: readonly ReviewRecord[]): AccuracyStat {
  return acc(reviews.filter((r) => r.kind === 'scheduled'));
}

export interface WeakWord {
  wordId: string;
  score: number;
  lapses: number;
  easeFactor: number;
  recentAccuracy: number | null;
}

/** Words most at risk, highest weakness score first. */
export function weakWords(progress: readonly WordProgress[], limit = 10): WeakWord[] {
  return progress
    .filter((p) => p.reviewCount > 0)
    .map((p) => {
      const recent = p.recentResults.slice(-8);
      const recentAccuracy = recent.length ? recent.filter(Boolean).length / recent.length : null;
      const score =
        p.lapses * 1.5 + (2.5 - p.easeFactor) * 4 + (recentAccuracy === null ? 0 : (1 - recentAccuracy) * 5);
      return { wordId: p.wordId, score: Math.round(score * 100) / 100, lapses: p.lapses, easeFactor: p.easeFactor, recentAccuracy };
    })
    .filter((w) => w.score > 0.5)
    .sort((a, b) => b.score - a.score || a.wordId.localeCompare(b.wordId))
    .slice(0, limit);
}

/** Share of planned reviews completed across sessions, or null when nothing was planned. */
export function reviewCompletionRate(sessions: readonly StudySession[]): number | null {
  const planned = sessions.reduce((s, x) => s + x.plannedReviews, 0);
  if (planned === 0) return null;
  const done = sessions.reduce((s, x) => s + Math.min(x.completedReviews, x.plannedReviews), 0);
  return done / planned;
}

/** Consecutive local days with at least one review, ending today (or yesterday). */
export function studyStreak(reviews: readonly ReviewRecord[], now: Date): number {
  const days = new Set(reviews.map((r) => localDayKey(new Date(r.reviewedAt))));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (days.has(localDayKey(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

/**
 * Number of reviews falling due on each of the next `days` local days.
 * Index 0 is today and includes everything already overdue.
 */
export function reviewForecast(progress: readonly WordProgress[], now: Date, days = 7): number[] {
  const out = new Array<number>(days).fill(0);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const p of progress) {
    if (p.status === 'new' || !p.nextReviewAt) continue;
    const t = Date.parse(p.nextReviewAt);
    const dayIndex = t < startOfToday ? 0 : localDayIndex(startOfToday, t);
    if (dayIndex < days) out[dayIndex]!++;
  }
  return out;
}

function localDayIndex(startOfToday: number, t: number): number {
  const s = new Date(startOfToday);
  const d = new Date(t);
  const a = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/** Earliest upcoming review time, or null. */
export function nextReviewTime(progress: readonly WordProgress[]): string | null {
  let best: string | null = null;
  for (const p of progress) {
    if (p.status === 'new' || !p.nextReviewAt) continue;
    if (best === null || p.nextReviewAt < best) best = p.nextReviewAt;
  }
  return best;
}

export interface DashboardSummary {
  dueNow: number;
  reviewedToday: number;
  newToday: number;
  accuracyToday: number | null;
  streak: number;
  counts: StatusCounts;
}

export function dashboardSummary(
  progress: readonly WordProgress[],
  reviews: readonly ReviewRecord[],
  totalWords: number,
  now: Date,
): DashboardSummary {
  const today = localDayKey(now);
  const todays = reviews.filter((r) => localDayKey(new Date(r.reviewedAt)) === today);
  const correct = todays.filter((r) => r.isCorrect).length;
  return {
    dueNow: countDue(progress, now),
    reviewedToday: todays.length,
    newToday: progress.filter((p) => p.firstReviewedAt && localDayKey(new Date(p.firstReviewedAt)) === today).length,
    accuracyToday: todays.length ? correct / todays.length : null,
    streak: studyStreak(reviews, now),
    counts: statusCounts(progress, totalWords),
  };
}
