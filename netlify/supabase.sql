-- Run once in Supabase: SQL Editor -> New query -> paste -> Run
create table if not exists public.payments (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  checkout_id text unique not null,
  merchant_request_id text,
  phone text not null,
  amount numeric not null,
  plan text not null,
  account text,
  status text not null default 'pending',   -- pending | paid | cancelled | failed
  receipt text,
  result_code int,
  result_desc text,
  paid_at timestamptz,
  expires_at timestamptz
);
create index if not exists payments_phone_idx on public.payments (phone, created_at desc);
create index if not exists payments_account_idx on public.payments (account);
-- Locked down: no public access. Only the Netlify functions (service key) can read or write.
alter table public.payments enable row level security;
