'use client';
import { createRoot } from 'react-dom/client';
import type { ComponentType, ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import AppLayout from '@/app/(app)/layout';
import AuthLayout from '@/app/(auth)/layout';
import Home from '@/app/(app)/page';
import Study from '@/app/(app)/study/page';
import Session from '@/app/(app)/session/page';
import Words from '@/app/(app)/words/page';
import WordPage from '@/app/(app)/words/[id]/page';
import Analytics from '@/app/(app)/analytics/page';
import Tutor from '@/app/(app)/tutor/page';
import Ranking from '@/app/(app)/ranking/page';
import Shop from '@/app/(app)/shop/page';
import Notifications from '@/app/(app)/notifications/page';
import Me from '@/app/(app)/me/page';
import Member from '@/app/(app)/members/[id]/page';
import Login from '@/app/(auth)/login/page';
import Join from '@/app/(auth)/join/page';
import { RouterProvider, useHashLocation } from './router';
import '@/app/globals.css';

type Layout = ComponentType<{ children: ReactNode }>;
const ROUTES: { pattern: string; page: ComponentType; layout: Layout }[] = [
  { pattern: '/', page: Home, layout: AppLayout },
  { pattern: '/study', page: Study, layout: AppLayout },
  { pattern: '/session', page: Session, layout: AppLayout },
  { pattern: '/words', page: Words, layout: AppLayout },
  { pattern: '/words/:id', page: WordPage, layout: AppLayout },
  { pattern: '/analytics', page: Analytics, layout: AppLayout },
  { pattern: '/tutor', page: Tutor, layout: AppLayout },
  { pattern: '/ranking', page: Ranking, layout: AppLayout },
  { pattern: '/shop', page: Shop, layout: AppLayout },
  { pattern: '/notifications', page: Notifications, layout: AppLayout },
  { pattern: '/me', page: Me, layout: AppLayout },
  { pattern: '/members/:id', page: Member, layout: AppLayout },
  { pattern: '/login', page: Login, layout: AuthLayout },
  { pattern: '/join', page: Join, layout: AuthLayout },
];

function match(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  for (const r of ROUTES) {
    const pp = r.pattern.split('/').filter(Boolean);
    if (pp.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (pp.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(parts[i]!)), true) : p === parts[i]))) return { route: r, params };
  }
  return { route: ROUTES[0]!, params: {} };
}

function App() {
  const loc = useHashLocation();
  const { route, params } = match(loc.pathname);
  const Page = route.page;
  const L = route.layout;
  return (
    <RouterProvider value={{ ...loc, params }}>
      <Providers>
        <L>
          <Page key={loc.pathname} />
        </L>
      </Providers>
    </RouterProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
