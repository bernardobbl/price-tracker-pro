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
| `feat/checkout-pix` | Anual a R$ 59,90, dinâmica visual no checkout, aceite obrigatório dos documentos, os 3 documentos legais, e toda a documentação de pagamento. |

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
- **`DEMO = true`.** Nenhuma cobrança real acontece hoje.

---

## 2. ⚠️ Pendências que só VOCÊ resolve

Nada disso eu consigo fazer — precisa ser você, e algumas travam o resto.

| # | O quê | Onde | Trava o quê |
|---|---|---|---|
| 1 | **Ver a taxa real** do Pix por API | Mercado Pago → Seu perfil → Taxas e parcelas | Nada. Mas muda a conta de margem. |
| 2 | **Cadastrar uma chave Pix** na conta | Painel do Mercado Pago | **Trava a API inteira** — sem chave, `/v1/orders` não funciona. |
| 3 | **Criar a aplicação** e pegar as credenciais de teste | [Suas integrações](https://www.mercadopago.com.br/developers/panel/app) | Trava o desenvolvimento. |
| 4 | **Revisão jurídica** dos 3 documentos | Advogado | Trava o dinheiro real, não o código. |
| 5 | **Decidir o gatilho de virar MEI** | Você + contador | Nada agora. Decida o número ("quando passar de X/mês") para não virar susto depois. |

> Os documentos legais são **rascunhos meus, não parecer jurídico.** Estão escritos a partir do que
> o produto realmente faz — o que é mais do que a maioria dos modelos genéricos entrega — mas
> ninguém com OAB olhou.

---

## 3. O que falta no código

Nesta ordem. Cada etapa fecha sozinha.

### Etapa A — Backend contra o sandbox (o coração)

**1. Migração no Supabase.** Rodar o SQL de `docs/vigencia-do-acesso.md` §3 (tabela
`subscriptions` + índice único por `charge_id` + RLS).

**2. `backend/src/lib/mercadoPagoClient.ts`** — todo o contato com o provedor isolado num arquivo
só, como o plano da Fase 10 mandava. Trocar de provedor depois deve custar um arquivo.

```
POST https://api.mercadopago.com/v1/orders
  Authorization: Bearer <ACCESS_TOKEN>
  X-Idempotency-Key: <uuid v4>
  { type:"online", total_amount:"59.90", external_reference:"<nosso id>",
    processing_mode:"automatic",
    transactions:{ payments:[{ amount:"59.90",
      payment_method:{ id:"pix", type:"bank_transfer" },
      expiration_time:"PT15M" }]},
    payer:{ email:"<email>" } }
```

Devolve `qr_code`, `qr_code_base64` e `ticket_url` — os três campos que o `checkout.html` já espera.

**3. Três endpoints:**

| Endpoint | Faz |
|---|---|
| `POST /api/billing/checkout` | Recebe `{plan, email, legalVersion}`. **Decide o preço pelo `plan`** — nunca aceita valor do front. Cria a order e devolve o QR. |
| `POST /api/billing/webhook` | Confere a assinatura, ignora `charge_id` repetido, calcula a vigência (doc §2), grava a assinatura. |
| `GET /api/billing/charge/:id` | O polling que a página já faz. |

**4. Gate de acesso.** Checar assinatura ativa **no backend** antes de criar alerta/favorito. RLS é
segunda linha, não a primeira — o backend usa `service_role` e ignora RLS.

**5. Os 10 testes** da tabela em `docs/vigencia-do-acesso.md` §5. São eles que provam o
"exatamente 1 mês".

### Etapa B — Honrar o que os documentos prometem

Prometido por escrito, ainda não existe:

- [ ] **Estorno** — endpoint de refund + webhook `refunded` que zera `expires_at` na hora
- [ ] **Reembolso proporcional** do anual (a política promete a conta de 8/12)
- [ ] **Aviso antes de vencer** — 7 dias e 1 dia, no job semanal que já roda a ingestão
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

## 6. Estimativa honesta

Você disse que queria produção esta semana. Meu palpite, com o que está pronto:

| | Esforço |
|---|---|
| Etapa A (backend no sandbox) | 2–3 dias de trabalho focado |
| Etapa B (estorno, avisos, LGPD) | +2 dias |
| Etapa C (revisão jurídica) | depende de terceiro |

**Dá para ter tudo funcionando no sandbox nesta semana.** O que não recomendo é virar `DEMO = false`
antes da Etapa B: no dia em que o primeiro cliente pedir reembolso, o botão precisa existir — e a
política já promete que ele existe.
