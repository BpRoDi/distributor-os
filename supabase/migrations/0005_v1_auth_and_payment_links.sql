-- V1 auth and payment link polish.
-- Allows portal-submitted POs to live in the same orders table and gives
-- payment requests room to store hosted checkout metadata.

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('po_requested', 'draft', 'approved', 'link_created', 'distributor_confirmed', 'cancelled'));

alter table public.payment_requests
  add column if not exists provider text not null default 'manual'
    check (provider in ('manual', 'stripe')),
  add column if not exists provider_session_id text;

create index if not exists payment_requests_provider_session_idx
  on public.payment_requests(provider, provider_session_id);
