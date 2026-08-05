# Auditoria da branch `feat/checkout-pix`

> Revisão independente feita em 05/ago/2026 sobre `4d79882`, comparando com `main`.
> 26 commits, 46 arquivos, +6838 linhas.
>
> ✅ **Todos os achados desta auditoria foram corrigidos na mesma data.** O texto original foi
> mantido — inclusive o raciocínio que levou a cada achado — porque o registro do *porquê* vale
> mais que a lista do *o quê*. Cada seção traz a correção logo abaixo.

---

## Veredito

A branch está **saudável e pronta para PR** depois do teste ponta a ponta. O desenho de
segurança do pagamento está correto no ponto que mais importa: **a verdade sobre um pagamento
vem de um `GET` autenticado na API, nunca do corpo do webhook**, e o preço é decidido pelo
backend. Isso elimina as duas fraudes clássicas de checkout.

Encontrei **1 bug com impacto real em produção** (§1), **3 lacunas de robustez** (§2) e
**2 documentos desatualizados** (§4).

---

## 0. O que rodei

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` backend | ✅ limpo |
| `tsc --noEmit` frontend | ✅ limpo |
| `eslint` backend | ✅ limpo |
| `eslint` frontend | ✅ limpo |
| `vitest run` backend | ✅ **171 passando**, 20 arquivos |
| `vitest run` frontend | ✅ **61 passando**, 9 arquivos |
| Segredos no histórico (`APP_USR-…`, JWT `eyJ…`) | ✅ **0 ocorrências** |
| `.env` versionado | ✅ só os `.env.example` |
| Working tree | ✅ limpo, em dia com `origin` |

As contagens batem exatamente com o que o `PR_BODY.md` afirma.

---

## 1. 🔴 Bug real — o polling estoura o próprio rate limit

**Onde:** `backend/src/app.ts` (limitador) × `frontend/public/checkout.html` (polling).

A conta:

| | |
|---|---|
| Limite da API | 300 requisições / 15 min / IP |
| Intervalo do polling | 4 s |
| Requisições do polling em 15 min | **225** |
| Validade do QR | 30 min → **450 requisições** se a pessoa esperar tudo |

Quem abre o checkout e demora para pagar **passa dos 300 antes do QR expirar** — só com o
polling, sem contar as chamadas normais do dashboard. E o `.catch()` do polling é silencioso:

```js
.catch(function(){ /* silencioso: cold start do backend é normal */ });
```

Então o 429 não aparece na tela. **A pessoa paga, o backend confirma, e a página continua
dizendo "Aguardando o pagamento…" para sempre.** É o pior modo de falha possível numa tela de
cobrança: dinheiro entrou, cliente acha que não.

Piora com IP compartilhado (NAT de operadora móvel, escritório): duas pessoas no checkout ao
mesmo tempo estouram o limite em ~7 min.

**Efeito colateral do mesmo desenho:** como o `GET /charge/:id` reconcilia com o provedor a
cada chamada, são **até 450 chamadas ao Mercado Pago por tentativa de checkout**. O Mercado
Pago também tem limite.

**Correções possíveis (escolha uma):**

1. **Backoff no polling** — 4 s nos primeiros 60 s, depois 10 s, depois 20 s. Reduz para ~60
   requisições no total e preserva a sensação de imediatismo (Pix cai em segundos).
2. **Isentar `/billing/charge/` do limitador geral** e dar a ele um limitador próprio mais
   folgado — é rota autenticada e filtrada por dono, o risco de abuso é baixo.
3. **Reconciliar com o provedor a cada N polls** (ex.: 1 em cada 3), não em todos.

**Independente da escolha, trate o 429 na tela.** Silenciar erro de rede é razoável no cold
start; silenciar 429 é esconder do cliente que a página parou de funcionar.

### ✅ Corrigido — 05/ago/2026

Opção 1, a escada. `setInterval` fixo virou uma cadeia de `setTimeout`:

```js
var POLL_STEPS = [
  { until:  60, every:  3 },      // 1º minuto: 20 chamadas — Pix cai aqui
  { until: 300, every: 10 },      // até 5 min: mais 24
  { until: Infinity, every: 30 }  // resto da janela
];
```

Contas conferidas por simulação: **64 requisições em 15 min** (limite: 300) e **94 na janela de
30 min**, contra 450 antes. Folga de quase 5x mesmo com duas pessoas no mesmo IP — e, pelo mesmo
motivo, 94 consultas ao Mercado Pago em vez de 450. Junto disso:

- **429 aparece na tela** e o ritmo cai para o degrau mais lento em vez de insistir;
- **401 encerra o polling com a mensagem certa** — o token do Supabase vence enquanto a pessoa
  espera, e "sessão expirada" numa tela de pagamento parece que o dinheiro sumiu. A mensagem diz
  o que é verdade: o pagamento está amarrado à cobrança no backend, não a esta aba;
- **falha repetida (3 seguidas) aparece na tela** — uma isolada continua silenciosa, porque
  cold start do Render leva 30–60s e assustar por causa disso seria ruído;
- `cancelled` e `refunded` agora encerram o polling (antes só `paid` e `expired`);
- `setStatus` sai cedo quando a mensagem não mudou, senão o spinner reiniciaria a cada poll.

---

## 2. 🟡 Lacunas de robustez

### 2.1 `billingService.ts` não tem teste nenhum

O arquivo de 300 linhas que **decide quem ganha acesso pago** é o único do fluxo sem cobertura.
Os testes da branch cobrem as bordas puras — vigência, cota, status, aviso de vencimento — mas
nenhum toca `createCharge`, `confirmPaymentByOrderId` ou `getChargeStatus`, nem as rotas de
`billingRoute.ts`.

Confirmado: `grep -rl "billingService\|confirmPaymentByOrderId" test/` não retorna nada.

Os caminhos que mais merecem teste (com o Supabase e o `mercadoPagoClient` mockados):

- notificação repetida não cria segunda assinatura (a 1ª camada de idempotência, `charge.status === "paid"`)
- `23505` no insert devolve `created: false` em vez de estourar
- `user_id` nulo lança `USER_REQUIRED` — este é o caso que **já aconteceu de verdade** no teste
  manual de 04/ago, segundo a armadilha nº 8 dos próximos passos
- status ≠ `paid` atualiza a cobrança e **não** cria assinatura
- falha do provedor no `createCharge` marca a cobrança como `cancelled`

São testes baratos e cobrem exatamente onde erro vira dinheiro.

### ✅ Corrigido — `test/billingService.test.ts`, 26 testes

Supabase e Mercado Pago falsos; o que se testa é a **decisão**. Além dos cinco casos previstos
acima, entraram: o preço vindo do plano (5990 / 1690, com o valor pedido ao provedor conferido
contra o gravado), o carimbo do aceite com hora do servidor, a vigência de 12 meses de
calendário, a renovação antecipada somando ao saldo, o status desconhecido caindo em `pending`,
a mensagem do provedor não vazando para o cliente, o filtro por dono no `getChargeStatus`, e a
reconciliação devolvendo o status armazenado quando o provedor está fora.

Backend passou de **171 para 202 testes** — e para **209** com os do `APRO` (§6).

### 2.2 O valor pago nunca é conferido contra o valor cobrado

`getOrder` já devolve `amountCents` do snapshot da order, mas `confirmPaymentByOrderId` **não
compara** com `charge.amount_cents` antes de criar a assinatura.

Na prática o risco é baixo — o valor do Pix é fixado pela order que nós mesmos criamos. Mas o
dado já está na mão, a comparação é uma linha, e ela transforma "confio que a API não mudou o
valor" em "verifiquei". Divergência deveria virar log de erro alto e recusa, não assinatura.

### ✅ Corrigido — passo 6 do `confirmPaymentByOrderId`

Divergência lança `AMOUNT_MISMATCH` com `logger.error` (cobrado, pago, `chargeId`, `orderId`) e
**não** cria assinatura. `amountCents` nulo não bloqueia: não conseguir conferir é diferente de
conferir e dar errado.

Detalhe do webhook que veio junto: `AMOUNT_MISMATCH` e `USER_REQUIRED` são falhas
**permanentes** — reenviar a notificação mil vezes dá o mesmo resultado. Antes caíam no 500
genérico e o Mercado Pago retentaria em backoff para sempre. Agora respondem 200 com
`needsReview: true`, encerrando a fila; o `logger.error` é que pede atenção humana, e o dinheiro
fica visível em `billing_charges` para tratar pelo runbook.

### 2.3 `legalVersion` aceita qualquer string do cliente

```ts
legalVersion: z.string().trim().min(1, "legalVersion é obrigatória."),
```

O valor é gravado como **prova do que a pessoa aceitou**, mas vem do front sem lista branca —
um cliente forjado grava `"999.0"` ou `"nenhuma"`. O horário é do servidor (correto), mas a
versão não é verificável.

Correção: `z.enum(["1.0"])` no backend, ou uma constante `LEGAL_VERSIONS` que o schema valide.
Custa uma linha e fecha a única ponta da prova que hoje depende do cliente.

### ✅ Corrigido — `backend/src/lib/legalVersions.ts`

Lista branca em módulo próprio, com a regra de manutenção escrita junto: ao publicar uma versão
nova, **acrescente sem remover as antigas** (cobranças passadas apontam para elas) e suba o
backend **antes** do front — na ordem inversa o checkout responde 400 para todo mundo. Aceitar
versões antigas também evita bloquear quem está com a página em cache no meio de uma compra.
Cinco testes novos em `schemas.test.ts`, incluindo a confirmação de que o schema continua sem
campo de valor.

---

## 3. 🟢 O que está bem resolvido (e vale não mexer)

- **Preço no backend.** O schema do checkout nem tem campo de valor. Fecha a fraude nº 1.
- **Verdade via `GET` autenticado.** Webhook forjado não libera nada. Fecha a fraude nº 2.
- **Idempotência em duas camadas** — verificação de status + índice único
  `(provider, charge_id)`. O tratamento do `23505` como caminho normal está certo.
- **Recusa de `user_id` nulo no código**, já que a coluna é nullable por causa da LGPD.
  Exatamente a armadilha nº 8, e está resolvida.
- **Trava de ambiente** (`MERCADOPAGO_ENV`). Token de teste e de produção são idênticos a olho;
  a bandeira obrigatória e a recusa de `NODE_ENV=production` + `ENV=test` evitam os dois
  acidentes caros.
- **`normalizeOrderStatus` falha fechado** — status desconhecido vira `pending`, nunca `paid`.
- **Gate falha fechado** em todos os caminhos: sem Supabase ou com erro de banco, ninguém é
  assinante.
- **`X-Idempotency-Key` determinístico** (o próprio `externalReference`): retentativa de rede
  não vira cobrança dupla no provedor.
- **A linha nasce antes da chamada externa**, então falha do provedor deixa registro
  rastreável em vez de cobrança órfã.
- **Webhook fora do rate-limit** — a justificativa no comentário está certa: 429 para o
  provedor gera *mais* tráfego, não menos.
- **A faixa da tela diz a verdade sobre o modo** (dev / demo / produção). Detalhe pequeno,
  postura correta: mentira sobre cobrança é a pior espécie.

Sobre a validação `x-signature` do webhook: a análise dos documentos está **correta**. Não é a
diferença entre seguro e inseguro, é defesa em profundidade — e depende de URL pública. Deixar
para depois do deploy é a ordem certa. Vale notar que ela também mitiga o consumo de limite da
API do provedor mencionado em §1.

---

## 4. 📄 Documentos desatualizados — ✅ ambos corrigidos

### 4.1 `docs/proximos-passos.md` §3 "Etapa C" — item já feito

> - [ ] Rodapé do app React com links para `/termos`, `/privacidade`, `/reembolso`
>       (hoje só o checkout linka)

**Está implementado.** `frontend/src/App.tsx` linhas 243–260 têm o `<footer className="site-footer">`
com os três links e a isenção da ANP. O `PR_BODY.md` §2 já afirma isso corretamente — os dois
documentos se contradizem. Marcar como feito.

### 4.2 `docs/proximos-passos.md` §4 armadilha 7 — número errado

> **Só o `expiration_time` da order não expira a assinatura.** São coisas diferentes: um é o
> prazo do QR (**15 min**)…

O código usa **30 min** (`QR_EXPIRES_MINUTES = 30` no `billingService.ts`, espelhado em
`EXPIRES_SECONDS = 30 * 60` no `checkout.html`). O ponto da armadilha continua válido; só o
número está velho.

---

## 5. Ordem sugerida

**Antes do PR:**

1. ✅ ~~Corrigir o polling~~ (§1) — feito.
2. ✅ ~~Testes do `billingService`~~ (§2.1) — feito.
3. ✅ ~~Conferência de valor (§2.2) e lista branca de `legalVersion` (§2.3)~~ — feitos.
4. ✅ ~~Corrigir os dois documentos~~ (§4) — feito.
5. **Teste ponta a ponta com pagamento sandbox** — o único bloqueador que sobrou.

**Antes de `MERCADOPAGO_ENV=production`:**

6. `x-signature` do webhook, depois da URL pública.
7. O portão de go-live completo do `runbook-operacao.md` §1.
8. Estorno, reembolso proporcional, exclusão de conta e exportação LGPD — a dívida assumida nos
   documentos legais (Etapa B). Enquanto não automatiza, o procedimento manual está no runbook.

**Estado após as correções:** `tsc` e `eslint` limpos nos dois pacotes, **209 testes no backend**
e **61 no frontend** passando.

**Sobre "um PR ou três":** a divisão em três (visual · legal · billing) conta a história melhor,
mas os commits de billing já dependem das migrações e dos documentos legais para fazer sentido
sozinhos — o aceite obrigatório amarra as duas frentes. Se dividir, `visual` sai limpo; `legal`
e `billing` vão brigar no rebase. Um PR só, com os grupos marcados no corpo (que o `PR_BODY.md`
já faz), é a opção de menor atrito.

---

## 6. 🔴 Achado tardio — o teste planejado não podia passar

Encontrado ao escrever o roteiro do teste, depois de fechar a auditoria. É o achado mais
importante dos seis, porque invalidava **o plano inteiro** do último passo antes do PR.

O `proximos-passos.md` mandava "pagar com a conta de teste do Mercado Pago e ver o polling virar
pago". A documentação oficial diz o contrário:

> When creating a payment in sandbox mode, it will be pending and the corresponding Pix code and
> QR code will be returned, **but it will not be possible to use these codes to end the flow and
> approve the test payment.**

Ou seja: **um Pix de sandbox não pode ser pago.** O copia e cola não é um Pix válido para banco
nenhum, e a conta de teste do Mercado Pago também não paga QR de Pix. O teste como estava escrito
travaria no passo 5 — e o diagnóstico natural seria procurar bug no nosso código, que estaria
certo o tempo todo. Horas perdidas caçando um fantasma.

A saída oficial é a **order de valores predefinidos**: `payer.first_name = "APRO"` faz a order
nascer `action_required` e mudar sozinha para aprovada.

### ✅ Corrigido — `buildPayer` no `mercadoPagoClient.ts`

O `APRO` entra automaticamente quando `MERCADOPAGO_ENV=test`, e o log diz que entrou. Em produção
o `payer` vai só com o e-mail.

**Por que isso não é um risco:** o gatilho é o nosso próprio `MERCADOPAGO_ENV`, e o config
**recusa o boot** com `NODE_ENV=production` + `MERCADOPAGO_ENV=test`. Não existe combinação em
que produção envie `APRO` — que seria o pior bug possível neste sistema: order marcada como
aprovada sem ninguém ter pago. `test/mercadoPagoPayer.test.ts` trava o contrato nas duas
direções (7 testes), incluindo o `qr_code_base64` vazio que o sandbox devolve virando `null` em
vez de um `<img>` quebrado.

**Roteiro refeito:** `docs/teste-ponta-a-ponta.md`, com teste de fumaça por curl antes de abrir o
navegador — ele separa "a conta do Mercado Pago está pronta" de "meu código está certo", que são
as duas causas possíveis de falha e pedem investigações completamente diferentes.

**Fonte:** [Perform a Test Purchase with Pix — Mercado Pago
Developers](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix)
