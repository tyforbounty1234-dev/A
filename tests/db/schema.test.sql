-- Database tests: RLS isolation, idempotent review submission, ordering safety,
-- immutability of history and seed idempotency. Any failed check raises an error.
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

-- Two users; the trigger must create their profiles.
-- Registration is invite-only (social migration).
insert into public.invite_codes (code, max_uses) values ('TESTCODE1', 100);
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', '{"invite_code":"TESTCODE1","display_name":"Aki"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com', '{"invite_code":"testcode1","display_name":"Ben"}');
select pg_temp.check((select count(*) from public.profiles) = 2, 'profiles created by auth trigger');
select pg_temp.check((select count(*) from public.words) = 203, 'seed loaded 203 words');

-- Seed is idempotent.
\i supabase/seed.sql
select pg_temp.check((select count(*) from public.words) = 203, 'seed re-run does not duplicate words');

-- ---------------------------------------------------------------- user A
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select pg_temp.check((select count(*) from public.words) = 203, 'authenticated user can read words');
select pg_temp.check((select count(*) from public.profiles) = 1, 'user sees only own profile');

insert into public.study_sessions (id, mode, started_at, planned_reviews)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'learn', '2026-11-19T10:00:00Z', 0);

select pg_temp.check(public.submit_review(
  jsonb_build_object('id','aaaaaaaa-0000-0000-0000-0000000000a1','word_id','8c57149c-6089-5fe0-8594-3eba84f4092c',
    'session_id','aaaaaaaa-0000-0000-0000-000000000001','question_type','en_to_ja_mc','competency','recognition',
    'review_kind','new','user_answer','至る所にある','is_correct',true,'quality',5,'response_time',2100,
    'reviewed_at','2026-11-19T10:01:00Z'),
  jsonb_build_object('word_id','8c57149c-6089-5fe0-8594-3eba84f4092c','review_count',1,'correct_count',1,
    'incorrect_count',0,'repetitions',1,'lapses',0,'ease_factor',2.6,'interval',1,'learning_status','review',
    'first_reviewed_at','2026-11-19T10:01:00Z','last_reviewed_at','2026-11-19T10:01:00Z',
    'next_review_at','2026-11-20T10:01:00Z','recent_results',jsonb_build_array(true),
    'competency_scores', '{"recognition":{"attempts":1,"correct":1,"proficiency":1,"avgResponseMs":2100,"lastAt":"2026-11-19T10:01:00Z"}}'::jsonb)
), 'first submit_review inserts');

select pg_temp.check((select count(*) from public.reviews) = 1, 'review stored');
select pg_temp.check((select session_id from public.reviews) = 'aaaaaaaa-0000-0000-0000-000000000001', 'review linked to session');
select pg_temp.check((select ease_factor from public.word_progress) = 2.60, 'progress stored');
select pg_temp.check((select recent_results from public.word_progress) = array[true], 'recent results stored');

-- Retrying the same review id is a no-op.
select pg_temp.check(public.submit_review(
  jsonb_build_object('id','aaaaaaaa-0000-0000-0000-0000000000a1','word_id','8c57149c-6089-5fe0-8594-3eba84f4092c',
    'session_id',null,'question_type','en_to_ja_mc','competency','recognition','review_kind','new',
    'user_answer','x','is_correct',false,'quality',1,'response_time',100,'reviewed_at','2026-11-19T10:01:00Z'),
  jsonb_build_object('word_id','8c57149c-6089-5fe0-8594-3eba84f4092c','review_count',99,'correct_count',0,
    'incorrect_count',99,'repetitions',0,'lapses',0,'ease_factor',1.3,'interval',0,'learning_status','learning',
    'last_reviewed_at','2026-11-19T10:01:00Z','recent_results','[]'::jsonb)
) = false, 'duplicate review id returns false');
select pg_temp.check((select review_count from public.word_progress) = 1, 'duplicate review does not change progress');

-- A newer review applies; then an OLDER review arriving late must not roll progress back.
select public.submit_review(
  jsonb_build_object('id','aaaaaaaa-0000-0000-0000-0000000000a2','word_id','8c57149c-6089-5fe0-8594-3eba84f4092c',
    'question_type','ja_to_en_mc','competency','recall','review_kind','scheduled','user_answer','ubiquitous',
    'is_correct',true,'quality',4,'response_time',4000,'reviewed_at','2026-11-20T10:05:00Z'),
  jsonb_build_object('word_id','8c57149c-6089-5fe0-8594-3eba84f4092c','review_count',2,'correct_count',2,
    'incorrect_count',0,'repetitions',2,'lapses',0,'ease_factor',2.6,'interval',6,'learning_status','review',
    'first_reviewed_at','2026-11-19T10:01:00Z','last_reviewed_at','2026-11-20T10:05:00Z',
    'next_review_at','2026-11-26T10:05:00Z','recent_results',jsonb_build_array(true,true),'competency_scores','{}'::jsonb));
select public.submit_review(
  jsonb_build_object('id','aaaaaaaa-0000-0000-0000-0000000000a3','word_id','8c57149c-6089-5fe0-8594-3eba84f4092c',
    'question_type','spelling','competency','spelling','review_kind','practice','user_answer','ubiquitus',
    'is_correct',false,'quality',2,'response_time',9000,'reviewed_at','2026-11-19T12:00:00Z'),
  jsonb_build_object('word_id','8c57149c-6089-5fe0-8594-3eba84f4092c','review_count',2,'correct_count',1,
    'incorrect_count',1,'repetitions',0,'lapses',1,'ease_factor',2.3,'interval',0.007,'learning_status','relearning',
    'first_reviewed_at','2026-11-19T10:01:00Z','last_reviewed_at','2026-11-19T12:00:00Z',
    'next_review_at','2026-11-19T12:10:00Z','recent_results',jsonb_build_array(true,false),'competency_scores','{}'::jsonb));
select pg_temp.check((select interval from public.word_progress) = 6, 'late older review does not roll back schedule');
select pg_temp.check((select count(*) from public.reviews) = 3, 'late older review is still kept in history');

-- Review missing a synced session keeps the answer with session_id null.
select public.submit_review(
  jsonb_build_object('id','aaaaaaaa-0000-0000-0000-0000000000a4','word_id','4aedfc17-b89a-5c9f-ac13-7c8eb1a77409',
    'session_id','aaaaaaaa-0000-0000-0000-00000000dead','question_type','en_to_ja_mc','competency','recognition',
    'review_kind','new','user_answer','x','is_correct',false,'quality',1,'response_time',5000,
    'reviewed_at','2026-11-19T10:02:00Z'),
  jsonb_build_object('word_id','4aedfc17-b89a-5c9f-ac13-7c8eb1a77409','review_count',1,'correct_count',0,
    'incorrect_count',1,'repetitions',0,'lapses',0,'ease_factor',2.04,'interval',0.00694,'learning_status','learning',
    'first_reviewed_at','2026-11-19T10:02:00Z','last_reviewed_at','2026-11-19T10:02:00Z',
    'next_review_at','2026-11-19T10:12:00Z','recent_results',jsonb_build_array(false),'competency_scores','{}'::jsonb));
select pg_temp.check((select session_id from public.reviews where id = 'aaaaaaaa-0000-0000-0000-0000000000a4') is null,
  'review with unknown session is kept with null session');

-- History is immutable for clients.
do $$ begin
  begin
    delete from public.reviews;
    raise exception 'delete should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.reviews set is_correct = true;
    raise exception 'update should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.check(true, 'reviews cannot be deleted or edited');

do $$ begin
  begin
    update public.words set word = 'hacked';
    raise exception 'word update should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.check(true, 'words are read-only for users');

-- A user cannot write rows for someone else.
do $$ begin
  begin
    insert into public.word_progress (user_id, word_id)
    values ('22222222-2222-2222-2222-222222222222', '8c57149c-6089-5fe0-8594-3eba84f4092c');
    raise exception 'cross-user insert should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.check(true, 'cannot insert progress for another user');

-- Profile settings validation.
update public.profiles set daily_new_words = 15, daily_target = 30;
select pg_temp.check((select daily_new_words from public.profiles) = 15, 'user can update own targets');
do $$ begin
  begin
    update public.profiles set daily_new_words = 1000;
    raise exception 'invalid target should have failed';
  exception when check_violation then null;
  end;
end $$;
select pg_temp.check(true, 'invalid daily target rejected');

-- ---------------------------------------------------------------- user B
reset role;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.check((select count(*) from public.reviews) = 0, 'user B cannot see user A reviews');
select pg_temp.check((select count(*) from public.word_progress) = 0, 'user B cannot see user A progress');
select pg_temp.check((select count(*) from public.study_sessions) = 0, 'user B cannot see user A sessions');
update public.word_progress set interval = 999;
reset role;
select pg_temp.check((select interval from public.word_progress
  where user_id = '11111111-1111-1111-1111-111111111111' and word_id = '8c57149c-6089-5fe0-8594-3eba84f4092c') = 6,
  'user B cannot modify user A progress');

-- ---------------------------------------------------------------- anon
select pg_temp.as_user(null);
do $$ begin
  begin
    perform count(*) from public.words;
    raise exception 'anon read should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_review('{}'::jsonb, '{}'::jsonb);
    raise exception 'anon rpc should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.check(true, 'anonymous clients cannot read data or submit reviews');

-- Deleting an auth user removes their learning data (account deletion).
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.check((select count(*) from public.reviews) = 0, 'account deletion cascades to history');
select pg_temp.check((select count(*) from public.words) = 203, 'account deletion keeps shared words');

-- ---------------------------------------------------------------- Phase 2
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
insert into public.study_sessions (id, mode, started_at) values ('bbbbbbbb-0000-0000-0000-000000000001', 'weak', now());
select pg_temp.check((select mode from public.study_sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'weak',
  'weak practice sessions are accepted');
do $$ begin
  begin
    insert into public.study_sessions (id, mode, started_at) values ('bbbbbbbb-0000-0000-0000-000000000002', 'bogus', now());
    raise exception 'invalid mode should have failed';
  exception when check_violation then null;
  end;
end $$;
reset role;
select pg_temp.check(true, 'unknown session modes are still rejected');

-- adaptive fields are stored by submit_review
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select public.submit_review(
  jsonb_build_object('id','bbbbbbbb-0000-0000-0000-0000000000c1','word_id','4aedfc17-b89a-5c9f-ac13-7c8eb1a77409',
    'session_id','bbbbbbbb-0000-0000-0000-000000000001','question_type','spelling','competency','spelling',
    'review_kind','scheduled','user_answer','ephemeral','is_correct',true,'quality',4,'response_time',5000,
    'reviewed_at','2026-11-25T10:00:00Z','prev_interval',6,'applied_modifier',1.12),
  jsonb_build_object('word_id','4aedfc17-b89a-5c9f-ac13-7c8eb1a77409','review_count',1,'correct_count',1,
    'incorrect_count',0,'repetitions',3,'lapses',0,'ease_factor',2.5,'interval',17,'learning_status','review',
    'first_reviewed_at','2026-11-19T10:00:00Z','last_reviewed_at','2026-11-25T10:00:00Z',
    'next_review_at','2026-12-12T10:00:00Z','recent_results',jsonb_build_array(true),
    'competency_scores','{"spelling":{"attempts":1,"correct":1,"proficiency":0.8,"avgResponseMs":5000,"lastAt":null,"srs":{"repetitions":3,"lapses":0,"easeFactor":2.5,"intervalDays":17,"status":"review","lastReviewedAt":"2026-11-25T10:00:00Z","nextReviewAt":"2026-12-12T10:00:00Z","modifier":1.12}}}'::jsonb));
select pg_temp.check((select prev_interval = 6 and abs(applied_modifier - 1.12) < 0.001 from public.reviews
  where id = 'bbbbbbbb-0000-0000-0000-0000000000c1'), 'submit_review stores adaptive fields');
select pg_temp.check((select competency_scores->'spelling'->'srs'->>'intervalDays' from public.word_progress
  where word_id = '4aedfc17-b89a-5c9f-ac13-7c8eb1a77409') = '17', 'per-competency schedule stored in progress');
select public.submit_review(
  jsonb_build_object('id','bbbbbbbb-0000-0000-0000-0000000000c2','word_id','4aedfc17-b89a-5c9f-ac13-7c8eb1a77409',
    'question_type','en_to_ja_mc','competency','recognition','review_kind','new','user_answer','x','is_correct',true,
    'quality',5,'response_time',900,'reviewed_at','2026-11-25T10:01:00Z'),
  jsonb_build_object('word_id','4aedfc17-b89a-5c9f-ac13-7c8eb1a77409','review_count',2,'correct_count',2,
    'incorrect_count',0,'repetitions',1,'lapses',0,'ease_factor',2.5,'interval',1,'learning_status','review',
    'last_reviewed_at','2026-11-25T10:01:00Z','next_review_at','2026-11-26T10:01:00Z','recent_results',jsonb_build_array(true,true)));
select pg_temp.check((select prev_interval is null and applied_modifier is null from public.reviews
  where id = 'bbbbbbbb-0000-0000-0000-0000000000c2'), 'reviews without adaptive fields are still accepted');
reset role;

-- ---------------------------------------------------------------- Phase 3: AI tutor storage
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role service_role';
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'c@example.com', '{"invite_code":"TESTCODE1"}'),
  ('44444444-4444-4444-4444-444444444444', 'd@example.com', '{"invite_code":"TESTCODE1"}');
select pg_temp.as_service();
select pg_temp.check(public.reserve_ai_request('33333333-3333-3333-3333-333333333333', 'examples', 2), 'service reserves 1st AI request');
select pg_temp.check(public.reserve_ai_request('33333333-3333-3333-3333-333333333333', 'examples', 2), 'service reserves 2nd AI request');
select pg_temp.check(not public.reserve_ai_request('33333333-3333-3333-3333-333333333333', 'examples', 2), 'daily AI limit is enforced');
select pg_temp.check(public.reserve_ai_request('44444444-4444-4444-4444-444444444444', 'examples', 2), 'AI limit is per user');
insert into public.ai_generations (user_id, kind, word_id, cache_key, prompt_version, model, request, content) values
  ('33333333-3333-3333-3333-333333333333', 'examples', '8c57149c-6089-5fe0-8594-3eba84f4092c', repeat('a', 64), 'p3.1', 'm', '{"kind":"examples"}', '{"examples":[]}'),
  ('44444444-4444-4444-4444-444444444444', 'mistakes', null, repeat('b', 64), 'p3.1', 'm', '{"kind":"mistakes"}', '{"summaryJa":"x"}');
select pg_temp.check((select count(*) from public.ai_generations) = 2, 'service can store validated AI content');
reset role;

do $$ begin
  insert into public.ai_generations (user_id, kind, cache_key, prompt_version, model, request, content)
  values ('33333333-3333-3333-3333-333333333333', 'joke', repeat('c', 64), 'p', 'm', '{}', '{}');
  raise exception 'FAILED: unknown AI kind accepted';
exception when check_violation then null;
end $$;
select pg_temp.check(true, 'unknown AI kinds are rejected');

select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select pg_temp.check((select count(*) from public.ai_generations) = 1, 'user reads only own AI content');
do $$ begin
  insert into public.ai_generations (user_id, kind, cache_key, prompt_version, model, request, content)
  values ('33333333-3333-3333-3333-333333333333', 'examples', repeat('d', 64), 'p', 'm', '{}', '{"examples":[]}');
  raise exception 'FAILED: client inserted AI content';
exception when insufficient_privilege then null;
end $$;
select pg_temp.check(true, 'clients cannot write AI content');
do $$ begin
  update public.ai_generations set content = '{"hacked":true}';
  raise exception 'FAILED: client updated AI content';
exception when insufficient_privilege then null;
end $$;
select pg_temp.check(true, 'clients cannot change AI content');
do $$ begin
  perform public.reserve_ai_request('33333333-3333-3333-3333-333333333333', 'x', 1000);
  raise exception 'FAILED: client reserved AI quota';
exception when insufficient_privilege then null;
end $$;
select pg_temp.check(true, 'clients cannot call the quota function');
do $$ begin
  perform count(*) from public.ai_requests;
  raise exception 'FAILED: client read the AI usage log';
exception when insufficient_privilege then null;
end $$;
select pg_temp.check(true, 'clients cannot read the AI usage log');
reset role;

select pg_temp.as_user(null);
do $$ begin
  perform count(*) from public.ai_generations;
  raise exception 'FAILED: anon read AI content';
exception when insufficient_privilege then null;
end $$;
select pg_temp.check(true, 'anonymous users cannot read AI content');
reset role;

delete from auth.users where id = '44444444-4444-4444-4444-444444444444';
select pg_temp.check((select count(*) from public.ai_generations where user_id = '44444444-4444-4444-4444-444444444444') = 0
  and (select count(*) from public.ai_requests where user_id = '44444444-4444-4444-4444-444444444444') = 0,
  'deleting a user deletes their AI data');
