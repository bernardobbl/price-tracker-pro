# Vigência do acesso — especificação

> **Requisito do Bernardo (04/ago/2026), literal:** *"quem pagou o anual fica o ano todo no plano
> exatamente, e quem pagou um mês fica exatamente um mês. Não quero erro de ficarem mais tempo do
> que foi pago nem menos tempo."*
>
> Este documento existe porque "exatamente um mês" é ambíguo em software e **cada ambiguidade não
> resolvida vira um bug que dá dinheiro de graça ou tira acesso pago**. Cada decisão abaixo tem a
> justificativa junto.

---

## 1. A regra em uma frase

```
expires_at = starts_at + (1 mês | 12 meses)
acesso liberado  ⟺  agora < expires_at
```

`starts_at` é o **momento da confirmação do pagamento**, não o da criação da cobrança.

---

## 2. As seis decisões que evitam os bugs

### 2.1 O relógio começa quando o pagamento é CONFIRMADO

O usuário pode gerar o QR e pagar 10 minutos depois — ou nunca. Se o relógio começasse na criação
da cobrança, ele perderia esse tempo.

> **Regra:** `starts_at` = horário em que o webhook de pagamento aprovado é processado.
> Sem pagamento confirmado, não existe registro de vigência.

### 2.2 O horário é o do SERVIDOR, em UTC, e nunca o do navegador

O relógio do celular do usuário pode estar errado ou adulterado. Guardar em UTC e converter só na
exibição elimina uma classe inteira de bug (usuário no Acre veria vencimento diferente do usuário
em São Paulo).

> **Regra:** gravar `timestamptz` em **UTC**, gerado pelo banco (`now()`), nunca vindo do cliente.
> Exibir convertido para `America/Sao_Paulo`.
>
> O `acceptedAt` que o `checkout.html` envia serve só de referência de auditoria — **a hora que
> vale é a do servidor.**

### 2.3 Virada de mês: 31 de janeiro + 1 mês = 28 de fevereiro

Este é *o* clássico. Não existe 31 de fevereiro. Se você somar 30 dias, quem paga em fevereiro
ganha mais tempo que quem paga em março, e o "exatamente 1 mês" morre.

> **Regra:** usar aritmética de calendário com **clamp para o último dia do mês**.
> Em Postgres, `+ interval '1 month'` já faz isso corretamente.

| Pagou em | Vence em | Por quê |
|---|---|---|
| 31/jan | 28/fev (ou 29 em bissexto) | fevereiro não tem dia 31 |
| 31/mar | 30/abr | abril não tem dia 31 |
| 15/mai | 15/jun | caso normal |
| 29/fev/2028 (bissexto), anual | 28/fev/2029 | 2029 não é bissexto |

> ⚠️ **Não use "30 dias" nem "365 dias".** Meses têm 28–31 dias e anos têm 365 ou 366. Somar dias
> fixos quebra o requisito nos dois sentidos.

#### Por que 30 dias fixos foi descartado (discutido em 04/ago/2026)

A proposta era usar 30 dias por ser "mais prático e igual para todo mundo". Três motivos derrubaram:

1. **Contradiz o que é vendido.** A interface diz "mensal" e os Termos dizem "exatamente 1 mês".
   Em 7 dos 12 meses, 30 dias é *menos* que um mês — quem paga em 1º de janeiro perde o dia 31.
   Isso é o "menos tempo do que foi pago" que o requisito proíbe.
2. **A data foge pelo calendário.** Pagou 15/jan → vence 14/fev → 16/mar → 15/abr. O cliente nunca
   sabe de cabeça quando vence. Com mês de calendário é sempre "o mesmo dia do mês seguinte", que
   é como toda assinatura que ele já conhece funciona.
3. **Quebra a coerência com o anual.** 12 × 30 = **360 dias**, contra 365 do anual. Doze pagamentos
   mensais deveriam equivaler a um anual, e não equivaleriam — o cliente perderia **5 dias por ano**.

E o argumento de praticidade não se sustenta: **mês de calendário não dá trabalho nenhum a mais.**
O Postgres já faz o clamp sozinho — `+ interval '1 month'` devolve 28/fev para 31/jan. É um
operador, não um bloco de exceções.

> **Decisão:** mês de calendário com clamp, nos dois planos.

### 2.4 Renovar antes de vencer SOMA ao saldo, não substitui

Se alguém com 20 dias restantes paga de novo e o sistema fizer `expires_at = agora + 1 mês`, essa
pessoa **perde 20 dias que pagou**. É exatamente o "menos tempo do que foi pago" que o requisito
proíbe.

> **Regra:**
> ```
> base = MAX(agora, expires_at_atual)
> expires_at_novo = base + intervalo_do_plano
> ```
> Se a assinatura anterior já venceu, `base` é agora (não dá crédito retroativo por período
> parado). Se ainda está ativa, `base` é o vencimento (soma).

### 2.5 O corte é `<`, e o vencimento é o instante exato

> **Regra:** o acesso vale enquanto `now() < expires_at`. No instante exato do vencimento, acabou.
> Sem "meia-noite do dia seguinte", sem tolerância — é o que "exatamente" significa.

### 2.6 Estorno encerra na hora

Se o reembolso for feito (7 dias do CDC ou proporcional), o acesso não pode continuar até a data
original.

> **Regra:** ao processar o webhook de estorno, `expires_at = now()` e `status = 'refunded'`.
> **Nunca apague a linha** — o histórico é prova fiscal e de auditoria.

---

## 3. Modelo de dados (proposta)

```sql
create table subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,

  plan         text not null check (plan in ('mensal','anual')),
  status       text not null check (status in ('active','expired','refunded')),

  -- Vigência. Ambos em UTC, ambos gerados pelo servidor.
  starts_at    timestamptz not null,
  expires_at   timestamptz not null,

  -- Rastro do pagamento
  provider     text not null default 'mercadopago',
  charge_id    text not null,              -- id da order no Mercado Pago
  amount_cents int  not null,              -- quanto FOI pago de fato
  paid_at      timestamptz not null,

  -- Prova do aceite (ver docs legais)
  legal_version text not null,             -- ex.: '1.0'
  accepted_at   timestamptz not null,

  created_at   timestamptz not null default now(),

  constraint vigencia_valida check (expires_at > starts_at)
);

-- Uma cobrança só pode virar UMA assinatura: se o webhook chegar duas vezes
-- (e ele chega), a segunda tentativa esbarra aqui em vez de dobrar a vigência.
create unique index subscriptions_charge_unique on subscriptions (provider, charge_id);

-- Consulta quente: "esse usuário tem acesso agora?"
create index subscriptions_lookup on subscriptions (user_id, expires_at desc);
```

### O cálculo, em SQL

```sql
-- Renovação que soma ao saldo restante (decisão 2.4)
insert into subscriptions (user_id, plan, status, starts_at, expires_at, ...)
values (
  $1, $2, 'active',
  now(),
  greatest(
    now(),
    coalesce((select max(expires_at) from subscriptions
               where user_id = $1 and status = 'active'), now())
  ) + case $2 when 'anual' then interval '12 months'
              else interval '1 month' end,
  ...
);
```

### A verificação

```sql
-- Tem acesso pago agora?
select exists (
  select 1 from subscriptions
  where user_id = $1 and status = 'active' and now() < expires_at
);
```

---

## 4. Onde o gate é aplicado

Em **dois lugares**, e os dois são necessários:

1. **No backend**, antes de qualquer ação paga. O backend usa a `service_role` do Supabase, que
   **ignora RLS** — então a checagem em código é a que realmente protege.
2. **Em RLS**, como segunda linha de defesa para acesso direto do cliente ao banco.

> ⚠️ Nunca confie no frontend para isso. Esconder o botão é experiência do usuário, não segurança.

---

## 5. Testes obrigatórios antes de ligar dinheiro real

Cada um destes corresponde a um bug que o requisito proíbe:

| # | Cenário | Esperado |
|---|---|---|
| 1 | Mensal pago em 31/jan | vence 28/fev (29 em bissexto) |
| 2 | Mensal pago em 31/mar | vence 30/abr |
| 3 | Anual pago em 29/fev/2028 | vence 28/fev/2029 |
| 4 | Renova com 20 dias restantes | novo vencimento = antigo + 1 mês (**não perde os 20 dias**) |
| 5 | Renova 5 dias depois de vencido | conta a partir de agora (sem crédito retroativo) |
| 6 | Webhook do mesmo `charge_id` chega 2x | cria **uma** assinatura só; a 2ª é ignorada |
| 7 | 1 segundo antes do `expires_at` | acesso liberado |
| 8 | 1 segundo depois do `expires_at` | acesso bloqueado |
| 9 | Estorno processado | `expires_at = now()`, acesso cai na hora, linha preservada |
| 10 | Pagamento nunca concluído | nenhuma assinatura criada |

Todos são testáveis como funções puras de data + testes de integração no webhook, sem depender do
Mercado Pago estar no ar.

---

## 6. O aviso antes de vencer

Os Termos e a página de checkout **prometem** aviso por e-mail antes do vencimento. Isso é
obrigação assumida — precisa existir.

> **Proposta:** reaproveitar o job semanal que já roda a ingestão da ANP. Ele varre
> `subscriptions` e envia aviso quando faltam **7 dias** (anual e mensal) e novamente em **1 dia**.
> Marcar o envio na linha para não mandar duas vezes.

Sem isso, o mensal vira uma armadilha silenciosa — a pessoa perde acesso sem entender por quê.
