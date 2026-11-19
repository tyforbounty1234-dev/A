/**
 * Local-mode stand-in for the social tables: one player's profile, LP and
 * emote collection, kept in this browser. Same rules as the server: 1 LP the
 * first time a word is mastered, emotes bought once and kept.
 */
import type { ShopItem } from './social';

/** Same catalogue as the database seed (supabase/migrations/*_social.sql). */
export const LOCAL_SHOP: ShopItem[] = [
  { id: 'clap', name: 'はくしゅ', emoji: '👏', price: 0 },
  { id: 'thumbs', name: 'いいね', emoji: '👍', price: 0 },
  { id: 'fire', name: '燃えてる', emoji: '🔥', price: 3 },
  { id: 'muscle', name: 'がんばれ', emoji: '💪', price: 3 },
  { id: 'party', name: 'おめでとう', emoji: '🎉', price: 5 },
  { id: 'heart', name: 'ハート', emoji: '💖', price: 5 },
  { id: 'brain', name: '天才', emoji: '🧠', price: 8 },
  { id: 'rocket', name: 'ロケット', emoji: '🚀', price: 10 },
  { id: 'sakura', name: '合格祈願', emoji: '🌸', price: 12 },
  { id: 'trophy', name: 'トロフィー', emoji: '🏆', price: 15 },
  { id: 'crown', name: '王冠', emoji: '👑', price: 30 },
];

export interface LocalSocialState {
  displayName: string;
  avatar: string;
  bio: string;
  /** Word ids that have earned their (one) LP. */
  awarded: string[];
  spent: number;
  owned: string[];
}

const KEY = 'lexicore:local:social:v1';
const DEFAULT: LocalSocialState = { displayName: 'あなた', avatar: '🙂', bio: '', awarded: [], spent: 0, owned: [] };

let state: LocalSocialState | null = null;
const listeners = new Set<() => void>();

function read(): LocalSocialState {
  if (state) return state;
  try {
    const raw = window.localStorage.getItem(KEY);
    state = raw ? { ...DEFAULT, ...(JSON.parse(raw) as Partial<LocalSocialState>) } : { ...DEFAULT };
  } catch {
    state = { ...DEFAULT };
  }
  return state;
}

function write(next: LocalSocialState) {
  state = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode): keep it in memory for this visit.
  }
  listeners.forEach((l) => l());
}

export const localSocial = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: read,
  balance(s = read()) {
    return s.awarded.length - s.spent;
  },
  /** Award 1 LP for each newly mastered word. Returns how many were new. */
  awardMastered(masteredWordIds: Iterable<string>): number {
    const s = read();
    const have = new Set(s.awarded);
    const fresh = [...masteredWordIds].filter((id) => !have.has(id));
    if (fresh.length) write({ ...s, awarded: [...s.awarded, ...fresh] });
    return fresh.length;
  },
  owns(itemId: string, s = read()) {
    return LOCAL_SHOP.some((i) => i.id === itemId && i.price === 0) || s.owned.includes(itemId);
  },
  /** Returns 'ok' or the same error codes as the server. */
  purchase(itemId: string): 'ok' | 'not_found' | 'already_owned' | 'insufficient_lp' {
    const s = read();
    const item = LOCAL_SHOP.find((i) => i.id === itemId);
    if (!item) return 'not_found';
    if (localSocial.owns(itemId, s)) return 'already_owned';
    if (localSocial.balance(s) < item.price) return 'insufficient_lp';
    write({ ...s, spent: s.spent + item.price, owned: [...s.owned, itemId] });
    return 'ok';
  },
  updateProfile(patch: Partial<Pick<LocalSocialState, 'displayName' | 'avatar' | 'bio'>>) {
    write({ ...read(), ...patch });
  },
};
