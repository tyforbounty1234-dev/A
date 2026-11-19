import { useLearning } from '../state/LearningProvider';
import { Pill } from './components';

/** Shows whether learning data is safely on the server. */
export function SyncBadge() {
  const { sync, pendingCount, failedCount } = useLearning();
  if (sync === 'local') return <Pill label="端末のみに保存" tone="neutral" />;
  if (failedCount > 0) return <Pill label={`同期エラー ${failedCount}件`} tone="bad" />;
  if (sync === 'syncing') return <Pill label="同期中…" tone="accent" />;
  if (pendingCount > 0 || sync === 'offline') return <Pill label={`オフライン・未送信 ${pendingCount}件`} tone="warn" />;
  if (sync === 'error') return <Pill label="同期できません" tone="bad" />;
  return <Pill label="同期済み" tone="ok" />;
}
