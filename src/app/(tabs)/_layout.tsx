import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/tabs';
import type { ComponentProps } from 'react';
import { useLearning } from '../../state/LearningProvider';
import { countDue } from '../../domain/srs/queue';
import { usePalette } from '../../ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icon =
  (name: IconName) =>
  ({ color, size }: { color: string | import('react-native').ColorValue; size: number }) => (
    <Ionicons name={name} size={size} color={color as string} />
  );

export default function TabLayout() {
  const c = usePalette();
  const snap = useLearning();
  const due = snap.ready ? countDue(snap.progress.values(), new Date()) : 0;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'ホーム', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="learn" options={{ title: '学習', tabBarIcon: icon('add-circle-outline') }} />
      <Tabs.Screen
        name="review"
        options={{ title: '復習', tabBarIcon: icon('refresh'), tabBarBadge: due > 0 ? (due > 99 ? '99+' : due) : undefined }}
      />
      <Tabs.Screen name="analytics" options={{ title: '分析', tabBarIcon: icon('stats-chart-outline') }} />
      <Tabs.Screen name="tutor" options={{ title: 'AI講師', tabBarIcon: icon('chatbubble-ellipses-outline') }} />
      <Tabs.Screen name="library" options={{ title: '単語帳', tabBarIcon: icon('book-outline') }} />
    </Tabs>
  );
}
