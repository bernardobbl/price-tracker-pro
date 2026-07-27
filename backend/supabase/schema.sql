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
  street        text,                      -- Nome da Rua (localização do posto)
  street_number text,                      -- Número Rua
  neighborhood  text,                      -- Bairro
  cep           text,                      -- CEP
  created_at    timestamptz not null default now(),
  unique (cnpj, product, collected_at)
);

-- Colunas de endereço (localização do posto) — idempotente para bancos criados antes delas.
alter table public.fuel_prices add column if not exists street text;
alter table public.fuel_prices add column if not exists street_number text;
alter table public.fuel_prices add column if not exists neighborhood text;
alter table public.fuel_prices add column if not exists cep text;

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
-- Funções de listagem (DISTINCT no servidor)
-- ---------------------------------------------------------------------------
-- Os seletores do app precisam das UFs e dos municípios distintos. Fazer o
-- distinct no cliente exigiria puxar as linhas — e o PostgREST limita respostas
-- a 1000, o que silenciosamente perderia valores. Estas funções resolvem o
-- distinct no Postgres (usando os índices) e devolvem poucas linhas.
create or replace function public.fuel_states()
returns table (state text)
language sql
stable
as $$
  select distinct fp.state from public.fuel_prices fp order by fp.state;
$$;

create or replace function public.fuel_municipalities(p_state text)
returns table (municipality text)
language sql
stable
as $$
  select distinct fp.municipality
  from public.fuel_prices fp
  where fp.state = p_state
  order by fp.municipality;
$$;

-- Produtos que realmente têm dado ingerido. Existe pelo mesmo motivo das duas
-- funções acima, mas conserta um problema concreto: a lista vivia fixa no código
-- e incluía GLP, que o ingestor descarta (escopo automotivo) — o seletor oferecia
-- um combustível que nunca teria série. Derivar do dado mantém UI e ETL coerentes.
--
-- A ordenação NÃO é alfabética: segue a sequência canônica (gasolina → etanol →
-- diesel → GNV) para o seletor abrir no combustível mais procurado. Produtos que
-- a ANP venha a publicar e ainda não estejam na lista caem no fim, em ordem
-- alfabética — aparecem sozinhos, sem precisar de deploy.
create or replace function public.fuel_products()
returns table (product text)
language sql
stable
as $$
  select p.product
  from (select distinct fp.product from public.fuel_prices fp) p
  order by
    coalesce(
      array_position(
        array[
          'GASOLINA', 'GASOLINA ADITIVADA', 'ETANOL',
          'DIESEL', 'DIESEL S10', 'DIESEL S500', 'GNV'
        ],
        p.product
      ),
      99
    ),
    p.product;
$$;

-- ---------------------------------------------------------------------------
-- Funções de agregação (série e snapshot no servidor)
-- ---------------------------------------------------------------------------
-- Motivo: o PostgREST corta respostas em 1000 linhas (Max Rows) MESMO com .limit()
-- maior no cliente. Agregar no cliente exigia puxar as linhas cruas do município —
-- que passam de 1000 com ~6 meses de histórico numa cidade grande, truncando
-- silenciosamente os registros MAIS RECENTES (ordenação ascendente). Estas funções
-- agregam no Postgres (usando fuel_prices_lookup_idx) e devolvem poucas linhas:
-- uma por data de levantamento (série) ou uma por posto do último levantamento.

-- Série diária agregada de um produto num município (média/mín/máx + amostra).
create or replace function public.fuel_daily_series(
  p_product text,
  p_state text,
  p_municipality text,
  p_brand text default null
)
returns table (
  date date,
  avg_price numeric,
  min_price numeric,
  max_price numeric,
  sample_size integer
)
language sql
stable
as $$
  select
    fp.collected_at as date,
    round(avg(fp.sell_price), 3) as avg_price,
    min(fp.sell_price) as min_price,
    max(fp.sell_price) as max_price,
    count(*)::integer as sample_size
  from public.fuel_prices fp
  where fp.product = p_product
    and fp.state = p_state
    and fp.municipality = p_municipality
    and (p_brand is null or fp.brand = p_brand)
  group by fp.collected_at
  order by fp.collected_at;
$$;

-- Linhas (por posto) do levantamento MAIS RECENTE de um produto num município.
-- O ranking/dedup por CNPJ continua na função pura `summarizeSnapshot` (testada).
create or replace function public.fuel_latest_snapshot(
  p_product text,
  p_state text,
  p_municipality text,
  p_brand text default null
)
returns table (
  collected_at date,
  sell_price numeric,
  reseller text,
  brand text,
  cnpj text,
  street text,
  street_number text,
  neighborhood text,
  cep text
)
language sql
stable
as $$
  select
    fp.collected_at, fp.sell_price, fp.reseller, fp.brand, fp.cnpj,
    fp.street, fp.street_number, fp.neighborhood, fp.cep
  from public.fuel_prices fp
  where fp.product = p_product
    and fp.state = p_state
    and fp.municipality = p_municipality
    and (p_brand is null or fp.brand = p_brand)
    and fp.collected_at = (
      select max(fp2.collected_at)
      from public.fuel_prices fp2
      where fp2.product = p_product
        and fp2.state = p_state
        and fp2.municipality = p_municipality
        and (p_brand is null or fp2.brand = p_brand)
    );
$$;

-- ---------------------------------------------------------------------------
-- Operação no free tier: retenção e estatísticas (Fase 9)
-- ---------------------------------------------------------------------------
-- O free tier do Supabase dá 500 MB de banco. O job semanal só ADICIONA linhas
-- (~70k/mês ≈ 21-23 MB/mês, medido), então sem controle o banco cresceria para
-- sempre. A retenção apaga levantamentos mais antigos que N meses (o app chama
-- com RETENTION_MONTHS, padrão 12 → platô ~280 MB ≈ 56% do limite) — custo R$ 0
-- para sempre. Nota: DELETE não devolve espaço ao SO, mas o espaço é reutilizado
-- pelas ingestões seguintes (o platô é o que importa para o limite).
-- Segurança: EXECUTE revogado de anon/authenticated — só o service_role (ETL) roda.

create or replace function public.fuel_prices_retention(p_keep_months integer default 12)
returns integer
language plpgsql
as $$
declare
  deleted integer;
begin
  if p_keep_months is null or p_keep_months < 1 then
    return 0; -- 0/negativo = retenção desligada, não apaga nada
  end if;
  delete from public.fuel_prices
  where collected_at < (current_date - make_interval(months => p_keep_months));
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function public.fuel_prices_retention(integer) from public, anon, authenticated;
grant execute on function public.fuel_prices_retention(integer) to service_role;

-- Saúde/tamanho do banco para o CLI `npm run db:stats` (monitorar o free tier).
create or replace function public.fuel_db_stats()
returns table (
  db_size_mb numeric,
  fuel_rows bigint,
  oldest date,
  newest date
)
language sql
stable
as $$
  select
    round(pg_database_size(current_database()) / 1024.0 / 1024.0, 1) as db_size_mb,
    (select count(*) from public.fuel_prices) as fuel_rows,
    (select min(collected_at) from public.fuel_prices) as oldest,
    (select max(collected_at) from public.fuel_prices) as newest;
$$;

revoke execute on function public.fuel_db_stats() from public, anon, authenticated;
grant execute on function public.fuel_db_stats() to service_role;

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
