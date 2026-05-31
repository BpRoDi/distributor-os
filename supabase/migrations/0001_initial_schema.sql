-- Distributor OS Lite Alpha schema
-- Run with: supabase db push or paste into Supabase SQL editor for the first prototype.

create extension if not exists "pgcrypto";

create type user_role as enum ('brand_admin', 'brand_staff', 'distributor_user');
create type order_status as enum ('Draft', 'Submitted', 'Confirmed', 'Ready to Ship', 'Shipped', 'Delivered', 'Cancelled');
create type thread_type as enum ('Order Thread', 'Product Inquiry', 'Change Request');
create type thread_status as enum ('Open', 'Resolved');

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  role user_role not null,
  full_name text,
  email text not null,
  created_at timestamptz not null default now()
);

create table public.distributors (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  contact_email text not null,
  country text,
  region text,
  tier text default 'Standard',
  payment_terms text default 'Deposit',
  status text default 'Invited',
  created_at timestamptz not null default now()
);

create table public.distributor_users (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references public.distributors(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(distributor_id, user_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  sku text not null,
  category text,
  moq integer not null default 1 check (moq > 0),
  wholesale_price numeric(12,2) not null default 0,
  default_distributor_price numeric(12,2) not null default 0,
  status text not null default 'Available',
  created_at timestamptz not null default now(),
  unique(brand_id, sku)
);

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  distributor_id uuid not null references public.distributors(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric(12,2) not null,
  moq integer,
  created_at timestamptz not null default now(),
  unique(distributor_id, product_id)
);

create table public.inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  available integer not null default 0 check (available >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  safety_stock integer not null default 0 check (safety_stock >= 0),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  distributor_id uuid not null references public.distributors(id) on delete cascade,
  order_number text not null,
  status order_status not null default 'Submitted',
  payment_status text not null default 'Pending',
  delivery_eta text,
  amount numeric(12,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(brand_id, order_number)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) generated always as (quantity * unit_price) stored
);

create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  distributor_id uuid not null references public.distributors(id) on delete cascade,
  type thread_type not null,
  status thread_status not null default 'Open',
  topic text not null,
  order_id uuid references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  priority text default 'Medium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contextual_thread check (order_id is not null or product_id is not null)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_user_id uuid references auth.users(id),
  sender_role user_role not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  distributor_id uuid references public.distributors(id) on delete cascade,
  email text not null,
  token text unique not null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.brands enable row level security;
alter table public.profiles enable row level security;
alter table public.distributors enable row level security;
alter table public.distributor_users enable row level security;
alter table public.products enable row level security;
alter table public.price_lists enable row level security;
alter table public.inventory enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.message_threads enable row level security;
alter table public.messages enable row level security;
alter table public.invitations enable row level security;
alter table public.activity_logs enable row level security;

create or replace function public.current_brand_id()
returns uuid language sql stable security definer as $$
  select brand_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_brand_user(target_brand_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and brand_id = target_brand_id
      and role in ('brand_admin', 'brand_staff')
  )
$$;

create or replace function public.is_distributor_user(target_distributor_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.distributor_users
    where user_id = auth.uid()
      and distributor_id = target_distributor_id
  )
$$;

create policy "brand users can read own brand" on public.brands for select using (public.is_brand_user(id));
create policy "profiles can read self" on public.profiles for select using (id = auth.uid() or public.is_brand_user(brand_id));

create policy "brand users manage distributors" on public.distributors for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));
create policy "distributor users read own distributor" on public.distributors for select using (public.is_distributor_user(id));

create policy "brand users manage products" on public.products for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));
create policy "distributor users read brand products" on public.products for select using (
  exists (
    select 1 from public.distributors d
    where d.brand_id = products.brand_id and public.is_distributor_user(d.id)
  )
);

create policy "brand users manage inventory" on public.inventory for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));
create policy "distributor users read inventory" on public.inventory for select using (
  exists (
    select 1 from public.distributors d
    where d.brand_id = inventory.brand_id and public.is_distributor_user(d.id)
  )
);

create policy "brand users manage price lists" on public.price_lists for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));
create policy "distributor users read own prices" on public.price_lists for select using (public.is_distributor_user(distributor_id));

create policy "brand users manage orders" on public.orders for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));
create policy "distributor users manage own orders" on public.orders for all using (public.is_distributor_user(distributor_id)) with check (public.is_distributor_user(distributor_id));

create policy "order items visible through order" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_items.order_id and (public.is_brand_user(o.brand_id) or public.is_distributor_user(o.distributor_id)))
);
create policy "order items insert through order" on public.order_items for insert with check (
  exists (select 1 from public.orders o where o.id = order_items.order_id and (public.is_brand_user(o.brand_id) or public.is_distributor_user(o.distributor_id)))
);

create policy "brand users manage threads" on public.message_threads for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));
create policy "distributor users manage own threads" on public.message_threads for all using (public.is_distributor_user(distributor_id)) with check (public.is_distributor_user(distributor_id));

create policy "messages visible through thread" on public.messages for select using (
  exists (select 1 from public.message_threads t where t.id = messages.thread_id and (public.is_brand_user(t.brand_id) or public.is_distributor_user(t.distributor_id)))
);
create policy "messages insert through thread" on public.messages for insert with check (
  exists (select 1 from public.message_threads t where t.id = messages.thread_id and (public.is_brand_user(t.brand_id) or public.is_distributor_user(t.distributor_id)))
);

create policy "brand users manage invitations" on public.invitations for all using (public.is_brand_user(brand_id)) with check (public.is_brand_user(brand_id));
create policy "brand users read activity" on public.activity_logs for select using (public.is_brand_user(brand_id));
