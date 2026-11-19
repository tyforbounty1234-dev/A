export function formatPct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

export function formatSeconds(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}秒`;
}

/** Short relative time in Japanese ("3分前", "明日 9:00"). */
export function formatWhen(iso: string, now = new Date()): string {
  const t = new Date(iso);
  const diff = t.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const hm = t.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (diff <= 0) {
    if (abs < 60_000) return 'たった今';
    if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}分前`;
    if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}時間前`;
    if (abs < 7 * 86_400_000) return `${Math.floor(abs / 86_400_000)}日前`;
    return t.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  }
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(t) - day(now)) / 86_400_000);
  if (days === 0) return `今日 ${hm}`;
  if (days === 1) return `明日 ${hm}`;
  if (days < 7) return `${days}日後`;
  return t.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}
