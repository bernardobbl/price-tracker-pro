# Plan.md — Price Tracker Pro → versão 10x (portfólio + deploy)

> Objetivo: transformar o Price Tracker Pro num projeto **profissional, confiável e apresentável**,
> pronto para LinkedIn e portfólio, com **deploy público funcionando** e um **README que vende o projeto**.
>
> Este documento é o roteiro. Cada fase tem: **metas**, **tarefas** e **critério de pronto (DoD)**.
> Marque os checkboxes conforme avançar. Faça uma fase por vez — não pule para a UI antes de estabilizar a base.

---

## 1. Diagnóstico do estado atual

### O que já está bom (a base é honesta)
- Separação clara `backend/` (Express + TS) e `frontend/` (React + Vite + TS).
- TypeScript nos dois lados, com `strict: true`.
- Autenticação real com Supabase Auth (login/signup, sessão, logout).
- **Row Level Security** bem configurado no `schema.sql` (cada usuário só vê o que é seu).
- Alertas de preço por email (Nodemailer) + cron diário (`node-cron`).
- Gráfico de evolução de preço com Chart.js.

### Problemas e riscos (o que precisa mudar)

**🔴 Críticos (quebram em produção ou confundem o usuário)**
1. **Bug de UX no destaque de preço** (`App.tsx`): quando há mais de 1 registro, o número em destaque vira a **média** (rótulo "Média de preço") em vez do **preço atual**. Num rastreador de preços, o preço atual é o herói. A média é um dado secundário.
2. **Persistência dupla e frágil**: grava em CSV local **e** em Supabase (`priceService.ts`). Os CSVs estão **commitados no git** e o filesystem de hosts de deploy (Render/Railway/Fly/Vercel) é **efêmero** → os dados em CSV se perdem a cada deploy. Fonte única de verdade tem que ser o Supabase.
3. **Scraping dentro da request HTTP**: `POST /api/track` faz até 2 fetches ao Mercado Livre de forma síncrona, sem timeout/retry/cache. Lento (segundos), quebra fácil (seletores voláteis) e pode ser bloqueado. Scraping é trabalho de background, não de request.

**🟠 Importantes (qualidade e escala)**
4. **N+1 e caminhos duplicados nos alertas**: `evaluateAlertImmediately` e `evaluateAlertsForPrice` fazem lógica parecida; ambos chamam `auth.admin.getUserById` por alerta.
5. **Sem validação de entrada** (nenhum Zod/schema): checagens manuais espalhadas.
6. **Tipos duplicados** entre front e back (`PriceHistoryItem` existe nos dois — some manualmente).
7. **Sem testes, sem CI, sem Docker, sem config de deploy.**
8. **CSVs de dados reais commitados** (inclusive nomes com espaço/acento: `prices_capacete de moto.csv`) — poluem o repositório.
9. **`requireAuth` faz bypass total** quando o Supabase não está configurado — ok para demo local, mas precisa ficar explícito.

**🟡 Polimento (o que faz parecer "produto")**
10. UI não permite **excluir produto**, nem **listar/remover alertas**.
11. Sem **estatísticas** (menor preço, maior preço, variação %, "melhor momento").
12. Sem **skeletons/estados vazios bonitos**, só dark mode, sem responsividade testada.
13. `README.md` fraco para portfólio: sem demo, sem screenshots, sem diagrama, sem stack badges.
14. Mistura de `fetch` direto e `api/client.ts` no front (`handleSearch`, `handleCreateAlert` usam fetch cru).

---

## 2. Visão do produto "10x"

Um **rastreador de preços de verdade**, que um recrutador consegue abrir, usar em 30 segundos e entender o valor:

- Busca um produto → adiciona ao monitoramento → vê **preço atual, histórico e variação**.
- Cria **alerta** ("me avise quando cair abaixo de X") e recebe **email**.
- Dashboard com **cards de estatística** (atual / menor / maior / variação), gráfico interativo e lista de produtos gerenciável.
- **Deploy público** (frontend + backend + banco) com **demo login** pronto para o recrutador testar.
- Repositório com **README impecável**, testes, CI verde e diagrama de arquitetura.

Princípio norteador: **menos features novas, mais confiabilidade e acabamento.** 10x aqui é qualidade, não escopo.

---

## 3. Roadmap por fases

> Ordem recomendada. Cada fase é independente o suficiente para virar 1 commit/PR limpo.

### Fase 0 — Higiene do repositório (rápida, alto impacto) ✅ CONCLUÍDA
**Meta:** repositório limpo e seguro antes de qualquer coisa.

- [x] Remover CSVs de dados do git e adicionar `backend/data/` ao `.gitignore` (mantido `.gitkeep`).
- [x] Confirmar que nenhum `.env` real está versionado (só `.env.example`) — confirmado ok.
- [ ] **Rotacionar a `SUPABASE_SERVICE_ROLE_KEY`** no painel do Supabase se ela já circulou fora do `.env` local (⚠️ ação manual do Bernardo antes de tornar o repo público).
- [x] Padronizar `README.md` raiz com passos reais de setup (variáveis, `npm i`, `npm run dev`). Também completado o `backend/.env.example` (FRONTEND_URL + SMTP). _(READMEs de subpasta ficam para a Fase 8.)_
- [x] Adicionar `LICENSE` (MIT).
- [x] Criar `.nvmrc` + campo `engines` (`node >=20`) fixando a versão do Node.
- [x] _Extra:_ removido `package-lock.json` órfão da raiz.

**DoD:** ✅ `git status` limpo, repo sem dados de scraping, README explica como rodar do zero.

---

### Fase 1 — Estabilizar a base de dados (fonte única de verdade) ✅ CONCLUÍDA
**Meta:** Supabase como única persistência; remover CSV do fluxo de produção.

- [x] Isolar a escrita/leitura em CSV de `priceService.ts` atrás de `csvEnabled()` → só roda quando o Supabase não está configurado ou com `USE_CSV_FALLBACK=true`. Desligado por padrão em produção.
- [x] `getPriceHistory` e `trackAndStorePrice` operam via Supabase como fonte de verdade; CSV vira apenas fallback dev/offline.
- [x] `schema.sql` revisado — é idempotente (`if not exists` / `drop policy if exists`); ordem documentada no README (migration_drop → schema).
- [x] Índices e RLS revisados — já cobrem os acessos por usuário; nada faltando.
- [x] Criado **seed script** (`backend/scripts/seed.ts` + `npm run seed`): cria usuário demo, 3 produtos e ~30 dias de histórico com tendência de queda.

**DoD:** ✅ Com Supabase configurado, todo o histórico é lido/gravado no banco; CSV não roda. Verificação **rodando** pendente (faremos junto com a demo visual).

---

### Fase 2 — Refatorar o scraping para fora da request ✅ CONCLUÍDA
**Meta:** scraping confiável, testável e que não trava a API.

- [x] Extrair seletores/parsing para **funções puras testáveis** (`parseListingPrice`, `parseDetailPrice`, `parseSearchResults`) que recebem HTML como string. Verificadas com smoke test (preço 4.299/90 → 4299.9, desconto, resultados de busca).
- [x] Adicionar **timeout (10s)**, **retry com backoff exponencial** e **User-Agent rotativo** num novo `httpClient.ts` (`fetchHtml`).
- [x] `POST /api/track` mantido síncrono mas com **timeouts limitados** + **respostas estruturadas** (404 "sem preço", 502 "falha externa temporária"). _(Abordagem simples escolhida: timeout + mensagem amigável.)_
- [x] Scraping centralizado no **cron** + endpoint manual `POST /track`; não há scraping em page load.
- [x] **Rate-limit** entre produtos no job diário (delay de 2s, dependency-free).
- [x] Caso "produto sem preço" tratado com erro estruturado (`ScrapeError("PRICE_NOT_FOUND")` → 404).

**DoD:** ✅ Parser verificado por smoke test; cron com rate-limit. _(Testes formais com fixtures em `backend/test/fixtures/` entram na Fase 4.)_

---

### Fase 3 — Qualidade de código (validação, tipos, DX) ✅ CONCLUÍDA
**Meta:** código que passa numa code review de vaga sênior.

- [x] **Zod** no backend: `/products`, `/track/:productId`, `/prices/:productId`, `/alerts` e `/search` validados por um middleware reutilizável (`validate()` + schemas em `schemas/requestSchemas.ts`).
- [~] Tipos compartilhados: **decisão deliberada** de manter `TrackedProduct`/`PriceHistoryItem` por-projeto (são 2 interfaces pequenas e alinhadas). Um pacote `shared/` complicaria os deploys separados (Vercel/Render) sem ganho real agora. Revisitar só se a duplicação crescer.
- [x] Respostas de erro padronizadas (`{ error: { code, message, details? } }` via `sendError`) + **error handler central** (`errorHandler`) + `asyncHandler` para propagar erros sem try/catch repetido.
- [x] Logger **pino** (`lib/logger.ts`) substituindo **todos** os `console.*` do backend (logs JSON estruturados).
- [x] Front: **todo** `fetch` unificado em `api/client.ts` (`searchProducts`, `createAlert` adicionados; `handleSearch`/`handleCreateAlert` não usam mais `fetch` cru) + parsing de erro no novo formato.
- [~] Hooks (`useProducts`, `usePriceHistory`, `useAlerts`): **adiados para a Fase 6** (rework de UI), onde encaixam melhor — evita refatorar o `App.tsx` duas vezes.
- [x] `type-check` adicionado aos scripts dos dois projetos; `lint` + `tsc --noEmit` limpos.

**DoD:** ✅ `lint` + `type-check` limpos nos dois projetos; toda entrada da API validada. Verificado **rodando**: boot ok, `/health` ok, `/api/search` sem `q` → 400 com erro padronizado + detalhes Zod, logs pino estruturados.

---

### Fase 4 — Testes automatizados ✅ CONCLUÍDA
**Meta:** confiança para mexer sem quebrar; sinal de senioridade no portfólio.

- [x] Backend com **Vitest**: parsers de preço (fixtures em `test/fixtures/`), schemas Zod, e **lógica de alerta** (extraí `decideAlertAction` pura: notify/reset/none + anti-spam).
- [x] Backend integração com **supertest** (`test/api.test.ts`): `/health`, `/api/search` sem `q` → 400, `/api/products` inválido → 400. Exigiu split `app.ts` (app exportável) / `index.ts` (só `listen` + cron).
- [x] Frontend com **Vitest + Testing Library**: `PriceChart` (estado vazio + com dados, gráfico mockado) e `computePriceStats` (extraído do `App.tsx` para `lib/priceStats.ts`).
- [x] Cobertura pragmática dos módulos de lógica: parser, schemas, decisão de alerta, estatísticas e rotas. **29 testes** (22 backend + 7 frontend).

**DoD:** ✅ `npm test` verde nos dois projetos (29 passando); cobre parser, alertas, validação e componente. Scripts `test`/`test:watch` adicionados.

---

### Fase 5 — CI/CD ✅ CONCLUÍDA (deploy automático fica na Fase 7)
**Meta:** cada push roda lint + type-check + testes; deploy automatizado.

- [x] `.github/workflows/ci.yml`: **matrix** backend/frontend → `npm ci`, `lint`, `type-check`, `test`, `build`, com cache de npm. Roda em push/PR na `main`.
- [x] **Badge de CI** (+ badge de licença) no topo do README.
- [x] `dependabot.yml` (npm backend/frontend + github-actions, semanal).
- [x] _Extra:_ sincronizei os `package-lock.json` (estavam faltando deps nativas) e validei o pipeline **localmente com `npm ci`** — verde nos dois projetos, então o CI abre verde no primeiro push.
- [ ] Deploy automático a partir da `main` → configurado na **Fase 7** (junto com os hosts).

**DoD:** ✅ Pipeline completo roda e passa localmente (equivalente ao CI); PRs abrirão com checks verdes.

---

### Fase 6 — UI/UX 10x (a parte que o recrutador vê primeiro)
**Meta:** parecer um SaaS real, não um trabalho de faculdade.

- [x] **Corrigir o bug do destaque**: preço **atual** como herói; média/menor/maior como cards secundários. _(feito antecipadamente na Fase 0 por ser bug de correção.)_
- [x] Adicionar **cards de estatística**: Menor · Médio · Maior · Variação % (▲/▼ vs. registro anterior) + badge "Menor preço!". _(Data da última coleta já exibida no rodapé do card.)_
- [ ] Tela de **gerenciar produtos**: listar, selecionar, **excluir** produto (endpoint `DELETE /api/products/:id` + RLS já cobre).
- [ ] Tela/lista de **alertas**: ver alertas ativos, editar threshold, **remover** alerta (`GET`/`DELETE /api/alerts`).
- [ ] **Estados vazios e skeletons** bonitos (nada de "Aguardando primeiro rastreamento..." solto).
- [ ] **Responsividade** real (mobile → desktop) e **toggle dark/light** (opcional, mas impressiona).
- [ ] Toasts para sucesso/erro no lugar de `<p className="error">` espalhados.
- [ ] Acessibilidade básica: labels, foco, contraste, `aria-*` nos controles.
- [ ] Usar a skill **ui-ux-pro-max** para revisar layout, paleta e tipografia (dashboard/SaaS).
- [ ] Favicon, título e meta tags decentes (`index.html`).

**DoD:** abrir no celular e no desktop, criar produto, ver stats e gráfico, gerenciar alertas — tudo fluido e sem número enganoso.

---

### Fase 7 — Deploy público (o marco final)
**Meta:** link clicável funcionando, com dados de demo.

- [ ] **Banco**: Supabase (já é hospedado) — projeto de produção separado do de dev.
- [ ] **Backend**: deploy no **Render** ou **Railway** (Express + cron). Configurar env vars (Supabase, SMTP, `FRONTEND_URL`).
- [ ] **Frontend**: deploy no **Vercel** ou **Netlify**; setar `VITE_API_BASE_URL` e `VITE_SUPABASE_*`.
- [ ] Ajustar **CORS** para aceitar o domínio do frontend em produção (hoje é origem única via env — validar).
- [ ] Configurar **SMTP real** para os emails de alerta (ex: Resend/Brevo/Gmail app password) e testar ponta a ponta.
- [ ] Criar **usuário de demo** (`demo@...`) com produtos e histórico via seed, e deixar as credenciais no README.
- [ ] Adicionar **healthcheck** e **uptime** (o `/health` já existe — usar num monitor grátis tipo UptimeRobot).
- [ ] `Dockerfile` para o backend (opcional, mas fica bom no portfólio) + `docker-compose` para rodar local.

**DoD:** URL pública abre, login demo funciona, criar alerta dispara email real, gráfico mostra histórico seedado.

---

### Fase 8 — Apresentação e portfólio (o que converte no LinkedIn)
**Meta:** transformar o repo num case que vende.

- [ ] **README raiz de alto nível**: título, 1 frase de pitch, **GIF/screenshots**, link da demo, badges (CI, licença, stack), seção "Arquitetura" com **diagrama** (Mermaid), "Como rodar", "Decisões técnicas", "Próximos passos".
- [ ] Diagrama de arquitetura em **Mermaid** (Frontend → API → Scraper → Supabase → Email/Cron).
- [ ] **GIF de demonstração** do fluxo (buscar → rastrear → alerta) — usar a skill de gravação do navegador.
- [ ] Seção **"O que eu aprendi / trade-offs"** — recrutadores amam isso.
- [ ] Post de LinkedIn: problema → solução → stack → link da demo → aprendizado.
- [ ] Adicionar tópicos/tags no GitHub (`price-tracking`, `react`, `typescript`, `supabase`, `web-scraping`).

**DoD:** um estranho entende o projeto em 30s pelo README e consegue testar a demo sem te perguntar nada.

---

## 4. Decisões de stack (mantém o que já é bom)

| Camada | Hoje | Manter / Mudar |
|---|---|---|
| Frontend | React + Vite + TS + Chart.js | **Manter.** Adicionar hooks + toasts. |
| Backend | Express + TS | **Manter.** Adicionar Zod + pino + error handler. |
| Scraping | Axios + Cheerio | **Manter**, mas endurecer (retry/timeout) e tirar da request. |
| DB/Auth | Supabase (Postgres + RLS) | **Manter** como fonte única (remover CSV). |
| Email | Nodemailer | **Manter**, configurar SMTP real no deploy. |
| Testes | — | **Adicionar** Vitest + Testing Library + supertest. |
| CI/CD | — | **Adicionar** GitHub Actions. |
| Deploy | — | Vercel (front) + Render/Railway (back) + Supabase (db). |

---

## 5. Ordem sugerida de execução (checklist macro)

- [x] Fase 0 — Higiene do repo
- [x] Fase 1 — Fonte única de verdade (Supabase, tira CSV)
- [x] Fase 2 — Scraping robusto e fora da request
- [x] Fase 3 — Validação, tipos, logger, cliente HTTP unificado
- [x] Fase 4 — Testes
- [x] Fase 5 — CI
- [ ] Fase 6 — UI/UX 10x (corrigir bug do preço + stats + gestão)
- [ ] Fase 7 — Deploy público + email real + demo
- [ ] Fase 8 — README, diagrama, GIF, post

---

## 6. Como saberemos que ficou "10x" (critérios de sucesso)

- ✅ Existe uma **URL pública** que qualquer recrutador abre e testa com login demo.
- ✅ O **preço em destaque é o correto** (bug atual corrigido) e há cards de estatística.
- ✅ **Dados persistem** após deploy (Supabase, sem CSV efêmero).
- ✅ **CI verde** em cada PR (lint + type-check + testes).
- ✅ **README** com demo, screenshots/GIF, diagrama e decisões técnicas.
- ✅ Um **alerta real** dispara um **email real**.
- ✅ Nada de segredos no git; repositório limpo e profissional.

---

## 7. Registro de execução (o que foi feito e por quê)

> Resumo cronológico das fases já concluídas — serve de "diário de bordo" do projeto
> e ajuda a contar a história das decisões no README/LinkedIn.

### ✅ Fase 0 — Higiene do repositório
- **Removi 11 CSVs de dados** do versionamento e os ignorei (`backend/data/*.csv`). _Por quê:_ eram dados de scraping que poluíam o repo e não devem ser versionados.
- **Removi o `package-lock.json` órfão** da raiz (não havia `package.json` correspondente).
- **Reescrevi o `.gitignore`** (env, dist, logs, arquivos de OS) e **criei `LICENSE` (MIT) + `.nvmrc`** e `engines: node >=20`. _Por quê:_ deixar claro como rodar e proteger segredos.
- **Reescrevi o `README`** com passos reais de setup e completei o `.env.example`. _Por quê:_ qualquer pessoa consegue subir o projeto do zero.

### ✅ Correção de bug — destaque de preço (item da Fase 6, adiantado)
- O número em destaque mostrava a **média** (rotulada de forma confusa). Agora o **preço atual é o herói** e a média/menor/maior/variação viraram **cards de estatística**, com badge "Menor preço!". _Por quê:_ era um erro de correção que confundia o usuário — inaceitável num rastreador de preços.

### ✅ Fase 1 — Supabase como fonte única de verdade
- O **Supabase virou a fonte primária** de leitura/escrita de preços; o **CSV ficou isolado** atrás de `csvEnabled()` (só roda sem Supabase ou com `USE_CSV_FALLBACK=true`). _Por quê:_ o filesystem de deploy é efêmero — dados em CSV se perderiam em produção.
- Criei o **`scripts/seed.ts` (`npm run seed`)**: usuário demo + 3 produtos + ~30 dias de histórico com tendência de queda. _Por quê:_ a demo pública precisa abrir já com dados bonitos.

### ✅ Fase 2 — Scraping robusto e fora da request
- Criei o **`httpClient.ts`** com **timeout, retry com backoff e User-Agent rotativo**, e um erro estruturado **`ScrapeError`**. _Por quê:_ scraping é frágil; precisa resistir a falhas e não travar a API.
- Quebrei o scraper em **parsers puros e testáveis** (`parseListingPrice`, `parseDetailPrice`, `parseSearchResults`). _Por quê:_ testar parsing sem depender da rede.
- Adicionei **rate-limit no cron** (2s entre produtos) e mapeei os erros de scraping para **404/502** nas rotas. _Por quê:_ não ser bloqueado e dar mensagens claras ao front.

### ✅ Fase 3 — Qualidade de código
- **Validação com Zod** em todas as rotas via middleware `validate()`. _Por quê:_ nunca confiar na entrada do cliente.
- **Erros padronizados** `{ error: { code, message } }` + **error handler central** + `asyncHandler`. _Por quê:_ respostas consistentes e rotas limpas sem try/catch repetido.
- **Logger pino** no lugar de todos os `console.*`. _Por quê:_ logs estruturados, prontos para produção.
- **Todo `fetch` do front unificado** em `api/client.ts`. _Por quê:_ uma única camada de acesso à API, fácil de manter.

### ✅ Fase 4 — Testes automatizados
- **Vitest** nos dois projetos, com **29 testes** verdes. _Por quê:_ confiança para evoluir sem quebrar e sinal de maturidade no portfólio.
- Extraí duas funções puras para testar a lógica com facilidade: **`decideAlertAction`** (regra de alerta/anti-spam no backend) e **`computePriceStats`** (estatísticas de preço no frontend). _Por quê:_ lógica pura é trivial de testar e deixa o código mais limpo.
- Testes de **parser** (com fixtures de HTML), **schemas Zod**, **integração de rotas** (supertest) e **componente** (`PriceChart`). Separei `app.ts`/`index.ts` para deixar o app testável. _Por quê:_ cobrir as partes que mais quebram.

### ✅ Fase 5 — CI/CD
- **GitHub Actions** (`.github/workflows/ci.yml`) com matrix backend/frontend rodando `npm ci` + lint + type-check + test + build a cada push/PR. _Por quê:_ garante que nada quebra ao evoluir e mostra disciplina de engenharia no portfólio.
- **Badges** de CI e licença no README + **Dependabot** semanal. _Por quê:_ profissionalismo e dependências atualizadas.
- Validei o pipeline localmente com `npm ci` (corrigindo os lockfiles) para o CI já abrir verde. _Por quê:_ um CI vermelho no primeiro push passa má impressão.

---

### Notas de escopo
Não vamos inflar o produto com marketplaces novos, mobile app ou ML de previsão de preço agora — isso entra em **"Próximos passos"** no README (mostra visão sem gastar tempo). O foco do 10x é **confiabilidade + acabamento + apresentação**, que é exatamente o que faz um projeto de portfólio se destacar.
