-- ═══════════════════════════════════════════════════════════════════════════
-- Migração 004 — cobranças (a ponte entre o checkout e a assinatura)
--
-- Por que esta tabela existe: quando o webhook chega, ele traz só o id da order
-- no Mercado Pago. Sem um registro nosso, não há como saber **quem** pagou e
-- **qual plano** — o webhook não carrega isso, e confiar no que ele carregasse
-- seria aceitar que qualquer um libere acesso.
--
-- O caminho é: criamos a cobrança aqui (pending) → mandamos o id dela ao
-- Mercado Pago como `external_reference` → o webhook volta com esse id → nós
-- reconsultamos a API para saber a verdade → viramos para `paid` e criamos a
-- assinatura.
--
-- Idempotente: pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists billing_charges (
  id            uuid primary key default gen_random_uuid(),

  -- Mesmo desenho da tabela subscriptions: nullable com `set null`, para
  -- permitir anonimizar a pedido do titular (LGPD) sem apagar o registro de
  -- receita. Ver docs/vigencia-do-acesso.md.
  user_id       uuid references auth.users(id) on delete set null,

  plan          text not null check (plan in ('mensal', 'anual')),
  -- Valor decidido pelo BACKEND a partir do plano. O front nunca envia preço.
  amount_cents  integer not null check (amount_cents > 0),

  status        text not null default 'pending'
                check (status in ('pending', 'paid', 'expired', 'cancelled', 'refunded')),

  provider          text not null default 'mercadopago',
  -- Id da order no provedor. Nulo entre criar a linha e a API responder.
  provider_order_id text,

  -- Prova do aceite dos documentos legais, capturada no checkout.
  legal_version text not null,
  accepted_at   timestamptz not null,

  created_at    timestamptz not null default now(),
  paid_at       timestamptz,

  -- Só pode existir data de pagamento se estiver paga, e vice-versa.
  constraint pago_tem_data check (
    (status = 'paid' and paid_at is not null) or (status <> 'paid')
  )
);

-- Uma order do provedor mapeia para UMA cobrança nossa. O webhook chega mais de
-- uma vez (é garantido, não hipótese) e é este índice que impede duas linhas.
create unique index if not exists billing_charges_provider_order_unique
  on billing_charges (provider, provider_order_id)
  where provider_order_id is not null;

create index if not exists billing_charges_user
  on billing_charges (user_id, created_at desc);

-- Varredura de cobranças pendentes (expiração / conciliação)
create index if not exists billing_charges_pending
  on billing_charges (created_at) where status = 'pending';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Segunda linha de defesa. A primeira é a checagem no backend, que usa a
-- service_role e ignora RLS.
alter table billing_charges enable row level security;

drop policy if exists "cobrança visível só para o dono" on billing_charges;
create policy "cobrança visível só para o dono"
  on billing_charges for select
  using (auth.uid() = user_id);

-- Sem policy de insert/update/delete: só o backend escreve aqui. Explicitado
-- para quem ler não achar que foi esquecimento.

comment on table billing_charges is
  'Cobranças criadas no checkout. Vira assinatura quando o pagamento é confirmado pela API do provedor.';
comment on column billing_charges.provider_order_id is
  'Id da order no provedor; é o que o webhook traz e o que reconsultamos para saber a verdade.';
comment on column billing_charges.amount_cents is
  'Decidido pelo backend a partir do plano. O frontend nunca envia valor.';
