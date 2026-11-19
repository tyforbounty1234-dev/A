import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'LexiCore', template: '%s | LexiCore' },
  description: '京大・東大レベルの英単語を、忘れる前に復習する単語学習アプリ。',
  applicationName: 'LexiCore',
  appleWebApp: { capable: true, title: 'LexiCore', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f5f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0f131b' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
