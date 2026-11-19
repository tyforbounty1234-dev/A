import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-2xl border border-line bg-surface p-4 flex flex-col gap-3', className)}>{children}</section>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-wider text-muted">{children}</h2>;
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'bg-accent-soft text-accent hover:opacity-90',
  ghost: 'border border-line text-accent hover:bg-surface-alt',
  danger: 'border border-bad/40 text-bad hover:bg-bad-soft',
};
const BUTTON = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition disabled:opacity-50';

export function Button({
  variant = 'primary',
  className,
  loading,
  children,
  ...rest
}: ComponentProps<'button'> & { variant?: Variant; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={cx(BUTTON, VARIANT[variant], className)}>
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = 'primary', className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...rest} className={cx(BUTTON, VARIANT[variant], className)} />;
}

export function Stat({ value, label, tone }: { value: ReactNode; label: string; tone?: 'ok' | 'bad' | 'accent' | 'gold' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-accent' : tone === 'gold' ? 'text-gold' : 'text-ink';
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <span className={cx('tabular text-2xl font-bold', color)}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'bad' | 'warn' | 'accent' | 'gold' }) {
  const cls = {
    neutral: 'bg-surface-alt text-muted',
    ok: 'bg-ok-soft text-ok',
    bad: 'bg-bad-soft text-bad',
    warn: 'bg-warn-soft text-warn',
    accent: 'bg-accent-soft text-accent',
    gold: 'bg-warn-soft text-gold',
  }[tone];
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', cls)}>{children}</span>;
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'ok' }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-alt" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-all', tone === 'ok' ? 'bg-ok' : 'bg-accent')} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-4 w-4' : 'h-6 w-6')}
      role="status"
      aria-label="読み込み中"
    />
  );
}

export function Loading({ label = '読み込み中…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-accent">
      <Spinner />
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

export function Notice({ tone = 'bad', children }: { tone?: 'bad' | 'warn' | 'ok' | 'accent'; children: ReactNode }) {
  const cls = { bad: 'bg-bad-soft text-bad', warn: 'bg-warn-soft text-warn', ok: 'bg-ok-soft text-ok', accent: 'bg-accent-soft text-accent' }[tone];
  return (
    <div className={cx('rounded-xl px-3 py-2 text-sm', cls)} role={tone === 'bad' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function PageTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{children}</h1>
      {right}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-accent focus:outline-none';

export function Chip({ active, disabled, onClick, children }: { active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={!!active}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-40',
        active ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-line bg-surface text-ink hover:bg-surface-alt',
      )}
    >
      {children}
    </button>
  );
}
