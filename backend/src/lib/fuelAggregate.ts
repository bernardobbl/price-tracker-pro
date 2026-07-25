/**
 * Lógica pura do snapshot de preços de combustível (I2).
 *
 * O `fuel_prices` guarda uma linha por posto/data. A **série diária** (média/mín/máx
 * por data) é agregada **no Postgres** (RPC `fuel_daily_series`) — o PostgREST corta
 * respostas em 1000 linhas, então agregar no cliente truncaria o histórico conforme
 * ele cresce. O que continua aqui, puro e testável, é o resumo do levantamento mais
 * recente ("onde está mais barato"): ranking de postos com dedup por CNPJ, sobre as
 * poucas linhas que a RPC `fuel_latest_snapshot` devolve.
 */

export interface FuelPriceRecord {
  /** Data da coleta (yyyy-mm-dd). */
  collectedAt: string;
  sellPrice: number;
  reseller: string;
  brand: string | null;
  cnpj: string;
  /** Endereço do posto (para localizar). Opcionais. */
  street?: string | null;
  streetNumber?: string | null;
  neighborhood?: string | null;
  cep?: string | null;
}

export interface DailyAggregate {
  date: string;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  /** Nº de postos que compuseram a média naquela data. */
  sampleSize: number;
}

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

export interface SnapshotSummary {
  /** Data do levantamento mais recente disponível (ou null se vazio). */
  date: string | null;
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  sampleSize: number;
  /** Postos do levantamento mais recente, ordenados do mais barato ao mais caro. */
  quotes: ResellerQuote[];
}

/** Arredonda para 3 casas (preços de combustível têm 3 decimais). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Resume o levantamento **mais recente**: média/mín/máx do dia mais novo e o
 * ranking de postos (do mais barato ao mais caro). Duplicatas por CNPJ são
 * colapsadas mantendo o menor preço do posto naquele dia.
 */
export function summarizeSnapshot(records: FuelPriceRecord[]): SnapshotSummary {
  const empty: SnapshotSummary = {
    date: null,
    avgPrice: null,
    minPrice: null,
    maxPrice: null,
    sampleSize: 0,
    quotes: [],
  };
  if (records.length === 0) return empty;

  // Data mais recente presente nos registros.
  let latest = records[0].collectedAt;
  for (const r of records) {
    if (r.collectedAt > latest) latest = r.collectedAt;
  }

  // Um preço por posto (CNPJ) no dia mais recente — mantém o menor.
  const byCnpj = new Map<string, ResellerQuote>();
  for (const r of records) {
    if (r.collectedAt !== latest || !Number.isFinite(r.sellPrice)) continue;
    const existing = byCnpj.get(r.cnpj);
    if (!existing || r.sellPrice < existing.sellPrice) {
      byCnpj.set(r.cnpj, {
        reseller: r.reseller,
        brand: r.brand,
        cnpj: r.cnpj,
        sellPrice: r.sellPrice,
        street: r.street ?? null,
        streetNumber: r.streetNumber ?? null,
        neighborhood: r.neighborhood ?? null,
        cep: r.cep ?? null,
      });
    }
  }

  const quotes = [...byCnpj.values()].sort((a, b) => a.sellPrice - b.sellPrice);
  if (quotes.length === 0) return { ...empty, date: latest };

  const prices = quotes.map((q) => q.sellPrice);
  const sum = prices.reduce((a, b) => a + b, 0);

  return {
    date: latest,
    avgPrice: round3(sum / prices.length),
    minPrice: round3(Math.min(...prices)),
    maxPrice: round3(Math.max(...prices)),
    sampleSize: quotes.length,
    quotes,
  };
}
