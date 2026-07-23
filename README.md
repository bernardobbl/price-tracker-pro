# Price Tracker Pro

[![CI](https://github.com/bernardobbl/price-tracker-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/bernardobbl/price-tracker-pro/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Rastreador de preços de livros ([Books to Scrape](https://books.toscrape.com)) com histórico,
estatísticas e **alertas por email** quando o preço cai abaixo de um valor desejado.

> **Nota sobre a fonte de dados:** o projeto começou raspando o Mercado Livre, mas eles passaram a
> bloquear scraping (anti-bot) e a exigir OAuth na API. Para manter uma demo **sempre no ar e confiável**,
> a fonte foi migrada para o **Books to Scrape** — um sandbox oficial feito para praticar web scraping.
> Como o catálogo tem preços estáticos, o histórico da demo usa uma pequena variação simulada (via `seed`).

- **Backend:** Node.js + TypeScript + Express, web scraping (Axios + Cheerio), cron (`node-cron`)
- **Frontend:** React + Vite + TypeScript + Chart.js
- **Banco / Auth:** Supabase (PostgreSQL + Row Level Security)
- **Email:** Nodemailer (SMTP)

> 📋 O roteiro de evolução do projeto (rumo ao deploy) está em [`plan.md`](./plan.md).

---

## Estrutura

```
.
├── backend/     API, scraping, cron, integração Supabase e envio de email
└── frontend/    Dashboard React que consome a API
```

---

## Pré-requisitos

- Node.js **20+** (veja `.nvmrc` → `nvm use`)
- Conta no [Supabase](https://supabase.com) (URL do projeto + anon key + service_role key)
- (Opcional) Credenciais SMTP para os emails de alerta

---

## Como rodar localmente

### 1. Banco de dados

No **SQL Editor** do Supabase, execute o conteúdo de `backend/supabase/schema.sql`
(domínio de **preços de combustível / ANP**: `fuel_prices`, `tracked_series`, `alerts`, `ingestion_runs`).

Se já rodou uma versão antiga do domínio **livros** (`tracked_products`/`prices`), rode antes
`backend/supabase/migration_002_books_to_fuel.sql` para dropar as tabelas antigas e depois o `schema.sql`.
(O `migration_drop_old_tables.sql` é ainda mais antigo — só relevante para bancos pré-`schema.sql`.)

### 2. Backend

```bash
cd backend
cp .env.example .env      # preencha SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev               # API em http://localhost:4000
```

Variáveis (`backend/.env`):

| Variável | Descrição |
|---|---|
| `PORT` | Porta da API (padrão 4000) |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave pública anon |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service_role (backend grava preços; **secreta**) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | SMTP para alertas (opcional) |
| `FRONTEND_URL` | Origem liberada no CORS (padrão `http://localhost:5173`) |
| `ANP_CSV_URL` | URL do CSV da ANP a ingerir (padrão: arquivo do semestre corrente) |
| `ANP_CRON` | Cron do job semanal de ingestão (padrão `0 6 * * 1` — segunda 06:00) |
| `ANP_INGEST_ON_BOOT` | Se `true`, ingere uma vez no boot (útil no 1º deploy/demo) |

### 3. Frontend

```bash
cd frontend
cp .env.example .env      # preencha VITE_API_BASE_URL e VITE_SUPABASE_*
npm install
npm run dev               # dashboard em http://localhost:5173
```

---

## Scripts úteis

| Comando | Onde | O que faz |
|---|---|---|
| `npm run dev` | backend/frontend | Modo desenvolvimento |
| `npm run build` | backend/frontend | Build de produção |
| `npm run lint` | backend/frontend | Lint |
| `npm start` | backend | Roda o build (`dist/`) |

---

## Como funciona

1. Usuário faz login (Supabase Auth) e cadastra um produto pelo nome.
2. O backend faz scraping do preço no Books to Scrape e grava o histórico.
3. Um cron diário atualiza os preços dos produtos monitorados.
4. O dashboard mostra preço atual, menor/maior/médio, variação e o gráfico de evolução.
5. O usuário define um alerta; quando o preço cai abaixo do alvo, recebe um email.

## Fonte de dados & legalidade (ANP)

O projeto está migrando para uma fonte de **dados reais e públicos**: a
[Série Histórica de Preços de Combustíveis](https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/serie-historica-de-precos-de-combustiveis)
da **ANP** (Agência Nacional do Petróleo, Gás Natural e Biocombustíveis), publicada como **dado aberto**
a partir do levantamento semanal de preços por município, produto e revenda.

Boas práticas de coleta adotadas (Frente H do [`plan.md`](./plan.md)):

- **Legalidade / robots.txt:** é dado aberto governamental, de uso livre com **atribuição à ANP**. O
  `robots.txt` do `gov.br` **não restringe** o caminho de dados abertos utilizado (verificado — as regras
  `Disallow` cobrem apenas `/economia`, `/ebserh` e `/mre`).
- **Coleta educada:** um único arquivo por semestre, baixado **no máximo uma vez por semana** (cron), com
  **timeout + retry com backoff** e **requisição condicional** (`ETag`/`If-Modified-Since` → `304 Not Modified`)
  para não rebaixar o arquivo quando nada mudou.
- **Idempotência:** persistência por **upsert** na chave natural (CNPJ + produto + data), então reprocessar
  o mesmo arquivo nunca duplica dados.
- **Observabilidade:** cada execução é registrada em `ingestion_runs` (arquivo, hash, linhas lidas/inseridas/
  rejeitadas, duração, status), e a ingestão roda **sempre em background** (cron/job), nunca dentro de uma
  request HTTP.
- **Qualidade de dado:** as linhas passam por normalização (produto canônico, CNPJ só-dígitos, descarte de
  valores fora de faixa) e por um **gate de validação Zod** antes de gravar; rejeições são contabilizadas.

> Esta é a **2ª migração de fonte** do projeto (Mercado Livre → Books to Scrape → ANP). O histórico das
> migrações fica registrado no `plan.md`. A troca de rótulos/UI do domínio livros para combustível é a
> etapa seguinte (Frente I).

## Licença

MIT — veja [`LICENSE`](./LICENSE).
