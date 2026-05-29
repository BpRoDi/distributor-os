-- Foundation modules for catalog upload, analytics, and payment tracking.

alter table public.products
  add column if not exists aliases text[] not null default '{}'::text[],
  add column if not exists lead_time text not null default 'To be confirmed';

alter table public.orders
  add column if not exists payment_method text not null default 'offline',
  add column if not exists payment_due_date date,
  add column if not exists amount_paid numeric(12,2) not null default 0,
  add column if not exists outstanding_amount numeric(12,2) not null default 0;

alter table public.orders
  alter column payment_status set default 'unpaid';

update public.orders
set payment_status = case
  when lower(payment_status) in ('paid') then 'paid'
  when lower(payment_status) in ('partial') then 'partial'
  when lower(payment_status) in ('overdue') then 'overdue'
  when lower(payment_status) in ('requested') then 'requested'
  else 'unpaid'
end,
outstanding_amount = greatest(0, coalesce(total_value, amount, 0) - coalesce(amount_paid, 0));

alter table public.orders
  drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('unpaid', 'requested', 'paid', 'partial', 'overdue'));

alter table public.orders
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('bank_transfer', 'paypal', 'card', 'apple_pay', 'offline'));
