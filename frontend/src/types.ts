/**
 * Ponto de preço genérico consumido pelas libs de inteligência
 * (`priceStats`, `priceInsights`, `dealSignal`) e pelo `PriceChart`.
 * No domínio combustível, cada ponto é a **média diária do município**
 * (ver `lib/seriesToHistory`).
 */
export interface PriceHistoryItem {
  date: string;
  fullPrice: number;
  discountedPrice: number;
  currency: string;
  title: string;
  url: string;
}

// ── Domínio combustível (ANP) ───────────────────────────────────────────────

/** Ponto da série agregada por data (saída de `GET /api/fuel/series`). */
export interface FuelSeriesPoint {
  date: string;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  /** Nº de postos que compuseram a média naquela data. */
  sampleSize: number;
}

/** Cotação de um posto no levantamento mais recente. */
export interface ResellerQuote {
  reseller: string;
  brand: string | null;
  cnpj: string;
  sellPrice: number;
  /** Endereço do posto (para localizar onde abastecer). */
  street?: string | null;
  streetNumber?: string | null;
  neighborhood?: string | null;
  cep?: string | null;
}

/** Snapshot do levantamento mais recente + ranking de postos (`GET /api/fuel/snapshot`). */
export interface SnapshotSummary {
  date: string | null;
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  sampleSize: number;
  quotes: ResellerQuote[];
}

/** Favorito do usuário: produto + UF + município (+ bandeira opcional). */
export interface TrackedSeries {
  id: string;
  product: string;
  state: string;
  municipality: string;
  brand: string | null;
  label: string;
  created_at?: string;
}

/** "Recorte" de série que o painel de detalhe exibe (favorito ou exploração ad-hoc). */
export interface SeriesView {
  product: string;
  state: string;
  municipality: string;
  brand: string | null;
  label: string;
}

/** Alerta por série (join com `tracked_series`, vindo de `GET /api/fuel/alerts`). */
export interface FuelAlert {
  id: string;
  series_id: string;
  threshold_price: number;
  currency: string;
  enabled: boolean;
  triggered: boolean;
  created_at?: string;
  tracked_series: {
    product: string;
    state: string;
    municipality: string;
    brand: string | null;
    label: string;
  } | null;
}
