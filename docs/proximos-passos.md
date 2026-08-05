# Próximos passos — retomar daqui

> **Para o Bernardo do futuro.** Escrito em 04/ago/2026 no fim de uma sessão, para você conseguir
> voltar sem reler tudo. **Atualizado em 05/ago/2026 (noite)** — segunda varredura de pontas
> soltas, três corrigidas e uma aberta (§0). Comece por aqui.
>
> **Branch:** `feat/checkout-pix` → [PR #22](https://github.com/bernardobbl/price-tracker-pro/pull/22).

---

## 0. 🔎 Segunda varredura — 05/ago/2026 (noite)

Revisão independente da branch depois da auditoria, procurando o que tinha escapado. Verificado
do zero: `tsc` limpo nos dois pacotes, `eslint` limpo nos dois, **209 testes no backend e 61 no
frontend passando**, working tree limpo, nenhum `.env` versionado.

### ✅ Corrigido nesta varredura

| # | O quê | Onde | Por que importava |
|---|---|---|---|
| 1 | O Resumo do checkout dizia **"renova todo mês"** no plano mensal | `checkout.html` (`PLANS.mensal.cycle`) | Era a **única linha do produto a prometer débito automático**, ao lado do preço, numa tela de pagamento. Todo o resto — a própria página três linhas abaixo, a `premium.html` e a Política de Reembolso — diz "compra avulsa, sem cobrança automática". Sobrou do texto anterior ao merge da `main`, que arrumou a `premium.html` e não o objeto `PLANS`. Agora: **"1 mês de acesso"**. |
| 2 | `render.yaml` **não declarava nenhuma variável `MERCADOPAGO_*`** | `render.yaml` | O blueprint é o registro de quais variáveis o serviço precisa. Sem as quatro ali, um serviço recriado a partir dele sobe com a cobrança desligada (503 no checkout) e nada no arquivo explica o porquê. Adicionadas como `sync: false` — os valores continuam no painel, só a dependência ficou visível. |
| 3 | Três docs desatualizados | `billingService.ts`, `runbook-operacao.md` §1, `fase10-pagamentos.md` | O comentário do `getChargeStatus` ainda dizia "a página consulta a cada 4s" (é escada desde a auditoria); o portão de go-live disparava em `DEMO = false`, que **já é false** — o gatilho certo é `MERCADOPAGO_ENV=production`, e um portão que parece violado deixa de ser lido; o `fase10-pagamentos.md` abria dizendo "só existe na branch `feat/premium-landing`" e "nada implementado", com AbacatePay no título. |

### ⚠️ Aberto — o app React não sabe que a assinatura existe

**O achado que sobrou, e o único com efeito para quem paga.**

`GET /api/fuel/entitlement` foi construído "para a interface" — e **nenhuma interface o consulta**.
`grep -rn "entitlement\|premium" frontend/src` não devolve **uma linha**. Na prática:

- quem **paga** volta para o app e não vê diferença nenhuma: nenhum selo, nenhuma data de
  vencimento, nenhuma confirmação de que o dinheiro virou alguma coisa. A única prova é o email;
- quem **não paga** não tem como chegar ao checkout de dentro do app: o rodapé linka Termos,
  Privacidade e Reembolso, e nada aponta para `/premium`.

Não é bug — é um pedaço que nunca foi escrito, e não bloqueia o merge, porque hoje o plano grátis
é idêntico ao pago (`FREE_ALERT_LIMIT = Infinity`) e a landing é a porta de entrada real.
**Vira problema no dia em que o limite do grátis ligar:** o gate responderá 402 numa tela que não
sabe explicar o que aconteceu nem para onde mandar a pessoa.

O menor passo útil, quando for a hora: ler o `entitlement` no boot do app, mostrar "Premium até
DD/MM" para quem tem, e um link para `/premium` para quem não tem. Trate isso como pré-requisito
do item "limitar alertas do plano grátis" da Etapa C — os dois só fazem sentido juntos.

---

## 🔴 RETOMAR AQUI — o que fazer na próxima sessão

**270 testes passam** (209 backend + 61 frontend). O fluxo de checkout Pix foi exercitado de
ponta a ponta em 05/ago/2026 — cobrança criada, APRO aprovou sozinho (~7s), reconciliação via
polling, assinatura no banco, gate `active: true`. Registro completo em
[`docs/teste-ponta-a-ponta.md`](./teste-ponta-a-ponta.md).

### 1. Merge do PR #22

A branch está pronta. Depois do merge na `main`:

- A Vercel faz deploy automático do frontend (checkout, documentos legais, visual).
- O backend no Render precisa das variáveis `MERCADOPAGO_*` configuradas **no painel** — o
  `render.yaml` agora as declara como `sync: false`, o que registra a dependência mas **não
  preenche valor nenhum**. Conferir que o deploy passou e que o log do boot traz
  `[MercadoPago] Configurado` com `env: "test"`. Se o log não aparecer, ou aparecer o aviso de
  `MERCADOPAGO_ENV`, a cobrança subiu desligada e o checkout responde 503.

### 2. Pendências pós-merge (ordem recomendada)

| # | O quê | Quando | Urgência |
|---|---|---|---|
| 1 | **Secrets de SMTP + `FRONTEND_URL`** no GitHub Actions | depois do merge | Baixa — ninguém tem assinatura ainda |
| 2 | **Revisão jurídica** dos 3 documentos | antes de dinheiro real | Alta para go-live |
| 3 | **Credenciais de produção** + portão de go-live | por último | Irreversível — ver `runbook-operacao.md` §1 |

O irreversível (produção) vem **depois** do que ainda pode ser corrigido de graça.

### 3. Dívida técnica conhecida (não bloqueia o merge)

- Validação `x-signature` do webhook — exige URL pública primeiro
- Estorno + reembolso proporcional (a matemática existe; falta o endpoint)
- Exclusão de conta + exportação LGPD
- Limitar alertas do plano grátis (`FREE_ALERT_LIMIT = Infinity` hoje)

Detalhes na §3 deste arquivo e em `docs/runbook-operacao.md`.

---

---

## 1. Onde estamos

### Feito e commitado

| Branch | O que tem |
|---|---|
| `feat/visual-login-header` | Fundo animado no login, fio de dados no header, ponteiro de tanque nos botões. Correção do bug do eixo Y (`R$ 7.600000000000001`). **61 testes passando.** |
| `feat/checkout-pix` | Anual a R$ 59,90, dinâmica visual no checkout, aceite obrigatório dos documentos, os 3 documentos legais, **o gate de assinatura** e toda a documentação de pagamento. |

### ✅ Gate de assinatura — FEITO (04/ago/2026)

Construído antes de qualquer pagamento, porque não depende de gateway nenhum.

| Arquivo | O que é |
|---|---|
| `backend/src/lib/subscriptionPeriod.ts` | Aritmética pura de vigência (mês de calendário, renovação que soma, corte estrito, pró-rata) |
| `backend/src/lib/alertQuota.ts` | Decisão de cota. **`FREE_ALERT_LIMIT = Infinity` — nada mudou ainda** |
| `backend/src/services/subscriptionService.ts` | Leitura do direito de acesso. Falha fechado em todos os caminhos |
| `backend/supabase/migration_003_subscriptions.sql` | Tabela + índices + RLS. **✅ Rodada e verificada no Supabase (04/ago)** |
| `GET /api/fuel/entitlement` | Situação da assinatura (para a interface, não é o gate) |
| gate no `POST /api/fuel/alerts` | O gate de verdade |
| `docs/testar-o-gate.md` | Passo a passo para provar que funciona — **executado com sucesso pelo Bernardo (7/7 passos)** |

### ✅ Etapa A — FEITA (04/ago/2026, mesma sessão)

O backend de pagamento existe e o checkout está ligado a ele:

| Peça | Arquivo |
|---|---|
| Config com trava test/production | `backend/src/config/mercadoPago.ts` |
| Cliente do provedor (único ponto de contato) | `backend/src/services/mercadoPagoClient.ts` |
| Tabela de cobranças (**migração 004 ✅ rodada**) | `backend/supabase/migration_004_billing_charges.sql` |
| Orquestração: criar cobrança → confirmar → assinatura | `backend/src/services/billingService.ts` |
| `POST /checkout` · `GET /charge/:id` (com reconciliação) · `POST /webhook` | `backend/src/routes/billingRoute.ts` |
| Checkout ligado, com login obrigatório (opção A) | `frontend/public/checkout.html` |

**Testes:** 209 no backend e 61 no frontend passando (05/ago, após a auditoria).

### ✅ Teste ponta a ponta — FEITO (05/ago/2026)

Exercitado localmente com `MERCADOPAGO_ENV=test`. Resultado:

| Etapa | Status |
|---|---|
| Cobrança criada no Mercado Pago | ✅ |
| QR + copia e cola gerados | ✅ |
| APRO aprovou sozinho (~7s) | ✅ |
| Reconciliação via polling (sem webhook) | ✅ |
| Assinatura criada no banco (`paid`, 5990, `1.0`, `anual`, 1 year) | ✅ |
| Gate `/api/fuel/entitlement` → `active: true` | ✅ |
| Dados de teste limpos no Supabase | ✅ |

Correção descoberta no teste: email real recusado no sandbox (`invalid_email_for_sandbox`) —
`buildPayer` passou a enviar `@testuser.com` em teste. Roteiro completo:
[`docs/teste-ponta-a-ponta.md`](./teste-ponta-a-ponta.md).

### ✅ Auditoria da branch — FEITA (05/ago/2026)

Revisão independente de tudo o que a branch traz, registrada em
`docs/auditoria-branch-checkout-pix.md`. Encontrou 1 bug real, 3 lacunas e 2 docs errados —
**todos já corrigidos**:

| O quê | Onde | Estado |
|---|---|---|
| Polling a 4s fixos estourava o rate limit (429 silencioso → tela mentia sobre pagamento confirmado) | `checkout.html` | ✅ escada 3s→10s→30s + 429 e falha repetida visíveis na tela |
| `billingService.ts` sem teste nenhum | `test/billingService.test.ts` | ✅ 26 testes: idempotência nas 2 camadas, `user_id` nulo, valor divergente, reconciliação, filtro por dono |
| Valor pago nunca conferido contra o cobrado | `billingService.ts` §6 | ✅ divergência vira `AMOUNT_MISMATCH` e log de erro, não assinatura |
| `legalVersion` aceitava qualquer string do cliente | `lib/legalVersions.ts` | ✅ lista branca; 5 testes novos no `schemas.test.ts` |
| Docs desatualizados (rodapé, prazo do QR) | este arquivo | ✅ corrigidos |

### Documentos desta frente

| Arquivo | Para quê |
|---|---|
| `docs/fase10-pagamentos.md` | Arquitetura original (652 linhas). Ainda vale quase toda — só troque AbacatePay por Mercado Pago. |
| `docs/recebimento-sem-cnpj.md` | Comparativo de provedores, taxas, e **o achado do Pix Automático**. |
| `docs/vigencia-do-acesso.md` | **Leia antes de escrever o backend.** As 6 decisões que evitam dar tempo a mais ou a menos. |
| `docs/runbook-operacao.md` | **Portão de go-live** + como cumprir à mão o que ainda não está automatizado. |
| `docs/proximos-passos.md` | Este arquivo. |

### Decisões travadas

- **Provedor: Mercado Pago.** Taxa percentual (~0,99%) vence a taxa fixa do Asaas (R$ 1,99) com folga em ticket baixo.
- **Planos:** mensal R$ 16,90 (1 mês exato) e anual R$ 59,90 (12 meses exatos).
- **Sem renovação automática.** Não é escolha: o Banco Central exige CNPJ ativo para ser recebedor de Pix Automático.
- **`DEMO = false` com credenciais de TESTE** (`MERCADOPAGO_ENV=test`). O fluxo é real de ponta a ponta, mas nenhum dinheiro circula até as credenciais de produção entrarem.

---

## 2. ⚠️ Pendências que só VOCÊ resolve

Nada disso eu consigo fazer — precisa ser você, e algumas travam o resto.

| # | O quê | Onde | Trava o quê |
|---|---|---|---|
| 1 | ~~Ver a taxa real do Pix por API~~ | ✅ **FEITO 04/ago** | **0,99% na aba "Checkout", liberação na hora.** R$ 0,17 no mensal, R$ 0,59 no anual. (A aba "QR Code" a 0,00% é o QR presencial — outro produto, não serve.) |
| 2 | **Cadastrar uma chave Pix** na conta | Painel do Mercado Pago | **Trava a API inteira** — sem chave, `/v1/orders` não funciona. |
| 3 | **Criar a aplicação** e pegar as credenciais de teste | [Suas integrações](https://www.mercadopago.com.br/developers/panel/app) | Trava o desenvolvimento. |
| 4 | **Revisão jurídica** dos 3 documentos | Advogado | Trava o dinheiro real, não o código. |
| 5 | **Decidir o gatilho de virar MEI** | Você + contador | Nada agora. Decida o número ("quando passar de X/mês") para não virar susto depois. |
| 6 | **Secrets de SMTP + variable `FRONTEND_URL`** no GitHub Actions | Settings → Secrets and variables → Actions | **O aviso de vencimento.** O código está pronto e rodando no job semanal, mas sem SMTP o e-mail não sai (o log diz isso) e sem `FRONTEND_URL` ele sai sem o link de renovação. Conferir na aba Actions: `[ingest] Avisos de vencimento: N elegíveis · N enviados` |

> Os documentos legais são **rascunhos meus, não parecer jurídico.** Estão escritos a partir do que
> o produto realmente faz — o que é mais do que a maioria dos modelos genéricos entrega — mas
> ninguém com OAB olhou.

---

## 3. O que falta no código

> A Etapa A original foi concluída — ver §1. O que segue é o que resta.

### ~~Rumo ao PR — o teste que faltava~~ ✅ FEITO (05/ago/2026)

O fluxo completo foi exercitado — ver §1 "Teste ponta a ponta". O webhook continua sendo
otimização de latência; a reconciliação do `GET /charge/:id` é a garantia que importa, e
funciona.

> ⏱️ **O polling é uma escada, não 4s fixos:** 3s no 1º minuto, 10s até os 5 min, 30s no
> resto. O porquê está em `docs/auditoria-branch-checkout-pix.md` §1.

### Produção (não bloqueia o PR)

- [ ] URL pública do backend → cadastrar o webhook no painel → pegar o segredo →
      implementar a validação `x-signature` (ver ponta solta abaixo)
- [ ] Trocar credenciais para as de produção + `MERCADOPAGO_ENV=production`
- [ ] Portão de go-live completo do `runbook-operacao.md` §1

### ⚠️ Ponta solta conhecida — validação de assinatura do webhook

`MERCADOPAGO_WEBHOOK_SECRET` é lida pelo config mas **não valida nada**. A assinatura
(`x-signature`) não está implementada.

**Isso torna o sistema inseguro?** Não. A confirmação de pagamento vem de um `GET` **autenticado**
na API do Mercado Pago, nunca do corpo da notificação — então uma requisição forjada no webhook
não libera acesso nenhum. Ela só faz o backend consultar uma order inexistente.

**O que falta, então?** Barrar a forjaria *antes* da consulta. Sem isso, alguém que descubra a URL
pode disparar requisições e queimar nosso limite na API do provedor. É defesa em profundidade.

**Ordem natural:** o segredo só existe depois de cadastrar a URL do webhook no painel, e isso exige
URL pública. Então: URL pública → pegar o segredo → implementar a validação. Não dá para antecipar.

### Etapa B — Honrar o que os documentos prometem

Prometido por escrito, ainda não existe:

- [x] ~~**Aviso antes de vencer**~~ — **FEITO em 04/ago/2026.** Janela de 8 dias (o job é semanal), roda no `scripts/ingest.ts` via GitHub Actions. Falta só configurar os secrets de SMTP e a variable `FRONTEND_URL` no Actions.
- [ ] **Estorno** — endpoint de refund + webhook `refunded` que zera `expires_at` na hora
- [ ] **Reembolso proporcional** do anual — a matemática já existe e está testada (`computeProRataRefundCents`); falta o endpoint e a chamada ao provedor
- [ ] **Exclusão de conta a pedido** — a Política de Privacidade promete em 30 dias
- [ ] **Exportar dados do usuário** — direito da LGPD art. 18

> Prometer nos documentos e não implementar é pior que não prometer. Esta lista é dívida assumida.
>
> **Mitigação enquanto não automatiza:** `docs/runbook-operacao.md` tem o procedimento manual de
> cada uma, com o SQL pronto. Promessa cumprida à mão continua cumprida — o que mata é ninguém
> saber como cumprir. Aquele documento também traz o **portão de go-live**: a lista que precisa
> estar inteira antes de `DEMO = false`.

### Etapa C — Só depois de A e B

- [x] ~~Rodapé do app React com links para `/termos`, `/privacidade`, `/reembolso`~~ — **já estava feito**, e este arquivo é que estava desatualizado. Ver `frontend/src/App.tsx`, `<footer className="site-footer">`: os três links e a isenção da ANP.
- [ ] Revisão jurídica
- [ ] `DEMO = false` + credencial de produção
- [ ] Limitar alertas do plano grátis — **a landing já promete "alertas ilimitados" no Premium, e hoje o grátis também é ilimitado.** Sem isso, não há motivo para pagar. (Já apontado na §8 do plano da Fase 10.)

---

## 4. Armadilhas — leia antes de codar

1. **Preço nunca vem do front.** O `checkout.html` manda só a chave (`'anual'`/`'mensal'`). Quem decide o valor é o backend. Preço no front = qualquer um paga R$ 0,01.
2. **Webhook chega duas vezes.** É garantido, não é hipótese. O índice único em `(provider, charge_id)` é o que impede vigência dobrada.
3. **Não use "30 dias" nem "365 dias".** Use aritmética de calendário. Ver `vigencia-do-acesso.md` §2.3 — conferido: 31/jan +1m = 28/fev, 29/fev/2028 +12m = 28/fev/2029.
4. **Renovar antecipado soma, não substitui.** Senão a pessoa perde os dias que já pagou.
5. **Cold start do Render.** A API dorme após 15 min no plano grátis. Um webhook que chega nesse momento pode receber timeout — o Mercado Pago reenvia, mas o seu handler precisa ser idempotente (ver 2).
6. **`LEGAL_VERSION` no `checkout.html` precisa subir junto** com qualquer edição nos documentos. Sem isso você não prova o que a pessoa aceitou.
7. **Só o `expiration_time` da order não expira a assinatura.** São coisas diferentes: um é o prazo do QR (**30 min** — `QR_EXPIRES_MINUTES` no `billingService.ts`, espelhado em `EXPIRES_SECONDS` no `checkout.html`), outro é a vigência do acesso (1 mês / 12 meses).
8. **O webhook precisa recusar `user_id` vazio.** A coluna é nullable por causa da anonimização (LGPD), então o banco aceita uma assinatura sem dono sem reclamar — foi exatamente o que aconteceu no teste manual de 04/ago. Em produção isso vira dinheiro recebido sem ninguém liberado. **Valide no código antes do insert:** se não achou o usuário, é erro, não linha órfã.

---

## 5. Rodar local

```bash
cd ~/Desktop/"Price Tracker Pro"
git checkout feat/checkout-pix
cd frontend && npm run dev
```

| Página | URL local |
|---|---|
| App | `http://localhost:5173/` |
| Landing | `http://localhost:5173/premium.html` |
| Checkout | `http://localhost:5173/checkout.html` |
| Termos | `http://localhost:5173/termos.html` |
| Privacidade | `http://localhost:5173/privacidade.html` |
| Reembolso | `http://localhost:5173/reembolso.html` |

No checkout, o botão **"Gerar pagamento" começa desabilitado** — marque o aceite para liberar.

As URLs sem `.html` (`/termos`, `/premium/checkout`) só funcionam na Vercel, que faz o rewrite.

---

## 6. Estimativa honesta — atualizada em 04/ago (fim do dia)

A Etapa A saiu no mesmo dia, não em 2–3. O que resta:

| | Esforço | Depende de |
|---|---|---|
| ~~Teste ponta a ponta com pagamento sandbox~~ | ✅ feito 05/ago | — |
| Estorno + reembolso proporcional (Etapa B) | 1–2 dias | nada |
| Exclusão de conta + exportação LGPD (Etapa B) | 1 dia | nada |
| Webhook com assinatura validada | ~2 h | URL pública (deploy) |
| Revisão jurídica | — | advogado |

---

## 7. PR #22 — pronto para review

**Checklist:**

- [x] `npm test` nos dois pacotes (**209 + 61**)
- [x] Teste ponta a ponta (pagamento sandbox → assinatura criada → gate ativo)
- [x] Decisão: **um PR só** — as três frentes (visual, legal, billing) contam a história
      completa do checkout; dividir agora seria retrabalho sem ganho.
- [x] Repositório público — preços e documentos legais em rascunho são intencionais.
- [x] Nenhuma credencial no histórico do git.

**PR:** https://github.com/bernardobbl/price-tracker-pro/pull/22

Para marcar como pronto (se ainda estiver em rascunho):

```bash
gh pr ready 22
```

Para merge após review:

```bash
gh pr merge 22 --squash   # ou --merge, como preferir
```

Sem o CLI, o push imprime um link `https://github.com/.../pull/new/feat/checkout-pix` — é só abrir.
