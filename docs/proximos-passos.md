# Próximos passos — a frente de pagamentos

> ## 📍 O status geral mora no `plan.md`, não aqui
>
> Este arquivo é a fonte da verdade sobre **como retomar a frente de pagamentos**: as armadilhas, o
> que falta codar, como rodar local. Para saber **em que pé o projeto está**, vá em
> [`plan.md` → 📍 Estado atual](../plan.md).
>
> A divisão não é burocracia: em 05/ago/2026 este arquivo e o `plan.md` afirmavam coisas diferentes
> sobre os secrets de SMTP, os dois estavam errados, e o alerta semanal ficou semanas sem enviar
> email nenhum. **Um fato mora num lugar só.**
>
> **Para o Bernardo do futuro.** Escrito em 04/ago/2026, atualizado pela última vez em
> **09/ago/2026** (§0.4 e §0.5).
>
> **Branch:** `feat/checkout-pix` → [PR #22](https://github.com/bernardobbl/price-tracker-pro/pull/22)
> — **mergeado** na `main` em 05/ago/2026 (`1b4d02f`). As correções posteriores vivem na
> `fix/pontas-soltas`.
>
> 🔴 **O produto cobra dinheiro real desde 06/ago/2026, 12:44.** Se você chegou aqui procurando "em
> que pé estamos", a resposta está na tabela do milestone no `plan.md` — não neste arquivo.

---

## 0. 🔎 Segunda varredura — 05/ago/2026 (noite)

Revisão independente da branch depois da auditoria, procurando o que tinha escapado. Verificado
do zero: `tsc` limpo nos dois pacotes, `eslint` limpo nos dois, working tree limpo, nenhum `.env`
versionado. Os testes saíram de 209+61 para **211 no backend e 70 no frontend** — os 11 novos são
as regressões dos bugs achados aqui.

### 0.1 ✅ RESOLVIDO — o alerta semanal nunca tinha enviado email em produção

> **Fechado no mesmo dia, 05/ago/2026.** Os cinco secrets foram cadastrados no Actions (copiados do
> painel do Render, Brevo na porta **2525**) e o envio foi **verificado com email real chegando na
> caixa de entrada** — não no spam, o que também derruba a ressalva de entregabilidade da Fase 7.6.
> O relato abaixo fica como registro do diagnóstico.

Descoberto ao conferir o painel do GitHub em 05/ago/2026, e era **mais grave que o item que
estávamos investigando**. Os *Repository secrets* do Actions tinham exatamente três nomes:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. **Nenhum `SMTP_*`, nenhum
`EMAIL_FROM`.**

O que isso causa, hoje, toda segunda-feira:

```
ingest.ts → evaluateAllFuelAlerts() → sendPriceAlertEmail()
                                        └─ getTransporter() devolve null
                                           (falta SMTP_HOST/USER/PASS/EMAIL_FROM)
                                        └─ `if (!tx) return;`  ← sai calado
```

O job termina verde. O log conta quantos alertas foram "notificados". **E nenhum email sai.**

### Por que isso passou despercebido tanto tempo

O `plan.md` §7.6 afirma, sobre a solução do Brevo: *"As mesmas credenciais foram para os secrets
do GitHub, para o alerta semanal do Actions também enviar."* **Essa frase não é verdade** — ou
nunca foi executada, ou os secrets foram perdidos depois. Ela foi escrita junto com um sucesso
real e por isso ninguém duvidou dela.

O sucesso real era outro: a Fase 7.6 validou o alerta **imediato** (`POST /api/fuel/alerts` →
`evaluateFuelAlertImmediately`), que roda **no Render**, onde as credenciais do Brevo existem de
fato. Dois caminhos diferentes, com ambientes diferentes, e o teste cobriu só um. Como o Render
está com `ANP_CRON=off`, o Actions é o **único** caminho do alerta recorrente em produção.

> É a mesma lição da Ponta Solta 3 da Fase 7.7, que já tinha nos pegado com o `FRONTEND_URL`:
> **mudar onde algo executa troca o conjunto de variáveis de ambiente junto.** Da primeira vez
> perdemos o link dentro do email; desta vez, o email inteiro.

**Onde estão as credenciais certas:** no painel do **Render** (Environment do
`price-tracker-pro-api`) — são as do **Brevo, porta 2525**. ⚠️ **Não** copie do `backend/.env`
local: lá está Gmail na 587, e a própria Fase 7.6 registra que essa combinação não funciona a
partir de host (o Render Free bloqueia 25/465/587).

**Correção junto:** o `guard` do `ingest.yml` avisava quando faltava `FRONTEND_URL` mas ficava
calado sobre SMTP — justamente o que teria mostrado isso na aba Actions há semanas. Agora avisa.

### 0.2 Os três bugs de código que o diagnóstico acima destravou

Achar o secret faltando foi o começo. Procurar **por que ninguém notou** rendeu três defeitos reais,
todos corrigidos em 05/ago/2026:

**a) O alerta era marcado como avisado sem que o email saísse.** `sendPriceAlertEmail` devolvia
`void` e caía num `return` mudo sem SMTP; o `notifyAndMark` gravava `triggered: true` assim mesmo.
Como `triggered` só volta a `false` quando o preço sobe acima do alvo, o alerta ficava **queimado** —
a pessoa nunca seria avisada. Agora a função devolve booleano e nada é marcado sem envio confirmado.
O `sendExpiryNoticeEmail` sempre fez assim; foi o modelo. Regressão trancada em
`test/alertNoSmtp.test.ts`.

**b) A avaliação dos alertas estava presa ao sucesso da ingestão.** `if (result.status === "success")`
parecia economia e custava caro: a ANP publica CSVs **mensais**, então a maioria das execuções
semanais volta `skipped` por hash idêntico — em três execuções seguidas de 05/ago, nenhum alerta foi
sequer olhado. E o alvo do alerta é do usuário: quem baixa o alvo hoje precisa ser avaliado contra o
preço que já está no banco. Corrigido no `scripts/ingest.ts` **e** no `scheduleWeeklyAnpJob.ts`.

**c) O cadastro aceitava email sem domínio de topo.** O campo usava só `type="email"`, e a validação
do HTML5 aceita `alguem@gmail` — válido pela RFC, indeliverável na internet. Uma conta real foi
criada assim em 23/jul/2026 e passou meses sem receber nada: nem alerta, nem aviso de vencimento,
nem recuperação de senha. Novo `frontend/src/lib/emailValidation.ts`, aplicado **só no cadastro**
(no login não — quem já tem conta torta precisa conseguir entrar para pedir a correção).

### ✅ Já feito, ao contrário do que este arquivo dizia

- **Variable `FRONTEND_URL`** — existe no Actions (`https://precos-combustivel-br.vercel.app`),
  junto com `BACKEND_URL`. A ação manual da Fase 7.7 foi cumprida; era este arquivo que não sabia.

### ✅ Corrigido nesta varredura

| # | O quê | Onde | Por que importava |
|---|---|---|---|
| 0 | O aviso do Supabase mentia sobre o próprio estado | `config/supabaseClient.ts` | Disparava sempre que faltasse a *anon key* e afirmava "operações remotas serão puladas" — mesmo com a service_role presente, quando nada era pulado. O Actions cai exatamente nesse caso, então todo log de ingestão abria com alarme falso. Alarme falso recorrente treina quem lê a ignorar o log inteiro. |
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

> ✅ **Fechado no mesmo dia:** `useEntitlement` + `PlanBadge` no header, e o 402 da cota virou
> convite no `DetailPanel`. O parágrafo acima fica como registro de como o buraco apareceu.

---

## 0.3 🔎 Terceira varredura — 05/ago/2026 (noite, depois do merge)

Disparada por um relato de uso, não por leitura de código: *"o QR Code e o código de pagamento não
levam a nada — quando você copia o código ou lê o QR, não acontece nada."*

### O diagnóstico: não era bug, e mesmo assim era um defeito

**Um Pix de sandbox não é um Pix.** Com `MERCADOPAGO_ENV=test`, o `qr_code` devolvido pela API não
é reconhecido por banco nenhum: copiar ou ler o QR **falha por desenho**. Isso estava documentado
— em `mercadoPagoClient.ts`, no `buildPayer` — e o comportamento observado batia exatamente com a
documentação.

O defeito é que **nada disso aparecia na tela**. Um brCode de teste é visualmente idêntico a um
real, e a única pista era a faixa do topo dizendo "nenhuma cobrança é real" — que se lê como *"não
vai te cobrar"*, não como *"o seu banco vai recusar este código"*. São afirmações diferentes, e a
segunda é a que a pessoa precisava.

> **A lição, e ela se repete neste projeto:** comportamento documentado no código não é
> comportamento comunicado. O `plan.md` §7.6 já tinha nos pegado assim com o SMTP. Quem está na
> tela não lê o `mercadoPagoClient.ts`.

### O que foi corrigido

| # | O quê | Onde | Por que importava |
|---|---|---|---|
| 1 | O checkout não sabia em que ambiente o código foi gerado | `mercadoPagoClient.ts` → `billingService.ts` → `checkout.html` | O `POST /checkout` passou a devolver `environment: 'test'\|'production'`, e a página mostra um aviso explícito no painel do Pix quando é sandbox. **O ambiente vem do backend, nunca do hostname**: frontend publicado apontando para backend em modo teste é um caso real, e o hostname não denuncia. Campo ausente também aciona o aviso — na dúvida, avisa. |
| 2 | `ticketUrl` era devolvido pela API e **jogado fora** | `checkout.html` | A página hospedada do Mercado Pago, com o mesmo QR, existia e ninguém via. É a saída de quem não consegue ler o QR desta tela. |
| 3 | Sem `brCodeBase64`, a caixa do QR ficava com "QR Code aparece aqui" **para sempre** | `checkout.html` | Parecia carregamento travado. Agora diz que o QR não veio e aponta para o copia e cola (ou para o `ticketUrl`), que continuam válidos. |
| 4 | **503 `BILLING_DISABLED` virava "tente de novo em instantes"** | `checkout.html` | É o estado de produção **hoje**: as variáveis `MERCADOPAGO_*` não estão no Render, e `/premium` está no ar linkando este checkout. Quem clicar em "Gerar pagamento" recebia um convite a repetir um caminho que nunca vai funcionar. A §"RETOMAR AQUI" previa exatamente isto ("se demorar, trate o `BILLING_DISABLED` na tela"). Também passou a distinguir 429. |
| 5 | O contador do HTML dizia **15:00** com o QR valendo **30 min** | `checkout.html` | Valor fixo que aparece antes do JavaScript rodar. Contador menor que o código faz a tela dizer "expirou" com o Pix ainda válido — e a pessoa desiste de um pagamento que teria funcionado. É a armadilha nº 7 desta lista, acontecendo. |
| 6 | Depois de excluir a conta, não sobrava como pedir reembolso | `accountService.ts` + `accountRoute.ts` | A resposta prometia que os registros "continuam servindo de base para um pedido de reembolso", mas `user_id = null` torna a cobrança inalcançável por qualquer busca por pessoa, e o `previewRefund` só trabalha por `chargeId`. Agora os ids vão na resposta — a promessa passou a ser exequível. |
| 7 | Validação `x-signature` do webhook | `lib/webhookSignature.ts` | Era a última dívida técnica declarada. O bloqueio ("precisa de URL pública") já não existia: a API está no ar desde o merge. Ver a seção própria na §3. |

**Guardas novos** (`frontend/src/lib/checkoutPage.test.ts`): o `checkout.html` é a única página que
move dinheiro e a única sem compilador olhando. O teste agora confere que todo `$('id')` do script
existe no HTML — um id errado devolve `null`, a linha seguinte estoura e **derruba o polling que
confirma o pagamento** —, que o contador bate com `EXPIRES_SECONDS`, e que os quatro pontos acima
não regridem.

---

## 0.4 🔎 Quarta varredura — 09/ago/2026 (branch `fix/pontas-soltas`)

Leitura do código inteiro procurando o que não fecha. **415 testes passam** (296 backend + 119
frontend), `tsc` e `eslint` limpos nos dois pacotes, build dos dois ok. Dois achados, e o primeiro
é filho direto da correção anterior.

### 0.4.1 A tela dizia "Alertas ativos" para alertas que não disparam mais

O corte por cota do commit `722df0e` fechou o vazamento de receita: quem assinou, criou vários
alertas e deixou vencer parou de recebê-los todo domingo de graça. Ele **não** mexeu na tela — e a
barra lateral continuou listando os mesmos alertas sob o título `Alertas ativos`.

Para a pessoa nessa situação, o produto passou a afirmar, por escrito, o oposto do que faz. E o
único registro do corte era o `logger.info` do job semanal: observável para quem opera o serviço,
invisível para quem usa. O próprio comentário do `alertQuota.ts` previa a pergunta — *"por que
parei de receber e-mail?" é uma pergunta que chega ao suporte* — e respondeu só para o operador.

É a quinta ocorrência do mesmo padrão neste projeto (Pix de sandbox, SMTP ausente, `/entitlement`
sem tela, `AccountPanel`, agora esta): **comportamento documentado no código não é comportamento
comunicado**. Duas coisas a distinguem das anteriores, e as duas pioram o caso:

- não é omissão, é **afirmação positiva e falsa**. Quem lê "ativos" sai mais errado do que se não
  houvesse título nenhum;
- cai justamente sobre quem **já pagou uma vez**, que é a pessoa mais provável de renovar e a que
  mais precisa entender o que aconteceu.

**Correção.** `GET /api/fuel/alerts` passou a devolver `dormant` por alerta, calculado pelo novo
`markDormantByQuota` — que é a **mesma** função usada pelo job semanal, não uma segunda cópia da
regra. A tela troca o título por "Seus alertas", marca os dormentes com "não avisa", explica em uma
frase que nada foi apagado e aponta para o Premium.

> ⚠️ **Não recalcule isso no navegador.** O front tem o `entitlement` e conseguiria contar até
> `FREE_ALERT_LIMIT` sozinho — ao custo de duplicar o limite, a ordem de sobrevivência e o
> desempate por `id`. No dia em que uma das três mudasse, a tela marcaria como parado um alerta que
> dispara: uma mentira nova no lugar da que foi consertada. `test/alertDormantFlag.test.ts` compara
> as duas saídas alerta por alerta justamente para impedir a divergência.

**Vazamento junto, achado no caminho:** regravar o alvo de um alerta dormente disparava a avaliação
imediata e **mandava e-mail na hora**. O gate do `POST /alerts` não barra edição (correto: atualizar
não pode custar cota), então o caminho existia e entregava por uma porta lateral exatamente o que o
corte semanal retém — além de contradizer a tela, que agora mostra aquele alerta como parado. A
avaliação imediata passou a pular alertas dormentes.

### 0.4.2 O `render.yaml` dizia que a validação do webhook não existia

O comentário da `MERCADOPAGO_WEBHOOK_SECRET` afirmava *"é lida e não valida nada — a validação
x-signature é pendência aberta"*. Ela foi implementada em 05/ago/2026 (`lib/webhookSignature.ts`,
com a rota respondendo 401), e a frase sobreviveu à implementação.

Mesmo mecanismo do SMTP na §0.1: afirmação desatualizada ao lado de fatos corretos herda a
credibilidade deles. Aqui o efeito prático é direto — o `render.yaml` é o registro do que o serviço
precisa, e quem o lesse deixaria de preencher um segredo achando que não adiantaria. Falta só o
valor; o código está pronto dos dois lados.

### 0.4.3 Segunda passada, no mesmo dia — as páginas de pagamento

Varredura pedida separadamente, olhando só o que o cliente **lê e clica** ao pagar. O detalhe de
cada achado está na tabela §🔧 09/ago do `plan.md`; aqui fica o que muda para quem for mexer:

1. **A faixa do topo do checkout não pode mais afirmar nada sobre dinheiro a partir do hostname.**
   Ela dizia "Nenhuma cobrança é real" em `localhost` — e `localhost` + backend com
   `MERCADOPAGO_ENV=production` é um caso previsto, que o `config/mercadoPago.ts` permite de
   propósito e denuncia no log. Agora ela só afirma para onde a página aponta, e o
   `ajustarFaixaAoAmbiente` corrige a frase quando a resposta do backend chega. **É a armadilha nº 8
   desta lista se repetindo num segundo lugar** — o `#sandboxNote` já obedecia à regra, a faixa não.
2. **`status: 'expired'` vindo do provedor agora para o cronômetro e oferece saída.** Antes só
   chamava `stopPolling()`, em silêncio, com o contador correndo.
3. **A confirmação usa o plano que o backend devolveu**, não o que o navegador escolheu.
4. **Os avisos de "rascunho, não revisado por advogado" saíram dos três documentos legais** — a
   revisão foi em 06/ago. Ver a §2 deste arquivo para a condição que os traz de volta.

### 0.4.4 Terceira passada — usando o produto no navegador, como cliente

Bateria dos blocos B, C e D da §4.5 do `plan.md`, rodada no Chrome contra **produção**. O bloco E
(compra 💸) não foi executado — continua sendo o item 16.

**Verde ao vivo:** `/health` 200 · entitlement `active:false` numa conta sem plano · 1º alerta criado
normalmente · 2º alerta **bloqueado** com o aviso âmbar e link "Ver o Premium" (não erro vermelho) ·
mensagem dizendo o que a pessoa ainda pode fazer · `GET /api/billing/refund/<uuid-inexistente>` com a
conta admin devolvendo **`CHARGE_NOT_FOUND`**, que é a prova positiva do item 10.

Dois defeitos que **só** apareceram usando o produto — nenhum dos dois é visível lendo o código com
a suíte verde:

1. **`SERVIÃ␇OS AUTOMOTIVOS PEDRODAVI LTDA.`** no ranking de São Paulo. O CSV da ANP é UTF-8 e o
   `anpIngestor` o decodificava como Latin-1. Novo `ingest/anpDecode.ts` **detecta** o encoding em
   vez de declará-lo. ⚠️ **A correção não conserta o que já está no banco**: o ingestor pula por
   `ETag` antes de decodificar, então os nomes só se corrigem quando a ANP publicar arquivo novo —
   ou na hora, com `npm run ingest -- --url <url-do-mês>`.
2. **Alerta recusado pela cota deixava um favorito para trás.** O fluxo favorita antes de alertar
   (não dá para inverter: alerta exige série favoritada), então a recusa chegava depois da escrita.
   Agora a tentativa desfaz o que ela mesma criou.

> **A lição desta passada, e ela vale para as próximas.** As duas varreduras anteriores foram feitas
> lendo código e documento, e acharam bastante coisa — mas nenhuma das duas teria achado estas. Um
> nome com cedilha torta e um favorito a mais não quebram teste, não geram log e não contradizem
> nenhum documento. **Só aparecem para quem olha a tela.** Abrir o produto e usá-lo é um método de
> auditoria com alcance próprio, não uma conferência do que a leitura já disse.

### Verificado e correto (não mexi)

Registrado para a próxima varredura não gastar tempo de novo: o gate de criação e o corte semanal
usam a mesma regra; o estorno chama o provedor antes do banco; `confirmPaymentByOrderId` encerra a
assinatura ao ver `refunded`; a landing diz "o grátis acompanha 1", batendo com `FREE_ALERT_LIMIT`;
`requireAdmin`, `requireAuth` e `getMercadoPagoConfig` falham fechado; os links das páginas
estáticas usam `.html`.

**Sobras conhecidas, deliberadamente não tocadas:** `newIdempotencyKey` e `isPlanKey` são exports
sem nenhum chamador (código morto inofensivo); e o cache de e-mail do `userEmailService` não tem
TTL, então trocar de e-mail num processo já em pé só passa a valer no próximo deploy.

> O `robots: noindex` do `premium.html` também estava nesta lista, como decisão de produto. Foi
> **resolvido em 09/ago**: a landing passou a ser indexável, e o `checkout.html` continua `noindex`
> de propósito — página transacional que exige login não serve a quem chega de busca.

---

## 🔴 RETOMAR AQUI — o que fazer na próxima sessão

**415 testes passam** (296 backend + 119 frontend). O fluxo de checkout Pix foi exercitado de
ponta a ponta em 05/ago/2026 — cobrança criada, APRO aprovou sozinho (~7s), reconciliação via
polling, assinatura no banco, gate `active: true`. Registro completo em
[`docs/teste-ponta-a-ponta.md`](./teste-ponta-a-ponta.md).

### ✅ Concluído em 05/ago/2026

- **PR #22 mergeado** na `main` (`1b4d02f`). Vercel publicou; conferido que a página em produção é
  a versão nova. API no Render respondendo `{"status":"ok"}`.
- **Secrets de SMTP no Actions** — os cinco cadastrados, envio verificado com email real na caixa
  de entrada.

> **Sobre as variáveis `MERCADOPAGO_*` no Render: não preencha ainda.** O `render.yaml` define
> `NODE_ENV=production`, e o config **recusa** a combinação `NODE_ENV=production` +
> `MERCADOPAGO_ENV=test` — de propósito, para ninguém pagar um QR de sandbox que não cobra nada.
> Preencher com o token de teste dá o mesmo resultado de não preencher: checkout em 503. Elas
> entram junto com as credenciais de **produção**, no portão de go-live.
>
> Consequência aceita conscientemente: `/premium` está no ar linkando um checkout que hoje só
> responde erro. Decidido em 05/ago **deixar como está** — o tráfego é ~zero e a cobrança liga em
> semanas. Se demorar mais que isso, trate o `BILLING_DISABLED` na tela em vez de dizer "tente de
> novo em instantes", que é mentira.

### ✅ A dívida dos documentos legais foi paga — 05/ago/2026

As três promessas publicadas que só existiam como SQL manual viraram código. Detalhe completo em
[`plan.md` → 📍 Estado atual](../plan.md); o essencial para quem for mexer:

| O quê | Onde | O que muda na prática |
|---|---|---|
| Estorno integral e pró-rata | `GET/POST /api/billing/refund` (admin) | O `POST` exige repetir o valor do preview. Recusa divergência **antes** de chamar o provedor |
| Estorno pelo painel do MP | `confirmPaymentByOrderId` | Passou a encerrar a assinatura ao ver `refunded` — o furo que este runbook avisava |
| Exportar e excluir conta | `GET /api/account/export`, `DELETE /api/account` | Anonimiza `user_id` em `subscriptions` e `billing_charges`; favoritos e alertas caem em cascata |
| App enxerga a assinatura | `PlanBadge` + `useEntitlement` | Selo no header (ativo / vencendo / grátis) e link para `/premium` no rodapé |

**Nova env:** `ADMIN_EMAILS`. Sem ela, ninguém é admin e as rotas de estorno respondem 503.

⚠️ **Armadilha nova, para a lista da §4:** o estorno chama o provedor **antes** de mexer no banco.
Não inverta. Se inverter, uma falha na chamada externa deixa o cliente sem acesso e sem dinheiro,
que é o pior resultado possível. Na ordem atual, falha do provedor não altera nada.

### O que fazer agora — ordem

| # | O quê | Depende de | Nota |
|---|---|---|---|
| 1 | ~~**Revisão jurídica**~~ | ✅ **FEITA 06/ago/2026** | Nenhum texto mudou → `LEGAL_VERSION` segue `1.0` |
| 2 | ~~**Credenciais de produção + go-live**~~ | ✅ **FEITO 06/ago/2026, 12:44** | `MERCADOPAGO_ENV=production` no Render |

> Os dois estão fechados. O que resta são os itens **16** (compra real de ponta a ponta) e **17**
> (lembrete no calendário) da tabela do milestone no `plan.md` — e os dois dependem de você, não de
> código.

> ✅ **O limite do plano gratuito foi ligado em 05/ago/2026** — `FREE_ALERT_LIMIT = 1`. A armadilha
> que este trecho avisava (contagem vinda do `listFuelAlerts`, que confunde "sem alertas" com
> "banco fora") foi fechada junto: o `countFuelAlerts` devolve `null` quando não dá para saber e a
> rota recusa com 503. O raciocínio do número está no `alertQuota.ts` e no `plan.md`.

### Dívida técnica conhecida

- ~~Validação `x-signature` do webhook~~ — **código feito em 05/ago/2026**; falta cadastrar a URL
  no painel e colar `MERCADOPAGO_WEBHOOK_SECRET` no Render para ligar a conferência
- Apagar a conta com email sem TLD (`9f7a8e4c-77a3-4b2e-bb23-fd9e3e56a83f`): nunca receberá email

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
- ~~**`DEMO = false` com credenciais de TESTE** (`MERCADOPAGO_ENV=test`). O fluxo é real de ponta a
  ponta, mas nenhum dinheiro circula até as credenciais de produção entrarem.~~
  🔴 **SUPERADO EM 06/ago/2026, 12:44 — `DEMO = false` com credenciais de PRODUÇÃO**
  (`MERCADOPAGO_ENV=production`). Um Pix gerado no checkout é pagável por qualquer banco e o valor
  cai numa conta real.

  > Esta linha ficou riscada em vez de reescrita de propósito. Ela era a afirmação mais perigosa
  > deste arquivo — "nenhum dinheiro circula" é exatamente a permissão que alguém procura antes de
  > testar algo no checkout —, e este documento é o que o `plan.md` aponta como fonte da verdade
  > para quem retoma a frente de pagamentos. Um leitor que chegasse aqui em busca de "onde
  > paramos" leria, com toda a confiança de uma seção chamada *decisões travadas*, o oposto do
  > estado atual. É o mesmo mecanismo que fez o alerta semanal passar semanas sem enviar e-mail:
  > afirmação desatualizada ao lado de fatos corretos herda a credibilidade deles.
  >
  > **O estado do pagamento mora na tabela do milestone, no `plan.md`.** Aqui ficam as armadilhas e
  > o como-rodar-local.

---

## 2. ⚠️ Pendências que só VOCÊ resolve

Nada disso eu consigo fazer — precisa ser você, e algumas travam o resto.

| # | O quê | Onde | Trava o quê |
|---|---|---|---|
| 1 | ~~Ver a taxa real do Pix por API~~ | ✅ **FEITO 04/ago** | **0,99% na aba "Checkout", liberação na hora.** R$ 0,17 no mensal, R$ 0,59 no anual. (A aba "QR Code" a 0,00% é o QR presencial — outro produto, não serve.) |
| 2 | **Cadastrar uma chave Pix** na conta | Painel do Mercado Pago | **Trava a API inteira** — sem chave, `/v1/orders` não funciona. |
| 3 | **Criar a aplicação** e pegar as credenciais de teste | [Suas integrações](https://www.mercadopago.com.br/developers/panel/app) | Trava o desenvolvimento. |
| 4 | ~~**Revisão jurídica** dos 3 documentos~~ | ✅ **FEITA 06/ago/2026** | Destravou o go-live no mesmo dia. Os avisos de "rascunho" nas páginas publicadas sobreviveram três dias à revisão — corrigidos em 09/ago e travados por teste (`staticPromises.test.ts`). |
| 5 | **Decidir o gatilho de virar MEI** | Você + contador | Nada agora. Decida o número ("quando passar de X/mês") para não virar susto depois. |
| 6 | **Secrets de SMTP** no GitHub Actions — os cinco: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Settings → Secrets and variables → Actions → aba **Secrets** | **Conferido em 05/ago: não existe nenhum deles.** Trava o alerta semanal de preço (que hoje não envia nada) e o aviso de vencimento. Copie do painel do **Render**, não do `.env` local — ver §0.1. A variable `FRONTEND_URL` **já está lá**, não mexa. |

> ~~Os documentos legais são **rascunhos meus, não parecer jurídico** — ninguém com OAB olhou.~~
> **Superado em 06/ago/2026: a revisão jurídica aconteceu e nenhum texto mudou.** A frase riscada
> ficou porque ela era a justificativa de todo o resto desta seção, e apagá-la sem marca faria
> parecer que a revisão nunca foi uma pendência.
>
> ⚠️ A revisão vale para o **texto de 04/ago, versão 1.0**. Qualquer edição futura nos três
> documentos invalida a revisão: suba a `LEGAL_VERSION` (em `checkout.html` **e** em
> `backend/src/lib/legalVersions.ts`) e trate como não revisado até um advogado ver a versão nova.

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

- [x] ~~Validação `x-signature` do webhook~~ — **código FEITO em 05/ago/2026** (ver abaixo). Falta só
      **cadastrar a URL no painel e colar o segredo** no Render: sem `MERCADOPAGO_WEBHOOK_SECRET`
      a conferência fica desligada (e o log avisa uma vez).
- [ ] Trocar credenciais para as de produção + `MERCADOPAGO_ENV=production`
- [ ] Portão de go-live completo do `runbook-operacao.md` §1

### ✅ Validação de assinatura do webhook — FEITA (05/ago/2026)

`backend/src/lib/webhookSignature.ts` implementa o HMAC-SHA256 do manifesto documentado pelo
Mercado Pago, e `POST /api/billing/webhook` responde **401** ao que não bater. É **opcional por
desenho**: sem `MERCADOPAGO_WEBHOOK_SECRET` a rota aceita como antes e avisa **uma vez** no log
(não a cada notificação — alerta repetido some no ruído).

**O que muda de fato:** a forjaria passa a ser barrada *antes* da consulta ao provedor. O sistema
já era seguro sem isso — a confirmação vem de um `GET` autenticado na API, nunca do corpo da
notificação — e o que se ganha é não deixar uma URL pública queimar nosso limite de requisições.

⚠️ **Duas armadilhas do manifesto**, ambas presas por teste em `test/webhookSignature.test.ts`:

1. **`data.id` vai em minúsculas.** Os ids de order vêm sempre maiúsculos (`ORD01JQ4S...`), então
   esquecer isso não falha "às vezes": falha sempre, no primeiro pagamento real.
2. **Campo ausente sai do manifesto**, não vira vazio — `id:;` é outra string e outro HMAC.

**Decisão deliberada: não recusamos por `ts` velho.** O Mercado Pago reenvia a mesma notificação a
cada 15 min até receber 200, carregando a assinatura original; qualquer tolerância curta
transformaria a retentativa — o mecanismo que existe para não perder um pagamento — em 401. E não
há o que ganhar: reprocessar é idempotente e a verdade continua vindo da consulta autenticada.

### Etapa B — Honrar o que os documentos prometem

- [x] ~~**Aviso antes de vencer**~~ — **FEITO em 04/ago/2026**, janela de 8 dias (o job é semanal), roda no `scripts/ingest.ts` via GitHub Actions. Os secrets de SMTP entraram em 05/ago e o envio foi verificado com email real.
- [x] ~~**Estorno**~~ — `GET/POST /api/billing/refund` (admin) + `confirmPaymentByOrderId` encerrando a assinatura ao ver `refunded`, o que cobre também o estorno feito pelo painel do MP.
- [x] ~~**Reembolso proporcional** do anual~~ — `previewRefund` aplica as três regras da política (CDC 7 dias → integral; anual → meses inteiros; mensal fora do prazo → nada), e o `POST` exige repetir o valor calculado.
- [x] ~~**Exclusão de conta a pedido**~~ — `DELETE /api/account`, exigindo `confirm: "EXCLUIR MINHA CONTA"`. Anonimiza o registro fiscal antes de remover o usuário, e **devolve os ids das cobranças** — depois da anonimização eles são a única alça para um pedido de reembolso.
- [x] ~~**Exportar dados do usuário**~~ — `GET /api/account/export`, com `Content-Disposition` para baixar como arquivo.

- [x] ~~**Tela para os dois**~~ — `AccountPanel`, aberto pelo e-mail no header. Baixa o JSON e
  exclui a conta com confirmação digitada. Fechou o padrão que já tinha nos pegado duas vezes:
  endpoint escrito, testado e sem nenhuma tela chamando (foi assim com o `/entitlement`).

### Etapa C — Só depois de A e B

- [x] ~~Rodapé do app React com links para `/termos`, `/privacidade`, `/reembolso`~~ — **já estava feito**, e este arquivo é que estava desatualizado. Ver `frontend/src/App.tsx`, `<footer className="site-footer">`: os três links e a isenção da ANP.
- [x] ~~Limitar alertas do plano grátis~~ — `FREE_ALERT_LIMIT = 1`, ligado em 05/ago/2026.
- [x] ~~Revisão jurídica~~ — **06/ago/2026**, nenhum texto mudou
- [x] ~~Credencial de produção + `MERCADOPAGO_ENV=production`~~ — **06/ago/2026, 12:44**
- [x] ~~Tela de conta com exportar/excluir dados~~ — `AccountPanel`, 05/ago/2026

---

## 4. Armadilhas — leia antes de codar

1. **Preço nunca vem do front.** O `checkout.html` manda só a chave (`'anual'`/`'mensal'`). Quem decide o valor é o backend. Preço no front = qualquer um paga R$ 0,01.
2. **Webhook chega duas vezes.** É garantido, não é hipótese. O índice único em `(provider, charge_id)` é o que impede vigência dobrada.
3. **Não use "30 dias" nem "365 dias".** Use aritmética de calendário. Ver `vigencia-do-acesso.md` §2.3 — conferido: 31/jan +1m = 28/fev, 29/fev/2028 +12m = 28/fev/2029.
4. **Renovar antecipado soma, não substitui.** Senão a pessoa perde os dias que já pagou.
5. **Cold start do Render.** A API dorme após 15 min no plano grátis. Um webhook que chega nesse momento pode receber timeout — o Mercado Pago reenvia, mas o seu handler precisa ser idempotente (ver 2).
6. **`LEGAL_VERSION` no `checkout.html` precisa subir junto** com qualquer edição nos documentos. Sem isso você não prova o que a pessoa aceitou.
7. **Só o `expiration_time` da order não expira a assinatura.** São coisas diferentes: um é o prazo do QR (**30 min** — `QR_EXPIRES_MINUTES` no `billingService.ts`, espelhado em `EXPIRES_SECONDS` no `checkout.html`), outro é a vigência do acesso (1 mês / 12 meses).
8. **Um Pix de sandbox não é pagável — e a tela tem de dizer isso.** Com `MERCADOPAGO_ENV=test` o `qr_code` não é reconhecido por banco nenhum: copiar ou ler o QR falha *por desenho*. O `POST /checkout` devolve `environment` justamente para o checkout avisar. **Nunca deduza o ambiente pelo hostname:** frontend publicado + backend em modo teste não denuncia nada pela URL, e foi assim que o sintoma chegou como "o QR não funciona" (§0.3).

   ⚠️ **Esta regra já foi quebrada duas vezes, no mesmo arquivo.** Consertada no `#sandboxNote` em 05/ago, ela continuou valendo na faixa do topo (`avisarModo`), que via `localhost` e escrevia "Nenhuma cobrança é real" (§0.4.3). O caso perigoso é o **inverso** do de 05/ago: máquina local apontando para backend de produção — que o `config/mercadoPago.ts` permite de propósito e anuncia no log como *"cobranças criadas aqui são REAIS"*. Ao escrever qualquer frase sobre dinheiro nesta página, a pergunta é sempre: **quem me disse isso, o backend ou a barra de endereço?**
9. **O `checkout.html` não passa pelo compilador.** É HTML com `<script>` inline: um `$('id')` errado devolve `null`, a linha seguinte estoura e leva junto o polling que confirma o pagamento. `frontend/src/lib/checkoutPage.test.ts` é o único `tsc` que aquela página tem — não apague, e acrescente ali ao mexer.
10. **O webhook precisa recusar `user_id` vazio.** A coluna é nullable por causa da anonimização (LGPD), então o banco aceita uma assinatura sem dono sem reclamar — foi exatamente o que aconteceu no teste manual de 04/ago. Em produção isso vira dinheiro recebido sem ninguém liberado. **Valide no código antes do insert:** se não achou o usuário, é erro, não linha órfã.

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

> ⚠️ **E é por isso que os links do código apontam para o arquivo real**, nunca para o apelido.
> Em 05/ago/2026 essa armadilha pegou três vezes seguidas: o selo do plano, o rodapé do app e os
> botões "Assinar" da landing apontavam para `/premium` e `/premium/checkout`. Em produção
> funcionava; no `vite dev` o apelido cai no fallback do SPA e devolve o `index.html` — o clique
> parecia não fazer nada e a pessoa voltava ao dashboard. **Funciona em produção e falha em
> desenvolvimento** é o pior formato possível de bug: quem testa local acha que estragou algo, e
> quem confere em produção não vê problema.
>
> A regra agora é verificada por teste: `frontend/src/lib/staticLinks.test.ts` varre os `href` das
> páginas estáticas e falha se algum não resolver para um arquivo que existe em `public/`.

---

## 6. Estimativa honesta — atualizada em 04/ago (fim do dia)

A Etapa A saiu no mesmo dia, não em 2–3. O que resta:

| | Esforço | Depende de |
|---|---|---|
| ~~Teste ponta a ponta com pagamento sandbox~~ | ✅ feito 05/ago | — |
| Estorno + reembolso proporcional (Etapa B) | 1–2 dias | nada |
| Exclusão de conta + exportação LGPD (Etapa B) | 1 dia | nada |
| Webhook com assinatura validada | ~2 h | URL pública (deploy) |
| ~~Revisão jurídica~~ | ✅ feita 06/ago | — |

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
