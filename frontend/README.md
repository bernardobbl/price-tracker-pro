## Frontend - Price Tracker Pro

Dashboard em React + Vite + TypeScript consumindo o backend e exibindo gráfico de evolução de preço com Chart.js.

### Tecnologias

- React + TypeScript
- Vite
- Chart.js + react-chartjs-2

### Instalação

```bash
cd frontend
npm install
cp .env.example .env
```

No `.env`, ajuste se necessário:

- `VITE_API_BASE_URL` — URL do backend (padrão: `http://localhost:4000`)

### Rodar em desenvolvimento

```bash
cd frontend
npm run dev
```

Por padrão o Vite sobe em `http://localhost:5173`.

### Fluxo

1. O backend expõe `GET /api/prices/:productId`, que retorna o histórico de preços.
2. O frontend chama esse endpoint (por padrão `productId = "ps5"`).
3. A tela mostra:
   - Último preço conhecido + link para o anúncio.
   - Gráfico de linha da evolução do preço ao longo do tempo.

Você pode trocar o `productId` pelo mesmo ID que configurou no backend (`PRODUCTS_TO_TRACK`).

