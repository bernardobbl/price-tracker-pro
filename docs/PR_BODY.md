# Checkout Pix com Mercado Pago, gate de assinatura e documentos legais

> ⚠️ **Rascunho até o teste ponta a ponta rodar.** Ver "O que falta" no fim.

Traz três frentes que cresceram juntas numa sessão. Se preferir revisar separado, dá para
dividir por commit — os grupos estão marcados abaixo.

---

## 1. Visual

Camada decorativa no login e no header, sem tocar em comportamento.

- **`DataBackdrop`** — fundo da tela de login: a série de preço se desenha ao abrir, um ponto
  dourado a percorre em loop, os marcos pulsam, e as camadas se deslocam com o mouse.
- **`HeaderWire`** — fio no rodapé do header do dashboard com o mesmo ponto percorrendo.
- **`FuelGauge`** — marcador de tanque (E→F) nos botões enquanto a ação carrega.

Os três são `aria-hidden`, `pointer-events: none`, respeitam `prefers-reduced-motion` e pausam
em aba oculta.

**Correção de bug junto:** o eixo Y do gráfico mostrava `R$ 7.600000000000001`. O Chart.js
calcula os ticks por soma sucessiva e o callback interpolava o valor cru. Passou a usar o
`fmt()` que já existia — o que também alinhou o eixo ao padrão pt-BR (vírgula decimal).

## 2. Documentos legais

Termos de Uso, Política de Privacidade e Política de Reembolso, escritos a partir do que o
produto realmente faz.

- Os Termos incluem **isenção explícita sobre o preço exibido**: ele vem do levantamento
  semanal da ANP e não é o preço da bomba agora. Sem isso o projeto fica exposto a "dirigi
  até lá e o preço era outro".
- A Política de Reembolso registra os **7 dias do art. 49 do CDC**, que não são renunciáveis.
- **Aceite obrigatório no checkout**: o botão de pagar nasce desabilitado. O `legalVersion`
  vai no POST e o backend grava com o horário dele — versão + hora do servidor são a prova.
- **Rodapé no app React** com os três links. A Política de Privacidade precisa estar acessível
  a quem *usa* o app, não só a quem chega no checkout.

> São rascunhos, ainda **sem revisão jurídica**.

## 3. Assinatura e pagamento

### Vigência (`subscriptionPeriod.ts`) — funções puras

- **Mês de calendário com clamp**, não "30 dias": `31/jan + 1m = 28/fev`,
  `29/fev/2028 + 12m = 28/fev/2029`. Somar dias fixos daria menos tempo que o vendido em 7 dos
  12 meses, e 12 mensais (360 dias) não fechariam com o anual (365).
- **Renovação soma ao saldo**: base é `MAX(agora, vencimento_atual)`. Renovar com 10 dias
  sobrando dá 41 dias, não 31 — a pessoa não perde o que já pagou.
- **Corte estrito**: acesso vale enquanto `agora < expires_at`.

### Gate

`subscriptions` (migração 003) + `subscriptionService` + gate no `POST /api/fuel/alerts`.
**Falha fechado em todos os caminhos**: sem Supabase ou com erro de banco, ninguém é assinante
— erro de infraestrutura não pode virar acesso grátis.

`FREE_ALERT_LIMIT = Infinity` por enquanto: **nenhum comportamento muda**. Limitar o plano
gratuito é decisão à parte.

### Mercado Pago

- **`config/mercadoPago.ts`** — trava de ambiente. Os tokens de teste e de produção começam
  ambos com `APP_USR` e são indistinguíveis a olho, então `MERCADOPAGO_ENV` é obrigatória e a
  combinação `NODE_ENV=production` + `ENV=test` é recusada no boot.
- **`mercadoPagoClient.ts`** — único ponto de contato com o provedor. `normalizeOrderStatus`
  **falha fechado**: status desconhecido vira `pending`, nunca `paid`.
- **`billing_charges`** (migração 004) — a ponte entre checkout e assinatura.
- **Endpoints**: `POST /checkout`, `GET /charge/:id`, `POST /webhook`.

**Duas decisões de segurança que valem destaque:**

1. **A verdade sobre um pagamento vem de um `GET` autenticado na API, nunca do corpo do
   webhook.** Uma notificação forjada não libera nada — só provoca uma consulta inútil.
2. **O preço é decidido pelo plano, no backend.** O schema do checkout nem tem campo de valor.

**`GET /charge/:id` reconcilia com o provedor quando a cobrança está pendente.** É um GET com
efeito colateral — incomum, e justificado: sem isso, um pagamento cujo webhook se perdeu (o
backend hiberna no free tier) deixaria quem pagou esperando para sempre, e o desenvolvimento
local seria impossível, porque o Mercado Pago não alcança `localhost`.

### Aviso antes de vencer

Como o Banco Central exige CNPJ para receber Pix Automático, **não existe renovação
automática** — o aviso por e-mail é o que impede o cliente de perder acesso sem entender por
quê. Roda no job semanal que já existia. Janela de **8 dias, não 7**: com job semanal, 7
deixaria escapar quem vence 7,5 dias depois de uma execução.

### Só Pix

Decisão de produto: Pix custa 0,99% contra 4,98% do crédito, cai na hora e dispensa cadastro
de cartão. O seletor de método saiu inteiro — com uma opção só, escolher seria teatro.

---

## Testes

| | |
|---|---|
| Backend | 171 passando |
| Frontend | 61 passando |
| `type-check` + `lint` | limpos nos dois pacotes |

Cobrem as bordas que o requisito de vigência exige: virada de mês, ano bissexto, renovação
antecipada, corte no instante exato, reembolso proporcional e a tradução de status do provedor.

## Migrações

Rodar em ordem: `migration_003_subscriptions.sql` e `migration_004_billing_charges.sql`.
As duas são idempotentes. **Já aplicadas e verificadas** no projeto do Supabase.

## O que falta (não bloqueia o merge)

- [ ] **Teste ponta a ponta com pagamento sandbox** ← único bloqueador real
- [ ] Validação `x-signature` do webhook — o segredo só existe depois de cadastrar a URL
      pública no painel
- [ ] Estorno e reembolso proporcional (a matemática existe e está testada; falta o endpoint)
- [ ] Exclusão de conta e exportação de dados (LGPD)
- [ ] Revisão jurídica dos três documentos

Procedimento manual de tudo isso: `docs/runbook-operacao.md`.
