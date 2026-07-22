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

No **SQL Editor** do Supabase, execute o conteúdo de `backend/supabase/schema.sql`.
(Se já rodou uma versão antiga, rode antes `backend/supabase/migration_drop_old_tables.sql`.)

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

## Licença

MIT — veja [`LICENSE`](./LICENSE).
