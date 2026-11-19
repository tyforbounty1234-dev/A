/**
 * Social features API: members, leaderboard, shop, reactions, notifications and
 * invite codes. Every write goes through a database function that checks the
 * rules (LP balance, ownership, rate limits); see supabase/migrations/*_social.sql.
 */
import { getSupabase } from './supabase';

export interface Member {
  id: string;
  displayName: string;
  avatar: string;
  bio: string;
  lpBalance: number;
  lpEarned: number;
  masteredCount: number;
  createdAt: string;
}

export interface LeaderboardRow {
  memberId: string;
  displayName: string;
  avatar: string;
  lp: number;
  mastered: number;
  rank: number;
}

export interface ShopItem {
  id: string;
  name: string;
  emoji: string;
  price: number;
}

export type NotificationKind = 'reaction' | 'lp_earned' | 'member_joined' | 'welcome';

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface InviteCode {
  code: string;
  uses: number;
  maxUses: number;
  expiresAt: string | null;
}

export type SocialErrorCode = 'insufficient_lp' | 'already_owned' | 'not_owned' | 'rate_limited' | 'self' | 'invite_limit' | 'not_found' | 'network' | 'unknown';

export class SocialError extends Error {
  constructor(
    readonly code: SocialErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SocialError';
  }
}

export const SOCIAL_ERROR_MESSAGES: Record<SocialErrorCode, string> = {
  insufficient_lp: 'LPが足りません。単語を定着させるとLPがもらえます。',
  already_owned: 'このアイテムはもう持っています。',
  not_owned: 'このエモートはまだ持っていません。ショップで手に入れましょう。',
  rate_limited: '送りすぎです。少し時間をおいてから送ってください。',
  self: '自分には送れません。',
  invite_limit: '有効な招待コードはこれ以上作れません。',
  not_found: '見つかりませんでした。',
  network: 'サーバーに接続できません。インターネット接続を確認してください。',
  unknown: 'エラーが発生しました。もう一度お試しください。',
};

function toSocialError(error: { message?: string; hint?: string | null; code?: string } | null): SocialError {
  const hint = error?.hint ?? '';
  const known: SocialErrorCode[] = ['insufficient_lp', 'already_owned', 'not_owned', 'rate_limited', 'self', 'invite_limit'];
  if (known.includes(hint as SocialErrorCode)) return new SocialError(hint as SocialErrorCode, error?.message ?? hint);
  if (error?.code === 'P0002') return new SocialError('not_found', error.message ?? 'not found');
  if (/fetch|network/i.test(error?.message ?? '')) return new SocialError('network', error?.message ?? 'network');
  return new SocialError('unknown', error?.message ?? 'unknown error');
}

interface MemberRow {
  id: string;
  display_name: string;
  avatar: string;
  bio: string;
  lp_balance: number;
  lp_earned: number;
  mastered_count: number;
  created_at: string;
}
const toMember = (r: MemberRow): Member => ({
  id: r.id,
  displayName: r.display_name,
  avatar: r.avatar,
  bio: r.bio,
  lpBalance: r.lp_balance,
  lpEarned: r.lp_earned,
  masteredCount: r.mastered_count,
  createdAt: r.created_at,
});

export async function fetchMember(id: string): Promise<Member | null> {
  const { data, error } = await getSupabase().from('members').select('*').eq('id', id).maybeSingle<MemberRow>();
  if (error) throw toSocialError(error);
  return data ? toMember(data) : null;
}

export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await getSupabase().from('members').select('*').order('display_name').limit(500);
  if (error) throw toSocialError(error);
  return (data as MemberRow[]).map(toMember);
}

export async function updateMyProfile(id: string, patch: { displayName?: string; avatar?: string; bio?: string }): Promise<Member> {
  const row: Record<string, string> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName.trim();
  if (patch.avatar !== undefined) row.avatar = patch.avatar;
  if (patch.bio !== undefined) row.bio = patch.bio.trim();
  const { data, error } = await getSupabase().from('members').update(row).eq('id', id).select('*').single<MemberRow>();
  if (error) throw toSocialError(error);
  return toMember(data);
}

export async function fetchLeaderboard(period: 'all' | 'week'): Promise<LeaderboardRow[]> {
  const { data, error } = await getSupabase().rpc('leaderboard', { p_period: period, p_limit: 100 });
  if (error) throw toSocialError(error);
  return (data as { member_id: string; display_name: string; avatar: string; lp: number; mastered: number; rank: number }[]).map((r) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    avatar: r.avatar,
    lp: r.lp,
    mastered: r.mastered,
    rank: Number(r.rank),
  }));
}

export async function fetchShop(): Promise<ShopItem[]> {
  const { data, error } = await getSupabase().from('shop_items').select('id, name, emoji, price').eq('active', true).order('sort');
  if (error) throw toSocialError(error);
  return data as ShopItem[];
}

/** Item ids the member owns (free items are owned by everyone). */
export async function fetchOwned(memberId: string, shop: ShopItem[]): Promise<Set<string>> {
  const { data, error } = await getSupabase().from('inventory').select('item_id').eq('user_id', memberId);
  if (error) throw toSocialError(error);
  return new Set([...shop.filter((i) => i.price === 0).map((i) => i.id), ...(data as { item_id: string }[]).map((r) => r.item_id)]);
}

/** Returns the new LP balance. */
export async function purchase(itemId: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('purchase_item', { p_item: itemId });
  if (error) throw toSocialError(error);
  return data as number;
}

export async function sendReaction(toMemberId: string, itemId: string): Promise<void> {
  const { error } = await getSupabase().rpc('send_reaction', { p_to: toMemberId, p_item: itemId });
  if (error) throw toSocialError(error);
}

export async function fetchReactionCounts(memberId: string): Promise<{ itemId: string; emoji: string; received: number }[]> {
  const { data, error } = await getSupabase().rpc('reaction_counts', { p_member: memberId });
  if (error) throw toSocialError(error);
  return (data as { item_id: string; emoji: string; received: number }[]).map((r) => ({ itemId: r.item_id, emoji: r.emoji, received: Number(r.received) }));
}

export async function fetchNotifications(limit = 50): Promise<AppNotification[]> {
  const { data, error } = await getSupabase()
    .from('notifications')
    .select('id, kind, payload, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw toSocialError(error);
  return (data as { id: number; kind: NotificationKind; payload: Record<string, unknown>; created_at: string; read_at: string | null }[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload ?? {},
    createdAt: r.created_at,
    readAt: r.read_at,
  }));
}

export async function countUnread(): Promise<number> {
  const { count, error } = await getSupabase().from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  if (error) throw toSocialError(error);
  return count ?? 0;
}

export async function markAllRead(): Promise<void> {
  const { error } = await getSupabase().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (error) throw toSocialError(error);
}

export async function fetchMyInviteCodes(): Promise<InviteCode[]> {
  const { data, error } = await getSupabase().from('invite_codes').select('code, uses, max_uses, expires_at').order('created_at', { ascending: false });
  if (error) throw toSocialError(error);
  return (data as { code: string; uses: number; max_uses: number; expires_at: string | null }[]).map((r) => ({
    code: r.code,
    uses: r.uses,
    maxUses: r.max_uses,
    expiresAt: r.expires_at,
  }));
}

export async function createInviteCode(): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_invite_code');
  if (error) throw toSocialError(error);
  return data as string;
}

export async function checkInviteCode(code: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('check_invite_code', { p_code: code });
  if (error) throw toSocialError(error);
  return data === true;
}

export function inviteLink(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/join?code=${encodeURIComponent(code)}`;
}
