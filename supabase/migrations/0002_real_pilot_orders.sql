-- Real pilot workflow persistence for Distributor OS.
-- This upgrades the prototype schema so brand-generated order links can be
-- stored, reviewed by distributors, confirmed, and audited with events.

alter table public.distributors
  add column if not exists level text not null default 'B'
    check (level in ('A', 'B', 'C')),
  add column if not exists trust_score integer not null default 75
    check (trust_score >= 0 and trust_score <= 100);

alter table public.products
  add column if not exists level_a_price numeric(12,2) not null default 0,
  add column if not exists level_b_price numeric(12,2) not null default 0,
  add column if not exists level_c_price numeric(12,2) not null default 0,
  add column if not exists stock integer not null default 0 check (stock >= 0);

alter table public.orders
  alter column status drop default;

alter table public.orders
  alter column status type text using lower(status::text);

alter table public.orders
  alter column status set default 'draft';

alter table public.orders
  add column if not exists distributor_name text,
  add column if not exists distributor_level text not null default 'B'
    check (distributor_level in ('A', 'B', 'C')),
  add column if not exists source_channel text not null default 'WhatsApp'
    check (source_channel in ('WhatsApp', 'Telegram')),
  add column if not exists original_message text not null default '',
  add column if not exists share_token text unique,
  add column if not exists total_value numeric(12,2) not null default 0;

update public.orders
set status = case
  when status in ('draft') then 'draft'
  when status in ('cancelled') then 'cancelled'
  when status in ('confirmed', 'ready to ship', 'shipped', 'delivered') then 'approved'
  when status in ('submitted') then 'approved'
  else 'approved'
end;

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('draft', 'approved', 'link_created', 'distributor_confirmed', 'cancelled'));

alter table public.order_items
  add column if not exists product_name text,
  add column if not exists level_a_price numeric(12,2) not null default 0,
  add column if not exists level_b_price numeric(12,2) not null default 0,
  add column if not exists level_c_price numeric(12,2) not null default 0,
  add column if not exists moq integer not null default 1 check (moq > 0),
  add column if not exists stock_snapshot integer not null default 0 check (stock_snapshot >= 0),
  add column if not exists confidence integer not null default 0 check (confidence >= 0 and confidence <= 100);

alter table public.order_items
  drop column if exists line_total;

alter table public.order_items
  add column line_total numeric(12,2) not null default 0;

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  label text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.order_events enable row level security;

create policy "order events visible through order" on public.order_events
for select using (
  exists (
    select 1 from public.orders o
    where o.id = order_events.order_id
      and (public.is_brand_user(o.brand_id) or public.is_distributor_user(o.distributor_id))
  )
);

create policy "brand users manage order events" on public.order_events
for all using (
  exists (
    select 1 from public.orders o
    where o.id = order_events.order_id
      and public.is_brand_user(o.brand_id)
  )
) with check (
  exists (
    select 1 from public.orders o
    where o.id = order_events.order_id
      and public.is_brand_user(o.brand_id)
  )
);

create index if not exists orders_share_token_idx on public.orders(share_token);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_events_order_id_idx on public.order_events(order_id);
