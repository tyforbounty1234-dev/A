import { useColorScheme } from 'react-native';

/**
 * Visual system: calm ink-blue on cool paper, one accent, semantic colours for
 * correct / wrong / due. Large type for the word being studied, compact UI chrome.
 */
const light = {
  bg: '#F3F5F9',
  surface: '#FFFFFF',
  surfaceAlt: '#E9EDF5',
  ink: '#151C2B',
  muted: '#5D677A',
  line: '#D6DCE7',
  accent: '#2A4A93',
  accentInk: '#FFFFFF',
  accentSoft: '#E1E8F7',
  ok: '#1E7A4C',
  okSoft: '#E0F2E8',
  bad: '#B42841',
  badSoft: '#F8E2E6',
  warn: '#9A5B00',
  warnSoft: '#FBEFD9',
};

const dark: typeof light = {
  bg: '#0F131B',
  surface: '#181E29',
  surfaceAlt: '#212938',
  ink: '#E8ECF3',
  muted: '#9BA5B8',
  line: '#2B3444',
  accent: '#8FA9EA',
  accentInk: '#0F131B',
  accentSoft: '#222C43',
  ok: '#5DCB90',
  okSoft: '#17301F',
  bad: '#F2829A',
  badSoft: '#3A1B23',
  warn: '#F0B35C',
  warnSoft: '#3A2C14',
};

export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16 } as const;

export const type = {
  display: { fontSize: 40, fontWeight: '700' as const, letterSpacing: 0.2 },
  title: { fontSize: 24, fontWeight: '700' as const },
  heading: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 24 },
  small: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.6 },
  stat: { fontSize: 30, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
};
