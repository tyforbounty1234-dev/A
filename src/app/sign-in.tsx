import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { authErrorMessage, useAuth } from '../state/AuthProvider';
import { Button, Card, Screen, T } from '../ui/components';
import { radius, space, usePalette } from '../ui/theme';

export default function SignIn() {
  const { signIn, signUp } = useAuth();
  const c = usePalette();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'bad' | 'ok' } | null>(null);

  const valid = /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 6;

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'signIn') await signIn(email, password);
      else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setMessage({ tone: 'ok', text: '確認メールを送りました。メールのリンクを開いてからログインしてください。' });
          setMode('signIn');
        }
      }
    } catch (e) {
      setMessage({ tone: 'bad', text: authErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const input = [styles.input, { borderColor: c.line, color: c.ink, backgroundColor: c.surface }];
  return (
    <Screen>
      <View style={{ gap: space.xs, marginTop: space.xxl }}>
        <T variant="display">LexiCore</T>
        <T color={c.muted}>難関大入試のための英単語。忘れる直前に、もう一度。</T>
      </View>
      <Card>
        <T variant="heading">{mode === 'signIn' ? 'ログイン' : 'アカウント作成'}</T>
        <TextInput
          style={input}
          placeholder="メールアドレス"
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          accessibilityLabel="メールアドレス"
        />
        <TextInput
          style={input}
          placeholder="パスワード（6文字以上）"
          placeholderTextColor={c.muted}
          secureTextEntry
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => valid && submit()}
          accessibilityLabel="パスワード"
        />
        {message && <T color={message.tone === 'bad' ? c.bad : c.ok}>{message.text}</T>}
        <Button label={mode === 'signIn' ? 'ログイン' : '登録する'} onPress={submit} disabled={!valid} loading={busy} />
        <Button
          variant="ghost"
          label={mode === 'signIn' ? 'はじめての方はこちら（アカウント作成）' : 'アカウントをお持ちの方はログイン'}
          onPress={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
            setMessage(null);
          }}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, fontSize: 16 },
});
