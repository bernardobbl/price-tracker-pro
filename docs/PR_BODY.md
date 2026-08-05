# Checkout Pix com Mercado Pago, gate de assinatura e documentos legais

Traz três frentes que cresceram juntas numa sessão. Se preferir revisar separado, dá para
dividir por commit — os grupos estão marcados abaixo.

> ✅ **Teste ponta a ponta concluído em 05/ago/2026.** Cobrança sandbox → APRO automático →
> reconciliação via polling → assinatura no banco → gate `active: true`. Roteiro:
> `docs/teste-ponta-a-ponta.md`.

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

**Quatro decisões de segurança que valem destaque:**

1. **A verdade sobre um pagamento vem de um `GET` autenticado na API, nunca do corpo do
   webhook.** Uma notificação forjada não libera nada — só provoca uma consulta inútil.
2. **O preço é decidido pelo plano, no backend.** O schema do checkout nem tem campo de valor.
3. **O valor pago é conferido contra o valor cobrado** antes de criar a assinatura. Divergência
   vira log de erro e recusa, não acesso. O dado já vinha no snapshot da order; faltava
   compará-lo.
4. **`legalVersion` é lista branca**, não string livre. Ela é a metade verificável da prova de
   aceite (a outra é o horário, que vem do servidor) — aceitar qualquer string deixaria um
   cliente forjado registrar uma versão que nunca existiu.

**`GET /charge/:id` reconcilia com o provedor quando a cobrança está pendente.** É um GET com
efeito colateral — incomum, e justificado: sem isso, um pagamento cujo webhook se perdeu (o
backend hiberna no free tier) deixaria quem pagou esperando para sempre, e o desenvolvimento
local seria impossível, porque o Mercado Pago não alcança `localhost`.

### Polling em escada, não em intervalo fixo

O QR vale 30 min e a API limita 300 requisições por IP a cada 15. Um polling de 4s fixos daria
225 requisições em 15 min e até 450 na janela inteira — quem demorasse para pagar tomava 429
**antes** do código expirar, e como o erro era silencioso o resultado era o pior possível numa
tela de cobrança: pagamento confirmado no backend, tela dizendo "Aguardando o pagamento…" para
sempre.

Agora o intervalo cresce (3s no 1º minuto → 10s até 5 min → 30s), o que respeita a forma real do
Pix: quase tudo cai no primeiro minuto. Total: **64 requisições em 15 min** contra o limite de
300, e **94 na janela inteira** em vez de 450 — e, pelo mesmo motivo, 94 consultas ao Mercado
Pago em vez de 450, já que o endpoint reconcilia a cada chamada. O 429 e a falha repetida
passaram a aparecer na tela; silenciar erro de rede no cold start é razoável, silenciar 429 é
esconder do cliente que a página parou de funcionar.

### Aviso antes de vencer

Como o Banco Central exige CNPJ para receber Pix Automático, **não existe renovação
automática** — o aviso por e-mail é o que impede o cliente de perder acesso sem entender por
quê. Roda no job semanal que já existia. Janela de **8 dias, não 7**: com job semanal, 7
deixaria escapar quem vence 7,5 dias depois de uma execução.

### Teste do Pix em sandbox

Um Pix de sandbox **não pode ser pago**: o copia e cola devolvido no ambiente de teste não é um
Pix válido, e a conta de teste do Mercado Pago também não paga QR. A saída oficial é a order de
valores predefinidos — `payer.first_name = "APRO"` faz a order aprovar sozinha. `buildPayer` liga
isso quando `MERCADOPAGO_ENV=test` e nunca em produção, o que é seguro porque o config recusa o
boot na combinação `NODE_ENV=production` + `ENV=test`. Sete testes travam o contrato nas duas
direções.

### Só Pix

Decisão de produto: Pix custa 0,99% contra 4,98% do crédito, cai na hora e dispensa cadastro
de cartão. O seletor de método saiu inteiro — com uma opção só, escolher seria teatro.

---

## Testes

| | |
|---|---|
| Backend | 209 passando |
| Frontend | 61 passando |
| `type-check` + `lint` | limpos nos dois pacotes |

Cobrem as bordas que o requisito de vigência exige: virada de mês, ano bissexto, renovação
antecipada, corte no instante exato, reembolso proporcional e a tradução de status do provedor.

`test/billingService.test.ts` (26 testes) cobre a costura onde erro vira dinheiro, com o
Supabase e o Mercado Pago falsos: idempotência nas duas camadas, cobrança sem `user_id`, valor
divergente, status desconhecido caindo em `pending`, reconciliação com o provedor fora do ar, e
o filtro explícito por dono — que é a proteção real, já que o backend usa `service_role` e
ignora RLS.

## Migrações

Rodar em ordem: `migration_003_subscriptions.sql` e `migration_004_billing_charges.sql`.
As duas são idempotentes. **Já aplicadas e verificadas** no projeto do Supabase.

## O que falta (não bloqueia o merge)

- [x] ~~Teste ponta a ponta com pagamento sandbox~~ — feito 05/ago/2026
- [ ] Validação `x-signature` do webhook — o segredo só existe depois de cadastrar a URL
      pública no painel
- [ ] Estorno e reembolso proporcional (a matemática existe e está testada; falta o endpoint)
- [ ] Exclusão de conta e exportação de dados (LGPD)
- [ ] Revisão jurídica dos três documentos
- [ ] Secrets de SMTP + `FRONTEND_URL` no GitHub Actions (aviso de vencimento)
- [ ] Credenciais de produção + portão de go-live (`runbook-operacao.md` §1)

Procedimento manual de tudo isso: `docs/runbook-operacao.md`.
