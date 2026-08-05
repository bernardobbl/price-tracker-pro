# Recebimento sem CNPJ — as opções reais

> **Complemento de `docs/fase10-pagamentos.md`.** Aquele documento desenhou a arquitetura
> assumindo AbacatePay e descobriu, na seção 6.6, que ela **não liga produção sem CNPJ**.
> Este documento responde à pergunta que ficou aberta: **quais caminhos existem para
> receber com CPF**, e o que cada um cobra em taxa, esforço e dor de cabeça.
>
> Decisão registrada do Bernardo (03/ago/2026): **não abrir MEI nem CNPJ agora**, e só
> reavaliar quando houver volume de clientes pagantes. Este documento respeita isso — não
> repete o argumento, apenas mostra o que dá para fazer dentro dessa restrição.
>
> ⚠️ Não sou contador nem advogado. Taxas, limites e regras de cadastro mudam sem aviso e
> variam por perfil. **Confirme cada número direto com o provedor antes de decidir.**

---

## 1. A escolha real: quem confirma que o pagamento entrou?

Todo o resto é detalhe. A pergunta que separa as opções é uma só:

> Quando o cliente paga, **quem avisa o seu sistema** — e você confia nesse aviso?

Isso divide o mundo em dois:

```
  A) PIX DIRETO NA SUA CHAVE            B) PIX VIA PROVEDOR (PSP)
     (QR estático, chave aleatória)        (QR dinâmico, por cobrança)

     cliente paga → cai na sua conta      cliente paga → cai no PSP
                    │                                    │
                    ▼                                    ▼
     ninguém avisa o seu sistema.         webhook assinado chega no
     Você descobre olhando o extrato.     seu backend em segundos.
                    │                                    │
                    ▼                                    ▼
     ❌ liberação manual                  ✅ liberação automática
     ❌ não dá pra saber QUEM pagou       ✅ cada cobrança tem id próprio
     ❌ comprovante falso funciona        ✅ conciliação automática
     ✅ taxa zero, CPF serve              ⚠️ taxa por transação
```

**Não existe meio-termo honesto.** Um QR estático com chave aleatória não carrega
identificação do comprador nem dispara notificação — quem promete isso está vendendo
gambiarra de leitura de extrato ou de e-mail bancário, que quebra e é frágil a fraude.

---

## 2. Opção A — Pix direto na sua chave aleatória

O que você descreveu na conversa. Vale entender exatamente o que ela é.

**Como funciona:** você gera **uma vez** um BR Code estático a partir de uma chave aleatória
(EVP) da sua conta, salva a imagem, e a página de checkout mostra sempre o mesmo QR.

| | |
|---|---|
| **Cadastro** | Nenhum. Só uma conta bancária no seu CPF. |
| **Taxa** | R$ 0. O dinheiro cai inteiro e na hora. |
| **Confirmação automática** | **Não existe.** |
| **Esforço por venda** | Você abre o app do banco, confere, e libera o acesso na mão. |
| **Fraude** | Alta. Print de comprovante é trivial de forjar, e você não tem como cruzar. |

**Onde isso quebra na prática:** com 3 assinantes é administrável. Com 30 você vira
funcionário do próprio produto — e o cliente que pagou às 23h só é liberado quando você
acorda. Renovação mensal multiplica o problema: são 30 conferências por mês, todo mês.

**O detalhe que ninguém conta:** para identificar *quem* pagou, você precisaria de um QR
**por cliente** com um identificador embutido (campo `txid`). Chave estática não tem isso.
Gerar `txid` por cobrança **é exatamente o que um PSP faz** — se você for construir isso,
já está construindo a opção B, só que sozinho e sem webhook.

> **Veredito:** serve para as **primeiras vendas manuais** (a "Etapa 1" do plano antigo,
> validar se alguém paga). Não serve como produto.

---

## 3. Opção B — PSPs que aceitam pessoa física

Aqui está a resposta à pergunta que o documento anterior deixou em aberto. Os três abaixo
têm API Pix com webhook **e** indicação pública de aceitar conta com CPF:

| Provedor | Aceita CPF? | Pix Automático (recorrência) | Observação |
|---|---|---|---|
| **Mercado Pago** | Sim — a doc de integração trata CPF como chave de recebimento; CNPJ é recomendado para volume/NF, não exigido tecnicamente | Não confirmei | Maior base instalada, Checkout Transparente documentado, QR fica na sua página |
| **Asaas** | Sim — a doc cita explicitamente limite de "5 chaves para pessoa física" | **Sim**, tem produto de Pix Automático documentado | O mais completo em assinatura recorrente; foco em cobrança |
| **InfinitePay** | Sim — a central de ajuda diz que dá para vender só com CPF, sem CNPJ ativo | Não confirmei | Anuncia Pix sem taxa de recebimento; conferir o que vale para API |

**O que muda no seu código:** quase nada. O plano antigo já isolou todo o contato com o
gateway em `abacatePayClient.ts`. Trocar de provedor é reescrever **um arquivo** — os
contratos (`POST /api/billing/checkout`, `GET /api/billing/charge/:id`, webhook) continuam
iguais, e o `checkout.html` não precisa saber quem está atrás.

### Recorrência: o ponto que decide entre mensal e anual

Pix comum **não renova sozinho**. Isso tem consequência direta no seu modelo de preço:

- **Plano anual (R$ 59,90):** funciona bem com Pix comum. Uma cobrança por ano, e você
  avisa por e-mail antes de vencer.
- **Plano mensal (R$ 16,90):** com Pix comum, o cliente precisa pagar um QR novo **todo
  mês**, na mão. A evasão nesse fluxo é alta — não porque a pessoa quer cancelar, mas
  porque ela esquece.

Duas saídas seriam **Pix Automático** ou **cartão de crédito** no mensal. A primeira caiu
por regra do Banco Central (ver §5.1). A segunda foi **descartada por decisão de produto em
04/ago/2026**: o cartão custa 4,98% contra 0,99% do Pix, exige tokenização e cadastro, e
adiciona atrito justamente onde o usuário decide. O checkout ficou **só com Pix**, e o mensal
convive com a renovação manual — com o aviso automático de vencimento como amortecedor.

---

## 4. Sobre "uma conta terceira que eu criar"

Um ponto só, factual, porque muda a viabilidade: a conta precisa ser **no seu CPF**. Uma
segunda conta digital sua, separada do dinheiro pessoal, é ótima ideia e resolve o problema
de conciliação — é a recomendação 2 da seção 6.6 do plano antigo, e é grátis abrir.

O que não funciona é receber na conta de **outra pessoa** (parente, sócio informal). Além
do risco para quem empresta o nome, os PSPs validam titularidade no saque: o destino tem
que bater com o titular da conta. Você travaria na hora de tirar o dinheiro.

---

## 5. Recomendação

Considerando que **ainda não existe um único cliente pagante**:

| Etapa | O que fazer | Quando sair dela |
|---|---|---|
| **Agora** | ~~Manter `DEMO = true`~~ **Superado (04/ago):** o checkout já fala com o backend usando as credenciais de teste do Mercado Pago. Ninguém é cobrado até entrarem as credenciais de produção. | Quando alguém disser "quero pagar" |
| **Primeiras vendas** | Opção A na mão — chave aleatória, você confere e libera. Serve para descobrir se o preço gruda. | Quando passar de ~5 assinantes |
| **Produto de verdade** | Opção B: escolher um dos três PSPs, reescrever `abacatePayClient.ts`, ligar o webhook. | — |

O trabalho técnico pesado (webhook assinado, idempotência, entitlement com RLS, gate de
feature) **é o mesmo nos três PSPs** e já está desenhado no plano antigo. Nada do que você
construir agora é jogado fora ao trocar de provedor.

---

## 5.1 ⛔ Achado decisivo: Pix Automático exige CNPJ — e isso não é regra de gateway

Apurado em 04/ago/2026, direto na documentação do Banco Central.

> **No Pix Automático, o recebedor precisa ser pessoa jurídica com CNPJ ativo.**
> A modalidade nasceu com pessoa física apenas como **pagadora** e empresa como **recebedora**.
> A limitação é proposital: o BC quis restringir o recurso a cobrança de serviços e assinaturas,
> e não a transferência entre pessoas.

**Por que isso é diferente de tudo que discutimos antes:** as exigências da AbacatePay eram
política *da empresa* — por isso trocar de provedor era saída. Esta é **regra do Banco Central**,
válida para todo o ecossistema Pix. **Nenhum gateway contorna.** Mercado Pago, Asaas, InfinitePay:
nenhum pode te dar Pix Automático enquanto você for pessoa física.

### O que sobra, na prática

| Plano | Pix comum funciona? | Renova sozinho? |
|---|---|---|
| **Anual — R$ 59,90** | Sim, sem restrição | Não precisa. É uma cobrança por ano; você avisa por e-mail antes de vencer. |
| **Mensal — R$ 16,90** | Sim, mas o cliente paga um QR **novo** todo mês, na mão | **Não.** Sem CNPJ, não existe renovação automática por Pix. |

**Consequência para o produto:** o **anual vira o plano principal de fato**, não só por
preferência de margem — é o único que funciona bem dentro da restrição. A landing já o trata
assim. O mensal continua vendável, mas com evasão alta por esquecimento, e isso precisa estar
no cálculo de receita, não ser descoberto no terceiro mês.

---

## 5.2 A API do Mercado Pago — confirmada na doc oficial

Checkout Transparente via **Orders API**. É isto que o backend vai chamar:

```
POST https://api.mercadopago.com/v1/orders
  Authorization: Bearer <ACCESS_TOKEN>
  X-Idempotency-Key: <UUID v4>          ← obrigatório, evita cobrança duplicada
  {
    "type": "online",
    "total_amount": "59.90",
    "external_reference": "<id da nossa cobrança>",
    "processing_mode": "automatic",
    "transactions": { "payments": [{
      "amount": "59.90",
      "payment_method": { "id": "pix", "type": "bank_transfer" },
      "expiration_time": "PT30M"        ← 30 min a 30 dias; padrão 24h
    }]},
    "payer": { "email": "<email do cliente>" }
  }
```

A resposta traz exatamente o que o `checkout.html` já espera:

| Campo devolvido | Para que serve na nossa página |
|---|---|
| `qr_code` | o "copia e cola" — vai no `<textarea id="brcode">` |
| `qr_code_base64` | imagem do QR — vai no `<img id="qrImg">` |
| `ticket_url` | página pronta do Mercado Pago, alternativa ao QR próprio |
| `status: action_required` / `status_detail: waiting_transfer` | ainda não pagou |

**Pré-requisito no painel:** é preciso ter **chave Pix cadastrada na conta** antes de a API
funcionar. E as notificações são configuradas pelo tópico **Order**.

O `X-Idempotency-Key` obrigatório é um presente: resolve de graça metade do problema de
idempotência que o plano da Fase 10 descrevia na seção 6.

### ✅ Taxa confirmada na conta do Bernardo (04/ago/2026)

Conferido direto no app, em **Taxas e parcelas**. A tarifa muda por **produto**, e é isso que
explica os números conflitantes que apareciam nos blogs:

| Aba do painel | Pix | Prazo | Serve para nós? |
|---|---|---|---|
| Maquininha Point / Tap | — | — | Não (presencial) |
| **QR Code** | **0,00%** | Na hora | **Não** — é o QR *presencial* (impresso / Point), produto de loja física |
| Link de pagamento | 0,99% | Na hora | Só se fôssemos mandar link avulso |
| **Checkout** | **0,99%** | **Na hora** | **SIM** — é aqui que cai o Checkout Transparente via `/v1/orders` |

> ⚠️ **Não tente usar o QR de 0,00% numa assinatura online.** É outro produto, com outras regras
> de uso. A tentação existe e a economia seria real, mas é o tipo de atalho que derruba a conta.

**Nossa taxa é 0,99%, com liberação na hora.** Sem prazo de 14/30 dias, sem mensalidade.

| | Mercado Pago 0,99% | Asaas R$ 1,99 fixo | Diferença |
|---|---|---|---|
| Mensal R$ 16,90 | **R$ 0,17** → líquido R$ 16,73 | R$ 1,99 (**11,8%**) | MP é **12× mais barato** |
| Anual R$ 59,90 | **R$ 0,59** → líquido R$ 59,31 | R$ 1,99 (3,3%) | MP é **3,4× mais barato** |

A decisão pelo Mercado Pago está confirmada com número real, não com estimativa.

De referência, se um dia quisermos cartão no mensal: **4,98% à vista**, ou R$ 0,84 sobre
R$ 16,90 — cinco vezes o custo do Pix, mas é o preço de ter cobrança recorrente sem CNPJ.

---

## 6. O que foi feito nesta branch

- `frontend/public/checkout.html` — preço do anual corrigido para **R$ 59,90** (era R$ 60,00),
  e a página ganhou a mesma dinâmica visual do app: fio de dados no header e ponteiro de
  tanque no botão enquanto gera a cobrança.
- `frontend/public/premium.html` — os 6 lugares que anunciavam R$ 60/ano e R$ 5,00/mês
  atualizados para R$ 59,90 e R$ 4,99/mês. O selo "economiza 70%" continua correto:
  12 × R$ 16,90 = R$ 202,80 contra R$ 59,90 é 70,5% de desconto.
- `DEMO` continua `true`. **Nenhuma cobrança real acontece.**

---

## Fontes

- [InfinitePay — Pessoa Física pode vender?](https://ajuda.infinitepay.io/pt-BR/articles/3406705-pessoa-fisica-pode-vender-com-a-infinitepay)
- [Asaas — Introdução ao Pix](https://docs.asaas.com/docs/pix)
- [Asaas — Pix Automático](https://docs.asaas.com/docs/pix-automatico)
- [Asaas — Webhook para cobranças](https://docs.asaas.com/docs/webhook-para-cobrancas)
- [Mercado Pago — Integrar com Pix (Checkout API)](https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-configuration/integrate-with-pix)
- [Mercado Pago — Pix para e-commerce](https://www.mercadopago.com.br/blog/integrar-pix-checkout-ecommerce)
