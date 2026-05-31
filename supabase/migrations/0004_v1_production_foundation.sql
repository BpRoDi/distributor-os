-- V1 production foundation for paid brand launches.
-- Adds the durable records needed for source-backed AI parsing, role-based
-- operations, payment requests, finance scoring, and richer payment rails.

do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'brand_finance' and enumtypid = 'user_role'::regtype) then
    alter type user_role add value 'brand_finance';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'brand_sales' and enumtypid = 'user_role'::regtype) then
    alter type user_role add value 'brand_sales';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'brand_ops' and enumtypid = 'user_role'::regtype) then
    alter type user_role add value 'brand_ops';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'distributor_buyer' and enumtypid = 'user_role'::regtype) then
    alter type user_role add value 'distributor_buyer';
  end if;
end $$;

create table if not exists public.brand_memberships (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role user_role not null,
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  unique(brand_id, user_id)
);

alter table public.orders
  drop constraint if exists orders_source_channel_check;

alter table public.orders
  add constraint orders_source_channel_check
  check (source_channel in ('WhatsApp', 'Telegram', 'Distributor Portal', 'Email', 'CSV', 'PDF', 'EDI'));

alter table public.orders
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('bank_transfer', 'ach', 'wire', 'paypal', 'card', 'apple_pay', 'stablecoin_usdc', 'offline'));

create table if not exists public.source_records (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  distributor_id uuid references public.distributors(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  channel text not null check (channel in ('WhatsApp', 'Telegram', 'Distributor Portal', 'Email', 'CSV', 'PDF', 'EDI')),
  external_ref text,
  original_body text not null,
  normalized_body text,
  captured_by uuid references auth.users(id),
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_order_parses (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  source_record_id uuid not null references public.source_records(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  parser_version text not null default 'rules-v1',
  confidence integer not null default 0 check (confidence >= 0 and confidence <= 100),
  extracted_items jsonb not null default '[]'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  distributor_id uuid not null references public.distributors(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'USD',
  rail text not null default 'bank_transfer'
    check (rail in ('bank_transfer', 'ach', 'wire', 'card', 'stablecoin_usdc', 'offline')),
  status text not null default 'requested'
    check (status in ('draft', 'requested', 'viewed', 'partial', 'paid', 'expired', 'cancelled')),
  due_date date,
  request_url text,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.distributor_credit_profiles (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  distributor_id uuid not null references public.distributors(id) on delete cascade,
  trust_score integer not null default 70 check (trust_score >= 0 and trust_score <= 100),
  recommended_terms text not null default 'Net 15',
  recommended_credit_limit numeric(12,2) not null default 0 check (recommended_credit_limit >= 0),
  risk_reason text not null default 'Limited payment history',
  signals jsonb not null default '[]'::jsonb,
  calculated_at timestamptz not null default now(),
  unique(brand_id, distributor_id)
);

alter table public.orders
  add column if not exists source_record_id uuid references public.source_records(id) on delete set null,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists external_order_id text,
  add column if not exists buyer_reference text;

alter table public.brand_memberships enable row level security;
alter table public.source_records enable row level security;
alter table public.ai_order_parses enable row level security;
alter table public.payment_requests enable row level security;
alter table public.distributor_credit_profiles enable row level security;

create or replace function public.is_brand_user(target_brand_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and brand_id = target_brand_id
      and role in ('brand_admin', 'brand_staff', 'brand_finance', 'brand_sales', 'brand_ops')
  )
  or exists (
    select 1 from public.brand_memberships
    where user_id = auth.uid()
      and brand_id = target_brand_id
      and status = 'active'
      and role in ('brand_admin', 'brand_staff', 'brand_finance', 'brand_sales', 'brand_ops')
  )
$$;

create policy "brand users manage memberships" on public.brand_memberships
for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));

create policy "brand users manage source records" on public.source_records
for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));

create policy "distributor users read own source records" on public.source_records
for select using (distributor_id is not null and public.is_distributor_user(distributor_id));

create policy "brand users manage ai parses" on public.ai_order_parses
for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));

create policy "brand users manage payment requests" on public.payment_requests
for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));

create policy "distributor users read own payment requests" on public.payment_requests
for select using (public.is_distributor_user(distributor_id));

create policy "brand users manage credit profiles" on public.distributor_credit_profiles
for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));

create policy "distributor users read own credit profile" on public.distributor_credit_profiles
for select using (public.is_distributor_user(distributor_id));

create index if not exists brand_memberships_brand_user_idx on public.brand_memberships(brand_id, user_id);
create index if not exists source_records_brand_distributor_idx on public.source_records(brand_id, distributor_id, captured_at desc);
create index if not exists source_records_order_idx on public.source_records(order_id);
create index if not exists ai_order_parses_source_idx on public.ai_order_parses(source_record_id, created_at desc);
create index if not exists payment_requests_order_idx on public.payment_requests(order_id, requested_at desc);
create index if not exists payment_requests_brand_status_idx on public.payment_requests(brand_id, status, due_date);
create index if not exists distributor_credit_profiles_brand_idx on public.distributor_credit_profiles(brand_id, trust_score desc);
