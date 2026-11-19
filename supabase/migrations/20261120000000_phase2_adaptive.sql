-- Phase 2: memory optimisation.
-- Additive only: existing rows are untouched.
--
-- * study_sessions.mode gains 'weak' (focused practice on automatically detected weak words).
-- * word_progress.competency_scores now also stores an independent SM-2 schedule per
--   competency under the key "srs". The column is already jsonb; rows written before
--   this migration are upgraded by the client on read (lossless, idempotent), so no
--   data migration is needed here.
-- * Index to find words by their earliest due competency stays (user_id, next_review_at):
--   next_review_at is the earliest due date over the word's competencies.

alter table public.study_sessions drop constraint if exists study_sessions_mode_check;
alter table public.study_sessions add constraint study_sessions_mode_check
  check (mode in ('review', 'learn', 'mixed', 'weak'));

comment on column public.word_progress.competency_scores is
  'Per-competency stats {attempts, correct, proficiency, avgResponseMs, lastAt, srs{repetitions, lapses, easeFactor, intervalDays, status, lastReviewedAt, nextReviewAt}}. Word-level SM-2 columns are the aggregate of active competencies.';
comment on column public.word_progress.next_review_at is
  'Earliest next review over the word''s active competencies.';

-- ---------------------------------------------------------------------------
-- Adaptive scheduling inputs recorded on each answer (nullable: older rows and
-- first tests of a competency have none). Also the features Phase 4 forgetting
-- prediction will train on.
-- ---------------------------------------------------------------------------
alter table public.reviews
  add column if not exists prev_interval double precision check (prev_interval is null or prev_interval between 0 and 3650),
  add column if not exists applied_modifier real check (applied_modifier is null or applied_modifier between 0.5 and 2);

comment on column public.reviews.prev_interval is 'Interval (days) of the tested competency that this answer concluded.';
comment on column public.reviews.applied_modifier is 'Per-user interval modifier that scheduled that interval.';

-- submit_review now stores the two new fields. Same idempotency and ordering rules.
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
                              user_answer, is_correct, quality, response_time, reviewed_at,
                              prev_interval, applied_modifier)
  values ((p_review->>'id')::uuid, v_uid, (p_review->>'word_id')::uuid,
          -- keep the answer even if its session row never reached the server
          (select s.id from public.study_sessions s where s.id = (p_review->>'session_id')::uuid),
          p_review->>'question_type', p_review->>'competency', p_review->>'review_kind',
          coalesce(left(p_review->>'user_answer', 500), ''), (p_review->>'is_correct')::boolean,
          (p_review->>'quality')::smallint, (p_review->>'response_time')::integer, v_reviewed_at,
          (p_review->>'prev_interval')::double precision, (p_review->>'applied_modifier')::real)
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
