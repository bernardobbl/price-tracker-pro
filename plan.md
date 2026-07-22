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

### Fase 4 — Testes automatizados
**Meta:** confiança para mexer sem quebrar; sinal de senioridade no portfólio.

- [ ] Backend: **Vitest** (ou Jest). Testar parser de preço, services (com Supabase mockado), lógica de alerta (threshold, anti-spam).
- [ ] Backend: teste de integração dos endpoints com **supertest** (auth mockada).
- [ ] Frontend: **Vitest + Testing Library** para componentes-chave (`PriceChart`, formulários, estados de erro/loading).
- [ ] Meta de cobertura pragmática: **~60–70%** nos módulos de lógica (não perseguir 100%).

**DoD:** `npm test` verde nos dois projetos; testes cobrem parser, alertas e ao menos 2 telas.

---

### Fase 5 — CI/CD
**Meta:** cada push roda lint + type-check + testes; deploy automatizado.

- [ ] Criar `.github/workflows/ci.yml`: matrix backend/frontend → `install`, `lint`, `type-check`, `test`, `build`.
- [ ] Badge de status do CI no README.
- [ ] (Opcional) `dependabot.yml` para atualizar dependências.
- [ ] Configurar deploy automático a partir da branch `main` (ver Fase 7).

**DoD:** PR abre com checks verdes; merge em `main` dispara build/deploy.

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
- [ ] Fase 4 — Testes
- [ ] Fase 5 — CI
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

### Notas de escopo
Não vamos inflar o produto com marketplaces novos, mobile app ou ML de previsão de preço agora — isso entra em **"Próximos passos"** no README (mostra visão sem gastar tempo). O foco do 10x é **confiabilidade + acabamento + apresentação**, que é exatamente o que faz um projeto de portfólio se destacar.
