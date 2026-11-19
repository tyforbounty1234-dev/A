import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../state/AuthProvider';
import { LearningProvider } from '../state/LearningProvider';
import { TutorProvider } from '../state/TutorProvider';
import { Loading } from '../ui/components';
import { usePalette } from '../ui/theme';

function RootNavigator() {
  const { loading, userId } = useAuth();
  const c = usePalette();
  if (loading) return <Loading />;
  const signedIn = userId !== null;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.accent,
        headerTitleStyle: { color: c.ink },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="session" options={{ title: '', headerBackTitle: '中断', gestureEnabled: false }} />
        <Stack.Screen name="word/[id]" options={{ title: '' }} />
        <Stack.Screen name="settings" options={{ title: '学習設定', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <LearningProvider>
          <TutorProvider>
            <StatusBar style="auto" />
            <RootNavigator />
          </TutorProvider>
        </LearningProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
