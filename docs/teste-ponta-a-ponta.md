# Teste ponta a ponta do pagamento — roteiro

> Escrito em 05/ago/2026. É o último passo antes do PR da `feat/checkout-pix`.
> Tempo: **~30 min**, quase tudo esperando.
>
> **Faça este teste ANTES de qualquer outra pendência.** O porquê está na §0.

---

## 0. Por que este é o primeiro passo, e não os secrets nem as credenciais de produção

Você tem três pendências na mão e elas **não são intercambiáveis**:

| Pendência | Quando | Por quê |
|---|---|---|
| **Teste sandbox** | **agora** | Você já tem tudo para fazê-lo: as credenciais de teste estão no `.env` e as migrações estão rodadas. É o único item que ainda pode revelar um erro de arquitetura — e erro de arquitetura descoberto depois custa dez vezes mais. |
| Secrets de SMTP no Actions | depois do PR | Independente, ~10 min, e **sem urgência**: ninguém tem assinatura ainda, então não há vencimento para avisar. Fazer antes só adia o que importa. |
| Credenciais de produção | **por último** | É o único passo **irreversível**. No instante em que entram, dinheiro de verdade circula e a Política de Reembolso passa a ser exigível — sem endpoint de estorno. Antes disso tem o portão de go-live inteiro (`runbook-operacao.md` §1) e a revisão jurídica. |

A regra é simples: **o irreversível vem depois do que ainda pode ser corrigido de graça.**

---

## 1. ⚠️ Leia isto antes: um Pix de sandbox não pode ser pago

Este é o ponto em que o plano antigo estava errado, e vale entender antes de começar.

O `proximos-passos.md` dizia "pague com a conta de teste do Mercado Pago e veja o polling virar
pago". **Isso não funciona.** A documentação oficial é explícita: no ambiente de teste, o código
copia e cola devolvido **não é um Pix válido** — nenhum banco o reconhece, e a conta de teste do
Mercado Pago também não paga QR de Pix.

A saída oficial é uma **order de valores predefinidos**: mandando `payer.first_name = "APRO"`, a
order nasce `action_required` e **muda sozinha para aprovada** logo em seguida, como se alguém
tivesse pago.

**Isso já está no código** (`buildPayer` no `mercadoPagoClient.ts`), ligado automaticamente
quando `MERCADOPAGO_ENV=test`. Em produção o `APRO` nunca é enviado — e o config recusa o boot
na combinação `NODE_ENV=production` + `MERCADOPAGO_ENV=test`, então não há caminho para vazar.
Sete testes travam esse contrato (`test/mercadoPagoPayer.test.ts`).

### O que este teste prova e o que ele não prova

| ✅ Prova | ❌ Não prova |
|---|---|
| A cobrança é criada e gravada com o valor certo | Que um Pix real cai na conta (só produção prova) |
| O Mercado Pago aceita nosso corpo de order | O webhook (o Mercado Pago não alcança `localhost`) |
| A reconciliação do `GET /charge/:id` funciona | A validação `x-signature` (nem existe ainda) |
| A assinatura nasce com a vigência exata | |
| O gate passa a liberar o usuário | |

O webhook ficar de fora **não é um problema**: a reconciliação é justamente o caminho que
substitui o webhook quando ele falha. Se ela funciona, o sistema tem como confirmar um pagamento
mesmo sem notificação nenhuma — que é a garantia que importa.

---

## 2. Pré-requisito que trava tudo: a chave Pix

**Sem uma chave Pix cadastrada na conta do Mercado Pago, a API de orders não funciona.** Não é
"funciona pior" — ela recusa a criação e nada mais anda.

1. Entre no [painel do Mercado Pago](https://www.mercadopago.com.br/)
2. Menu esquerdo → **Pix** (vai direto para `mercadopago.com.br/pix/home/hub`)
3. Em **Minhas chaves**, confirme que existe **pelo menos uma chave cadastrada**

Se não houver, cadastre agora. É o único item deste roteiro que não dá para contornar.

> **O menu mudou de nome.** Este passo dizia "Seu negócio → Pix", e em 06/ago/2026 esse caminho
> já não existia — o item virou só **Pix**, na barra lateral. Custou uma pergunta no meio da
> execução, que é o tipo de atrito que um roteiro operacional existe para evitar.
>
> **A chave aleatória serve.** Não precisa ser CPF nem e-mail: a API só exige que a conta tenha
> alguma chave, e a aleatória é a que menos expõe dado pessoal.

---

## 3. Teste de fumaça (2 min) — antes de abrir o navegador

Vale muito a pena: isola "a conta do Mercado Pago está pronta" de "meu código está certo". Se
falhar aqui, o problema é a conta, não o app — e você economiza meia hora caçando fantasma.

```bash
cd ~/Desktop/"Price Tracker Pro"/backend
TOKEN=$(grep '^MERCADOPAGO_ACCESS_TOKEN=' .env | cut -d= -f2-)

curl -s -X POST https://api.mercadopago.com/v1/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: fumaca-$(date +%s)" \
  -d '{
    "type": "online",
    "total_amount": "1.00",
    "external_reference": "teste-de-fumaca",
    "processing_mode": "automatic",
    "transactions": { "payments": [ {
      "amount": "1.00",
      "payment_method": { "id": "pix", "type": "bank_transfer" }
    } ] },
    "payer": { "email": "test_user_br@testuser.com", "first_name": "APRO" }
  }' | head -c 1200
```

**Esperado:** um JSON com `"status": "action_required"` e um `"qr_code"` começando com `00020126`.

| Se vier | Significa |
|---|---|
| `401` / `invalid_token` | O token no `.env` está errado ou venceu |
| erro citando **chave Pix** / `collector` | A §2 não foi feita — cadastre a chave |
| `400` reclamando de campo | O contrato da API mudou; compare com o `mercadoPagoClient.ts` |

Anote o `id` da resposta. Dá para consultar a order de novo e ver ela aprovar sozinha:

```bash
sleep 20
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.mercadopago.com/v1/orders/COLE_O_ID_AQUI | head -c 400
```

Se o `status` já estiver `processed`, o mecanismo do `APRO` está funcionando na sua conta — e o
resto do teste é quase certo que vai passar.

---

## 4. O teste de verdade

### 4.1 Subir os dois lados

```bash
# terminal 1
cd ~/Desktop/"Price Tracker Pro"/backend && npm run dev

# terminal 2
cd ~/Desktop/"Price Tracker Pro"/frontend && npm run dev
```

**No log do backend, confira estas duas linhas:**

```
[MercadoPago] Configurado    env: "test"   validacaoDeAssinaturaDoWebhook: "NÃO IMPLEMENTADA"
```

Se aparecer `MERCADOPAGO_ENV deve ser "test" ou "production" — cobrança desligada`, o `.env` não
foi lido. Se **não aparecer linha nenhuma** do MercadoPago, o token está ausente e o checkout vai
responder 503.

### 4.2 Entrar no app

1. `http://localhost:5173`
2. **Faça login.** O checkout lê o token do Supabase no `localStorage` da mesma origem — sem
   sessão, ele nem deixa gerar a cobrança.

### 4.3 Abrir o checkout

`http://localhost:5173/checkout.html`

**Confira antes de clicar em nada:**

- [ ] Faixa amarela no topo: **"Ambiente de desenvolvimento — usando as credenciais de teste"**
- [ ] Seu e-mail aparece em **"Conta que vai receber o acesso"**
- [ ] O botão **"Gerar pagamento" está desabilitado** (o aceite é obrigatório)
- [ ] Os três links legais (Termos, Privacidade, Reembolso) abrem

Se a faixa disser "Modo demonstração", `DEMO` voltou a `true` — não é o que queremos testar.

### 4.4 Gerar a cobrança

Escolha **o plano anual** (R$ 59,90 — o valor maior torna um erro de preço mais visível), marque
o aceite, clique em **Gerar pagamento**.

**Esperado:**

- [ ] O painel do Pix abre com o **código copia e cola** preenchido
- [ ] O contador começa em **30:00**
- [ ] Status: *"Aguardando o pagamento…"* com o spinner girando

> 🟡 **Não estranhe: não vai aparecer imagem de QR.** O sandbox devolve
> `qr_code_base64` vazio, então a página mostra o placeholder e só o copia e cola. É esperado, e
> tem teste travando esse comportamento — se virasse `<img src="data:...,">` você veria um ícone
> de imagem quebrada. Em produção a imagem vem.

### 4.5 O momento que importa

**Não faça nada.** Em até ~1 minuto a tela deve virar sozinha para o painel de conclusão, com a
mensagem *"Seu acesso Premium anual foi liberado na conta …"*.

Isso é a reconciliação do `GET /charge/:id` funcionando: a página perguntou o status, o backend
foi conferir na API do Mercado Pago, viu a order aprovada, criou a assinatura e devolveu `paid`.
**Sem webhook nenhum.** É o coração do sistema, e é exatamente o que precisava ser provado.

> ⏱️ O polling agora é uma **escada**: 3s no 1º minuto, 10s até os 5 min, 30s depois. Então a
> confirmação chega em segundos. Se demorar mais que 1 min, veja a §5.

### 4.6 Conferir no banco

No SQL Editor do Supabase:

```sql
select
  c.status              as cobranca,
  c.amount_cents        as centavos,
  c.legal_version,
  s.plan,
  s.starts_at at time zone 'America/Sao_Paulo' as inicio,
  s.expires_at at time zone 'America/Sao_Paulo' as vence,
  age(s.expires_at, s.starts_at) as vigencia
from billing_charges c
left join subscriptions s on s.charge_id = c.id::text
order by c.created_at desc
limit 3;
```

**Esperado, linha a linha:**

- [ ] `cobranca` = **`paid`**
- [ ] `centavos` = **`5990`** ← se vier outro valor, o preço vazou para o front. É grave.
- [ ] `legal_version` = **`1.0`**
- [ ] `vigencia` = **`1 year`** exato (não 365 dias, não 11 meses e 30 dias)
- [ ] `vence` cai no **mesmo dia e mês** de hoje, um ano à frente

### 4.7 Conferir que o gate virou

Com a mesma sessão aberta, no terminal:

```bash
TOKEN_APP="cole-aqui-o-access_token-do-localStorage"
curl -s http://localhost:4000/api/fuel/entitlement -H "Authorization: Bearer $TOKEN_APP"
```

**Esperado:** `{"active":true,"plan":"anual","expiresAt":"2027-…","daysLeft":364}`

> Para pegar o token: DevTools → Application → Local Storage → `localhost:5173` → a chave
> `sb-…-auth-token` → campo `access_token`.

### 4.8 Testar a idempotência (1 min, e vale muito)

É o cenário que mais dá prejuízo em produção — webhook chegando duas vezes e dobrando a vigência.

Chame o `GET /charge/:id` de novo com o id da cobrança que acabou de ser paga:

```bash
curl -s http://localhost:4000/api/billing/charge/COLE_O_CHARGE_ID \
  -H "Authorization: Bearer $TOKEN_APP"
```

Depois rode de novo a consulta da §4.6.

**Esperado:** continua existindo **exatamente uma** linha em `subscriptions`. Se aparecerem duas,
pare tudo — a idempotência furou e isso é bloqueador de produção.

---

## 5. Se algo falhar

Em ordem de probabilidade:

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Botão gera erro "Não conseguimos gerar a cobrança" | Chave Pix não cadastrada | §2. O log do backend traz a mensagem do provedor |
| 503 `BILLING_DISABLED` | `MERCADOPAGO_ACCESS_TOKEN` ou `MERCADOPAGO_ENV` ausente | Confira o `.env` e reinicie o `npm run dev` |
| Erro de CORS no console | `FRONTEND_URL` do backend não inclui `localhost:5173` | Hoje ele **não está no `.env`**, e o padrão já é `http://localhost:5173` — se você adicionar a variável, inclua essa origem na lista |
| "Sua sessão expirou" | Token do Supabase venceu | Recarregue o app e entre de novo |
| Fica em "Aguardando" para sempre | A order não aprovou sozinha | Consulte a order pelo curl da §3. Se o status estiver `action_required` parado, o `APRO` não pegou — confira que `MERCADOPAGO_ENV=test` e procure no log a linha *"enviando payer.first\_name=APRO"* |
| 400 `legalVersion deve ser uma versão conhecida` | `LEGAL_VERSION` no `checkout.html` divergiu da lista branca | Alinhe com `backend/src/lib/legalVersions.ts` |

**Para ver o que o backend está fazendo**, o log é generoso: cada etapa (`Configurado`, `APRO`,
`Assinatura criada a partir de pagamento confirmado`) sai nomeada.

---

## 6. Depois que passar

1. **Marque no `proximos-passos.md`** que o teste foi feito, com a data.
2. **Tire o "rascunho" do `PR_BODY.md`** (a linha de aviso no topo) — a descrição passa a poder
   afirmar que o fluxo funciona.
3. **Abra o PR**:
   ```bash
   git push -u origin feat/checkout-pix
   gh pr create --base main --head feat/checkout-pix \
     --title "feat: checkout Pix com Mercado Pago, gate de assinatura e documentos legais" \
     --body-file docs/PR_BODY.md
   ```
4. **Limpe o dado de teste** do Supabase, para não confundir a assinatura falsa com a primeira
   real:
   ```sql
   delete from subscriptions where charge_id in (
     select id::text from billing_charges where status = 'paid'
   );
   delete from billing_charges;
   ```
   (Só faça isso enquanto **não houver nenhum cliente real** — que é o caso hoje.)

Aí sim os secrets de SMTP, e só bem depois as credenciais de produção.

---

**Fonte da mecânica do sandbox:**
[Perform a Test Purchase with Pix — Mercado Pago Developers](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix)
