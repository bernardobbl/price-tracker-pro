# Próximos passos — retomar daqui

> **Para o Bernardo do futuro.** Escrito em 04/ago/2026 no fim de uma sessão, para você conseguir
> voltar sem reler tudo. Comece por aqui.
>
> **Branch:** `feat/checkout-pix` — **local, sem push.** Nada disso está no GitHub.

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

**Testes:** 171 no backend e 61 no frontend passando (última rodada do Bernardo, 04/ago).

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

### Rumo ao PR — o teste que falta

Tudo compilou e os testes unitários passam, mas **o fluxo completo com um pagamento de teste
do Mercado Pago ainda não foi exercitado**. Antes do PR, rode uma vez:

1. `npm run dev` nos dois pacotes, logar no app, abrir `localhost:5173/checkout.html`
2. Marcar o aceite → **Gerar pagamento** → deve aparecer um QR real do ambiente de teste
3. Pagar usando a conta de teste do Mercado Pago (painel → Contas de teste), ou aguardar
   expirar e conferir que a tela reflete
4. O polling deve virar "pago" **sem webhook nenhum** — é a reconciliação do
   `GET /charge/:id` fazendo o papel dele
5. Conferir no Supabase: `billing_charges` com status `paid` e uma linha nova em
   `subscriptions` com a vigência certa

Se o passo 4 funcionar, o coração inteiro está provado. O webhook vira otimização de
latência (confirmação em segundos em vez de no próximo polling).

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

- [ ] Rodapé do app React com links para `/termos`, `/privacidade`, `/reembolso` (hoje só o checkout linka)
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
7. **Só o `expiration_time` da order não expira a assinatura.** São coisas diferentes: um é o prazo do QR (15 min), outro é a vigência do acesso (1 mês / 12 meses).
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
| Teste ponta a ponta com pagamento sandbox (§3) | ~30 min | só você, na sua máquina |
| Estorno + reembolso proporcional (Etapa B) | 1–2 dias | nada |
| Exclusão de conta + exportação LGPD (Etapa B) | 1 dia | nada |
| Webhook com assinatura validada | ~2 h | URL pública (deploy) |
| Revisão jurídica | — | advogado |

---

## 7. Preparar o PR

**Checklist antes de abrir:**

- [ ] `npm test` nos dois pacotes (última contagem: 171 + 61)
- [ ] O teste ponta a ponta da §3 (pagamento sandbox → assinatura criada)
- [ ] Decidir: **um PR ou três?** A branch mistura três frentes independentes —
      visual (login/header/gauge + fix do eixo Y), legal (documentos + aceite) e
      billing (gate + Mercado Pago). Um PR só é honesto para repositório pessoal;
      três contam a história melhor no portfólio. Se for dividir, é
      `git rebase -i` ou cherry-pick em branches novas **antes** do push.
- [ ] Lembrar: **o repositório é público.** Push = tudo visível, incluindo os
      preços e os documentos legais em rascunho. Nada disso é segredo de verdade
      (o checkout está no ar na Vercel de qualquer forma), mas é bom decidir
      conscientemente.
- [ ] O que **não** entra no PR: `.env` (já ignorado), credenciais, e nada de
      `MERCADOPAGO_*` em texto claro em lugar nenhum — conferir com
      `git log -p | grep -c "APP_USR-[A-Za-z0-9]"` (deve dar 0).

**Corpo sugerido do PR:** o resumo da §1 deste arquivo já é 90% da descrição.
