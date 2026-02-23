## Price Tracker Pro

Sistema de rastreamento de preços (ex: Mercado Livre) com:
- Backend em Node.js + TypeScript
- Web scraping com Axios + Cheerio
- Agendamento automático com `node-cron`
- Persistência em Supabase + CSV local
- Dashboard em React + Chart.js

### Estrutura do projeto

- `backend/`: API, scraping, cron e integração com Supabase/CSV
- `frontend/`: Dashboard em React consumindo a API

### Pré-requisitos

- Node.js LTS instalado
- Conta Supabase (URL do projeto e chave anon pública)

### Passos gerais

1. Instalar dependências do backend e frontend
2. Configurar variáveis de ambiente (Supabase, porta, etc.)
3. Rodar o backend (API + cron)
4. Rodar o frontend (dashboard)

Os detalhes de configuração e execução estarão documentados em `backend/README.md` e `frontend/README.md`.

