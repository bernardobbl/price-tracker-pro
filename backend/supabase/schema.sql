-- Price Tracker Pro — Supabase schema + RLS (domínio: preços de combustível / ANP)
-- Execute no SQL Editor do Supabase.
--
-- ⚠️ Se você já rodou uma versão antiga (domínio "livros": tracked_products/prices),
-- rode PRIMEIRO: supabase/migration_002_books_to_fuel.sql (dropa as tabelas antigas).
-- Depois rode este arquivo inteiro. Ele é idempotente (create if not exists /
-- drop policy if exists), então pode ser reexecutado com segurança.
--
-- Modelo de dados (mudança de domínio — Fase 6.8):
--  * fuel_prices    → dados PÚBLICOS da ANP (Série Histórica de Preços de Combustíveis).
--                     NÃO é por-usuário: é referência compartilhada. Qualquer usuário
--                     autenticado LÊ; a ESCRITA é só via service_role (o ingestor/ETL,
--                     que ignora RLS). Chave natural única → upsert idempotente.
--  * tracked_series → "favoritos" do usuário (produto + município/UF + bandeira opcional).
--                     Por-usuário, com RLS. É o que substitui tracked_products.
--  * alerts         → alerta por threshold apontando para um tracked_series (não mais
--                     para um produto de livro). Por-usuário, com RLS.
--  * ingestion_runs → observabilidade do ETL (H3): 1 linha por execução de ingestão
--                     (arquivo, hash, lidas/inseridas/rejeitadas, duração, status).
--                     Operacional: só o service_role acessa.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- fuel_prices — dado público da ANP (referência compartilhada, sem user_id)
-- ---------------------------------------------------------------------------
-- Granularidade de uma linha: um posto (CNPJ) vende um produto numa data de coleta
-- por um preço. Chave natural (cnpj, product, collected_at) → permite upsert
-- idempotente (reprocessar o mesmo CSV não duplica linhas).
create table if not exists public.fuel_prices (
  id            bigint generated always as identity primary key,
  region        text,                      -- Região - Sigla (ex.: 'SE')
  state         text not null,             -- Estado - Sigla / UF (ex.: 'SP')
  municipality  text not null,             -- Município (ex.: 'SAO PAULO')
  reseller      text,                      -- Revenda (razão social do posto)
  cnpj          text not null default '',  -- CNPJ da Revenda (parte da chave natural)
  product       text not null,             -- Produto (ex.: 'GASOLINA', 'ETANOL', 'DIESEL S10')
  collected_at  date not null,             -- Data da Coleta
  sell_price    numeric(10,3) not null,    -- Valor de Venda (R$)
  buy_price     numeric(10,3),             -- Valor de Compra (R$, quase sempre nulo na revenda)
  unit          text,                      -- Unidade de Medida (ex.: 'R$ / litro')
  brand         text,                      -- Bandeira (ex.: 'VIBRA', 'IPIRANGA', 'BRANCA')
  created_at    timestamptz not null default now(),
  unique (cnpj, product, collected_at)
);

-- Índice principal de consulta: produto + local + tempo (I1: médio/min/máx por município).
create index if not exists fuel_prices_lookup_idx
  on public.fuel_prices (state, municipality, product, collected_at desc);

-- Agregados por produto no tempo (séries nacionais / gráficos).
create index if not exists fuel_prices_product_date_idx
  on public.fuel_prices (product, collected_at desc);

-- ---------------------------------------------------------------------------
-- tracked_series — favoritos do usuário (o que ele monitora)
-- ---------------------------------------------------------------------------
create table if not exists public.tracked_series (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  product       text not null,             -- ex.: 'GASOLINA'
  state         text not null,             -- UF, ex.: 'SP'
  municipality  text not null,             -- ex.: 'SAO PAULO'
  brand         text,                      -- bandeira opcional (null = todas)
  label         text not null,             -- rótulo de exibição, ex.: 'Gasolina · São Paulo/SP'
  created_at    timestamptz not null default now()
);

create index if not exists tracked_series_user_id_idx
  on public.tracked_series (user_id);

-- Unicidade por usuário: mesma combinação produto+UF+município+bandeira só uma vez.
-- (brand é nulável, então usamos coalesce para tratar "todas as bandeiras" como valor único.)
create unique index if not exists tracked_series_unique_combo
  on public.tracked_series (user_id, product, state, municipality, coalesce(brand, ''));

-- ---------------------------------------------------------------------------
-- alerts — alerta por threshold apontando para um tracked_series
-- ---------------------------------------------------------------------------
create table if not exists public.alerts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  series_id        uuid not null references public.tracked_series (id) on delete cascade,
  threshold_price  numeric(10,3) not null,
  currency         text not null default 'R$',
  channel          text not null default 'email',
  enabled          boolean not null default true,
  triggered        boolean not null default false,
  last_notified_at timestamptz,
  created_at       timestamptz not null default now(),
  unique (user_id, series_id, channel)
);

create index if not exists alerts_user_id_idx on public.alerts (user_id);
create index if not exists alerts_series_id_idx on public.alerts (series_id);

-- ---------------------------------------------------------------------------
-- ingestion_runs — observabilidade do ETL (H3). Operacional: service_role apenas.
-- ---------------------------------------------------------------------------
create table if not exists public.ingestion_runs (
  id            bigint generated always as identity primary key,
  source        text not null default 'anp-shpc',
  file_name     text,
  file_hash     text,                      -- H2: hash do conteúdo → evita reprocessar o mesmo CSV
  etag          text,                      -- H2: validador HTTP para GET condicional (If-None-Match)
  last_modified text,                      -- H2: validador HTTP para GET condicional (If-Modified-Since)
  rows_read     integer not null default 0,
  rows_inserted integer not null default 0,
  rows_rejected integer not null default 0,
  status        text not null default 'running',  -- running | success | error
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer
);

-- Colunas de cache condicional (H2) — idempotente para bancos criados antes destas colunas.
alter table public.ingestion_runs add column if not exists etag text;
alter table public.ingestion_runs add column if not exists last_modified text;

create index if not exists ingestion_runs_source_started_idx
  on public.ingestion_runs (source, started_at desc);

-- H2: consulta rápida "já processei este arquivo?" por hash.
create index if not exists ingestion_runs_file_hash_idx
  on public.ingestion_runs (file_hash);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.fuel_prices    enable row level security;
alter table public.tracked_series enable row level security;
alter table public.alerts         enable row level security;
alter table public.ingestion_runs enable row level security;

-- fuel_prices: leitura pública (qualquer usuário autenticado); escrita só via service_role
-- (o ingestor usa a service key, que ignora RLS — por isso não há policy de insert/update).
drop policy if exists fuel_prices_select_all on public.fuel_prices;
create policy fuel_prices_select_all on public.fuel_prices
  for select to authenticated using (true);

-- tracked_series: cada usuário só enxerga/gerencia os seus.
drop policy if exists tracked_series_select_own on public.tracked_series;
create policy tracked_series_select_own on public.tracked_series
  for select using (user_id = auth.uid());
drop policy if exists tracked_series_insert_own on public.tracked_series;
create policy tracked_series_insert_own on public.tracked_series
  for insert with check (user_id = auth.uid());
drop policy if exists tracked_series_update_own on public.tracked_series;
create policy tracked_series_update_own on public.tracked_series
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists tracked_series_delete_own on public.tracked_series;
create policy tracked_series_delete_own on public.tracked_series
  for delete using (user_id = auth.uid());

-- alerts: cada usuário só enxerga/gerencia os seus.
drop policy if exists alerts_select_own on public.alerts;
create policy alerts_select_own on public.alerts
  for select using (user_id = auth.uid());
drop policy if exists alerts_insert_own on public.alerts;
create policy alerts_insert_own on public.alerts
  for insert with check (user_id = auth.uid());
drop policy if exists alerts_update_own on public.alerts;
create policy alerts_update_own on public.alerts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists alerts_delete_own on public.alerts;
create policy alerts_delete_own on public.alerts
  for delete using (user_id = auth.uid());

-- ingestion_runs: sem policies → nenhum acesso via chave anon/authenticated.
-- Só o service_role (ETL) lê/escreve, pois ignora RLS. RLS habilitado = fail-closed.
