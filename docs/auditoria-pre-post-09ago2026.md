# Auditoria pré-publicação — 09/ago/2026

> **Registro datado.** Conta o que era verdade em 09/ago/2026, antes do post no LinkedIn e no
> Upwork. Não é atualizado depois. Estado atual mora no `plan.md`.

**Escopo:** `plan.md`, README, os três documentos legais, `checkout.html`, `premium.html`, todas as
rotas e serviços do backend, `App.tsx` + hooks + componentes, workflows, `render.yaml`, histórico do
git, e **as páginas em produção por fetch direto**.

**Veredito:** o código está pronto para publicar. O que não estava pronto era o **repositório como
peça de portfólio** — afirmações que um leitor atento checa primeiro, no topo do `plan.md`, que é
justamente o documento que o projeto usa para se vender.

> ⚠️ **Leia a §"Nota de método" no fim antes de usar este relatório.** Dos quatro blockers
> levantados, o **blocker 2 estava errado** e foi retirado no mesmo dia — o erro e a regra que ele
> gerou ficaram registrados no lugar dele.

---

## Verificação mecânica — tudo verde

| Checagem | Backend | Frontend |
|---|---|---|
| `tsc --noEmit` | ✅ 0 erros | ✅ 0 erros |
| `eslint .` | ✅ 0 problemas | ✅ 0 problemas |
| `build` | ✅ | ✅ (633 kB / 190 kB gzip) |
| `vitest run` | ✅ **304** | ✅ **133** |
| `npm audit --omit=dev` | ✅ 0 vulnerabilidades | ✅ 0 vulnerabilidades |

**Total real: 437 testes.** Guarde este número — ele aparece de novo no item 4.

**Segredos:** varredura de arquivos versionados e do **histórico completo** do git (`--pickaxe` por
`APP_USR-`, `sb_secret_`, JWT `eyJ…`, `AKIA…`): **0 ocorrências**. Nenhum `.env` jamais foi
adicionado — só os dois `.env.example`. O `.gitignore` cobre `.env*`, `dist`, `.vercel`, `.claude`.

---

## 🔴 Blocker 1 — o `plan.md` não sabe que a versão 1.1 existe

Há trabalho não commitado na `legal/privacidade-e-reembolso`: os três documentos legais subiram
para **1.1**, o `LEGAL_VERSIONS` do backend virou `["1.1", "1.0"]` e o `checkout.html` passou a
enviar `1.1`. A mudança é boa e foi feita na ordem certa (backend aceita antes de o front enviar).

O problema é o que o `plan.md` continua afirmando:

| Onde | O que diz | Realidade |
|---|---|---|
| Milestone, item 14 | *"Revisão jurídica dos 3 documentos · ✅ · **nenhum texto mudou**, então `LEGAL_VERSION` segue `1.0`"* | A 1.1 mudou a cláusula 9 (que passou a **não devolver nada** em fraude/revenda), reescreveu a seção 3 do reembolso e trocou o e-mail de contato |
| §4.5, item C4 | *"versão bate com `LEGAL_VERSION = 1.0`"* | Checklist que agora reprova o produto correto |
| Milestone, tabela inteira | não existe item para "revisar a 1.1" | Os comentários dos três HTML dizem, em caixa alta, **"AGUARDANDO REVISÃO JURÍDICA"** |

**Por que isto é mais grave do que parece.** A cláusula 9.2 nova retira dinheiro do consumidor em
caso de violação. O comentário do `termos.html` explica com precisão por que ela precisa de advogado
e por que 9.1 e 9.2 não podem ser fundidas — e essa é a única cópia dessa informação no projeto. A
tabela do milestone, que o próprio documento declara ser **"a única lista de pendências"**, não a
contém. O item legal de maior risco aberto hoje mora exclusivamente num comentário HTML.

É a mesma falha da §7.6 do SMTP: uma afirmação positiva ("revisão ✅") que envelheceu ao lado de um
sucesso real e herdou a credibilidade dele.

**Correção:** commitar; item 14 volta para ⛔ com o texto *"a 1.0 foi revisada; a 1.1 não"*; item
novo para revisar a 1.1; C4 passa a apontar para `CURRENT_LEGAL_VERSION` em vez de um literal.

---

## ~~🔴 Blocker 2~~ — RETIRADO: o achado estava errado, e o erro foi meu

> **Correção escrita no mesmo dia, algumas horas depois.** Mantida aqui, e não apagada, porque um
> registro que some quando erra não serve como registro.

**O que este bloco afirmava:** que a §🚨 do `plan.md` estava errada, que a produção servia o HEAD da
branch e não a `main`, e que portanto *"o deploy de produção da Vercel não está saindo da `main`"*.

**O que era verdade:** a `main` tinha sido atualizada **durante a auditoria**. Os PRs **#25**
(`0ed2c49`, 12:16) e **#27** (`c2244bd`, 13:10) foram mergeados em squash enquanto eu lia o
repositório. A produção servia a `main` — a `main` nova.

**Como o erro foi produzido.** Comparei as páginas publicadas contra `git show main:...`, e o ref
`main` **local** apontava para `2e75b86`, de antes dos merges. **Nunca rodei `git fetch`.** O
conteúdo publicado não batia com aquele ref, e daí saiu a conclusão de que a Vercel publicava de
outro lugar. O fetch das páginas era evidência real; a referência contra a qual ela foi comparada é
que era um cache velho.

**Por que vale mais do que o achado que ele substituiu.** O bloco original acusava o projeto de
*deduzir sem verificar* — "a Vercel publica a `main`, a `main` está atrasada, logo a produção está
atrasada" — e chegou à conclusão errada exatamente pelo mesmo caminho, uma camada acima: assumindo
que o ref local refletia o remoto. O diagnóstico estava certo e o paciente era outro.

**A regra, que é nova e não estava em lugar nenhum do projeto:** *ref local do git não é evidência
sobre estado remoto.* `git log`, `git show main:arquivo` e `git status` falam de um cache, e cache
sem `fetch` mente com a mesma cara de quem diz a verdade. Qualquer afirmação sobre "o que está no
GitHub" ou "o que está publicado" exige um `git fetch` na mesma sessão, antes — inclusive, e
principalmente, sobre a `main`, que é a que todo mundo assume estar em dia.

**Estado real em 09/ago:** item 18 **fechado**. `main` e produção idênticas, conferidas nos dois
lados (rodapé do `/termos.html`, `robots` do `/premium.html`, zero `simBtn` fora de comentário no
`/checkout.html`). O único conteúdo fora da `main` é a **versão 1.1** dos documentos legais, que
espera o push.

---

## 🔴 Blocker 3 — o e-mail que abre a rota de estorno está publicado no `plan.md`

Três ocorrências de `bernardobarcellosleite@gmail.com` no `plan.md`, e a da linha 106 diz
explicitamente que é o valor de `ADMIN_EMAILS` — a variável que autoriza `POST /api/billing/refund`.

Não é vulnerabilidade: a rota exige token válido do Supabase e o `requireAdmin` devolve 404 para
quem não é admin. Mas num repositório público isso entrega **o alvo**: a única conta capaz de mover
dinheiro, nominada, com a informação de que ela é essa conta. Vale para tentativa de recuperação de
senha e para credential stuffing.

E há a incoerência: a 1.1 tirou esse endereço dos três documentos legais justamente para não expor
o e-mail pessoal. O `plan.md` continua expondo — junto com a função dele.

**Correção:** trocar as três ocorrências por `<seu-email-admin>` ou pelo `pricetrackerpro@`, mantendo
a lição (a conta precisa existir no Supabase), que é a parte que vale.

---

## 🔴 Blocker 4 — o README diz 398 testes; são 437

Em três lugares: tabela de stack, §Testing & CI, §Technical decisions.

O agravante é a regra do próprio projeto. O `plan.md` afirma: *"este é o **único lugar** do
repositório que carrega a contagem de testes — a §4.5 já teve os números repetidos, envelheceu
sozinha e passou a ensinar quem executava o checklist a ignorar o desvio."*

O README carrega o número, não está listado no mapa de donos da verdade, e está errado por 39. A
regra foi escrita e o arquivo mais lido do repositório ficou de fora dela.

**Correção:** ou remover o número do README ("full suite on every push"), ou incluí-lo no mapa da
§*Mapa dos documentos* e atualizá-lo. A primeira é mais barata e não envelhece.

---

## Importantes — antes de a próxima pessoa pagar

**5 · `EMAIL_FROM` × o novo e-mail de contato.** A 1.1 manda o cliente escrever para
`pricetrackerpro@gmail.com` (LGPD art. 18, prazo de 15 dias; Termos, 7 dias úteis). Duas verificações
que só você pode fazer: **a caixa existe e é lida**, e o `EMAIL_FROM` no Render e nos secrets do
Actions aponta para ela. Se o comprovante de pagamento sai do endereço antigo, o "responder" do
cliente vai para uma caixa que os documentos não citam — e o prazo corre igual.

**6 · Ordem de deploy da 1.1.** A Vercel publica em ~1 min, o Render leva vários. Existe uma janela
em que o front envia `1.1` e o backend só conhece `1.0` → **400 no checkout para todo mundo**. É
exatamente o cenário que o cabeçalho do `legalVersions.ts` descreve. Nenhum teste cruza os dois
pacotes: o `staticPromises.test.ts` amarra `checkout.html` ↔ páginas legais, e para aí. Suba o
backend primeiro, ou aceite a janela de propósito e sabendo dela.

**7 · Screenshots.** O README ainda tem o bloco comentado `<!-- Screenshots / GIF go here -->`. Para
um post de LinkedIn é o item de maior retorno por esforço do projeto inteiro — um GIF do fluxo
sinal de compra → alerta vale mais que qualquer parágrafo do README.

**8 · Analytics.** `trackEvent` só faz `console.log`. Se o objetivo do post é responder *"alguém
paga sem eu pedir?"*, publicar sem medição gasta o tráfego do lançamento — que é o único tráfego
grande e não repetível que o projeto vai ter — sem coletar a resposta.

**9 · Bundle de 633 kB** (190 kB gzip), sem code splitting. Nitpick de portfólio: um revisor
front-end nota. Não afeta usuário no gzip.

---

## O que está muito bom — e vale ser dito no post

- **As camadas do billing.** Preço decidido no servidor; verdade do pagamento vinda de um GET
  autenticado e nunca do corpo do webhook; idempotência em duas camadas (índice único + verificação);
  valor pago conferido contra o cobrado; estorno com valor confirmado que precisa bater com o
  preview; provedor antes do banco, com o motivo escrito.
- **Fail-closed consistente**, nos três lugares que importam: `requireAuth` em produção,
  `requireAdmin` sem `ADMIN_EMAILS`, e a cota recusando quando `countFuelAlerts` devolve `null`.
  Esse último é raro de ver — "não consegui contar" tratado como diferente de "contei zero".
- **`requireAdmin` devolvendo 404 e não 403**, para não revelar que a rota existe.
- **LGPD implementada de verdade:** anonimização **antes** da remoção do usuário, para não deixar
  registro fiscal órfão. A ordem está no código e o porquê está no comentário.
- **Os comentários.** É o maior diferencial deste repositório. Quase todo bloco não conta o que o
  código faz — conta qual defeito real o produziu e o que aconteceria sem ele. Um revisor técnico
  identifica isso em trinta segundos, e é raríssimo.

---

## Ordem sugerida antes de postar

- [x] Commitar a 1.1 e corrigir os itens 14 e C4 do `plan.md` *(blocker 1)*
- [x] ~~Reescrever a §🚨~~ → o blocker 2 não existia; a §🚨 foi reescrita para registrar o merge
      (item 18) e o erro de leitura que produziu o achado falso
- [x] Tirar o e-mail admin do `plan.md` *(blocker 3)*
- [x] Corrigir/remover a contagem de testes do README *(blocker 4)*
- [x] Mergear na `main` — feito por você pelos PRs #25 e #27, durante esta auditoria
- [ ] **Conferir a caixa `pricetrackerpro@gmail.com` e o `EMAIL_FROM`** — antes do push da 1.1, não
      depois: os prazos da LGPD começam a correr quando aqueles documentos forem publicados
- [ ] **Push da 1.1** — Render antes da Vercel, senão o checkout responde 400 na janela entre os dois
- [ ] **Screenshots + GIF no README**
- [ ] Postar

O último item técnico é o push. O de maior retorno para o post continua sendo o GIF.

---

## Nota de método — o que esta auditoria errou

Quatro achados, três corretos. O quarto (blocker 2) foi produzido comparando produção contra um ref
`git` local sem ter rodado `fetch`, e afirmava um problema de infraestrutura que não existia.

Um relatório de auditoria que erra um em quatro é útil; um que erra e não registra qual, não é. A
regra que sai daí está no bloco do blocker 2 e vale além deste documento: **ref local não é evidência
sobre estado remoto.**
