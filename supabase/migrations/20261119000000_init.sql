-- LexiCore initial schema (Phase 1).
-- Static vocabulary (public.words) is separate from per-user learning data
-- (profiles, word_progress, reviews, study_sessions). Every user table is
-- protected by Row Level Security so a user can only see and change their own rows.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Users (profile row per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  learning_goal       text check (char_length(learning_goal) <= 200),
  proficiency_level   smallint not null default 3 check (proficiency_level between 1 and 5),
  daily_target        smallint not null default 20 check (daily_target between 5 and 240), -- minutes
  daily_new_words     smallint not null default 10 check (daily_new_words between 0 and 100),
  daily_review_limit  smallint not null default 100 check (daily_review_limit between 10 and 1000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Words (static dictionary data, read-only for clients)
-- ---------------------------------------------------------------------------
create table public.words (
  id                 uuid primary key default gen_random_uuid(),
  word               text not null,
  ipa                text,
  audio_url          text,
  part_of_speech     text not null check (part_of_speech in ('n.','v.','adj.','adv.','prep.','conj.','phr.')),
  definitions        jsonb not null check (jsonb_typeof(definitions) = 'array' and jsonb_array_length(definitions) > 0),
  examples           jsonb not null default '[]'::jsonb check (jsonb_typeof(examples) = 'array'),
  synonyms           text[] not null default '{}',
  antonyms           text[] not null default '{}',
  collocations       text[] not null default '{}',
  derivatives        jsonb not null default '[]'::jsonb check (jsonb_typeof(derivatives) = 'array'),
  etymology          text,
  difficulty         smallint not null default 3 check (difficulty between 1 and 5),
  exam_relevance     jsonb not null default '{}'::jsonb,
  synonym_group      text,
  spelling_variants  text[] not null default '{}',
  rank               integer not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index words_word_key on public.words (lower(word));
create index words_rank_idx on public.words (rank);
create index words_updated_at_idx on public.words (updated_at);

-- ---------------------------------------------------------------------------
-- WordProgress (SM-2 state per user and word)
-- ---------------------------------------------------------------------------
create table public.word_progress (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  word_id            uuid not null references public.words (id) on delete restrict,
  review_count       integer not null default 0 check (review_count >= 0),
  correct_count      integer not null default 0 check (correct_count >= 0),
  incorrect_count    integer not null default 0 check (incorrect_count >= 0),
  repetitions        integer not null default 0 check (repetitions >= 0),
  lapses             integer not null default 0 check (lapses >= 0),
  ease_factor        numeric(4,2) not null default 2.50 check (ease_factor between 1.30 and 3.00),
  interval           double precision not null default 0 check (interval >= 0 and interval <= 3650), -- days
  learning_status    text not null default 'new'
                     check (learning_status in ('new','learning','review','relearning','mastered')),
  first_reviewed_at  timestamptz,
  last_reviewed_at   timestamptz,
  next_review_at     timestamptz,
  recent_results     boolean[] not null default '{}',
  competency_scores  jsonb not null default '{}'::jsonb check (jsonb_typeof(competency_scores) = 'object'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, word_id),
  check (correct_count + incorrect_count = review_count)
);
create index word_progress_due_idx on public.word_progress (user_id, next_review_at);
create index word_progress_status_idx on public.word_progress (user_id, learning_status);
create index word_progress_word_idx on public.word_progress (word_id);

-- ---------------------------------------------------------------------------
-- StudySessions
-- ---------------------------------------------------------------------------
create table public.study_sessions (
  id                  uuid primary key, -- generated on the client so offline sessions sync idempotently
  user_id             uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  mode                text not null check (mode in ('review','learn','mixed')),
  started_at          timestamptz not null,
  completed_at        timestamptz,
  words_studied       integer not null default 0 check (words_studied >= 0),
  questions_answered  integer not null default 0 check (questions_answered >= 0),
  correct_answers     integer not null default 0 check (correct_answers >= 0),
  accuracy            real check (accuracy between 0 and 1),
  planned_reviews     integer not null default 0 check (planned_reviews >= 0),
  completed_reviews   integer not null default 0 check (completed_reviews >= 0),
  created_at          timestamptz not null default now(),
  check (completed_at is null or completed_at >= started_at)
);
create index study_sessions_user_started_idx on public.study_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Reviews (append-only answer log; the source of truth for analytics)
-- ---------------------------------------------------------------------------
create table public.reviews (
  id                uuid primary key, -- generated on the client for idempotent offline sync
  user_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  word_id           uuid not null references public.words (id) on delete restrict,
  session_id        uuid references public.study_sessions (id) on delete set null,
  question_type     text not null check (question_type in
                    ('en_to_ja_mc','ja_to_en_mc','spelling','listening','sentence_completion','context','production')),
  competency        text not null check (competency in ('recognition','recall','spelling','context','production')),
  review_kind       text not null check (review_kind in ('new','scheduled','relearn','practice')),
  user_answer       text not null default '' check (char_length(user_answer) <= 500),
  is_correct        boolean not null,
  quality           smallint not null check (quality between 0 and 5),
  response_time     integer not null check (response_time between 0 and 3600000), -- ms
  reviewed_at       timestamptz not null,
  created_at        timestamptz not null default now()
);
create index reviews_user_time_idx on public.reviews (user_id, reviewed_at desc);
create index reviews_user_word_idx on public.reviews (user_id, word_id, reviewed_at desc);
create index reviews_session_idx on public.reviews (session_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger words_touch before update on public.words
  for each row execute function public.touch_updated_at();
create trigger word_progress_touch before update on public.word_progress
  for each row execute function public.touch_updated_at();

-- Reviews are an immutable history: block updates and deletes from clients.
create or replace function public.reviews_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'reviews are append-only';
end $$;
create trigger reviews_no_update before update on public.reviews
  for each row execute function public.reviews_immutable();

-- ---------------------------------------------------------------------------
-- Create a profile automatically for every new auth user
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.words          enable row level security;
alter table public.word_progress  enable row level security;
alter table public.reviews        enable row level security;
alter table public.study_sessions enable row level security;

create policy "profiles: read own"   on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "words: read" on public.words for select to authenticated using (true);

create policy "progress: read own"   on public.word_progress for select to authenticated using (user_id = (select auth.uid()));
create policy "progress: insert own" on public.word_progress for insert to authenticated with check (user_id = (select auth.uid()));
create policy "progress: update own" on public.word_progress for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "reviews: read own"   on public.reviews for select to authenticated using (user_id = (select auth.uid()));
create policy "reviews: insert own" on public.reviews for insert to authenticated with check (user_id = (select auth.uid()));

create policy "sessions: read own"   on public.study_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy "sessions: insert own" on public.study_sessions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "sessions: update own" on public.study_sessions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Clients never delete learning history.
revoke delete on public.word_progress, public.reviews, public.study_sessions from anon, authenticated;
revoke update on public.reviews from anon, authenticated;
revoke insert, update, delete on public.words from anon, authenticated;
revoke all on public.profiles, public.word_progress, public.reviews, public.study_sessions, public.words from anon;

-- ---------------------------------------------------------------------------
-- submit_review: record one answer and the resulting SM-2 state atomically.
--
-- * Idempotent: the review id is generated on the client. Re-sending the same
--   review (e.g. an offline retry) is a no-op and returns false.
-- * Ordering-safe: progress is only overwritten when this review is at least as
--   new as the stored last_reviewed_at, so a late-arriving older review from a
--   second device cannot roll the schedule back.
-- * Runs with the caller's privileges (security invoker) so RLS still applies.
-- ---------------------------------------------------------------------------
create or replace function public.submit_review(p_review jsonb, p_progress jsonb)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_inserted int;
  v_reviewed_at timestamptz := (p_review->>'reviewed_at')::timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if (p_review->>'word_id') is distinct from (p_progress->>'word_id') then
    raise exception 'review and progress refer to different words' using errcode = '22023';
  end if;

  insert into public.reviews (id, user_id, word_id, session_id, question_type, competency, review_kind,
                              user_answer, is_correct, quality, response_time, reviewed_at)
  values ((p_review->>'id')::uuid, v_uid, (p_review->>'word_id')::uuid,
          -- keep the answer even if its session row never reached the server
          (select s.id from public.study_sessions s where s.id = (p_review->>'session_id')::uuid),
          p_review->>'question_type', p_review->>'competency', p_review->>'review_kind',
          coalesce(left(p_review->>'user_answer', 500), ''), (p_review->>'is_correct')::boolean,
          (p_review->>'quality')::smallint, (p_review->>'response_time')::integer, v_reviewed_at)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  insert into public.word_progress as wp (user_id, word_id, review_count, correct_count, incorrect_count,
      repetitions, lapses, ease_factor, interval, learning_status, first_reviewed_at, last_reviewed_at,
      next_review_at, recent_results, competency_scores)
  values (v_uid, (p_progress->>'word_id')::uuid,
      (p_progress->>'review_count')::int, (p_progress->>'correct_count')::int, (p_progress->>'incorrect_count')::int,
      (p_progress->>'repetitions')::int, (p_progress->>'lapses')::int, (p_progress->>'ease_factor')::numeric,
      (p_progress->>'interval')::double precision, p_progress->>'learning_status',
      (p_progress->>'first_reviewed_at')::timestamptz, (p_progress->>'last_reviewed_at')::timestamptz,
      (p_progress->>'next_review_at')::timestamptz,
      coalesce((select array_agg(x::boolean) from jsonb_array_elements_text(p_progress->'recent_results') x), '{}'),
      coalesce(p_progress->'competency_scores', '{}'::jsonb))
  on conflict (user_id, word_id) do update set
      review_count = excluded.review_count, correct_count = excluded.correct_count,
      incorrect_count = excluded.incorrect_count, repetitions = excluded.repetitions,
      lapses = excluded.lapses, ease_factor = excluded.ease_factor, interval = excluded.interval,
      learning_status = excluded.learning_status,
      first_reviewed_at = least(wp.first_reviewed_at, excluded.first_reviewed_at),
      last_reviewed_at = excluded.last_reviewed_at, next_review_at = excluded.next_review_at,
      recent_results = excluded.recent_results, competency_scores = excluded.competency_scores
    where wp.last_reviewed_at is null or wp.last_reviewed_at <= excluded.last_reviewed_at;

  return true;
end $$;

revoke all on function public.submit_review(jsonb, jsonb) from public, anon;
grant execute on function public.submit_review(jsonb, jsonb) to authenticated;
