-- ═══════════════════════════════════════════════════════════════════════════
-- Migração 003 — assinaturas (gate de acesso pago)
--
-- Especificação: docs/vigencia-do-acesso.md
-- Idempotente: pode rodar mais de uma vez sem quebrar.
--
-- Esta migração NÃO depende de gateway nenhum. Dá para criar a tabela, inserir
-- uma assinatura na mão e testar o gate inteiro antes de existir pagamento.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists subscriptions (
  id            uuid primary key default gen_random_uuid(),

  -- `on delete set null` + nullable DE PROPÓSITO: no pedido de exclusão (LGPD)
  -- anonimizamos a linha zerando este campo, sem destruir o registro de receita.
  -- O `charge_id` continua apontando para o registro completo no provedor, que
  -- é quem tem obrigação legal de guardá-lo. Trocar isto depois é migração.
  user_id       uuid references auth.users(id) on delete set null,

  plan          text not null check (plan in ('mensal', 'anual')),
  status        text not null check (status in ('active', 'expired', 'refunded')),

  -- Vigência. Sempre timestamptz (UTC), sempre gerada pelo servidor.
  starts_at     timestamptz not null,
  expires_at    timestamptz not null,

  -- Rastro do pagamento
  provider      text not null default 'mercadopago',
  charge_id     text not null,
  amount_cents  integer not null check (amount_cents >= 0),
  paid_at       timestamptz not null,

  -- Prova do aceite dos documentos legais
  legal_version text not null,
  accepted_at   timestamptz not null,

  -- Controle do aviso de vencimento (ver runbook-operacao.md §3.3)
  warned_at     timestamptz,

  created_at    timestamptz not null default now(),

  constraint vigencia_valida check (expires_at > starts_at)
);

-- Uma cobrança vira UMA assinatura. Webhook chega duas vezes — é garantido,
-- não hipótese. Sem este índice a vigência dobra silenciosamente.
create unique index if not exists subscriptions_charge_unique
  on subscriptions (provider, charge_id);

-- Consulta quente: "esse usuário tem acesso agora?"
create index if not exists subscriptions_lookup
  on subscriptions (user_id, expires_at desc);

-- Varredura do aviso de vencimento
create index if not exists subscriptions_expiring
  on subscriptions (expires_at) where status = 'active';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Segunda linha de defesa. A PRIMEIRA é a checagem no backend, porque ele usa
-- a service_role e ela IGNORA RLS.
alter table subscriptions enable row level security;

drop policy if exists "assinatura visível só para o dono" on subscriptions;
create policy "assinatura visível só para o dono"
  on subscriptions for select
  using (auth.uid() = user_id);

-- Ninguém escreve pelo cliente: só o backend (service_role) cria assinatura.
-- A ausência de policy de insert/update/delete já bloqueia — explicitado aqui
-- para quem ler não achar que foi esquecimento.

comment on table subscriptions is
  'Assinaturas pagas. Vigência em mês de calendário — ver docs/vigencia-do-acesso.md.';
comment on column subscriptions.user_id is
  'Nulo = linha anonimizada a pedido do titular (LGPD). O registro de receita permanece.';
comment on column subscriptions.expires_at is
  'Acesso vale enquanto now() < expires_at. Corte estrito, sem tolerância.';
