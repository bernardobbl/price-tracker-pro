# Backend — Price Tracker Pro

API REST + **ETL** dos preços de combustível da ANP. Duas responsabilidades bem
separadas: um **job** que ingere os CSVs públicos para o Supabase, e uma **API**
que serve séries agregadas e os favoritos/alertas de cada usuário.

> Documentação geral do projeto (arquitetura, decisões, demo) no
> [README raiz](../README.md).

## Tecnologias

- Node.js 22+ · TypeScript (`strict`)
- Express (API REST) · Zod (validação de entrada) · pino (logs estruturados)
- Axios (download dos CSVs, com timeout/retry e GET condicional)
- Supabase (PostgreSQL + Auth + RLS) — **única** fonte de verdade
- node-cron (agendamento embutido, opcional) · Nodemailer (alertas por email)
- Helmet + express-rate-limit · Vitest + supertest (testes)

## Instalação

```bash
cd backend
npm install
cp .env.example .env
```

O `.env.example` documenta cada variável. O mínimo para subir:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `FRONTEND_URL` — origens liberadas no CORS (aceita lista separada por vírgula)
  e base do link dentro do email de alerta

SMTP (`SMTP_*`, `EMAIL_FROM`) é opcional: sem ele, o alerta é apenas logado.

> **Antes do primeiro boot:** rode `supabase/schema.sql` no SQL Editor do
> Supabase (idempotente). Se o banco já teve o schema antigo do domínio "livros",
> rode `supabase/migration_002_books_to_fuel.sql` primeiro.

## Rodar

```bash
npm run dev          # API em http://localhost:4000 (ts-node-dev)
npm run ingest       # carga de dados reais da ANP (rode ao menos uma vez)
npm run build        # compila para dist/
npm start            # roda o dist/ (é o que o Render executa)
```

Sem passar por `npm run ingest` (ou `npm run seed`) o banco fica vazio e a
interface abre sem séries — não é bug.

## Scripts utilitários

| Comando | O que faz |
|---|---|
| `npm run ingest` | Ingere os CSVs da ANP. Meses derivados da data atual; `-- --url <URL>` força um arquivo específico (backfill). |
| `npm run seed` | Amostra **sintética** no layout da ANP + usuário demo, pelo ETL real. Só para demo offline. |
| `npm run db:stats` | Tamanho do banco, nº de linhas e janela de datas — monitora os 500 MB do free tier. |
| `npm test` | Vitest (unitários + integração com supertest). |
| `npm run lint` / `npm run type-check` | ESLint / `tsc --noEmit`. |

## Endpoints

**Consulta pública** (sem login, como Keepa/CamelCamelCamel):

- `GET /health` — healthcheck (usado pelo Render e pelo keep-alive)
- `GET /api/fuel/products` — combustíveis **com dado no banco**
- `GET /api/fuel/locations` — UFs · `?state=SP` — municípios daquela UF
- `GET /api/fuel/series?product=&state=&municipality=[&brand=]` — série diária
  agregada (média/mín/máx por levantamento)
- `GET /api/fuel/snapshot?product=&state=&municipality=[&brand=]` — levantamento
  mais recente + ranking de postos

**Autenticadas** (`Authorization: Bearer <token do Supabase>`):

- `GET`/`POST /api/fuel/tracked` · `DELETE /api/fuel/tracked/:id` — favoritos
- `GET`/`POST /api/fuel/alerts` · `DELETE /api/fuel/alerts/:id` — alertas

Toda entrada passa por Zod; erros seguem o formato
`{ error: { code, message, details? } }`.

## O ETL

`src/ingest/` — todo o trabalho pesado roda **fora da request HTTP**:

1. **Descoberta** (`anpDiscovery.ts`): lê a listagem da pasta do ano no portal da
   ANP e extrai os hrefs reais. O nome dos arquivos mudou em 2026 (prefixo de
   mês, um typo do portal, um arquivo sem extensão) — nenhum template sobrevive,
   então descobrimos em vez de adivinhar.
2. **Download** (`scrapers/httpClient.ts`): GET condicional (ETag /
   `If-Modified-Since`), timeout e retry com backoff; 4xx não é retentado.
3. **Parse** (`anpParser.ts`): CSV `;`, Latin-1, decimal com vírgula, data
   `dd/mm/aaaa`; dirigido pelo cabeçalho, tolerante a acento e reordenação.
4. **Normalização** (`anpNormalize.ts`): produto canônico, CNPJ só-dígitos, faixa
   de preço plausível, com contagem de rejeições por motivo.
5. **Dedup + gate Zod** (`anpRowSchema.ts`): chave natural
   `(cnpj, product, collected_at)`; a última linha vence.
6. **Upsert idempotente** no Supabase + registro em `ingestion_runs`
   (arquivo, hash, lidas/inseridas/rejeitadas, duração, status).

Reprocessar o mesmo arquivo é seguro e barato: o hash do conteúdo pula o que já
foi ingerido. O escopo é **automotivo** — os arquivos de GLP existem na pasta da
ANP e são deliberadamente ignorados.

## Agendamento

Em produção quem dispara a ingestão semanal é o **GitHub Actions**
(`.github/workflows/ingest.yml`), com `ANP_CRON=off` no backend. Motivo: no free
tier o processo web hiberna, então um cron embutido pode nunca chegar na hora
marcada.

O cron embutido (`src/jobs/scheduleWeeklyAnpJob.ts`) continua disponível para
rodar local ou em host próprio — expressão em `ANP_CRON`, fuso em `ANP_CRON_TZ`
(padrão `America/Sao_Paulo`, porque hosts rodam em UTC). Depois de cada ingestão
bem-sucedida ele reavalia os alertas e aplica a **retenção**
(`RETENTION_MONTHS`, padrão 12 meses), que mantém o banco num platô de tamanho.

## Estrutura

```
src/
  app.ts            # Express montado (exportável → testável)
  index.ts          # listen + agendamento do job
  routes/           # fuelRoute (público) · fuelUserRoute (autenticado)
  services/         # consulta, favoritos, alertas, email, retenção
  ingest/           # ETL da ANP (descoberta, parser, normalização, orquestrador)
  lib/              # funções puras (agregação, sinal de alerta, CORS, email…)
  middleware/       # auth, validação Zod, error handler
supabase/           # schema.sql + migrações
scripts/            # ingest · seed · db:stats
test/               # Vitest
```

A lógica que importa vive em **funções puras** (`lib/`, `ingest/`), sem I/O — é o
que torna os testes baratos.

## Segurança

- A API usa a **service key**, que **bypassa RLS** — por isso toda query por
  usuário filtra `user_id` explicitamente, e todo `series_id` vindo do cliente
  passa por checagem de posse antes de ser usado. O RLS é a segunda linha de
  defesa (acesso direto do cliente ao Postgres).
- Sem Supabase configurado, `requireAuth` libera apenas **fora de produção**
  (modo demo, com aviso no log); com `NODE_ENV=production` responde 503.
- Helmet + rate limit (300 req / 15 min por IP) na superfície pública.
