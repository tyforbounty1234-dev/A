-- Social features for the community web app: invite-only registration,
-- public member profiles, LP (learning points) for first-time mastery, a
-- leaderboard, an emote shop, reactions between members and notifications.
--
-- Trust model: a small group of friends. Everything that changes LP or sends
-- something to another member runs in a SECURITY DEFINER function with its own
-- checks; clients can never write LP, inventory, reactions or notifications
-- directly.

-- ---------------------------------------------------------------------------
-- Community settings (single row)
-- ---------------------------------------------------------------------------
create table public.community_settings (
  id              boolean primary key default true check (id),
  name            text not null default 'LexiCore' check (char_length(name) between 1 and 40),
  require_invite  boolean not null default true,
  -- Limits for member-created invite codes.
  member_invite_codes  smallint not null default 3 check (member_invite_codes between 0 and 50),
  member_invite_uses   smallint not null default 5 check (member_invite_uses between 1 and 100)
);
insert into public.community_settings default values;
alter table public.community_settings enable row level security;
create policy "settings: read" on public.community_settings for select to authenticated using (true);
revoke insert, update, delete on public.community_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Members: the public part of a profile, readable by every signed-in member
-- ---------------------------------------------------------------------------
create table public.members (
  id              uuid primary key references public.profiles (id) on delete cascade,
  display_name    text not null check (char_length(btrim(display_name)) between 1 and 20),
  avatar          text not null default '🙂' check (char_length(avatar) between 1 and 8),
  bio             text not null default '' check (char_length(bio) <= 120),
  lp_balance      integer not null default 0 check (lp_balance >= 0),
  lp_earned       integer not null default 0 check (lp_earned >= 0),
  mastered_count  integer not null default 0 check (mastered_count >= 0),
  invited_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index members_lp_idx on public.members (lp_earned desc, created_at);
create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();

alter table public.members enable row level security;
create policy "members: read" on public.members for select to authenticated using (true);
create policy "members: update own" on public.members for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke all on public.members from anon;
revoke insert, update, delete on public.members from authenticated;
-- Members may edit only their presentation; LP columns change only in functions below.
grant update (display_name, avatar, bio) on public.members to authenticated;

-- Members for accounts created before this migration.
insert into public.members (id, display_name)
select p.id, 'member-' || left(p.id::text, 4) from public.profiles p
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Invite codes
-- ---------------------------------------------------------------------------
create table public.invite_codes (
  code        text primary key check (code ~ '^[A-Z0-9]{6,16}$'),
  created_by  uuid references public.members (id) on delete set null,
  max_uses    integer not null default 10 check (max_uses between 1 and 1000),
  uses        integer not null default 0 check (uses >= 0),
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.invite_codes enable row level security;
create policy "invites: read own" on public.invite_codes for select to authenticated
  using (created_by = (select auth.uid()));
revoke all on public.invite_codes from anon;
revoke insert, update, delete on public.invite_codes from authenticated;

create or replace function public.normalize_invite_code(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Lets the sign-up page tell the visitor whether a code works before they register.
create or replace function public.check_invite_code(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.invite_codes c
     where c.code = public.normalize_invite_code(p_code)
       and c.uses < c.max_uses and (c.expires_at is null or c.expires_at > now()))
$$;
revoke all on function public.check_invite_code(text) from public;
grant execute on function public.check_invite_code(text) to anon, authenticated;

-- A member creates a code to share (limited by community_settings).
create or replace function public.create_invite_code() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_settings public.community_settings;
  v_active int;
  v_code text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_settings from public.community_settings;
  perform pg_advisory_xact_lock(hashtextextended('invite:' || v_uid::text, 0));
  select count(*) into v_active from public.invite_codes
   where created_by = v_uid and uses < max_uses and (expires_at is null or expires_at > now());
  if v_active >= v_settings.member_invite_codes then
    raise exception 'invite code limit reached' using errcode = 'P0001', hint = 'invite_limit';
  end if;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.invite_codes where code = v_code);
  end loop;
  insert into public.invite_codes (code, created_by, max_uses, expires_at)
  values (v_code, v_uid, v_settings.member_invite_uses, now() + interval '14 days');
  return v_code;
end $$;
revoke all on function public.create_invite_code() from public, anon;
grant execute on function public.create_invite_code() to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.members (id) on delete cascade,
  kind        text not null check (kind in ('reaction', 'lp_earned', 'member_joined', 'welcome')),
  payload     jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
alter table public.notifications enable row level security;
create policy "notifications: read own" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications: mark own read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Registration: invite code + member row for every new auth user
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code text := public.normalize_invite_code(v_meta->>'invite_code');
  v_invite public.invite_codes;
  v_name text := left(btrim(coalesce(v_meta->>'display_name', '')), 20);
  v_required boolean;
begin
  select require_invite into v_required from public.community_settings;
  if v_code <> '' then
    select * into v_invite from public.invite_codes where code = v_code for update;
  end if;
  if coalesce(v_required, true) and (v_invite.code is null or v_invite.uses >= v_invite.max_uses
      or (v_invite.expires_at is not null and v_invite.expires_at <= now())) then
    raise exception 'a valid invite code is required' using errcode = 'P0001', hint = 'invite_required';
  end if;
  if v_invite.code is not null then
    update public.invite_codes set uses = uses + 1 where code = v_invite.code;
  end if;

  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.members (id, display_name, invited_by)
  values (new.id,
          case when v_name = '' then 'member-' || left(new.id::text, 4) else v_name end,
          (select m.id from public.members m where m.id = v_invite.created_by))
  on conflict (id) do nothing;
  insert into public.notifications (user_id, kind, payload) values (new.id, 'welcome', '{}');
  if v_invite.created_by is not null and exists (select 1 from public.members where id = v_invite.created_by) then
    insert into public.notifications (user_id, kind, payload)
    values (v_invite.created_by, 'member_joined', jsonb_build_object('member_id', new.id, 'display_name',
            case when v_name = '' then 'member-' || left(new.id::text, 4) else v_name end));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- LP: 1 point the first time a word is mastered
-- ---------------------------------------------------------------------------
create table public.shop_items (
  id      text primary key check (id ~ '^[a-z0-9_]{2,32}$'),
  kind    text not null default 'emote' check (kind in ('emote')),
  name    text not null check (char_length(name) between 1 and 30),
  emoji   text not null check (char_length(emoji) between 1 and 8),
  price   integer not null check (price between 0 and 10000),
  sort    integer not null default 0,
  active  boolean not null default true
);
alter table public.shop_items enable row level security;
create policy "shop: read" on public.shop_items for select to authenticated using (true);
revoke all on public.shop_items from anon;
revoke insert, update, delete on public.shop_items from authenticated;

insert into public.shop_items (id, name, emoji, price, sort) values
  ('clap',    'はくしゅ',     '👏', 0, 10),
  ('thumbs',  'いいね',       '👍', 0, 20),
  ('fire',    '燃えてる',     '🔥', 3, 30),
  ('muscle',  'がんばれ',     '💪', 3, 40),
  ('party',   'おめでとう',   '🎉', 5, 50),
  ('heart',   'ハート',       '💖', 5, 60),
  ('brain',   '天才',         '🧠', 8, 70),
  ('rocket',  'ロケット',     '🚀', 10, 80),
  ('sakura',  '合格祈願',     '🌸', 12, 90),
  ('trophy',  'トロフィー',   '🏆', 15, 100),
  ('crown',   '王冠',         '👑', 30, 110)
on conflict (id) do nothing;

create table public.lp_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.members (id) on delete cascade,
  delta       integer not null check (delta <> 0),
  reason      text not null check (reason in ('mastery', 'purchase', 'adjustment')),
  word_id     uuid references public.words (id) on delete set null,
  item_id     text references public.shop_items (id),
  created_at  timestamptz not null default now()
);
create unique index lp_ledger_mastery_once on public.lp_ledger (user_id, word_id) where reason = 'mastery';
create index lp_ledger_user_time_idx on public.lp_ledger (user_id, created_at desc);
alter table public.lp_ledger enable row level security;
create policy "ledger: read own" on public.lp_ledger for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.lp_ledger from anon;
revoke insert, update, delete on public.lp_ledger from authenticated;

-- Fires when a word's progress becomes "mastered" (every tested skill at an
-- interval of 21 days or more). Progress is computed on the device, so the
-- award also requires a plausible history: at least 3 correct answers stored
-- on the server, the first of them at least 5 days earlier. (The adaptive
-- scheduler cannot reach a 21-day interval in less than about a week.)
create or replace function public.award_mastery() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_rows int;
  v_correct int;
  v_first timestamptz;
begin
  if new.learning_status is distinct from 'mastered' or new.interval < 21 then return new; end if;
  if tg_op = 'UPDATE' and old.learning_status = 'mastered' then return new; end if;
  if not exists (select 1 from public.members where id = new.user_id) then return new; end if;
  select count(*) filter (where r.is_correct), min(r.reviewed_at) into v_correct, v_first
    from public.reviews r where r.user_id = new.user_id and r.word_id = new.word_id;
  if v_correct < 3 or v_first is null or v_first > coalesce(new.last_reviewed_at, now()) - interval '5 days' then
    return new;
  end if;
  insert into public.lp_ledger (user_id, delta, reason, word_id)
  values (new.user_id, 1, 'mastery', new.word_id)
  on conflict (user_id, word_id) where reason = 'mastery' do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    update public.members set lp_balance = lp_balance + 1, lp_earned = lp_earned + 1,
           mastered_count = mastered_count + 1
     where id = new.user_id;
    insert into public.notifications (user_id, kind, payload)
    values (new.user_id, 'lp_earned', jsonb_build_object('word_id', new.word_id, 'lp', 1,
            'word', (select w.word from public.words w where w.id = new.word_id)));
  end if;
  return new;
end $$;

create trigger word_progress_award_mastery after insert or update of learning_status, interval on public.word_progress
  for each row execute function public.award_mastery();

-- ---------------------------------------------------------------------------
-- Leaderboard
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard(p_period text default 'all', p_limit integer default 50)
returns table (member_id uuid, display_name text, avatar text, lp integer, mastered integer, rank bigint)
language sql stable security definer set search_path = '' as $$
  with scores as (
    select m.id, m.display_name, m.avatar, m.mastered_count,
           case when p_period = 'week' then
             coalesce((select sum(l.delta)::int from public.lp_ledger l
                        where l.user_id = m.id and l.reason = 'mastery' and l.created_at > now() - interval '7 days'), 0)
           else m.lp_earned end as lp,
           m.created_at
      from public.members m
  )
  select s.id, s.display_name, s.avatar, s.lp, s.mastered_count,
         rank() over (order by s.lp desc)
    from scores s
   where auth.uid() is not null
   order by s.lp desc, s.created_at
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
revoke all on function public.leaderboard(text, integer) from public, anon;
grant execute on function public.leaderboard(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Shop and inventory
-- ---------------------------------------------------------------------------
create table public.inventory (
  user_id      uuid not null references public.members (id) on delete cascade,
  item_id      text not null references public.shop_items (id),
  acquired_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.inventory enable row level security;
-- Collections are part of the public profile.
create policy "inventory: read" on public.inventory for select to authenticated using (true);
revoke all on public.inventory from anon;
revoke insert, update, delete on public.inventory from authenticated;

create or replace function public.owns_item(p_user uuid, p_item text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shop_items i where i.id = p_item and i.price = 0)
      or exists (select 1 from public.inventory v where v.user_id = p_user and v.item_id = p_item)
$$;
revoke all on function public.owns_item(uuid, text) from public, anon, authenticated;

-- Returns the new LP balance.
create or replace function public.purchase_item(p_item text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item public.shop_items;
  v_balance int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_item from public.shop_items where id = p_item and active;
  if v_item.id is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  -- Lock the member row: concurrent purchases are serialized and the balance can't go negative.
  select lp_balance into v_balance from public.members where id = v_uid for update;
  if v_balance is null then raise exception 'not a member' using errcode = '28000'; end if;
  if public.owns_item(v_uid, p_item) then
    raise exception 'already owned' using errcode = 'P0001', hint = 'already_owned';
  end if;
  if v_balance < v_item.price then
    raise exception 'not enough LP' using errcode = 'P0001', hint = 'insufficient_lp';
  end if;
  update public.members set lp_balance = lp_balance - v_item.price where id = v_uid returning lp_balance into v_balance;
  insert into public.inventory (user_id, item_id) values (v_uid, p_item);
  insert into public.lp_ledger (user_id, delta, reason, item_id) values (v_uid, -v_item.price, 'purchase', p_item);
  return v_balance;
end $$;
revoke all on function public.purchase_item(text) from public, anon;
grant execute on function public.purchase_item(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reactions (emotes sent between members)
-- ---------------------------------------------------------------------------
create table public.reactions (
  id          uuid primary key default gen_random_uuid(),
  from_user   uuid not null references public.members (id) on delete cascade,
  to_user     uuid not null references public.members (id) on delete cascade,
  item_id     text not null references public.shop_items (id),
  created_at  timestamptz not null default now(),
  check (from_user <> to_user)
);
create index reactions_to_idx on public.reactions (to_user, created_at desc);
create index reactions_from_idx on public.reactions (from_user, created_at desc);
alter table public.reactions enable row level security;
create policy "reactions: read own" on public.reactions for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));
revoke all on public.reactions from anon;
revoke insert, update, delete on public.reactions from authenticated;

create or replace function public.send_reaction(p_to uuid, p_item text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_item public.shop_items;
  v_from public.members;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_from from public.members where id = v_uid;
  if v_from.id is null then raise exception 'not a member' using errcode = '28000'; end if;
  if p_to = v_uid then raise exception 'cannot send to yourself' using errcode = 'P0001', hint = 'self'; end if;
  if not exists (select 1 from public.members where id = p_to) then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  select * into v_item from public.shop_items where id = p_item and active;
  if v_item.id is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not public.owns_item(v_uid, p_item) then
    raise exception 'emote not owned' using errcode = 'P0001', hint = 'not_owned';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reaction:' || v_uid::text, 0));
  if (select count(*) from public.reactions where from_user = v_uid and created_at > now() - interval '24 hours') >= 50
     or (select count(*) from public.reactions where from_user = v_uid and to_user = p_to
          and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'too many reactions; try again later' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  insert into public.reactions (from_user, to_user, item_id) values (v_uid, p_to, p_item) returning id into v_id;
  insert into public.notifications (user_id, kind, payload)
  values (p_to, 'reaction', jsonb_build_object('reaction_id', v_id, 'from_user', v_uid,
          'from_name', v_from.display_name, 'from_avatar', v_from.avatar, 'item_id', p_item, 'emoji', v_item.emoji));
  return v_id;
end $$;
revoke all on function public.send_reaction(uuid, text) from public, anon;
grant execute on function public.send_reaction(uuid, text) to authenticated;

-- Reactions a member has received, with counts per emote (for their profile page).
create or replace function public.reaction_counts(p_member uuid)
returns table (item_id text, emoji text, received bigint)
language sql stable security definer set search_path = '' as $$
  select r.item_id, i.emoji, count(*) from public.reactions r join public.shop_items i on i.id = r.item_id
   where r.to_user = p_member and auth.uid() is not null
   group by r.item_id, i.emoji order by count(*) desc
$$;
revoke all on function public.reaction_counts(uuid) from public, anon;
grant execute on function public.reaction_counts(uuid) to authenticated;
