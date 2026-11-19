/** Human-friendly Japanese date for an upcoming review. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `今日 ${time}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `明日 ${time}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
