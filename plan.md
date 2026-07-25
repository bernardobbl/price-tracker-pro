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

> ⚠️ **Esta lista é a baseline ORIGINAL (pré-Fases 0–6.6) — mantida como registro histórico.**
> A maioria já foi resolvida e alguns itens estão **desatualizados** (ex.: citam "Mercado Livre", que migramos
> para Books to Scrape na Seção 6.5). A reconciliação item-a-item e o que realmente resta estão na
> **Fase 6.7 — Reconciliação e dívidas remanescentes** (logo antes da Fase 7). Não trate os itens abaixo como
> pendências ativas sem antes conferir a Fase 6.7.

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

**DoD:** ✅ **CI verde no GitHub** (run em `ca1e4b8`, jobs `backend -> success` e `frontend -> success`).

> ⚠️ **Fix (levou 2 tentativas — registro honesto):**
> - **Sintoma:** `npm ci` no CI não instalava as dependências opcionais nativas
>   (`@rollup/rollup-linux-x64-gnu`, `@rolldown/binding-linux-x64-gnu`), e `vite`/`vitest`
>   quebravam em runtime (bug npm [#4828](https://github.com/npm/cli/issues/4828)).
> - **1ª tentativa (errada):** achei que era mismatch de npm 10/11 e regenerei os lockfiles no Docker —
>   mas o Docker no Mac (Apple Silicon) roda **linux/arm64** por padrão, então gerei os binários **ARM**,
>   não os **x64** que o runner do GitHub usa. Pior: só validei o *exit code* do `npm ci` (que é 0 mesmo
>   sem instalar a opcional), sem rodar build/test no Linux. Falha continuou.
> - **Causa raiz real:** **arquitetura errada** (arm64 vs x64) nos binários do lockfile.
> - **Fix definitivo:** regenerei os dois lockfiles num container **`--platform linux/amd64`** `node:20`,
>   com árvore limpa, e validei **`npm ci` + build + test** no Linux x64 (Docker) **e** no macOS arm64.
>   Os lockfiles agora carregam os binários de ambas as plataformas.
> - **Aprendizado:** valide o pipeline **inteiro** (não só `npm ci`) e na **mesma arquitetura** do CI.

---

### Fase 6 — UI/UX 10x (a parte que o recrutador vê primeiro)
**Meta:** parecer um SaaS real, não um trabalho de faculdade.

- [x] **Corrigir o bug do destaque**: preço **atual** como herói; média/menor/maior como cards secundários. _(feito antecipadamente na Fase 0 por ser bug de correção.)_
- [x] Adicionar **cards de estatística**: Menor · Médio · Maior · Variação % (▲/▼ vs. registro anterior) + badge "Menor preço!". _(Data da última coleta já exibida no rodapé do card.)_
- [x] **Gerenciar produtos**: botão **excluir produto** (`DELETE /api/products/:id` + cascade no banco; seleção troca para o próximo produto automaticamente).
- [x] **Lista de alertas ativos**: ver + **remover** (`GET`/`DELETE /api/alerts/:id`). Editar threshold = re-salvar pelo formulário (upsert). Hook `useAlerts` (adiado da Fase 3) criado.
- [x] **Skeletons** (resumo e gráfico) durante o loading + estado vazio.
- [x] **Responsividade**: grid single-column no mobile, stat-grid 2 colunas, header com wrap, toasts com largura limitada.
- [x] **Toasts** de sucesso/erro (criar/excluir produto, salvar/excluir alerta) via `useToasts` + `ToastContainer`.
- [~] Acessibilidade **básica**: `aria-label` nos botões de ícone, `role="status"`/`aria-live` nos toasts, labels nos inputs. (Auditoria completa fica para depois.)
- [ ] Skill **ui-ux-pro-max** para revisar paleta/tipografia — **opcional, não feito** (o design atual já está coeso).
- [x] **Favicon** (SVG inline), `title` descritivo e `meta description`/`theme-color` no `index.html`.
- [~] **Toggle dark/light**: **não feito** — o dark theme atual já está bom; adiar (baixo ROI agora).

**DoD:** ✅ criar/excluir produto, ver stats e gráfico, gerenciar alertas, feedback por toast, skeletons e layout responsivo. Verificação **visual rodando** pendente (fazer com o Supabase real).

---

### Fase 6.5 — Redesign de inteligência de preço e busca (upgrade visual dinâmico)
**Meta:** o gráfico deixa de ser "uma linha" e vira uma **ferramenta de decisão** (comprar ou esperar);
a busca deixa de ser lista de links e vira **resultado vivo**. Referências: Keepa (faixa min/max),
CamelCamelCamel (filtros de período + simplicidade), Pricefy (busca em dashboard).

> Princípio: os melhores trackers não vendem um gráfico, vendem uma **decisão**. Essa é a camada que falta.
> Ordem dentro da fase: **maior impacto / menor esforço primeiro** (Frente A → B → C).

**Frente A — Painel de inteligência de preço (o gráfico vira decisão)**
- [x] **A1 · Deal score / sinal de compra**: card "Compre já / Espere" com score 0–100 derivado de
  `computePriceStats` (posição do preço atual entre mínimo e média). Dado já existe — é regra simples, sem ML.
  _(feito: `lib/dealSignal.ts` pura + testada; card renderizado no `App.tsx`.)_
- [x] **A2 · Barra de posição min↔max**: barra horizontal mostrando onde o preço atual cai entre o menor
  e o maior histórico. Comunica "é uma boa?" sem ler o gráfico. _(feito: barra com marcador + rótulos.)_
- [x] **A3 · Gráfico repaginado** (`PriceChart.tsx`): área com **gradiente**, **linha tracejada da média**
  e **tooltip rico** (data + preço/média). Mesma lib (Chart.js), muito mais vivo. _(faixa min/max sombreada
  fica opcional pra depois — a linha da média já dá o contexto principal.)_
- [x] **A4 · Filtros de período**: 30d / 90d / 6m / tudo (padrão CamelCamelCamel). _(feito: `filterByPeriod`
  puro + testado, ancorado na data mais recente; controle segmentado recorta gráfico E estatísticas.)_
- [x] **A5 · Tendência leve**: rótulo "↘ Caindo / ↗ Subindo / → Estável" via **média móvel** simples (sem ML).
  _(feito: `computeTrend` em `lib/priceInsights.ts`, testado.)_
- [x] **A6 · Cards secundários repaginados**: Menor · Média · Maior · Variação + **Tendência** + **Volatilidade**
  (`computeVolatility`: Baixa/Média/Alta pela amplitude relativa). _(feito: stat-grid com 6 cards.)_

**Frente B — Busca viva (unir buscar + rastrear)**
- [x] **B1 · Resultado rico**: cada item da busca mostra o **preço atual** direto na linha. _(feito: backend
  `searchBooks` agora devolve `price`/`currency`; front exibe por item.)_
- [~] **B2 · Mini-sparkline por item**: **adiado deliberadamente** — itens da busca ainda **não são rastreados**,
  logo não têm histórico pra desenhar. Sparkline faz sentido nos **cards de produto rastreado** (fica pra um
  próximo passo, quando o histórico de cada produto for carregado na sidebar). Por ora o item mostra preço + status.
- [x] **B3 · Botão "Rastrear" inline**: adiciona ao monitoramento sem sair da busca (`handleTrackFromSearch`:
  cria produto + dispara scraping + seleciona). Mostra "✓ Rastreando" se já existe. _(maior ganho de UX.)_
- [x] **B4 · Busca instantânea** com debounce (~350ms) via `useEffect`, com spinner. Submit manual removido.
- [x] **B5 · Skeletons e estado vazio** na busca (linhas skeleton durante o loading + mensagem "nenhum encontrado").

**Frente C — Design geral mais robusto e dinâmico**
- [x] **C1 · Layout dashboard**: `App` reestruturado em **sidebar** (busca + produtos + alertas, sticky) +
  **painel de detalhe** (preço/sinal/barra/período/stats/gráfico/alerta), no lugar da coluna única.
- [x] **C2 · Cards de produto** clicáveis (nome + id + excluir inline, ativo destacado) substituindo o `<select>`.
  _(thumbnail não se aplica ao Books to Scrape sem imagem; usei destaque + estado ativo.)_
- [x] **C3 · Micro-animações**: **count-up** no preço (`useCountUp`, respeita `prefers-reduced-motion`),
  fade-in do card de detalhe, transições em cards/hover.
- [x] **C4 · Tokens de design** (`:root` com cor/raio) aplicados aos componentes novos. _(migração incremental:
  o CSS legado segue funcionando; novos blocos usam os tokens.)_

**DoD:** o card de detalhe mostra um **sinal de compra** claro e um gráfico com contexto (média + faixa);
a busca permite **rastrear em 1 clique** com preço e sparkline por item; o layout parece um SaaS, não uma
coluna de cards. Cada item vira 1 commit pequeno. Verificação: rodar o app com Supabase real e conferir visual.

---

### Fase 6.6 — Refino visual e identidade (tema claro editorial, estilo Camel)
**Meta:** tirar a "cara de IA" e dar **identidade de marca**. Direção escolhida: **claro e editorial**
(inspirado no CamelCamelCamel) — fundo papel quente, cor de marca **terracota**, tipografia **serifada**
no wordmark/preço/títulos, ícones de verdade, números tabulares. Zero gradiente no texto, zero glassmorphism.

> **Diagnóstico "cara de IA" (o que estamos matando):** título com gradiente azul→verde; fundo navy em
> gradiente radial; `backdrop-filter: blur` (glassmorphism); sombras pesadas (`0 18px 45px`); emojis como
> ícones; tudo arredondado/suave; fonte `system-ui`; acento azul+verde "startup". São padrões de template.
>
> **Referências analisadas:** Camel (identidade quente + mascote → parece marca), Keepa (densidade de dados
> + números tabulares → parece ferramenta séria). Lição comum: fundo claro, cor contida, dados tabulares,
> função acima de decoração.

**Paleta e tipografia (fonte da verdade):**
- Papel `#F4F3EE` · superfície `#FFFFFF` · tinta `#20222E` · muted `#6E7180` · hairline `#E4E2DA`.
- **Marca índigo `#3B4A8C`** (profundo `#2C3A73`, suave `#EEF0F8`) · secundário dourado suave `#B08A4B`.
- Sinal: bom `#3E7B57` (soft `#E7F0E9`) · médio `#B7822B` · caro `#B0432E`.
- Fontes: **Fraunces** (serif de display: wordmark, títulos de seção, preço-herói) + **Inter** (UI); `tabular-nums` nos números.
- _Nota:_ a fundação foi construída em terracota (estilo Camel) e depois a **paleta de marca migrou para índigo**
  a pedido — o acento frio separa melhor a marca dos sinais verde (boa compra) / vermelho (espere). Só os
  tokens de cor e as cores do gráfico mudaram; layout, tipografia e lógica ficaram iguais.

**Frente D — Fundação visual (o que mais transforma)**
- [x] **D1 · Tokens da paleta clara**: `:root`, `body` e header reescritos — saiu o navy/gradiente, entrou papel quente + tinta.
- [x] **D2 · Tipografia real**: Fraunces + Inter importados no `index.html`; serif no wordmark/preço/sinal, `tabular-nums` nos números.
- [x] **D3 · Ícones de verdade**: `components/Icon.tsx` (SVGs inline estilo Lucide). **Sem nova dependência.** Todos os emojis trocados.
- [x] **D4 · Matar os sinais de IA**: fora o gradiente do título, o `backdrop-filter`/blur e as sombras pesadas → hairlines + sombras sutis; raios menores.

**Frente E — Aplicar a identidade por componente**
- [x] **E1 · Header/wordmark** editorial: brand mark terracota + wordmark na serif.
- [x] **E2 · Sidebar**: busca, cards de produto e alertas na nova paleta.
- [x] **E3 · Painel de detalhe**: preço-herói na serif, sinal, barra, stats e período repaginados.
- [x] **E4 · Gráfico Chart.js** recolorido (linha tinta, área terracota, média camelo tracejada, grid/tooltip claros).
- [x] **E5 · Login/auth** na nova identidade (card claro, tabs, serif no logo).
- [x] **E6 · Toasts, skeletons e estados vazios** coerentes com o tema claro.

**Frente F — Detalhes que elevam**
- [~] **F1 · Acessibilidade de cor**: usei tinta escura sobre claro e tons "deep" para texto colorido (bom contraste);
  **auditoria AA formal pendente** — revisar com ferramenta antes do deploy.
- [x] **F2 · Ritmo e alinhamento**: stat-grid mais denso (6 colunas), hairlines e espaçamento consistentes (lição do Keepa).
- [x] **F3 · Microinterações sóbrias**: count-up mantido; fade-in do detalhe; transições curtas e uniformes.
- [x] **F4 · Responsivo** revisado (stat-grid colapsa 6→3→2; sidebar deixa de ser sticky no mobile).

**DoD:** ✅ abrir o app **não parece mais template de IA** — identidade clara e quente, serif com personalidade,
ícones reais, gráfico legível no claro. `lint`/`type-check`/`build` limpos e **45 testes** verdes.

---

### Fase 6.7 — Reconciliação e dívidas remanescentes (fazer na próxima sessão)
**Meta:** reconciliar a baseline "Problemas e riscos" (Seção 1) com o estado real após as Fases 0–6.6,
fechar as poucas pendências técnicas de verdade e tirar as menções obsoletas. **Sem pressa** — é higiene
e robustez antes do deploy.

**Passo 1 — Reconciliar a Seção 1 item-a-item (doc)** ✅ verificado no código
Status real de cada um dos 14 itens originais (confirmado, não só esperado):

- [x] **#1 destaque de preço** → resolvido (Fase 0/6): preço atual é o herói. ✅
- [x] **#2 persistência dupla CSV+Supabase** → resolvido (Fase 1): CSV atrás de fallback. ✅
- [x] **#3 scraping na request** → endurecido (Fase 2), **fonte migrada p/ Books to Scrape** (6.5); menção a
  "Mercado Livre" já removida do código. Decisão de manter síncrono registrada no Passo 3. ✅
- [x] **#4 N+1 nos alertas** → **era dívida real** (confirmado: duplicação + `getUserById` no loop). **Resolvido**
  no Passo 2 (trilha única + cache). ✅
- [x] **#5 validação Zod** → resolvido (Fase 3). ✅
- [x] **#6 tipos duplicados** → decisão deliberada de manter (Fase 3). ✅
- [x] **#7 testes/CI/Docker/deploy** → testes+CI feitos; deploy é a Fase 7. ✅ (Docker não é necessário → não fazer.)
- [x] **#8 CSVs commitados** → resolvido (Fase 0); `git ls-files 'backend/data/*.csv'` = vazio. ✅
- [x] **#9 `requireAuth` bypass** → **era dívida real** (bypass total sem Supabase). **Resolvido** no Passo 2
  (fail-closed em produção). ✅
- [x] **#10 gestão de produto/alertas na UI** → resolvido (Fase 6). ✅
- [x] **#11 estatísticas** → resolvido (Fase 6/6.5). ✅
- [x] **#12 skeletons/estados/responsivo/tema** → resolvido (6/6.6); agora é **tema claro editorial**. ✅
- [ ] **#13 README fraco** → segue aberto → é a **Fase 8** (único item da Seção 1 ainda em aberto).
- [x] **#14 fetch cru no front** → resolvido (Fase 3). ✅

**Passo 2 — Fechar as pendências técnicas reais** ✅
- [x] **N+1/duplicação nos alertas (#4)**: unificada a trilha de notificação (`sendAlertEmailAndMark`) usada
  pela avaliação imediata e pela pós-scraping; `getUserById` agora passa por **cache de email por usuário**
  (`getUserEmail`), eliminando o N+1. Coberto por teste (`test/alertNotify.test.ts`, mock do Supabase).
- [x] **`requireAuth` explícito (#9)**: bypass só ocorre **fora de produção** e com `logger.warn`; em produção
  (`NODE_ENV=production`) sem Supabase **falha fechado** (503 `AUTH_UNAVAILABLE`). Erros do middleware
  padronizados via `sendError`.
- [x] **Auditoria de contraste AA (F1)**: calculei os ratios WCAG de todos os pares do tema. Ajustei
  `--muted` (#6e7180→#5c5f70) e `--faint` (#a2a4b0→#686b7e) para passarem AA sobre o papel (5.68 / 4.73).
  Verificado que chips de sinal já usam variantes `-deep` (passam) e que `--camel`/`--warn` só aparecem em
  gráfico/fundo (não-texto, 3:1 ok).
- [x] **Caça a menções obsoletas**: grep confirmou **zero** "Mercado Livre" no código/UI; nos READMEs só resta
  no **registro histórico da migração** (correto manter).

**Passo 3 — (avaliado) tirar o scraping da request (#3)** ✅ decisão registrada
- [x] **Decisão: manter `POST /api/track` síncrono.** Para a escala atual (poucos produtos, `fetchHtml` já tem
  timeout + retry, e a fonte Books to Scrape é rápida e estável) o custo de fila/worker em background não se
  justifica. O job pesado (vários produtos) já roda **fora da request** no cron. Revisitar só se houver muitos
  produtos por usuário ou a fonte ficar lenta.

**DoD:** Seção 1 reconciliada e honesta (sem "Mercado Livre" solto), #4 e #9 fechados com teste, contraste AA
auditado, e `lint`/`type-check`/`test`/`build` verdes. Aí sim seguir limpo para a Fase 7 (deploy).

---

### Fase 6.8 — Virada de domínio (a mais importante): preços reais de combustível (ANP)
**Meta:** trocar a fonte-sandbox (Books to Scrape, preços que nunca mudam → histórico simulado) por
**dados reais e públicos da ANP**, consertando a premissa do produto e elevando MUITO o realismo de
scraping/engenharia de dados. Fonte: [Série Histórica de Preços de Combustíveis — ANP / dados abertos](https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/serie-historica-de-precos-de-combustiveis).

> **Por que essa é a virada:** hoje o app rastreia variação de preço num site cujo preço não varia — o núcleo
> (histórico, tendência, sinal de compra, alerta) opera sobre dados fabricados pelo seed. Com a ANP, os preços
> **mudam de verdade** (levantamento semanal, por município/produto/bandeira), é **legal e sem anti-bot** (dado
> aberto), e o trabalho vira **ETL de verdade** (parsing de CSV grande, normalização, dedup) — que vale mais
> no portfólio do que raspar HTML estático. A arquitetura atual é **reaproveitada quase inteira**: rastrear
> entidade → valor periódico → histórico → stats/sinal/tendência → alerta por threshold.

**Frente G — Fonte de dados e ETL (o coração)**
- [x] **G1 · Mapear o dataset**: confirmado formato SHPC (separador `;`, encoding latin-1, decimal com vírgula,
  data dd/mm/aaaa, 16 colunas: Região/Estado/Município/Revenda/CNPJ/Produto/Data da Coleta/Valor de Venda/
  Valor de Compra/Unidade/Bandeira). _Feito por pesquisa; layout exato reconfirmado quando o ingestor rodar._
- [x] **G2 · Ingestor/ETL** (`backend/src/ingest/anp*.ts`):
  - [x] **Parser puro** `anpParser.ts` (`parseAnpCsv` dirigido pelo cabeçalho + `parseMoneyBR`/`parseDateBR`),
    tolerante a acentos/reordenação, descartando linhas ruins. **10 testes** com fixture (`anpSample.csv`).
  - [x] **Download** (`fetchLatin1`/`fetchBuffer` no `httpClient` — arraybuffer decodificado Latin-1),
    **normalização** (`anpNormalize.ts`: `canonicalProduct` mapeia variações históricas, CNPJ só-dígitos,
    trim/upper de UF/município/bandeira, descarte de preço fora da faixa com contagem de motivos),
    **dedup** (chave natural cnpj|produto|data, última vence) e **persistência idempotente** no Supabase
    (`fuelPriceService.upsertFuelPrices`, upsert em lote com `onConflict`). Orquestrado por
    `anpIngestor.ts` (`ingestAnp`): registra em `ingestion_runs` (H3), **hash sha256 pula arquivo já
    ingerido** (base do H2), roda todo o trabalho fora de request (H5). URL via env `ANP_CSV_URL`.
    **+11 testes** de normalização/dedup; `lint`/`type-check`/`test`/`build` verdes; smoke da pipeline
    parse→normalize→dedup na fixture ok. _(Persistência real no Supabase valida junto do seed/J3, que
    precisa de credenciais.)_
- [x] **G3 · Modelo de dados**: novo schema orientado a combustível. `schema.sql` reescrito com 4 tabelas:
  **`fuel_prices`** (dado público da ANP — SEM user_id, referência compartilhada; leitura `to authenticated`,
  escrita só via service_role; chave natural `(cnpj, product, collected_at)` → upsert idempotente; índices
  de consulta por local+produto+tempo), **`tracked_series`** (favoritos do usuário: produto+UF+município+bandeira
  opcional, RLS, índice único por combinação), **`alerts`** (reescrito para apontar `series_id`, RLS) e
  **`ingestion_runs`** (observabilidade do ETL — H3: arquivo/hash/lidas/inseridas/rejeitadas/duração/status;
  service_role apenas). Migração versionada `migration_002_books_to_fuel.sql` dropa `tracked_products`/`prices`/
  `alerts` do domínio livros; README atualizado com a ordem. _Idempotente; DDL validado por parse Postgres
  (sqlglot) — execução real no Supabase fica junto do ingestor G2b/seed. Colunas espelham `FuelPriceRow` do parser._
- [x] **G4 · Agendamento**: `scheduleWeeklyAnpJob.ts` roda `ingestAnp` **semanalmente** (padrão seg 06:00,
  via env `ANP_CRON`; valida a expressão antes de agendar). O "delta" é resolvido sem diff manual: **hash
  do conteúdo pula** o arquivo se não mudou (H2) + **upsert idempotente** grava só o que é novo/alterado.
  Timeout/retry já vêm do `httpClient`. Opção `ANP_INGEST_ON_BOOT=true` para ingerir no 1º deploy/demo.
  `index.ts` passou a bootar este job **no lugar** do cron diário de livros (que consultava `tracked_products`,
  tabela aposentada) — o arquivo antigo fica no git até a limpeza formal do J4. `type-check`/`lint`/`test`
  (45)/`build` verdes.

**Frente H — Realismo de scraping / engenharia de dados (o que a crítica apontou)** ✅ CONCLUÍDA
- [x] **H1 · robots.txt + legalidade**: verificado o `robots.txt` do `gov.br` — `Disallow` só cobre
  `/economia`, `/ebserh`, `/mre`; o caminho de dados abertos **não** é restrito. Documentado no README
  (seção "Fonte de dados & legalidade"): dado aberto, uso livre com atribuição à ANP, coleta educada.
- [x] **H2 · Requisição condicional / cache**: `fetchConditional` no `httpClient` envia `If-None-Match`/
  `If-Modified-Since` e trata **304 Not Modified** (não rebaixa o corpo). Validadores (`etag`/`last_modified`)
  guardados no `ingestion_runs` e reusados na próxima execução. **2ª linha de defesa**: hash de conteúdo
  (sha256) pula reprocessamento em servidores que ignoram o condicional.
- [x] **H3 · Observabilidade de ingestão**: `ingestion_runs` preenchida a cada execução (fonte, arquivo, hash,
  etag/last-modified, lidas/inseridas/rejeitadas, duração, status running/success/skipped/error) + logs pino
  estruturados em cada etapa. _(Feito no G2b; UI de status fica para depois, opcional.)_
- [x] **H4 · Qualidade de dado**: normalização (produto canônico, CNPJ só-dígitos, faixa de preço) com
  contagem de rejeições por motivo **+ gate Zod final** (`anpRowSchema.ts`, `filterValidRows`) antes do
  upsert; barrados somam ao `rows_rejected`. **+6 testes**.
- [x] **H5 · Trabalho pesado fora da request**: ingestão só no cron/job (`scheduleWeeklyAnpJob` + `ingestAnp`),
  nunca numa request HTTP — resolve de vez o item #3 da Seção 1. _(Feito no G2b/G4.)_

**Validação da Frente H:** `type-check`/`lint`/`build` limpos, **51 testes** verdes, `schema.sql` re-parseado
(38 statements, colunas `etag`/`last_modified` + `alter ... add column if not exists` idempotentes).

**Frente I — Produto sobre dados reais**
- [x] **I1 · Busca por combustível + local**: **backend + UI prontos**. Backend: agregação pura testável
  (`lib/fuelAggregate.ts`), `fuelQueryService.ts` e rotas `GET /api/fuel/{products,locations,series,snapshot}` com Zod.
  **Front (feito):** sidebar "Consultar preço" com seletores encadeados **combustível → UF → município**
  (`fetchFuelProducts`/`fetchStates`/`fetchMunicipalities`) que carregam a série do município no painel de detalhe.
- [x] **I2 · Comparação multi-revenda/bandeira** ("onde está mais barato"): **backend + UI prontos**.
  `summarizeSnapshot` devolve o ranking de postos do levantamento mais recente (asc por preço, dedup por CNPJ),
  exposto em `GET /api/fuel/snapshot`. **Front (feito):** painel "Onde está mais barato" no detalhe, com ranking
  de até 8 postos (bandeira + preço, o mais barato destacado) e a data do levantamento.
- [x] **I3 · Reuso**: sinal, tendência, volatilidade, filtro de período e gráfico **reaproveitados sobre a série real**
  via `lib/seriesToHistory.ts` (mapeia `DailyAggregate` → `PriceHistoryItem`). Zero alteração nas libs de inteligência
  (`priceStats`/`dealSignal`/`priceInsights`) nem no `PriceChart` (só ganhou prop `decimals=3` para combustível).
- [x] **I4 · Alerta real**: **backend + UI prontos**. Backend: `tracked_series` (favoritos) + `alerts` por `series_id`,
  avaliação imediata ao criar e em lote no job semanal (compara o preço médio mais recente do município). Como o preço
  muda de verdade, o alerta **dispara de verdade**. **Front (feito):** botão "Favoritar" no detalhe, lista de favoritos
  na sidebar (abrir/excluir), lista de alertas ativos e formulário de alerta que **favorita-e-alerta em um passo**
  (`ensureFavorite` → `createFuelAlert`). `useAlerts` migrado para os endpoints de fuel.
- [x] **I5 · UI/labels**: de "livros" para "combustível" — `App.tsx` reescrito, `index.html` (título/description/theme),
  estados vazios e placeholders. Nome do produto mantido como **"Price Tracker Pro"** (consistente com repo/README),
  só o subtítulo/contexto virou combustível. `type-check`/`lint`/`build` limpos, **24 testes** front verdes.

**Frente J — Testes e migração limpa**
- [x] **J1 · Testes de ETL**: parser do CSV ✅ (10 testes) + normalizador/dedup ✅ (11 testes: `canonicalProduct`,
  `normalizeFuelRows` com rejeições contadas, `dedupeFuelRows` chave natural). Faltam só as rotas/serviços (J2).
- [x] **J2 · Testes** das novas rotas/serviços: `api.test.ts` (validação Zod das rotas `/api/fuel/*`:
  series/locations/tracked/alerts + 400 padronizado), `schemas.test.ts` reescrito p/ os schemas de fuel
  (série, locations, tracked, alerta com UUID), `alertNotify.test.ts` reescrito p/ `evaluateFuelAlertImmediately`
  (notifica no/abaixo do alvo, ignora sem levantamento, **cache de email 1×** = fix do N+1) e `anpDemoData.test.ts`
  (gerador do seed passa 100% limpo pelo ETL, série semanal, cidades cobertas). **71 testes** backend.
- [x] **J3 · Seed** reescrito para o domínio combustível. O seed antigo estava **quebrado** (referenciava
  `tracked_products`/`prices`, tabelas dropadas na migração 002). Agora: `scripts/lib/anpDemoData.ts` gera uma
  amostra **no layout SHPC da ANP** (6 cidades × 5 postos × produtos × 16 semanas, RNG determinístico) e o
  `scripts/seed.ts` a ingere pelo **pipeline ETL real** (`parseAnpCsv → normalizeFuelRows → dedupeFuelRows →
  filterValidRows → upsertFuelPrices`), cria usuário demo + 1 favorito + 1 alerta e registra em `ingestion_runs`.
  Verificado com o ETL real: **1728 linhas, 0 rejeitadas/dedup/barradas**; série de Gasolina/SP com **16 pontos
  semanais** e tendência de queda realista. _Honestidade:_ os **preços** são gerados em níveis de mercado (não é
  cópia do arquivo oficial de 100+ MB); estrutura e caminho de ETL são idênticos aos de produção, onde o job
  semanal ingere o arquivo **real** da ANP.
- [x] **J4 · Aposentar o Books to Scrape**: removidos do backend `booksToScrapeScraper.ts`, `searchRoute.ts`,
  `priceService.ts`, `productService.ts`, `alertService.ts`, `scheduleDailyPriceJob.ts`, fixtures HTML e
  `scraper.test.ts`; `app.ts` enxuto (só `/health` + rotas de fuel); schemas de livros e `fetchHtml` órfão
  removidos; comentários que citavam "livros/prices/tracked_products" corrigidos. **README reescrito** para o
  domínio combustível (pitch, stack=ETL, "como funciona", seção de seed/demo). Seção 6.5 já marcada como "1ª migração".
  _Nota:_ a dependência `cheerio` (só usada pelo scraper de livros) ficou no `package.json` **de propósito** —
  removê-la exige regenerar o lockfile do backend, que arrasta binários nativos do rollup/vite (via vitest) e é a
  fonte da dor de CI da Fase 5. Removê-la fica para uma etapa dedicada e cuidadosa (ou no Docker linux/amd64).

**DoD:** o app roda sobre dados **reais da ANP que mudam no tempo**; histórico, sinal e alerta são verdadeiros;
ETL **idempotente com observabilidade**; testes verdes. Premissa consertada → as dimensões de
scraping/realismo/domínio da rubrica sobem de ~3–4 para ~7–8.

---

### Fase 6.9 — Pendências operacionais pré-deploy (ações do Bernardo)
**Meta:** fechar o que não é código antes de subir. Curta e objetiva.

- [ ] **🔑 Rotacionar a `SUPABASE_SERVICE_ROLE_KEY`** no painel do Supabase (Settings → API →
  "Reset" na service_role) e atualizar o `backend/.env` local. **⚠️ Pendente desde a Fase 0** —
  obrigatório **antes de tornar o repo público** (a chave ignora RLS; se já circulou fora do `.env`,
  considere-a comprometida). Se o repo já é público, fazer **imediatamente**.
- [~] **Commit + push**: fixes 1–5 já commitados ✅; falta o commit da **Fase 9** (10 arquivos: retenção
  + db:stats + docs). Antes: `rm -f .git/index.lock` (lock órfão do FUSE). Depois do push, **conferir o
  CI verde** no GitHub (aba Actions) — dos dois commits.
- [x] **Primeira impressão**: série padrão (Gasolina · São Paulo/SP) auto-carregada na abertura — feito (Fix 5).
- [x] **Reexecutar `schema.sql`** no Supabase (funções `fuel_daily_series`/`fuel_latest_snapshot`) — feito e validado.

**DoD:** chave rotacionada, CI verde no GitHub com o código atual, app abrindo com dados sem interação.

---

### Fase 7 — Deploy público (o marco final)
**Meta:** link clicável funcionando, com dados de demo.

> ✅ **Pré-requisito da ingestão já resolvido (sessão de revisão):** a URL/estrutura real da ANP foi descoberta e
> o ingestor ajustado — arquivos **mensais** em `.../shpc/dsan/ANO/precos-{gasolina-etanol,diesel-gnv}-MM.csv`,
> configuráveis por `ANP_YEAR`/`ANP_MONTHS`. Carga inicial validada localmente (~75k linhas/mês, 27 UFs). No
> deploy, rodar `npm run ingest` contra o Supabase de produção **ou** subir com `ANP_INGEST_ON_BOOT=true` na 1ª vez.

- [ ] **Banco**: Supabase (já é hospedado) — projeto de produção separado do de dev.
- [ ] **Backend**: deploy no **Render** ou **Railway** (Express + cron). Configurar env vars (Supabase, SMTP, `FRONTEND_URL`).
- [ ] **Frontend**: deploy no **Vercel** ou **Netlify**; setar `VITE_API_BASE_URL` e `VITE_SUPABASE_*`.
- [ ] Ajustar **CORS** para aceitar o domínio do frontend em produção (hoje é origem única via env — validar).
- [ ] Configurar **SMTP real** para os emails de alerta (ex: Resend/Brevo/Gmail app password) e testar ponta a ponta.
- [ ] ~~Criar usuário de demo com credenciais no README~~ → **substituído pelo modo público**: a consulta
  já funciona **sem login** (Fix 3), então o recrutador não precisa de credenciais compartilhadas — que
  eram um risco real (qualquer um poderia trocar a senha da conta demo e trancar os próximos visitantes).
  Quem quiser testar favoritos/alertas cria a própria conta. _(Na Fase 7, avaliar desativar a confirmação
  de email no Supabase Auth para o signup da demo ser sem fricção.)_
- [ ] Adicionar **healthcheck** e **uptime** (o `/health` já existe — usar num monitor grátis tipo UptimeRobot).
- [ ] `Dockerfile` para o backend (opcional, mas fica bom no portfólio) + `docker-compose` para rodar local.

**DoD:** URL pública abre, login demo funciona, criar alerta dispara email real, gráfico mostra histórico seedado.

---

### Fase 8 — Apresentação e portfólio (o que converte no LinkedIn)
**Meta:** transformar o repo num case que vende.

- [x] **README raiz de alto nível**: título, pitch, badges (CI, licença, stack), seção "Arquitetura" com
  **diagrama** (Mermaid), "Como rodar", "Decisões técnicas", "Próximos passos". Bilíngue (EN + resumo PT).
  _(GIF/screenshots + link da demo ficam como placeholders até o deploy.)_
- [x] Diagrama de arquitetura em **Mermaid** (ANP → ETL → Supabase → API → Frontend → usuário / Email/Cron).
- [ ] **GIF de demonstração** do fluxo (explorar → favoritar → alerta) — usar a skill de gravação do navegador.
- [x] Seção **"O que eu aprendi / trade-offs"** — feita (decisões técnicas & trade-offs no README).
- [ ] Post de LinkedIn: problema → solução → stack → link da demo → aprendizado.
- [ ] Adicionar tópicos/tags no GitHub (`fuel-prices`, `etl`, `react`, `typescript`, `supabase`, `open-data`).

**DoD:** um estranho entende o projeto em 30s pelo README e consegue testar a demo sem te perguntar nada.

---

### Fase 9 — Operação contínua no free tier (pós-deploy, custo zero)
**Meta:** o app roda sozinho, para sempre, **sem pagar nada** — o banco não estoura o limite grátis.

> **Contexto:** o free tier do Supabase dá **500 MB** de banco. Hoje temos ~615k linhas em `fuel_prices`
> (out/2025–jun/2026, 9 meses) — bem abaixo do limite, mas o job semanal só **adiciona** (~70–75k
> linhas/mês). Sem controle, em ~2–3 anos o limite chega. A solução é **retenção**: o produto só precisa
> da janela recente (o filtro máximo da UI é "tudo", mas o valor está nos últimos ~12 meses).

> ✅ **Implementada antecipadamente** (a pedido do Bernardo: "não quero pagar nem 1 real") — a proteção
> já nasce LIGADA por padrão, em vez de esperar o gatilho de 70%.

- [x] **Política de retenção automática**: função SQL `fuel_prices_retention(p_keep_months)` (plpgsql,
  devolve o total apagado; EXECUTE revogado de anon/authenticated, só service_role) + serviço
  `retentionService.ts` chamado **após cada ingestão** (job semanal E CLI `npm run ingest`). Config por
  `RETENTION_MONTHS`: padrão **12** (proteção ligada; era 18 no design, recalibrado após a medição —
  ver baseline abaixo); `0` desliga; valor inválido cai no padrão (nunca
  desliga por acidente — regra testada). Nunca lança (falha não derruba a ingestão). O banco atinge um
  **platô** de tamanho em vez de crescer para sempre. **+4 testes** (`test/retention.test.ts`).
- [x] **Monitoramento**: função SQL `fuel_db_stats()` (tamanho do banco em MB, linhas, janela de datas)
  + CLI **`npm run db:stats`** que mostra o % de uso dos 500 MB grátis, a política em vigor e avisa
  quando passar de 70% ("reduza para 12"). _Medir o baseline: rodar `npm run db:stats` após reexecutar
  o schema.sql (anotar: ___ MB)._
- [x] **Gatilho objetivo documentado**: se `db:stats` um dia passar de **~350 MB** (70%), reduzir
  `RETENTION_MONTHS` (ex.: 9) — improvável com o padrão 12 (platô ~56%).
  _Alternativa futura se quiser histórico longo:_ agregar meses antigos numa tabela mensal compacta
  (`fuel_prices_monthly`: média/mín/máx por município+produto+mês) antes de apagar o detalhe.
- [ ] **Keep-alive** (Supabase pausa após ~7 dias sem uso; backend free "dorme"): GitHub Action agendada
  fazendo query mínima + ping no `/health` — detalhes no **Anexo (Seção 8)**. _Depende do deploy (Fase 7)._
- [x] **⚠️ Ação manual**: schema.sql reexecutado no Supabase ✅ e baseline medido ✅.

**📊 Baseline medido (25/jul/2026):** `npm run db:stats` → **209,9 MB / 500 MB (42%)** com 614.987
linhas (9 meses, out/2025→jun/2026) = **~21–23 MB/mês**. Conta da janela: 18 meses ≈ 420 MB (84% —
apertado demais) vs **12 meses ≈ 280 MB (56%) — folga permanente**. Decisão: **padrão do código
recalibrado de 18 → 12 meses** (`DEFAULT_RETENTION_MONTHS`), documentado no .env.example/README/schema.
Sem ação do Bernardo: o app já passa o valor explicitamente na RPC (não precisa reexecutar o schema).

**DoD:** ✅ retenção automática LIGADA por padrão (12 meses, calibrado por medição real) com testes;
`db:stats` monitorando; keep-alive entra com o deploy. **Custo mensal: R$ 0, garantido por construção.**

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
- [x] Fase 6 — UI/UX 10x (corrigir bug do preço + stats + gestão)
- [x] Fase 6.5 — Redesign de inteligência de preço e busca (upgrade visual dinâmico)
- [x] Fase 6.6 — Refino visual e identidade (tema claro editorial, estilo Camel)
- [x] Fase 6.7 — Reconciliação da Seção 1 + dívidas remanescentes (#4, #9, contraste AA, menções obsoletas)
- [x] **Fase 6.8 — Virada de domínio: preços reais de combustível (ANP)** ✅ (Frentes G–J completas: ETL,
  realismo de coleta, produto sobre dados reais, front migrado, seed, testes e limpeza do Books to Scrape)
- [x] **Ingestão REAL validada ponta a ponta** ✅ (sessão de revisão): URL/estrutura real da ANP corrigida
  (arquivos mensais `dsan/ANO/precos-*-MM.csv`), `npm run ingest`, ~75k linhas/mês · 27 UFs · 0 rejeitadas.
- [x] **Sessão de revisão crítica 3** ✅ — fixes 1–5 validados e2e com dado real: meses dinâmicos +
  **descoberta de URLs pela listagem** (sobreviveu ao naming novo/typo/sem-extensão de 2026), agregação
  em **SQL** (fim do cap de 1000 linhas), **explorar sem login**, fim da demo compartilhada, série padrão
  na abertura. Banco: **614.987 linhas · out/2025→jun/2026 contínuo**.
- [ ] **Fase 6.9 — Pendências operacionais** (Bernardo): rotacionar `SUPABASE_SERVICE_ROLE_KEY` (⚠️
  pendente desde a Fase 0) + commit/push com CI verde.
- [ ] Fase 7 — Deploy público + email real + demo
- [~] Fase 8 — README + diagrama Mermaid + decisões/trade-offs **feitos**; falta GIF/screenshots + post + tags
  (dependem do deploy)
- [x] Fase 9 — Operação contínua no free tier ✅ (**antecipada**): retenção automática ligada por padrão
  (`RETENTION_MONTHS=12`, calibrado por medição real: platô ~280 MB ≈ 56%, SQL + serviço + testes)
  e `npm run db:stats` para monitorar os 500 MB.
  Falta só o keep-alive (depende do deploy). **Custo R$ 0 garantido por construção.**

---

## 5.5. Rubrica de avaliação (nota crítica para portfólio — acompanhar a evolução)

> Autoavaliação honesta por dimensão (0–10), para medir o progresso a cada fase. A nota geral pesa mais as
> dimensões de **scraping/realismo/domínio**, porque é o que o projeto se propõe a demonstrar.

| Dimensão | Baseline (pós-6.6) | Alvo (pós-6.8) | Alvo (pós-7/8) |
|---|:---:|:---:|:---:|
| Engenharia full-stack | 8.0 | 8.0 | 8.5 |
| Produto / UX | 8.0 | 8.0 | 8.5 |
| **Sofisticação de scraping / ETL** | 3.5 | 7.5 | 8.0 |
| **Realismo dos dados** | 3.0 | 8.0 | 8.5 |
| Domínio / originalidade | 4.0 | 7.5 | 7.5 |
| Apresentação (README/deploy) | 5.0 | 5.5 | 9.0 |
| **NOTA GERAL** | **6.0** | **~8.0** | **~8.7** |

**O que puxa a nota hoje (baseline 6.0):** dados de histórico **simulados** (premissa furada) e scraping de
**site-sandbox estático**. A **Fase 6.8 (ANP)** ataca exatamente essas duas dimensões — é o maior salto de nota
do projeto. Deploy + README (Fases 7–8) destravam a dimensão de apresentação.

> **📈 Atualização (sessão de revisão):** o realismo dos dados deixou de ser promessa e virou fato — **ingestão
> real da ANP validada ponta a ponta** (~75k linhas/mês, 27 UFs, 0 rejeitadas), então **Realismo** e **ETL**
> atingiram (e sustentam) o alvo pós-6.8. **Apresentação** subiu com o **README de portfólio + diagrama Mermaid**;
> falta só o que depende do **deploy** (link da demo, screenshots/GIF, post) para fechar a dimensão em ~9.

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

## 6.5. Migração da fonte de dados: Mercado Livre → Books to Scrape

> 📌 **Esta foi a 1ª migração de fonte.** Uma **2ª migração** (Books to Scrape → **ANP / combustível**) está
> planejada na **Fase 6.8** — porque Books to Scrape é sandbox estático (preços não mudam), o que deixava o
> histórico simulado. A ANP traz dados reais que variam no tempo. O registro abaixo fica como histórico.

> **Por que:** o Mercado Livre passou a **bloquear scraping** (redireciona para uma página de
> "account-verification" / anti-bot) e a **API oficial exige OAuth** (403 sem token). Isso quebraria a
> demo no deploy (IP de servidor é bloqueado ainda mais). Decisão: **manter a ideia** (rastreador de
> preços com **web scraping real**) e trocar a fonte para **[books.toscrape.com](https://books.toscrape.com)**
> — um sandbox oficial feito para scraping, estável, sem bot e sem auth.

**Validado ao vivo:** 20 itens/página, com título, preço (`.price_color`), estoque e link para a página de detalhe.
Estrutura equivalente à do ML (lista → detalhe), então a refatoração é pequena.

### O que muda (checklist da migração) ✅ CONCLUÍDA
- [x] Criado `backend/src/scrapers/booksToScrapeScraper.ts` (substitui o `mercadoLivreScraper.ts`), com parsers puros
  (`parseCatalogueListing`, `parseBookDetail`, `parseMoney`) + orquestradores (`searchBooks`, `scrapeBookPrice`).
- [x] **Busca:** `searchBooks(q)` varre as páginas do catálogo (`catalogue/page-N.html`) e filtra por título.
- [x] **Preço/moeda:** em **£** (como raspado); `fullPrice = discountedPrice` (sem desconto). `parseMoney` robusto a lixo de encoding.
- [x] **Preços estáticos → histórico:** scrape pega o preço **real**; o `seed` gera ~30 dias com variação simulada (documentado no README).
- [x] Atualizados `app.ts` (`/api/track`), `searchRoute`, `scheduleDailyPriceJob`, `priceService`, `productService`, schema e `seed`.
- [x] **Fixtures e testes** trocados para o HTML do Books to Scrape (`booksListing.html`, `booksDetail.html`, `scraper.test.ts`).
- [x] **UI e READMEs** atualizados: "Mercado Livre" → "Books to Scrape" (rastreador de preços de livros).
- [x] Resto **intacto**: auth, Supabase/RLS, alertas, cron, gráficos, CI, deploy.

**Validado ao vivo:** `/api/search?q=light` retorna livros reais; track de "A Light in the Attic" gravou **£51.77** no Supabase
(via app no navegador). `tsc`/lint/testes/build limpos nos dois projetos.

> **Alternativa registrada:** `dummyjson.com` (API JSON com busca e desconto) — descartada por ser
> consumo de API, não scraping (perderia a skill principal do projeto). Fica como plano B.

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

### ✅ Fase 6 — UI/UX 10x
- **Gestão de produtos e alertas**: excluir produto (com cascade no banco) e listar/remover alertas ativos, com novos endpoints `DELETE`. _Por quê:_ um rastreador de verdade deixa o usuário no controle.
- **Toasts** de feedback (`useToasts`/`ToastContainer`) no lugar de mensagens soltas, **skeletons** de loading e **estados vazios**. _Por quê:_ sensação de produto, não de protótipo.
- **Hooks** `useAlerts` e `useToasts` (o de alerts estava adiado da Fase 3). _Por quê:_ organizar a lógica de UI fora do `App`.
- **Polish**: favicon SVG, `title`/`meta description`, responsividade e `aria-*` básicos. _Por quê:_ primeira impressão e acessibilidade.

### ✅ Fase 6.5 — Redesign de inteligência de preço e busca
- **Sinal de compra (deal score)**: `lib/dealSignal.ts` (puro, testado) transforma as estatísticas num veredito
  "Compre já / Bom preço / Preço mediano / Espere cair" com score 0–100 + **barra de posição** (menor↔maior).
  _Por quê:_ os melhores trackers vendem uma **decisão**, não um gráfico — era a camada que faltava.
- **Gráfico repaginado** (`PriceChart.tsx`): área com gradiente, linha da média tracejada e tooltip com data.
  _Por quê:_ dar contexto imediato a cada ponto (padrão Keepa/CamelCamelCamel).
- **Insights** (`lib/priceInsights.ts`, puro e testado): **filtro de período** (30d/90d/6m/tudo) que recorta
  gráfico e stats, **tendência** por média móvel e **volatilidade** por amplitude relativa. _Por quê:_ leitura
  rápida do momento sem depender do olho no gráfico.
- **Busca viva**: backend passou a devolver **preço por item**; front reconstruiu a busca com **debounce**
  (instantânea), **preço na linha**, **skeletons/estado vazio** e **botão "Rastrear" inline** (`handleTrackFromSearch`).
  _Por quê:_ unir "buscar" e "cadastrar" era o maior atrito de UX.
- **Layout dashboard**: `App` virou **sidebar** (busca + produtos como cards + alertas) + **painel de detalhe**,
  com **count-up** no preço (`useCountUp`), fade-in e transições, e **tokens de design** (`:root`) nos componentes novos.
  _Por quê:_ parecer um SaaS de verdade, não uma coluna de cards.
- **Testes**: +7 (`dealSignal`) e +10 (`priceInsights`) no front. Total do projeto agora: **45 testes** (21 back + 24 front),
  `lint`/`type-check`/`build` limpos nos dois lados.
- **Decisão registrada (B2, sparkline):** adiado — itens da busca não são rastreados, logo não têm histórico.
  Melhor lugar é o card de produto rastreado; entra quando o histórico por produto for carregado na sidebar.

### ✅ Fase 6.6 — Refino visual e identidade (tema claro editorial)
- **Diagnóstico "cara de IA"**: mapeei os padrões de template (gradiente no título, navy, glassmorphism,
  sombras pesadas, emojis, `system-ui`) e os removi. _Por quê:_ o usuário sentiu o visual genérico de IA.
- **Direção escolhida**: **claro e editorial** (estilo CamelCamelCamel) — identidade quente e memorável.
- **Fundação (Frente D)**: reescrevi o `index.css` inteiro com **tokens de paleta clara** (papel `#F6F1E9`,
  terracota `#C15F3C`, tinta `#241F1A`), importei **Fraunces + Inter** (serif no wordmark/preço/sinal),
  criei **`components/Icon.tsx`** (SVGs inline, **sem dependência nova**) e troquei todos os emojis.
  _Por quê:_ tipografia real + cor de marca + ícones de verdade são o que separa "produto" de "template".
- **Aplicação (Frente E)**: header com brand mark, sidebar, painel de detalhe, **gráfico Chart.js recolorido**
  pro claro (linha tinta + área terracota + média camelo), auth e toasts — tudo na nova identidade.
- **Acabamento (Frente F)**: números tabulares, stat-grid mais denso (lição do Keepa), transições sóbrias
  (count-up mantido), responsivo revisado. _Pendente:_ auditoria de contraste **AA** formal antes do deploy.
- **Validação**: `lint`/`type-check`/`build` limpos; **45 testes** verdes; zero emoji e zero cor escura
  hardcoded remanescentes (verificado por grep). Também corrigi o `index.html` (título/description ainda
  citavam "Mercado Livre") e o favicon (agora terracota).

### ✅ Fase 6.8 (Frente I) — Frontend sobre dados reais da ANP
- **Fim do "cérebro dividido"**: o backend já falava combustível (rotas/serviços/ETL), mas o `App.tsx` ainda era
  100% "livros". Reescrevi o front inteiro para consumir `/api/fuel/*`. _Por quê:_ sem isso o app estava
  inconsistente (backend ANP, front livros).
- **Reuso via adaptador** (`lib/seriesToHistory.ts`): mapeia a série da ANP (`DailyAggregate`) para o
  `PriceHistoryItem` genérico. Com isso, **toda a camada de inteligência** (sinal de compra, tendência,
  volatilidade, filtro de período, gráfico) funciona sobre os dados reais **sem uma linha alterada** (I3).
  _Por quê:_ o valor estava na reutilização — a lógica já era boa, só precisava de dados reais.
- **Novo fluxo**: explorar (combustível → UF → município) → série + sinal + stats + gráfico → **favoritar** →
  alerta. Painel "Onde está mais barato" (ranking de postos, I2). `useAlerts` migrado para os endpoints de fuel.
- **Client/tipos** (`api/client.ts`, `types.ts`, `lib/seriesLabel.ts`) reescritos; `index.html` relabelado.
  Nome do produto mantido como "Price Tracker Pro". `type-check`/`lint`/`build` limpos, **24 testes** front.

### ✅ Fase 6.8 (J3) — Seed do domínio combustível
- **Seed antigo estava quebrado** (apontava para `tracked_products`/`prices`, tabelas removidas). Reescrito:
  `scripts/lib/anpDemoData.ts` gera uma amostra no **layout SHPC da ANP** (6 cidades × 5 postos × produtos ×
  16 semanas, RNG determinístico) e o `scripts/seed.ts` a ingere pelo **pipeline ETL real** + cria usuário demo,
  1 favorito e 1 alerta, registrando em `ingestion_runs`. _Por quê:_ a demo precisa abrir com série temporal de
  verdade (gráfico/sinal/ranking com dados) e exercitando o mesmo caminho de produção.
- **Validado** com o ETL real (sem Supabase): 1728 linhas, **0 rejeitadas/dedup/barradas**; Gasolina/SP com
  16 pontos semanais e queda realista. **69 testes** backend verdes.

### ✅ Sessão de revisão crítica + higiene + localização + **ingestão REAL da ANP** + README

> Sessão focada em revisar o projeto inteiro de forma crítica (para portfólio) e fechar as frentes A→D.
> **Marco desta sessão:** o app deixou de rodar sobre dados de seed e passou a rodar sobre **dados reais da ANP
> ingeridos de verdade** — a premissa do produto está finalmente comprovada ponta a ponta.

**A · Higiene do repo**
- Removidos do git os dois `.fuse_hidden*` (artefatos de mount, estavam rastreados) e adicionados
  `.fuse_hidden*` + `*.tsbuildinfo` ao `.gitignore`.
- `cheerio` (dep morta do scraper de livros): **removção adiada de propósito** — tirar exige regenerar o
  lockfile do backend, e o ambiente de trabalho era ARM (o CI é x64); regenerar lá reintroduziria o bug de
  arquitetura da Fase 5. Fazer no Docker linux/amd64 numa etapa dedicada.

**B · Localização dos postos + honestidade da UI**
- **"Ver no mapa"**: cada posto do ranking "Onde está mais barato" virou link para o Google Maps, montado a
  partir do endereço real (nome + rua + nº + bairro + município/UF). Ícone `map-pin` novo no `Icon.tsx`.
  _Por quê:_ era o que o Bernardo notou — endereço como texto morto; com o dado real da ANP o posto existe
  no mapa de verdade.
- **Selo "dados de demonstração"** via `VITE_DEMO_MODE` (desligado por padrão): quando ligado, a UI avisa que
  os dados são amostra ilustrativa (seed). Evita apresentar posto fictício como real sem mentir em produção.

**C · Ingestão REAL da ANP (a grande virada desta sessão)**
- **Bug crítico de URL descoberto e corrigido.** A estrutura assumida no código (`shpc/dsas/ca/ca-YYYY-SS.csv`,
  por semestre) **não existe** (404). A estrutura real é `shpc/dsan/ANO/precos-{gasolina-etanol,diesel-gnv}-MM.csv`
  — arquivos **mensais, separados por grupo de produto**, sem sufixo `/@@download/file`. Descoberto extraindo os
  hrefs reais da página viva da ANP.
- **`anpIngestor` refatorado** para o mundo real: `buildAnpUrls()` monta a lista a partir de `ANP_YEAR`/`ANP_MONTHS`
  (padrão 2025 · 10,11,12); `ingestAnp` agora **itera sobre vários arquivos**, com `ingestOneFile` por arquivo
  (fonte por-arquivo → validadores condicionais/observabilidade corretos) e **404 é pulado sem abortar o lote**.
- **`httpClient`**: o erro passou a **expor o status HTTP** (`describeAxiosError`) — antes engolia (só "falhou"),
  o que escondeu o 404 inicial. Melhora diagnóstico agora e em produção (virada de semestre/mês).
- **Novo comando `npm run ingest`** (`scripts/ingest.ts`) para carga manual/1ª carga — mais limpo que o hack
  `ANP_INGEST_ON_BOOT`, e bom artefato de portfólio. `.env.example` atualizado (ANP_YEAR/ANP_MONTHS).
- **Validado com DADO REAL no Supabase do Bernardo:** schema aplicado (4 tabelas + RLS ok); seed falso limpo
  (`delete from fuel_prices`); ingerido Dez/2025 = **74.638 linhas, 27 UFs, 0 rejeitadas**; depois o trimestre
  completo (out+nov+dez, com Dez **pulado automaticamente** pelo hash de conteúdo). Parser confirmado contra o
  cabeçalho oficial (16 colunas, inclui endereço) — **zero alteração no parser**. Alerta demo reavaliado e
  corretamente **não** disparou (limiar abaixo da média real). ETL impecável sobre produção.

**D · README / apresentação (parcial)**
- **README raiz reescrito como case de portfólio** (bilíngue: EN principal + resumo PT), com **badges** (CI,
  licença, stack), **diagrama de arquitetura em Mermaid** (ANP→ETL→Supabase→API→Front→usuário), "como funciona"
  com os números reais, **decisões técnicas & trade-offs**, "como rodar" já com `npm run ingest`, fonte/legalidade
  e **roadmap** honesto.
- **Placeholders** deixados para o deploy: link da demo (credenciais já anotadas) e seção de screenshots/GIF.
- **Pendente:** GIF de demonstração, post de LinkedIn e tags do GitHub (entram junto do deploy — Fase 7).

### ✅ Sessão de polimento pré-deploy (higiene final + segurança + refactor do front)

> Segunda passada crítica antes do deploy: fechar pontas soltas técnicas e elevar o código a nível de
> review sênior. Decisão do Bernardo: **deixar tudo 100% antes de partir para o deploy** (Fases 7–8).
> Auditoria confirmou que as alegações das fases anteriores se sustentam (testes/lint/type-check/build
> verdes, git limpo, sem segredos, RLS ok, README honesto). Ajustes desta sessão:

- **Env var morta removida:** `USE_CSV_FALLBACK` saiu do `backend/.env.example` (resquício do domínio
  de livros/CSV; nenhum código a referenciava mais).
- **`.fuse_hidden` (higiene):** confirmado que **não estão versionados** (só artefato de mount, invisível
  ao git/clone) — nada a fazer no repositório.
- **`cheerio` removido** (dep morta do scraper de livros, adiada desde a Fase 5 pelo medo do lockfile).
  Feito com segurança: `npm uninstall --package-lock-only` **preservou os 9 binários nativos multi-plataforma**
  (x64/darwin/win do rolldown) — validado com `npm ci` limpo num fs Linux à parte. A dor de CI da Fase 5
  **não** se repetiu.
- **Segurança da API pública:** adicionados **helmet** (headers de segurança, CSP desligada por ser API
  JSON) + **express-rate-limit** (300 req/15min por IP) em `app.ts`, com `trust proxy = 1` para contar o IP
  real atrás de Render/Vercel. Handler de 429 padronizado via `sendError`.
- **Vulnerabilidades zeradas:** `npm audit` acusava **3 (1 HIGH no nodemailer + 2 via uuid/node-cron)**.
  Bump **nodemailer 8→9** e **node-cron 3→4** (verificado que `cron.validate`/`cron.schedule` continuam
  na API v4; `@types/node-cron` removido pois v4 traz tipos próprios). Agora **`npm audit` = 0**.
- **`App.tsx` desmonolitizado: 897 → 209 linhas.** Lógica extraída em hooks (`useAuth`, `useFuelSeries`,
  `useFavorites`) e view em componentes (`AuthPage`, `Sidebar`, `DetailPanel`); helpers puros movidos para
  `lib/format.ts` (`fmt`/`formatLocation`/`mapsUrl`/`sameSeries`). O `App` virou orquestrador fino. **+7 testes**
  novos (`lib/format.test.ts`) cobrindo os helpers. _Por quê:_ um componente de 897 linhas era o maior sinal
  de imaturidade numa review; a nova estrutura (hooks/ + components/ + lib/) mostra separação de responsabilidades.
- **README** atualizado: contagem de testes (~99 → **~106**), linha de **Segurança** na stack (helmet + rate-limit)
  e bullet de decisão técnica ("Hardened public API" + audit limpo).
- **Verificação final (fs limpo):** backend type-check/lint/**75 testes**/build/audit-0 ✓; frontend
  type-check/lint/**31 testes**/build ✓. Total **106 testes**.
- **Nota operacional:** um `git status` rodado no ambiente de mount deixou um `.git/index.lock` órfão que o
  sandbox não conseguiu apagar (mesma limitação de permissão do FUSE). No Mac do Bernardo é um
  `rm -f .git/index.lock` antes de commitar.

### ✅ Sessão de revisão crítica 3 — dois bugs latentes de produção (meses fixos + cap de 1000 linhas)

> Auditoria crítica pré-deploy encontrou duas pontas soltas que só morderiam **em produção, com o tempo**.
> Ambas corrigidas nesta sessão.

- **Fix 1 · O cron nunca avançava de mês (dado congelaria em produção).** `buildAnpUrls` lia
  `ANP_YEAR`/`ANP_MONTHS` fixos do env (padrão 2025 · 10,11,12): o job semanal rebaixaria os mesmos
  arquivos para sempre (hash pula tudo) e o app exibiria dados velhos eternamente — alertas nunca mais
  disparariam. Agora os meses são **derivados da data de execução** (`defaultAnpPeriods`: mês corrente +
  2 anteriores, virada de ano tratada; mês não publicado → 404 pulado). Env virou **override explícito**
  para backfill (`ANP_CSV_URL` > `ANP_YEAR`/`ANP_MONTHS` > automático). `.env.example` comentado de acordo.
  **+8 testes** (`test/anpUrls.test.ts`, com data injetável e `vi.stubEnv`).
- **Fix 2 · Cap de 1000 linhas do PostgREST na série municipal.** `fetchRecords` fazia `.limit(20000)`
  na tabela crua, mas o Supabase corta a resposta em 1000 (Max Rows) ignorando o limit do cliente — o
  mesmo problema já visto nas UFs, só que aqui truncaria **as linhas mais recentes** (ordem ascendente)
  quando o histórico do município passasse de 1000 linhas (~6 meses numa cidade grande) → preço-herói
  silenciosamente desatualizado. Agora a agregação roda **no Postgres**: RPC `fuel_daily_series` (uma
  linha por data de levantamento) e `fuel_latest_snapshot` (só as linhas do último levantamento);
  o ranking/dedup por CNPJ continua na função pura `summarizeSnapshot` (testada). `aggregateDailySeries`
  (JS) removida — virou código morto (a versão SQL é a fonte de verdade). Bônus: menos tráfego DB→API.
- **⚠️ Ação manual:** reexecutar `backend/supabase/schema.sql` no SQL Editor do Supabase (idempotente)
  para criar as duas funções novas — **sem isso a série e o snapshot voltam vazios**.
- **Verificação:** `tsc --noEmit` ✓, `eslint` ✓, **80 testes backend** verdes (75 − 3 do agregador JS
  + 8 novos), schema re-parseado (46 statements). Front intocado (shape da API idêntico). Testes rodados
  em cópia linux-arm64 com binário nativo `--no-save` (lockfile do repo **não** foi tocado).

- **Fix 1b · Descoberta de URLs pela listagem do ano (a ANP mudou o naming em 2026).** O primeiro
  `npm run ingest` real pós-Fix 1 revelou que **todos** os arquivos de 2026 davam 404: a ANP trocou o
  padrão de nome — de `precos-{grupo}-MM.csv` (2025) para `MM-dados-abertos-precos-{grupo}.csv` (2026),
  **com um typo do próprio portal** em fevereiro (`02-cados-abertos-preco-...`), **abril sem extensão**
  `.csv` e **junho num terceiro formato** (`06-...-precos-2026-06-...`). Nenhum template sobrevive a isso.
  Solução: o ingestor agora **descobre os hrefs reais na página da pasta do ano** (`anpDiscovery.ts`,
  parser puro com fixture fiel à listagem real, tolerante a typos/sem-extensão, dedup por mês+grupo,
  ignora GLP) e só cai no padrão antigo se a listagem estiver fora do ar. Bônus: mês ausente da listagem
  = não publicado → **nem tenta baixar** (zero 404). **+10 testes.**
- **httpClient endurecido:** 4xx (exceto 429) **não é mais retentado** (um 404 era baixado 3× com backoff
  — desperdício e martelo no host); `ScrapeError` ganhou `httpStatus`; no ingestor, **404 virou "skipped"**
  (não "error") — lote e CLI não falham mais por mês não publicado.
- **Verificação (Fix 1b):** `tsc` ✓, `eslint` ✓, **90 testes backend** verdes. Total do projeto: **121**
  (90 back + 31 front). Validação e2e real: `npm run ingest` no Mac deve agora achar mai+jun/2026 pela
  listagem e pular jul (não publicado).

- **Fix 3 · Explorar sem login (padrão Keepa/CamelCamelCamel).** As rotas públicas (`/api/fuel/*` de
  leitura) nunca exigiram auth, mas o front bloqueava tudo atrás da AuthPage — recrutador abria o link e
  via um formulário. Agora o **dashboard de consulta é público**: a AuthPage só aparece via botão
  **"Entrar"** no header, ao clicar em **"Favoritar"** sem conta, ou pelo **CTA** que substitui o
  formulário de alerta para visitantes ("crie uma conta grátis para receber email…"). A AuthPage ganhou
  o link "← Explorar preços sem login" e o subtítulo explica o porquê do login. Sidebar já escondia
  favoritos/alertas sem conta (nada a mudar).
- **Fix 4 · Fim da promessa de demo "read-only".** O README prometia conta demo compartilhada
  "read-only", mas nada impedia trocar a senha dela (trancando os próximos visitantes) ou apagar os
  dados. Com o Fix 3 a conta demo pública ficou **desnecessária** — README atualizado (explorar é
  público; conta própria para favoritos/alertas) e o item da Fase 7 reescrito. O usuário demo do seed
  continua existindo **só para dev local**.
- **Fix 5 · Primeira impressão (série padrão).** Sem login e sem seleção, o painel de detalhe abria
  vazio. Agora, com as opções carregadas e nada em exibição, o app **auto-carrega Gasolina ·
  São Paulo/SP** (com fallback para o 1º produto/UF/município disponível): o visitante vê gráfico,
  sinal de compra e ranking em ~2s, sem clicar em nada. Roda uma única vez (ref) e nunca sobrescreve
  uma escolha do usuário. Essencial para demo pública e screenshots.

**✅ Validação e2e REAL dos fixes (terminal do Bernardo, 25/jul/2026):**
1. **1ª rodada (código antigo ainda):** 6×404 com 3 retries cada — evidenciou o problema do naming 2026
   e o desperdício de retry em 404 (ambos corrigidos em seguida).
2. **2ª rodada (Fix 1b):** listagem lida (`found: 12`), jul/2026 **pulado sem nenhuma requisição**,
   mai+jun ingeridos = **142.522 linhas, 0 rejeitadas** — incluindo o arquivo de junho com naming fora
   do padrão. Status `success`, alerta reavaliado.
3. **Backfill jan–abr/2026** (`ANP_YEAR=2026 ANP_MONTHS=01,02,03,04`): **274.251 linhas** — incluindo o
   arquivo de fevereiro **com typo do portal** (`02-cados-abertos-preco-...`) e os dois de abril **sem
   extensão .csv**, todos descobertos e ingeridos sem ajuste. Dedup pegou **6 duplicatas internas** dos
   próprios CSVs da ANP (44.330 lidas → 44.326 upsert em fev).
- **Estado final do banco: 614.987 linhas · 27 UFs · série contínua out/2025 → jun/2026.**
  Quando a ANP publicar jul/2026, o job semanal pega sozinho.

---

## 8. Anexo: hospedagem grátis, "sono" e keep-alive (para entender depois)

O deploy tem **3 peças**, cada uma com um comportamento no plano **grátis**:

| Peça | Onde | Comportamento grátis |
|---|---|---|
| **Frontend** (React) | Vercel/Netlify | ✅ Sempre no ar, instantâneo. Sem sono. |
| **Banco + Auth** (Supabase) | Supabase | ⏸️ Pausa após **~7 dias sem uso** → resolvido com **keep-alive**. |
| **Backend** (Express) | Render/Railway/Fly | 😴 "Dorme" após ~15 min parado → 1ª visita leva **~30–60s** pra acordar. |

**Keep-alive (Supabase não pausar):** um **GitHub Action agendado (cron)** — grátis e ilimitado em repositório
público — faz uma query pequena no Supabase a cada poucos dias. Isso zera o contador de inatividade → nunca pausa.
Roda na nuvem, sem depender do Mac ligado, **sem custo**.

**Cold start do backend (~30–60s):** é **normal** em free tier — o serviço "dorme" e acorda na 1ª requisição.
**Não é a única opção.** Formas de reduzir (todas grátis), a decidir na Fase 7:
- Um 2º keep-alive que "cutuca" o backend de tempos em tempos (mantém acordado); ou
- Reescrever o backend como **funções serverless na Vercel** (acordam em ~1s, tudo numa plataforma só) — mais trabalho.

**Resumo honesto:** dá para ter o projeto **sempre acessível pela URL, 100% grátis, sem manutenção manual**.
O único porém é a possível espera de ~30–60s na 1ª carga após inatividade (aceitável para portfólio).

---

## 9. Anexo: por que usei Docker (para entender depois)

**O problema:** o CI do GitHub roda em **Linux x64**. Meu ambiente de dev (e o do Bernardo) é
**macOS ARM64** (Apple Silicon). Um bug do npm (#4828) fazia o `npm ci` não instalar as dependências
nativas opcionais corretas por **arquitetura** — o erro só aparecia no Linux x64, nunca no Mac.

**O que é Docker / container (simples):** um **container** é uma "caixa" isolada que roda um mini-Linux
**dentro** do Docker, totalmente **separada** do macOS — como uma máquina virtual leve e descartável.
O que roda lá dentro **não altera o Mac** (nem arquivos do sistema, nem configurações, nem o OS).

**Por que usei:** para **reproduzir o ambiente exato do CI** (`--platform linux/amd64`, imagem `node:20`)
e testar a correção do lockfile **sem tocar na máquina local**. Foi como "abrir um Linux x64 temporário"
só para gerar/validar os lockfiles.

**Efeitos colaterais no Mac (inofensivos e reversíveis):**
- O **Docker Desktop** ficou aberto (estava instalado; só foi iniciado). Pode fechar em Docker → *Quit*.
- **~6,4 GB de imagens** (`node:20/22/24`) ficaram no cache do Docker. Para liberar o espaço quando quiser:
  - `docker image rm node:20 node:22 node:24` (remove só essas imagens), ou
  - `docker system prune -a` (limpa tudo que não está em uso — mais agressivo).
- **Nada mais foi alterado.** O `node_modules` local foi reinstalado com os binários ARM corretos
  (`npm ci`), então o desenvolvimento no Mac segue normal.

**Regra de bolso para o futuro:** gere os `package-lock.json` no **mesmo SO/arquitetura do CI**
(ou deixe o próprio CI gerar), e valide o **pipeline inteiro** (build + test), não só o `npm ci`.

---

### Notas de escopo
Não vamos inflar o produto com marketplaces novos, mobile app ou ML de previsão de preço agora — isso entra em **"Próximos passos"** no README (mostra visão sem gastar tempo). O foco do 10x é **confiabilidade + acabamento + apresentação**, que é exatamente o que faz um projeto de portfólio se destacar.
