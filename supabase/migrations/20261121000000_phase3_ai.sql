-- Phase 3: AI tutor storage.
--
-- ai_generations holds AI output that passed validation (the Edge Function
-- validates before it inserts). Learners can read their own rows; only the
-- server (service_role) can write, so a client can never plant "AI content".
-- ai_requests is the usage log behind the per-user daily limit.

create table public.ai_generations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('explain','compare','examples','context','exercises','mistakes')),
  word_id         uuid references public.words (id) on delete set null,
  cache_key       text not null check (char_length(cache_key) between 16 and 128),
  prompt_version  text not null,
  model           text not null,
  request         jsonb not null check (jsonb_typeof(request) = 'object'),
  content         jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at      timestamptz not null default now()
);
create index ai_generations_cache_idx on public.ai_generations (user_id, cache_key, created_at desc);
create index ai_generations_word_idx on public.ai_generations (user_id, word_id, kind, created_at desc);

create table public.ai_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  created_at  timestamptz not null default now()
);
create index ai_requests_user_time_idx on public.ai_requests (user_id, created_at desc);

alter table public.ai_generations enable row level security;
alter table public.ai_requests enable row level security;

create policy "ai_generations: read own" on public.ai_generations for select to authenticated
  using (user_id = (select auth.uid()));
-- No client policies on ai_requests: usage is server-side bookkeeping.

revoke insert, update, delete on public.ai_generations from anon, authenticated;
revoke all on public.ai_requests from anon, authenticated;
revoke all on public.ai_generations from anon;
grant select, insert on public.ai_generations to service_role;
grant select, insert on public.ai_requests to service_role;

-- Counts one AI request against the user's rolling 24-hour limit. Atomic per
-- user (advisory lock), so parallel requests cannot exceed the limit.
create or replace function public.reserve_ai_request(p_user uuid, p_kind text, p_daily_limit integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  used integer;
begin
  if p_user is null or p_daily_limit is null or p_daily_limit < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_requests:' || p_user::text, 0));
  select count(*) into used from public.ai_requests
   where user_id = p_user and created_at > now() - interval '24 hours';
  if used >= p_daily_limit then
    return false;
  end if;
  insert into public.ai_requests (user_id, kind) values (p_user, left(p_kind, 32));
  return true;
end $$;

revoke all on function public.reserve_ai_request(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_request(uuid, text, integer) to service_role;
