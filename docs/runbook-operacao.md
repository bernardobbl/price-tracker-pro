# Runbook de operação — como honrar as promessas antes de automatizar

> **Problema que este documento resolve:** os documentos legais prometem estorno, reembolso
> proporcional, aviso antes de vencer e exclusão de dados. Nada disso existe no código ainda.
>
> **A saída não é apagar as promessas** — a maioria é obrigação legal, não escolha. A saída é
> **executá-las à mão de forma confiável enquanto o volume é pequeno**, com procedimento escrito
> para nada ser esquecido. Promessa cumprida por humano continua sendo promessa cumprida. O que
> mata é promessa que ninguém sabe como cumprir às 23h de um sábado.
>
> Hoje o risco real é **zero**: `DEMO = true`, nenhum cliente. O risco começa no dia em que você
> virar a chave — e é por isso que a §1 existe.

---

## 1. 🚦 Portão de go-live

**Nada de `DEMO = false` antes de todas estas linhas estarem marcadas.** Não é burocracia: cada
item corresponde a uma promessa já publicada por escrito.

- [ ] Chave Pix cadastrada na conta do Mercado Pago
- [ ] Credenciais de **produção** no `.env` do backend (nunca no repositório, nunca no front)
- [ ] Webhook apontando para a URL de produção e **testado** com um pagamento real de R$ 0,01 seu
- [ ] Tabela `subscriptions` criada, com o índice único por `charge_id`
- [ ] Os 10 testes de `vigencia-do-acesso.md` §5 passando
- [ ] **Este runbook lido uma vez** e os comandos da §3 testados no Supabase com dado falso
- [ ] Uma **planilha ou consulta salva** com todas as assinaturas ativas e vencimentos (§2)
- [ ] Lembrete recorrente semanal no seu calendário: *"rodar a checagem de vencimento"*
- [ ] Revisão jurídica dos 3 documentos concluída
- [ ] `LEGAL_VERSION` no `checkout.html` conferido contra a versão publicada nos documentos

> **Se você só puder fazer uma coisa desta lista:** o lembrete no calendário. É o único item que
> protege um cliente pagante de perder acesso sem aviso — e é grátis.

---

## 2. Painel do pobre — o que olhar toda semana

Sem tela de admin, uma consulta resolve. Salve como *saved query* no Supabase.

```sql
-- Quem está ativo, e quanto falta
select
  u.email,
  s.plan,
  s.starts_at at time zone 'America/Sao_Paulo' as inicio,
  s.expires_at at time zone 'America/Sao_Paulo' as vence,
  date_trunc('day', s.expires_at - now()) as falta,
  s.amount_cents / 100.0 as pago,
  s.charge_id
from subscriptions s
join auth.users u on u.id = s.user_id
where s.status = 'active' and s.expires_at > now()
order by s.expires_at;
```

```sql
-- Quem vence nos próximos 7 dias  → PRECISA de aviso por e-mail
select u.email, s.plan,
       s.expires_at at time zone 'America/Sao_Paulo' as vence
from subscriptions s
join auth.users u on u.id = s.user_id
where s.status = 'active'
  and s.expires_at between now() and now() + interval '7 days'
order by s.expires_at;
```

---

## 3. Procedimentos

### 3.1 Cliente pede reembolso dentro de 7 dias (art. 49 do CDC)

Devolução **integral**, sem discutir, mesmo que ele tenha usado.

1. Confirme por e-mail que recebeu o pedido (prometido: **2 dias úteis**).
2. Localize a cobrança:
   ```sql
   select id, charge_id, amount_cents, plan, paid_at
   from subscriptions s join auth.users u on u.id = s.user_id
   where u.email = 'cliente@exemplo.com' order by paid_at desc limit 1;
   ```
3. No painel do Mercado Pago: **Atividade → a transação → Estornar**, valor total.
4. ⚠️ **Corte o acesso na mesma hora** — o estorno no painel não avisa o seu sistema:
   ```sql
   update subscriptions
      set expires_at = now(), status = 'refunded'
    where charge_id = '<charge_id>';
   ```
   **Nunca apague a linha.** Ela é prova fiscal e você prometeu guardar por 5 anos.
5. Responda ao cliente confirmando, com o prazo do banco.

### 3.2 Reembolso proporcional do anual (depois dos 7 dias)

A política promete devolver os **meses inteiros ainda não usados**.

```sql
-- Calcula o valor a devolver
select
  s.amount_cents / 100.0                                       as pago,
  floor(extract(epoch from (s.expires_at - now())) / 2629746)   as meses_inteiros_restantes,
  round(
    s.amount_cents / 100.0
    * floor(extract(epoch from (s.expires_at - now())) / 2629746)
    / 12
  , 2)                                                          as devolver
from subscriptions s join auth.users u on u.id = s.user_id
where u.email = 'cliente@exemplo.com' and s.status = 'active';
```

Confira contra o exemplo publicado na política: cancelou no 4º mês → 8 meses restantes →
`59,90 × 8 / 12 = R$ 39,93`. Depois, estorno parcial no painel e o mesmo `update` do passo 3.1.4.

### 3.3 Aviso antes de vencer ⚠️ *o mais fácil de esquecer*

**Toda segunda-feira**, rode a segunda consulta da §2 e envie para cada e-mail listado:

> **Assunto:** Seu acesso ao Price Tracker Pro vence em X dias
>
> Oi! Seu plano *(mensal/anual)* vence em **DD/MM**. Não existe cobrança automática — se quiser
> continuar, é só renovar em precos-combustivel-br.vercel.app/premium. Se não renovar, sua conta
> volta ao uso gratuito e você não perde nada do que já salvou.

Registre o envio para não mandar duas vezes:
```sql
alter table subscriptions add column if not exists warned_at timestamptz;
update subscriptions set warned_at = now() where charge_id = '<charge_id>';
```

### 3.4 Pedido de exclusão de dados (LGPD art. 18)

Prazo prometido: resposta em **15 dias**, exclusão em **30**.

⚠️ **Atenção ao conflito:** você prometeu apagar os dados *e* guardar o registro de pagamento por
5 anos. Os dois se resolvem **anonimizando** em vez de deletar tudo.

```sql
-- 1. Anonimiza o vínculo, preservando o registro fiscal
update subscriptions
   set user_id = null
 where user_id = (select id from auth.users where email = 'cliente@exemplo.com');

-- 2. Apaga os dados pessoais (favoritos e alertas caem em cascata)
delete from auth.users where email = 'cliente@exemplo.com';
```
> Para isso funcionar, `subscriptions.user_id` precisa aceitar `null` e usar
> `on delete set null` em vez de `cascade`. **Ajuste antes do go-live** — ver
> `vigencia-do-acesso.md` §3.

Depois, confirme por e-mail que foi feito.

### 3.5 Pagou e o acesso não liberou

O caso mais provável de suporte: o webhook falhou (cold start do Render, timeout, deploy no ar).

1. Confirme o pagamento no painel do Mercado Pago (status *aprovado*).
2. Libere na mão, com a mesma regra de data do doc de vigência:
   ```sql
   insert into subscriptions
     (user_id, plan, status, starts_at, expires_at,
      provider, charge_id, amount_cents, paid_at, legal_version, accepted_at)
   values (
     (select id from auth.users where email = 'cliente@exemplo.com'),
     'anual', 'active',
     now(),
     greatest(now(), coalesce(
       (select max(expires_at) from subscriptions
         where user_id = (select id from auth.users where email='cliente@exemplo.com')
           and status = 'active'), now()))
     + interval '12 months',
     'mercadopago', '<charge_id>', 5990, now(), '1.0', now()
   );
   ```
3. Peça desculpa e diga que foi resolvido. Anote a causa — se repetir, o webhook precisa de retry.

---

## 4. Até quando o manual aguenta

| Assinantes ativos | Situação | O que fazer |
|---|---|---|
| **1 – 10** | Manual funciona bem. Poucos minutos por semana. | Seguir este runbook |
| **10 – 30** | Começa a doer. Esquecer um aviso vira questão de tempo. | **Automatizar o aviso de vencimento** (Etapa B) — é o de maior risco e o mais fácil, reaproveita o job semanal da ANP |
| **30 +** | Manual é irresponsável. | Automatizar também estorno e exclusão |

> A ordem de automação segue o **risco para o cliente**, não a dificuldade:
> 1. **Aviso de vencimento** — falhar aqui prejudica quem está pagando, em silêncio
> 2. **Estorno + corte de acesso** — falhar aqui é problema legal
> 3. **Exclusão de dados** — prazo de 30 dias dá folga para fazer à mão por mais tempo

---

## 5. O que NÃO dá para resolver à mão

Uma coisa só, e ela é inegociável antes do go-live:

> **A verificação de assinatura ativa no backend.** Não existe versão manual disso — ou o código
> checa `now() < expires_at` antes de deixar criar alerta, ou todo mundo tem acesso pago de graça.
> É a única linha da Etapa A que não pode esperar.
