import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LexiCore',
    short_name: 'LexiCore',
    description: '京大・東大レベルの英単語学習',
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f5f9',
    theme_color: '#2a4a93',
    lang: 'ja',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
