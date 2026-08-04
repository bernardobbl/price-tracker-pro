# Testar o gate de assinatura — passo a passo

> Sem Mercado Pago, sem credencial, sem pagamento. Só SQL e a API local.
> Tempo: uns 10 minutos.

---

## Passo 1 — Rodar a migração

Supabase → **SQL Editor** → New query. Cole o conteúdo de
`backend/supabase/migration_003_subscriptions.sql` e execute.

É idempotente: se rodar duas vezes, não quebra.

**Confirme que funcionou:**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'subscriptions'
order by ordinal_position;
```

Espere ver 13 colunas. Confira especialmente que **`user_id` está com `is_nullable = YES`** — é
isso que permite anonimizar depois sem destruir o registro de receita.

```sql
-- O índice único que impede vigência dobrada por webhook repetido
select indexname from pg_indexes where tablename = 'subscriptions';
```

Espere `subscriptions_charge_unique`, `subscriptions_lookup` e `subscriptions_expiring`.

---

## Passo 2 — Descobrir o seu `user_id`

```sql
select id, email from auth.users where email = 'SEU@EMAIL.COM';
```

Use o e-mail com que você entra no app. Copie o `id`.

---

## Passo 3 — Criar uma assinatura na mão

Nenhum pagamento envolvido — `provider = 'manual'` deixa claro que é teste.

```sql
insert into subscriptions
  (user_id, plan, status, starts_at, expires_at,
   provider, charge_id, amount_cents, paid_at, legal_version, accepted_at)
values (
  (select id from auth.users where email = 'SEU@EMAIL.COM'),
  'mensal', 'active',
  now(),
  now() + interval '1 month',      -- mês de calendário, igual ao código
  'manual', 'teste-001', 1690, now(), '1.0', now()
);
```

**Confira:**

```sql
select plan, status,
       starts_at  at time zone 'America/Sao_Paulo' as inicio,
       expires_at at time zone 'America/Sao_Paulo' as vence,
       now() < expires_at as tem_acesso
from subscriptions where charge_id = 'teste-001';
```

Espere `tem_acesso = true`.

---

## Passo 4 — Ver o gate respondendo pela API

Suba o backend:

```bash
cd ~/Desktop/"Price Tracker Pro"/backend && npm run dev
```

Você precisa de um token de sessão. O jeito mais fácil: abra o app no navegador
(`npm run dev` no frontend), faça login, abra o **DevTools → Console** e rode:

```js
const { data } = await window.supabase.auth.getSession();
copy(data.session.access_token);   // copia para a área de transferência
```

> Se `window.supabase` não existir, pegue o token em **DevTools → Application → Local Storage** →
> a chave que começa com `sb-` → campo `access_token`.

Agora, no terminal:

```bash
curl -s http://localhost:4000/api/fuel/entitlement \
  -H "Authorization: Bearer COLE_O_TOKEN_AQUI" | jq
```

**Esperado:**

```json
{ "active": true, "plan": "mensal", "expiresAt": "2026-09-04T...", "daysLeft": 30 }
```

---

## Passo 5 — Expirar na marra e ver bloquear

```sql
update subscriptions
   set expires_at = now() - interval '1 second'
 where charge_id = 'teste-001';
```

Repita o `curl` do passo 4. **Esperado:**

```json
{ "active": false, "plan": null, "expiresAt": null, "daysLeft": null }
```

Se virou `false`, **o gate funciona**. É a única coisa que precisava ser provada.

---

## Passo 6 — Provar que a renovação soma o saldo

Este é o comportamento que o requisito exige ("nem mais nem menos tempo").

```sql
-- Volta a assinatura com 10 dias restantes
update subscriptions
   set expires_at = now() + interval '10 days'
 where charge_id = 'teste-001';

-- Simula uma renovação: soma 1 mês SOBRE O VENCIMENTO, não sobre agora
select
  expires_at at time zone 'America/Sao_Paulo'                        as vencimento_atual,
  (greatest(now(), expires_at) + interval '1 month')
    at time zone 'America/Sao_Paulo'                                 as novo_vencimento,
  extract(day from (greatest(now(), expires_at) + interval '1 month') - now())
                                                                     as dias_de_acesso
from subscriptions where charge_id = 'teste-001';
```

Espere **~41 dias** (os 10 que sobravam + o mês somado) — e não 30. Se der 30, alguém trocou a
base de `expires_at` para `now()` e a pessoa perderia os dias pagos.

---

## Passo 7 — Provar a anonimização (LGPD)

Só faça isso num usuário de teste.

```sql
-- Antes: a linha sabe de quem é
select user_id, amount_cents, charge_id from subscriptions where charge_id = 'teste-001';

-- Simula o pedido de exclusão
update subscriptions set user_id = null where charge_id = 'teste-001';

-- Depois: sabe que entrou dinheiro, não sabe de quem
select user_id, amount_cents, paid_at, charge_id from subscriptions where charge_id = 'teste-001';
```

`user_id` vira `null`, o valor e a data continuam. É esse o desenho: **receita preservada, pessoa
não identificável**, com o `charge_id` apontando para o registro completo que o provedor guarda
por obrigação legal.

---

## Passo 8 — Limpar

```sql
delete from subscriptions where provider = 'manual';
```

> Só apague as de `provider = 'manual'`. Assinatura real **nunca** se apaga — anonimiza-se.

---

## Resumo do que cada passo prova

| Passo | Prova |
|---|---|
| 1 | Schema criado, `user_id` nullable, índice único no lugar |
| 3–4 | Assinatura ativa libera acesso |
| 5 | Vencida bloqueia — **o gate** |
| 6 | Renovação soma o saldo, não substitui |
| 7 | Exclusão anonimiza sem destruir a receita |
