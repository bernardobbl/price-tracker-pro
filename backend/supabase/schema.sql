-- Price Tracker Pro (MVP) - Supabase schema + RLS
-- Execute no SQL Editor do Supabase.
--
-- Se você JÁ rodou uma versão antiga deste schema (com id uuid em tracked_products),
-- rode PRIMEIRO o arquivo: supabase/migration_drop_old_tables.sql
-- Depois rode este arquivo inteiro.

create extension if not exists "pgcrypto";

-- Produtos rastreados por usuário (id = slug texto, ex: "ps5", "iphone-15")
create table if not exists public.tracked_products (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  search_query text not null,
  marketplace text not null default 'mercado-livre',
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists tracked_products_user_id_idx on public.tracked_products (user_id);

-- Histórico de preços por produto (tracked_product_id = slug do produto)
create table if not exists public.prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tracked_product_id text not null,
  date timestamptz not null,
  full_price numeric not null,
  discounted_price numeric not null,
  currency text not null,
  title text not null,
  url text not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, tracked_product_id) references public.tracked_products (user_id, id) on delete cascade
);

create index if not exists prices_user_product_date_idx on public.prices (user_id, tracked_product_id, date);

-- Alertas de preço (tracked_product_id = slug do produto)
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tracked_product_id text not null,
  threshold_price numeric not null,
  currency text not null default 'R$',
  channel text not null default 'email',
  enabled boolean not null default true,
  triggered boolean not null default false,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (user_id, tracked_product_id) references public.tracked_products (user_id, id) on delete cascade,
  unique (user_id, tracked_product_id, channel)
);

create index if not exists alerts_user_id_idx on public.alerts (user_id);
create index if not exists alerts_tracked_product_id_idx on public.alerts (tracked_product_id);

-- RLS
alter table public.tracked_products enable row level security;
alter table public.prices enable row level security;
alter table public.alerts enable row level security;

-- tracked_products policies
drop policy if exists tracked_products_select_own on public.tracked_products;
create policy tracked_products_select_own on public.tracked_products for select using (user_id = auth.uid());
drop policy if exists tracked_products_insert_own on public.tracked_products;
create policy tracked_products_insert_own on public.tracked_products for insert with check (user_id = auth.uid());
drop policy if exists tracked_products_update_own on public.tracked_products;
create policy tracked_products_update_own on public.tracked_products for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists tracked_products_delete_own on public.tracked_products;
create policy tracked_products_delete_own on public.tracked_products for delete using (user_id = auth.uid());

-- prices policies
drop policy if exists prices_select_own on public.prices;
create policy prices_select_own on public.prices for select using (user_id = auth.uid());

-- alerts policies
drop policy if exists alerts_select_own on public.alerts;
create policy alerts_select_own on public.alerts for select using (user_id = auth.uid());
drop policy if exists alerts_insert_own on public.alerts;
create policy alerts_insert_own on public.alerts for insert with check (user_id = auth.uid());
drop policy if exists alerts_update_own on public.alerts;
create policy alerts_update_own on public.alerts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists alerts_delete_own on public.alerts;
create policy alerts_delete_own on public.alerts for delete using (user_id = auth.uid());
