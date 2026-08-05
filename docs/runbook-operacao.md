# Runbook de operação — como honrar as promessas antes de automatizar

> **Problema que este documento resolve:** os documentos legais prometem estorno, reembolso
> proporcional, aviso antes de vencer e exclusão de dados. Nada disso existe no código ainda.
>
> **A saída não é apagar as promessas** — a maioria é obrigação legal, não escolha. A saída é
> **executá-las à mão de forma confiável enquanto o volume é pequeno**, com procedimento escrito
> para nada ser esquecido. Promessa cumprida por humano continua sendo promessa cumprida. O que
> mata é promessa que ninguém sabe como cumprir às 23h de um sábado.
>
> Hoje o risco real ainda é **zero**: o checkout está ligado ao backend (`DEMO = false`), mas com
> as **credenciais de teste** do Mercado Pago (`MERCADOPAGO_ENV=test`) — nenhum dinheiro circula.
> O risco começa quando as credenciais de produção entrarem — e é por isso que a §1 existe.

---

## 1. 🚦 Portão de go-live

**Nada de `MERCADOPAGO_ENV=production` antes de todas estas linhas estarem marcadas.** Não é
burocracia: cada item corresponde a uma promessa já publicada por escrito.

> **Por que o gatilho mudou de nome.** Este portão dizia "nada de `DEMO = false`" — o que fazia
> sentido quando o checkout era uma maquete. Hoje `DEMO` já é `false` e mesmo assim **nenhum
> dinheiro circula**, porque as credenciais são de teste. A bandeira que separa "não cobra" de
> "cobra de verdade" passou a ser `MERCADOPAGO_ENV`, e é ela que este portão protege. Manter o
> nome antigo faria a lista parecer violada quando não está — e uma lista que parece violada
> deixa de ser lida.

- [ ] Chave Pix cadastrada na conta do Mercado Pago
- [ ] Credenciais de **produção** no `.env` do backend (nunca no repositório, nunca no front)
- [ ] `MERCADOPAGO_ENV=production` **e** `NODE_ENV=production` no Render — o config recusa a
      cobrança se as duas não combinarem, e o log do boot é onde isso aparece
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

### 3.1 e 3.2 Reembolso — ✅ AUTOMATIZADO em 05/ago/2026

> **Não faça mais à mão.** As duas regras da política (integral em 7 dias, proporcional no anual)
> viraram código, e o acesso é encerrado na mesma operação — que era justamente o passo que
> dependia de alguém lembrar de rodar um `UPDATE`.

**Pré-requisito:** seu e-mail em `ADMIN_EMAILS` no ambiente do backend. Sem a variável, as rotas
respondem 503 para todo mundo (fail-closed).

**Passo 1 — localize a cobrança.**

```sql
select bc.id as charge_id, bc.plan, bc.amount_cents/100.0 as pago, bc.paid_at, bc.status
  from billing_charges bc
  join auth.users u on u.id = bc.user_id
 where u.email = 'cliente@exemplo.com'
 order by bc.paid_at desc nulls last;
```

**Passo 2 — veja o que a política manda devolver.** Não move dinheiro:

```bash
curl -s https://price-tracker-pro-api.onrender.com/api/billing/refund/<charge_id> \
  -H "Authorization: Bearer <seu_token_supabase>"
```

Devolve a regra aplicada (`cdc-7-dias`, `prorata-anual` ou `sem-reembolso`), o valor em centavos e
uma frase pronta para colar na resposta ao cliente.

**Passo 3 — execute**, repetindo o valor que veio no preview:

```bash
curl -s -X POST https://price-tracker-pro-api.onrender.com/api/billing/refund \
  -H "Authorization: Bearer <seu_token_supabase>" \
  -H "Content-Type: application/json" \
  -d '{"chargeId":"<charge_id>","expectedCents":3993}'
```

O `expectedCents` **tem de bater** com o calculado, senão a operação é recusada. Não é burocracia:
é a diferença entre "o sistema devolveu R$ 39,93" e "alguém digitou um número e o sistema
obedeceu". O pró-rata também cai a cada mês que passa, então confirmar o valor evita executar um
preview velho.

**O que acontece automaticamente:** estorno no provedor (total com corpo vazio, parcial com valor +
id da transação), `billing_charges.status = 'refunded'`, e a assinatura encerrada com
`status = 'refunded'` e `expires_at = agora`. **A linha nunca é apagada** — é prova fiscal e os
Termos prometem guardá-la.

**Se o provedor recusar** (falta de saldo é o caso comum), **nada é alterado no banco**. Ninguém
fica sem acesso e sem dinheiro. O log traz `[Billing] Provedor recusou o estorno`.

**Estorno feito pelo painel do Mercado Pago também corta o acesso agora** — a próxima consulta da
order vê `refunded` e encerra a assinatura sozinha. Era exatamente o furo que este runbook avisava:
"o estorno no painel não avisa o seu sistema".

<details>
<summary>Procedimento manual (guardado caso as rotas estejam fora)</summary>

1. Painel do Mercado Pago: **Atividade → a transação → Estornar**.
2. Corte o acesso na mão:
   ```sql
   update subscriptions set expires_at = now(), status = 'refunded'
    where charge_id = '<charge_id>';
   update billing_charges set status = 'refunded' where id = '<charge_id>';
   ```
3. Confira o pró-rata contra o exemplo publicado: cancelou no 4º mês → 8 meses restantes →
   `59,90 × 8 / 12 = R$ 39,93`.

</details>

**Prazos que continuam sendo seus:** confirmar o recebimento do pedido em até 2 dias úteis e
solicitar o estorno em até 5 dias úteis, como a política promete.

### 3.3 Aviso antes de vencer — ✅ AUTOMATIZADO em 04/ago/2026

> **Não precisa mais fazer à mão.** O aviso roda junto do job semanal da ANP
> (`scripts/ingest.ts`, disparado pelo GitHub Actions toda segunda 09:00 UTC).
>
> - Janela de **8 dias**, e não 7: o job é semanal, então 7 deixaria escapar quem vence 7,5 dias
>   depois de uma execução.
> - `warned_at` impede aviso repetido.
> - Quem renovou **não** recebe aviso pela assinatura antiga — o serviço só olha a de maior
>   vigência de cada usuário.
> - Roda **fora** do `if (ingestão teve sucesso)`: uma semana sem publicação da ANP não pode
>   deixar o assinante sem aviso.
>
> **O que ainda depende de você:** os secrets de SMTP e a variable `FRONTEND_URL` precisam estar
> configurados no GitHub Actions. Sem SMTP o aviso não sai (e o log diz isso); sem `FRONTEND_URL`
> o e-mail sai, mas sem o link de renovação.
>
> Para conferir se está funcionando, veja a saída do workflow na aba **Actions** — a linha
> `[ingest] Avisos de vencimento: N elegíveis · N enviados`.

<details>
<summary>Procedimento manual (guardado caso o automático falhe)</summary>

**Toda segunda-feira**, rode a segunda consulta da §2 e envie para cada e-mail listado:

> **Assunto:** Seu acesso ao Price Tracker Pro vence em X dias
>
> Oi! Seu plano *(mensal/anual)* vence em **DD/MM**. Não existe cobrança automática — se quiser
> continuar, é só renovar em precos-combustivel-br.vercel.app/premium. Se não renovar, sua conta
> volta ao uso gratuito e você não perde nada do que já salvou.

Registre o envio para não mandar duas vezes:
```sql
update subscriptions set warned_at = now() where charge_id = '<charge_id>';
```

Para forçar um reenvio (ex.: o e-mail voltou), limpe a marca:
```sql
update subscriptions set warned_at = null where charge_id = '<charge_id>';
```

</details>

### 3.4 Exclusão e exportação de dados (LGPD art. 18) — ✅ AUTOMATIZADO em 05/ago/2026

> **O próprio titular resolve, sem passar por você.** Duas rotas autenticadas, agindo sempre sobre
> a conta do token — não existe parâmetro de "qual usuário".

| O quê | Rota | Efeito |
|---|---|---|
| Cópia dos dados | `GET /api/account/export` | JSON com conta, favoritos, alertas, assinaturas e cobranças. Baixa como arquivo |
| Excluir a conta | `DELETE /api/account` com `{"confirm":"EXCLUIR MINHA CONTA"}` | Anonimiza o registro fiscal e remove o usuário |

⚠️ **O conflito que isso resolve:** a Política de Privacidade promete apagar os dados **e** guardar
os registros de pagamento por 5 anos. As duas coisas só coexistem **anonimizando** em vez de
deletar: `subscriptions.user_id` e `billing_charges.user_id` viram `null`, favoritos e alertas caem
em cascata, o usuário sai do `auth.users`. Valor e data continuam lá, sem apontar para pessoa
nenhuma.

A ordem no código é anonimizar **antes** de remover o usuário. Se a remoção falhar, sobra uma conta
com registro já desvinculado — recuperável, e o log grita. Na ordem inversa, uma falha deixaria
registro fiscal órfão ou apagado.

**Exclusão é imediata**, não em 30 dias. O prazo publicado é um teto, não uma meta.

> O `on delete set null` das duas colunas já estava certo desde a migração 003 — a preocupação
> registrada aqui ("ajuste antes do go-live") era infundada. Conferido em 05/ago/2026.

<details>
<summary>Procedimento manual (guardado caso as rotas estejam fora)</summary>

```sql
-- 1. Anonimiza o vínculo, preservando o registro fiscal
update subscriptions    set user_id = null
 where user_id = (select id from auth.users where email = 'cliente@exemplo.com');
update billing_charges  set user_id = null
 where user_id = (select id from auth.users where email = 'cliente@exemplo.com');

-- 2. Apaga os dados pessoais (favoritos e alertas caem em cascata)
delete from auth.users where email = 'cliente@exemplo.com';
```

</details>

Depois, confirme por e-mail que foi feito — o prazo de resposta de **15 dias** continua sendo seu.

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

### Por que essa ordem também é a melhor para nós

Risco para o cliente e custo de construção **apontam para o mesmo lugar** aqui, o que é sorte e
deve ser aproveitado:

| | Risco se falhar | O que já existe pronto | Esforço |
|---|---|---|---|
| **1. Aviso de vencimento** | Alto e **silencioso** — o cliente some sem reclamar, e você nem sabe que perdeu | **Quase tudo**: o job semanal do GitHub Actions já roda, e o Nodemailer já manda e-mail de alerta de preço | **Baixo** — é uma consulta e um template a mais no que já existe |
| **2. Estorno automático** | Alto, mas **barulhento** — o cliente reclama, você fica sabendo | Nada. Precisa de endpoint novo + integração de refund + webhook | Médio |
| **3. Exclusão de dados** | Baixo no curto prazo — a LGPD dá 30 dias | Nada | Médio |

O aviso de vencimento é **o de maior risco e o de menor custo ao mesmo tempo**. Não existe decisão
difícil aqui: é o primeiro, com folga.

> **Mas antes de qualquer um dos três:** com zero clientes, automatizar é fabricar estoque que pode
> nunca ser vendido. O certo agora é o **gate de assinatura** (§5) — sem ele o produto não é
> vendável — e o resto à mão, seguindo este runbook.

---

## 5. O gate de assinatura — a única coisa sem versão manual

> Ou o código checa `now() < expires_at` antes de deixar criar alerta, ou todo mundo tem acesso
> pago de graça. Não existe "fazer à mão" isso: são milhares de requisições.

**A boa notícia: ele não depende do Mercado Pago.** O gate lê a tabela `subscriptions` e compara
duas datas. Dá para construir e testar **hoje**, sem gateway nenhum, inserindo uma linha na mão:

```sql
-- Simula um assinante ativo, sem pagamento nenhum envolvido
insert into subscriptions
  (user_id, plan, status, starts_at, expires_at, provider, charge_id,
   amount_cents, paid_at, legal_version, accepted_at)
values
  ((select id from auth.users where email='seu@email.com'),
   'mensal','active', now(), now() + interval '1 month',
   'manual','teste-001', 1690, now(), '1.0', now());

-- Depois, para testar o bloqueio, expire na marra:
update subscriptions set expires_at = now() - interval '1 second'
 where charge_id = 'teste-001';
```

Por isso ele deveria ser **a primeira coisa construída**, antes de qualquer linha de pagamento.

### ⚠️ E tem um problema anterior a ele

Hoje **o plano grátis também tem alertas ilimitados**, enquanto a landing vende "alertas
ilimitados" como se fosse benefício do Premium. Ou seja: mesmo com o gate perfeito, **não há motivo
para ninguém pagar.**

O gate são, na prática, duas coisas:

1. **Limitar o plano grátis** (ex.: 1 ou 2 alertas) — é o que cria a razão de existir do Premium
2. **Checar assinatura ativa** para liberar o ilimitado

Fazer só a 2 é construir uma catraca numa porta que continua aberta do lado.
(Já apontado na §8 do `fase10-pagamentos.md`.)
