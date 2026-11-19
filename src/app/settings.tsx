import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DEFAULT_PROFILE } from '../domain/types';
import { useAuth } from '../state/AuthProvider';
import { useLearning, useLearningStore } from '../state/LearningProvider';
import { Button, Card, Loading, Row, Screen, SectionLabel, T } from '../ui/components';
import { radius, space, usePalette } from '../ui/theme';

/** Bounds match the database CHECK constraints on public.profiles. */
const FIELDS = [
  { key: 'dailyNewWords', label: '1日の新しい単語', unit: '語', min: 0, max: 100, step: 5 },
  { key: 'dailyReviewLimit', label: '1回の復習の上限', unit: '語', min: 10, max: 1000, step: 10 },
  { key: 'dailyTargetMinutes', label: '1日の学習時間の目安', unit: '分', min: 5, max: 240, step: 5 },
] as const;
type FieldKey = (typeof FIELDS)[number]['key'];

export default function Settings() {
  const c = usePalette();
  const auth = useAuth();
  const snap = useLearning();
  const store = useLearningStore();
  const [values, setValues] = useState<Record<FieldKey, number> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (snap.profile && !values) {
      const p = snap.profile;
      setValues({ dailyNewWords: p.dailyNewWords, dailyReviewLimit: p.dailyReviewLimit, dailyTargetMinutes: p.dailyTargetMinutes });
    }
  }, [snap.profile, values]);

  if (!snap.ready || !values) return <Loading />;

  async function save() {
    if (!values) return;
    setSaving(true);
    setError(null);
    try {
      await store.updateProfile(values);
      router.back();
    } catch {
      setError('保存できませんでした。インターネット接続を確認してください。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Card>
        <SectionLabel>1日の目標</SectionLabel>
        {FIELDS.map((f) => (
          <Row key={f.key} style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <T style={{ flex: 1 }}>{f.label}</T>
            <Stepper
              value={values[f.key]}
              unit={f.unit}
              onChange={(v) => setValues({ ...values, [f.key]: Math.min(f.max, Math.max(f.min, v)) })}
              step={f.step}
              min={f.min}
              max={f.max}
              label={f.label}
            />
          </Row>
        ))}
        <T variant="small" color={c.muted}>
          おすすめは1日20分（新しい単語{DEFAULT_PROFILE.dailyNewWords}語＋復習）。新しい単語を増やすと、数日後の復習も増えます。
        </T>
        {error && <T color={c.bad}>{error}</T>}
        <Button label="保存" onPress={save} loading={saving} />
      </Card>

      <Card>
        <SectionLabel>アカウント</SectionLabel>
        {auth.cloud ? (
          <>
            <T>{auth.email}</T>
            <Button variant="ghost" label="ログアウト" onPress={() => void auth.signOut()} />
          </>
        ) : (
          <T color={c.muted}>
            ローカルモードで動いています。記録はこの端末だけに保存されます。Supabase を設定するとアカウントで同期できます（README 参照）。
          </T>
        )}
        {snap.failedCount > 0 && (
          <>
            <T color={c.bad}>送信できなかった記録が {snap.failedCount} 件あります。</T>
            <Button variant="secondary" label="もう一度送信する" onPress={() => void store.retryFailed()} />
          </>
        )}
      </Card>
    </Screen>
  );
}

function Stepper(props: { value: number; unit: string; step: number; min: number; max: number; label: string; onChange: (v: number) => void }) {
  const c = usePalette();
  const btn = (delta: number, symbol: string, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}を${delta > 0 ? '増やす' : '減らす'}`}
      disabled={disabled}
      onPress={() => props.onChange(props.value + delta)}
      style={[styles.stepBtn, { borderColor: c.line, opacity: disabled ? 0.4 : 1 }]}
    >
      <T variant="heading" color={c.accent}>
        {symbol}
      </T>
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {btn(-props.step, '−', props.value <= props.min)}
      <T variant="heading" style={{ minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
        {props.value}
        {props.unit}
      </T>
      {btn(props.step, '+', props.value >= props.max)}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  stepBtn: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
