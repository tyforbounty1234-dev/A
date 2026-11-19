/**
 * Reusable presentational components. No business logic here.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, space, type, usePalette } from './theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const c = usePalette();
  const body = <View style={styles.screenInner}>{children}</View>;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.flex, { backgroundColor: c.bg }]}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.scroll]}>{body}</View>
      )}
    </SafeAreaView>
  );
}

type TextVariant = keyof typeof type;
export function T({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const c = usePalette();
  return (
    <Text numberOfLines={numberOfLines} style={[type[variant], { color: color ?? c.ink }, style]}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
}) {
  const c = usePalette();
  const bg = variant === 'primary' ? c.accent : variant === 'secondary' ? c.accentSoft : 'transparent';
  const fg = variant === 'primary' ? c.accentInk : c.accent;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.8 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: c.line },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Stat({ value, label, tone }: { value: string | number; label: string; tone?: 'ok' | 'bad' | 'warn' | 'accent' }) {
  const c = usePalette();
  const color = tone === 'ok' ? c.ok : tone === 'bad' ? c.bad : tone === 'warn' ? c.warn : tone === 'accent' ? c.accent : c.ink;
  return (
    <View style={styles.stat}>
      <T variant="stat" color={color}>
        {value}
      </T>
      <T variant="small" color={c.muted}>
        {label}
      </T>
    </View>
  );
}

export function Row({ children, gap = space.md, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, { gap }, style]}>{children}</View>;
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'ok' | 'bad' | 'warn' | 'accent' }) {
  const c = usePalette();
  const map = {
    neutral: [c.surfaceAlt, c.muted],
    ok: [c.okSoft, c.ok],
    bad: [c.badSoft, c.bad],
    warn: [c.warnSoft, c.warn],
    accent: [c.accentSoft, c.accent],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[type.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const c = usePalette();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={[styles.bar, { backgroundColor: c.line }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color ?? c.accent, borderRadius: 3 }} />
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const c = usePalette();
  return (
    <T variant="label" color={c.muted} style={{ textTransform: 'uppercase' }}>
      {children}
    </T>
  );
}

export function Loading() {
  const c = usePalette();
  return (
    <View style={[styles.flex, styles.center, { backgroundColor: c.bg }]}>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}

export function formatPct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

export function formatSeconds(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}秒`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: space.lg, paddingVertical: space.lg },
  screenInner: { gap: space.lg, width: '100%', maxWidth: 640, alignSelf: 'center' },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.md },
  button: { minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  buttonText: { fontSize: 16, fontWeight: '700' },
  stat: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  pill: { alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: 999 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden', width: '100%' },
});
