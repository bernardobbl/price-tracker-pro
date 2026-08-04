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

Duas saídas: **Pix Automático** (o Asaas documenta; o cliente autoriza uma vez e as
cobranças seguintes rodam sozinhas) ou **cartão de crédito** para o mensal, deixando o Pix
como opção do anual. O `checkout.html` já tem os dois métodos na interface.

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
| **Agora** | Manter `DEMO = true` no `checkout.html`. A página inteira funciona, dá print, entra no portfólio, e ninguém é cobrado. | Quando alguém disser "quero pagar" |
| **Primeiras vendas** | Opção A na mão — chave aleatória, você confere e libera. Serve para descobrir se o preço gruda. | Quando passar de ~5 assinantes |
| **Produto de verdade** | Opção B: escolher um dos três PSPs, reescrever `abacatePayClient.ts`, ligar o webhook. | — |

O trabalho técnico pesado (webhook assinado, idempotência, entitlement com RLS, gate de
feature) **é o mesmo nos três PSPs** e já está desenhado no plano antigo. Nada do que você
construir agora é jogado fora ao trocar de provedor.

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
