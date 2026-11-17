-- =====================================================================
-- Triozizz Journal — database setup
-- Supabase → SQL Editor → New query → paste ALL of this → Run.
-- Safe to run again: it only creates what's missing and refreshes rules.
-- Every user can read and write ONLY their own rows (row-level security).
-- =====================================================================

-- ---------- profiles: one row per user (name, PIN hash, settings) ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  pin_salt     text,
  pin_iter     integer,
  pin_hash     text,
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- New sign-up -> profile row created automatically (name from sign-up metadata)
create or replace function public.tj_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists tj_on_auth_user_created on auth.users;
create trigger tj_on_auth_user_created after insert on auth.users
  for each row execute function public.tj_handle_new_user();

-- ---------- trades: one row per closed trade, kept until the user deletes it ----------
create table if not exists public.trades (
  id              uuid primary key,                        -- made on the phone, so a retried save never duplicates
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trade_date      date not null,
  trade_time      time,
  symbol          text not null default '',
  market          text,
  direction       text,                                    -- Buy / Sell
  source          text,                                    -- Manual, an EA name, DBot…
  account         text,
  setup           text,
  session         text,
  entry_price     numeric,
  sl_price        numeric,
  tp_price        numeric,
  exit_price      numeric,
  lots            numeric,
  risk            numeric,
  pnl             numeric not null,                        -- net profit / loss
  grade           text,
  emotion         text,
  followed        boolean not null default true,
  mistakes        text[] not null default '{}',
  notes           text,
  link            text,
  screenshot_path text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists trades_user_date_idx on public.trades (user_id, trade_date);

-- ---------- cashflows: deposits (+) and withdrawals (−); not counted as profit ----------
create table if not exists public.cashflows (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  flow_date  date not null,
  amount     numeric not null,
  account    text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists cashflows_user_date_idx on public.cashflows (user_id, flow_date);

-- ---------- weekly_reviews: one free-text review per ISO week ----------
create table if not exists public.weekly_reviews (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week       text not null,                                -- e.g. 2026-W47
  body       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, week)
);

-- ---------- row-level security: owner only ----------
alter table public.profiles       enable row level security;
alter table public.trades         enable row level security;
alter table public.cashflows      enable row level security;
alter table public.weekly_reviews enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "own trades" on public.trades;
create policy "own trades" on public.trades for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own cashflows" on public.cashflows;
create policy "own cashflows" on public.cashflows for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own reviews" on public.weekly_reviews;
create policy "own reviews" on public.weekly_reviews for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Signed-in users can use these tables (the rules above still limit them to their own rows).
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.trades, public.cashflows, public.weekly_reviews to authenticated;
revoke all on public.profiles, public.trades, public.cashflows, public.weekly_reviews from anon;

-- ---------- screenshots: private bucket, one folder per user, 5 MB max ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "own screenshots read"   on storage.objects;
drop policy if exists "own screenshots add"    on storage.objects;
drop policy if exists "own screenshots change" on storage.objects;
drop policy if exists "own screenshots delete" on storage.objects;
create policy "own screenshots read" on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own screenshots add" on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own screenshots change" on storage.objects for update to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own screenshots delete" on storage.objects for delete to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Done. Check: Table Editor shows profiles, trades, cashflows, weekly_reviews (each with "RLS enabled"),
-- and Storage shows a private "screenshots" bucket.
