## Backend - Price Tracker Pro

### Tecnologias

- Node.js + TypeScript
- Express (API REST)
- Axios + Cheerio (web scraping Mercado Livre)
- node-cron (agendamento diário)
- Supabase (persistência remota opcional)
- CSV local (persistência simples)

### Instalação

```bash
cd backend
npm install
cp .env.example .env
```

Edite o arquivo `.env` com:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Opcionalmente ajuste a `PORT`.

### Rodar em desenvolvimento

```bash
cd backend
npm run dev
```

### Endpoints principais

- `GET /health` — checagem simples
- `GET /api/prices/:productId` — retorna histórico de preços do produto (CSV e/ou Supabase)

### Job diário

O arquivo `src/jobs/scheduleDailyPriceJob.ts` agenda um job diário às 09:00 que:
- Faz scraping do Mercado Livre para cada produto em `PRODUCTS_TO_TRACK`
- Salva o registro do dia em:
  - CSV local em `backend/data/prices_<productId>.csv`
  - Tabela `prices` no Supabase (se configurado)

Você pode alterar/expandir a lista de produtos em `PRODUCTS_TO_TRACK`.

