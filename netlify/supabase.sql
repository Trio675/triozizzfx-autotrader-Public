-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
create table if not exists public.payments (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  checkout_id text unique not null,          -- M-Pesa CheckoutRequestID or Pesapal OrderTrackingId
  merchant_request_id text,
  phone text not null default '',
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
alter table public.payments add column if not exists provider text not null default 'mpesa';  -- mpesa | pesapal
alter table public.payments add column if not exists payer text;        -- phone or email: used for the first-payment bonus
alter table public.payments add column if not exists email text;
alter table public.payments add column if not exists currency text not null default 'KES';
alter table public.payments add column if not exists scope text;        -- binary | forex | both
alter table public.payments add column if not exists bonus_days int not null default 0;
create index if not exists payments_phone_idx on public.payments (phone, created_at desc);
create index if not exists payments_payer_idx on public.payments (payer, status);
create index if not exists payments_account_idx on public.payments (account);
-- Locked down: no public access. Only the Netlify functions (service key) can read or write.
alter table public.payments enable row level security;
