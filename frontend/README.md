# Frontend — Price Tracker Pro

Dashboard em React + Vite + TypeScript sobre a API de preços de combustível:
consulta pública por combustível/município, camada de inteligência de preço
(sinal de compra, tendência, volatilidade), ranking de postos e alertas por email.

> Documentação geral do projeto (arquitetura, decisões, demo) no
> [README raiz](../README.md).

## Tecnologias

- React + TypeScript (`strict`) · Vite
- Chart.js + react-chartjs-2 (gráfico de evolução)
- Supabase JS (apenas Auth — os dados vêm da API)
- Vitest + Testing Library

Sem biblioteca de UI e sem framework de CSS: a identidade visual (tema claro
editorial, Fraunces + Inter) vive em `src/index.css` com tokens em `:root`, e os
ícones são SVGs inline em `components/Icon.tsx`.

## Instalação

```bash
cd frontend
npm install
cp .env.example .env
```

Variáveis:

- `VITE_API_BASE_URL` — URL do backend (padrão `http://localhost:4000`)
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — Auth (a chave publishable é
  pública por natureza: vai no bundle)
- `VITE_DEMO_MODE` — `true` exibe o selo "dados de demonstração" (use quando o
  banco estiver populado pelo `seed`, e não pelo arquivo real da ANP)

## Rodar

```bash
npm run dev          # http://localhost:5173
npm test             # Vitest
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
npm run build        # bundle de produção em dist/
```

Precisa do backend no ar e com dados ingeridos (`npm run ingest` lá) — sem isso a
tela abre sem séries.

## Fluxo da interface

1. **Consulta é pública** (padrão Keepa/CamelCamelCamel): combustível → UF →
   município na sidebar. Sem escolha nenhuma, o app auto-carrega uma série padrão
   para o visitante ver o produto funcionando em ~2s.
2. O painel de detalhe mostra **preço-herói** (média do levantamento mais
   recente), **sinal de compra** 0–100, barra de posição menor↔maior, cards de
   estatística, filtro de período (30d/90d/6m/tudo), gráfico e o ranking **"onde
   está mais barato"** com link para o Google Maps.
3. **Favoritar** e **criar alerta** exigem conta — a tela de login só aparece
   quando o usuário pede ou quando a ação exige.
4. A URL carrega a série: `/?produto=GASOLINA&uf=SP&municipio=SAO%20PAULO`. É
   assim que o link do email de alerta abre exatamente a série do alerta, e o que
   torna qualquer consulta compartilhável.

## Estrutura

```
src/
  App.tsx          # orquestrador fino (~200 linhas)
  components/      # AuthPage · Sidebar · DetailPanel · PriceChart · Toast · Icon
  hooks/           # useAuth · useFuelSeries · useFavorites · useAlerts · useToasts…
  lib/             # funções puras: priceStats, dealSignal, priceInsights,
                   # alertThreshold, authErrors, seriesFromUrl, format…
  api/client.ts    # única camada de acesso à API (nenhum fetch cru nos componentes)
  types.ts
```

Toda a lógica de decisão é **pura e testada** em `lib/`; os componentes só
renderizam.

## Resiliência a cold start

O backend roda em free tier e hiberna após ~15 min parado, então a primeira
requisição pode levar até um minuto. O `api/client.ts` trata isso em um lugar só:
timeout explícito, **retry apenas em GET** (repetir POST/DELETE duplicaria
favorito ou alerta) e um sinal de "requisição lenta" que a UI consome via
`useApiWaking` para mostrar a faixa "Acordando o servidor…".

## Deploy

Vercel, com **Root Directory = `frontend`** (o repositório é multi-serviço; sem
isso a Vercel tenta publicar o backend junto). A configuração de build, o rewrite
de SPA e o cache dos assets estão em `vercel.json`.
