-- Social feature tests: invite-only registration, member profiles, LP for
-- first-time mastery, leaderboard, shop, reactions and notifications.
\set ON_ERROR_STOP on

create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
  execute 'set role ' || case when uid is null then 'anon' else 'authenticated' end;
end $$;

-- Expect `stmt` to fail; returns the error hint (or the message when there is no hint).
create or replace function pg_temp.fails(stmt text) returns text language plpgsql as $$
declare v_hint text; v_msg text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
  return coalesce(nullif(v_hint, ''), v_msg);
end $$;

-- Submit one answer for the current user through submit_review.
create or replace function pg_temp.answer(p_word text, p_id uuid, p_correct boolean, p_at timestamptz,
                                         p_status text, p_interval double precision, p_count int)
returns boolean language sql as $$
  select public.submit_review(
    jsonb_build_object('id', p_id, 'word_id', (select id from public.words where word = p_word),
      'question_type', 'en_to_ja_mc', 'competency', 'recognition', 'review_kind', 'scheduled',
      'user_answer', 'x', 'is_correct', p_correct, 'quality', case when p_correct then 4 else 1 end,
      'response_time', 2000, 'reviewed_at', p_at),
    jsonb_build_object('word_id', (select id from public.words where word = p_word), 'review_count', p_count,
      'correct_count', p_count, 'incorrect_count', 0, 'repetitions', p_count, 'lapses', 0, 'ease_factor', 2.5,
      'interval', p_interval, 'learning_status', p_status, 'first_reviewed_at', '2026-11-01T00:00:00Z',
      'last_reviewed_at', p_at, 'next_review_at', p_at + make_interval(days => ceil(p_interval)::int),
      'recent_results', jsonb_build_array(p_correct)))
$$;

\set alice '''aaaa0000-0000-4000-8000-000000000001'''
\set bob   '''aaaa0000-0000-4000-8000-000000000002'''
\set carol '''aaaa0000-0000-4000-8000-000000000003'''

-- ------------------------------------------------------------- registration
insert into public.invite_codes (code, max_uses) values ('FRIENDS1', 2);
insert into public.invite_codes (code, max_uses, expires_at) values ('OLDCODE1', 5, now() - interval '1 day');

select pg_temp.check(pg_temp.fails($$insert into auth.users (id, email, raw_user_meta_data) values
  (gen_random_uuid(), 'x@example.com', '{}')$$) = 'invite_required', 'sign-up without an invite code is rejected');
select pg_temp.check(pg_temp.fails($$insert into auth.users (id, email, raw_user_meta_data) values
  (gen_random_uuid(), 'x@example.com', '{"invite_code":"NOPE1234"}')$$) = 'invite_required', 'unknown invite code is rejected');
select pg_temp.check(pg_temp.fails($$insert into auth.users (id, email, raw_user_meta_data) values
  (gen_random_uuid(), 'x@example.com', '{"invite_code":"OLDCODE1"}')$$) = 'invite_required', 'expired invite code is rejected');

insert into auth.users (id, email, raw_user_meta_data) values
  (:alice, 'alice@example.com', '{"invite_code":"friends-1","display_name":"  Alice  "}');
select pg_temp.check((select display_name from public.members where id = :alice) = 'Alice', 'member created with trimmed display name');
select pg_temp.check((select uses from public.invite_codes where code = 'FRIENDS1') = 1, 'invite use counted (code normalized)');
select pg_temp.check(exists (select 1 from public.notifications where user_id = :alice and kind = 'welcome'), 'welcome notification');

-- Alice creates her own code and invites Bob with it.
select pg_temp.as_user(:alice);
select public.create_invite_code() as alice_code \gset
select public.create_invite_code();
select public.create_invite_code();
select pg_temp.check(pg_temp.fails('select public.create_invite_code()') = 'invite_limit', 'member invite codes are limited');
select pg_temp.check((select count(*) from public.invite_codes) = 3, 'member sees only own invite codes');
reset role;

insert into auth.users (id, email, raw_user_meta_data) values
  (:bob, 'bob@example.com', jsonb_build_object('invite_code', :'alice_code', 'display_name', 'Bob'));
select pg_temp.check((select invited_by from public.members where id = :bob) = :alice, 'inviter recorded');
select pg_temp.check(exists (select 1 from public.notifications where user_id = :alice and kind = 'member_joined'
  and payload->>'display_name' = 'Bob'), 'inviter is notified when a friend joins');
insert into auth.users (id, email, raw_user_meta_data) values
  (:carol, 'carol@example.com', '{"invite_code":"FRIENDS1","display_name":"Carol"}');
select pg_temp.check(pg_temp.fails($$insert into auth.users (id, email, raw_user_meta_data) values
  (gen_random_uuid(), 'y@example.com', '{"invite_code":"FRIENDS1"}')$$) = 'invite_required', 'used-up invite code is rejected');

select pg_temp.as_user(null);
select pg_temp.check(public.check_invite_code(:'alice_code') and not public.check_invite_code('FRIENDS1'),
  'visitors can check whether a code works');
select pg_temp.check(pg_temp.fails('select count(*) from public.members') is not null, 'visitors cannot list members');
select pg_temp.check(pg_temp.fails('select count(*) from public.invite_codes') is not null, 'visitors cannot list invite codes');
reset role;

-- ------------------------------------------------------------- profiles
select pg_temp.as_user(:bob);
select pg_temp.check((select count(*) from public.members) >= 3, 'members can see each other');
update public.members set display_name = 'Bobby', avatar = '🐻', bio = 'Kyoto 2027' where id = :bob;
select pg_temp.check((select display_name from public.members where id = :bob) = 'Bobby', 'member edits own profile');
select pg_temp.check(pg_temp.fails($$update public.members set lp_balance = 999 where id = 'aaaa0000-0000-4000-8000-000000000002'$$) is not null,
  'members cannot change their own LP');
update public.members set display_name = 'Hacked' where id = :alice;
select pg_temp.check((select display_name from public.members where id = :alice) = 'Alice', 'members cannot edit others');
select pg_temp.check(pg_temp.fails($$update public.members set display_name = '' where id = 'aaaa0000-0000-4000-8000-000000000002'$$) is not null,
  'empty display name rejected');
reset role;

-- ------------------------------------------------------------- LP for mastery
select pg_temp.as_user(:alice);
select pg_temp.answer('ubiquitous', 'bbbb0000-0000-4000-8000-000000000001', true, '2026-11-01T00:00:00Z', 'learning', 1, 1);
select pg_temp.answer('ubiquitous', 'bbbb0000-0000-4000-8000-000000000002', true, '2026-11-02T00:00:00Z', 'review', 6, 2);
select pg_temp.answer('ubiquitous', 'bbbb0000-0000-4000-8000-000000000003', true, '2026-11-08T00:00:00Z', 'mastered', 22, 3);
select pg_temp.check((select lp_balance = 1 and lp_earned = 1 and mastered_count = 1 from public.members where id = :alice),
  'first mastery earns 1 LP');
select pg_temp.check(exists (select 1 from public.notifications where user_id = :alice and kind = 'lp_earned'
  and payload->>'word' = 'ubiquitous'), 'LP notification names the word');
-- Lapse and re-mastery of the same word: no second award.
select pg_temp.answer('ubiquitous', 'bbbb0000-0000-4000-8000-000000000004', false, '2026-11-30T00:00:00Z', 'relearning', 0.01, 4);
select pg_temp.answer('ubiquitous', 'bbbb0000-0000-4000-8000-000000000005', true, '2026-12-01T00:00:00Z', 'mastered', 25, 5);
select pg_temp.check((select lp_earned from public.members where id = :alice) = 1, 'a word earns LP only once');
-- Implausible: mastered after a single answer.
select pg_temp.answer('ephemeral', 'bbbb0000-0000-4000-8000-000000000006', true, '2026-11-08T00:00:00Z', 'mastered', 30, 1);
select pg_temp.check((select lp_earned from public.members where id = :alice) = 1, 'mastery without a plausible history earns nothing');
-- Implausible: three answers within one day.
select pg_temp.answer('candid', 'bbbb0000-0000-4000-8000-000000000007', true, '2026-11-08T00:00:00Z', 'learning', 1, 1);
select pg_temp.answer('candid', 'bbbb0000-0000-4000-8000-000000000008', true, '2026-11-08T01:00:00Z', 'review', 6, 2);
select pg_temp.answer('candid', 'bbbb0000-0000-4000-8000-000000000009', true, '2026-11-08T02:00:00Z', 'mastered', 22, 3);
select pg_temp.check((select lp_earned from public.members where id = :alice) = 1, 'mastery within hours earns nothing');
select pg_temp.check(pg_temp.fails($$insert into public.lp_ledger (user_id, delta, reason) values
  ('aaaa0000-0000-4000-8000-000000000001', 100, 'adjustment')$$) is not null, 'clients cannot write the LP ledger');
reset role;

-- ------------------------------------------------------------- leaderboard
update public.members set lp_earned = 7, lp_balance = 20 where id = :bob;
select pg_temp.as_user(:carol);
select pg_temp.check((select array_agg(display_name order by rank, display_name) from public.leaderboard('all', 10)
  where display_name in ('Bobby', 'Alice', 'Carol')) = array['Bobby', 'Alice', 'Carol'], 'leaderboard is ordered by LP');
select pg_temp.check((select rank from public.leaderboard('all', 10) where display_name = 'Bobby') = 1
  and (select rank from public.leaderboard('all', 10) where display_name = 'Alice') = 2, 'leaderboard ranks');
select pg_temp.check((select lp from public.leaderboard('week', 10) where display_name = 'Alice') = 1
  and (select lp from public.leaderboard('week', 10) where display_name = 'Bobby') = 0, 'weekly board counts only mastery from the last 7 days');
reset role;
select pg_temp.as_user(null);
select pg_temp.check(pg_temp.fails($$select * from public.leaderboard('all', 10)$$) is not null, 'visitors cannot see the leaderboard');
reset role;

-- ------------------------------------------------------------- shop
select pg_temp.as_user(:carol);
select pg_temp.check(pg_temp.fails($$select public.purchase_item('fire')$$) = 'insufficient_lp', 'cannot buy without enough LP');
select pg_temp.check(pg_temp.fails($$select public.purchase_item('clap')$$) = 'already_owned', 'free emotes are owned by everyone');
reset role;
select pg_temp.as_user(:bob);
select pg_temp.check(public.purchase_item('fire') = 17, 'purchase deducts LP');
select pg_temp.check(pg_temp.fails($$select public.purchase_item('fire')$$) = 'already_owned', 'cannot buy the same emote twice');
select pg_temp.check(pg_temp.fails($$select public.purchase_item('unicorn')$$) = 'item not found', 'unknown item rejected');
select pg_temp.check((select lp_balance from public.members where id = :bob) = 17
  and (select lp_earned from public.members where id = :bob) = 7, 'spending LP does not lower the leaderboard score');
select pg_temp.check((select delta from public.lp_ledger where item_id = 'fire') = -3, 'purchase is in the ledger');
select pg_temp.check(pg_temp.fails($$insert into public.inventory (user_id, item_id) values
  ('aaaa0000-0000-4000-8000-000000000002', 'crown')$$) is not null, 'clients cannot grant themselves items');
reset role;

-- ------------------------------------------------------------- reactions
select pg_temp.as_user(:bob);
select public.send_reaction(:alice, 'fire') is not null as sent \gset
select pg_temp.check(:'sent'::boolean, 'member sends an owned emote');
select pg_temp.check(pg_temp.fails($$select public.send_reaction('aaaa0000-0000-4000-8000-000000000001', 'crown')$$) = 'not_owned',
  'cannot send an emote you do not own');
select pg_temp.check(pg_temp.fails($$select public.send_reaction('aaaa0000-0000-4000-8000-000000000002', 'clap')$$) = 'self',
  'cannot send to yourself');
select pg_temp.check(pg_temp.fails($$select public.send_reaction(gen_random_uuid(), 'clap')$$) = 'member not found', 'unknown member rejected');
select public.send_reaction(:alice, 'clap') from generate_series(1, 9);
select pg_temp.check(pg_temp.fails($$select public.send_reaction('aaaa0000-0000-4000-8000-000000000001', 'clap')$$) = 'rate_limited',
  'reactions to one member are rate-limited');
select pg_temp.check(pg_temp.fails($$insert into public.reactions (from_user, to_user, item_id) values
  ('aaaa0000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001', 'crown')$$) is not null,
  'clients cannot insert reactions directly');
reset role;

select pg_temp.as_user(:alice);
select pg_temp.check((select count(*) from public.reactions where to_user = :alice) = 10, 'recipient sees received reactions');
select pg_temp.check(exists (select 1 from public.notifications where kind = 'reaction' and payload->>'emoji' = '🔥'
  and payload->>'from_name' = 'Bobby'), 'recipient is notified with sender and emoji');
select pg_temp.check((select received from public.reaction_counts(:alice) where item_id = 'clap') = 9, 'reaction counts per emote');
update public.notifications set read_at = now() where kind = 'reaction';
select pg_temp.check((select count(*) from public.notifications where kind = 'reaction' and read_at is null) = 0, 'member marks notifications read');
select pg_temp.check(pg_temp.fails($$update public.notifications set payload = '{}'$$) is not null, 'notification content is read-only');
reset role;

select pg_temp.as_user(:carol);
select pg_temp.check((select count(*) from public.reactions) = 0, 'third parties cannot see reactions between others');
select pg_temp.check((select count(*) from public.notifications where kind = 'reaction') = 0, 'notifications are private');
select pg_temp.check((select count(*) from public.inventory where user_id = :bob) = 1, 'collections are visible on profiles');
reset role;

-- ------------------------------------------------------------- settings and deletion
update public.community_settings set require_invite = false;
insert into auth.users (id, email, raw_user_meta_data) values ('aaaa0000-0000-4000-8000-000000000009', 'open@example.com', '{}');
select pg_temp.check(exists (select 1 from public.members where id = 'aaaa0000-0000-4000-8000-000000000009'),
  'open registration when invites are turned off');
update public.community_settings set require_invite = true;

delete from auth.users where id = :bob;
select pg_temp.check((select count(*) from public.reactions where from_user = :bob) = 0
  and (select count(*) from public.inventory where user_id = :bob) = 0
  and (select invited_by from public.members where id = :alice) is null, 'deleting a member removes their social data');
