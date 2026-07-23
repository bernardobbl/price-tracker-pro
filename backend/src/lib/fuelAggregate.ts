/**
 * Agregação pura da série de preços de combustível (I1/I2).
 *
 * O `fuel_prices` guarda uma linha por posto/data. O produto que o usuário vê é
 * a **série do município**: para cada data de coleta, a média/mín/máx entre os
 * postos, mais o ranking de postos no levantamento mais recente ("onde está mais
 * barato"). Toda a agregação é feita aqui, sem I/O, para ser trivial de testar —
 * o `fuelQueryService` só busca as linhas e delega.
 */

export interface FuelPriceRecord {
  /** Data da coleta (yyyy-mm-dd). */
  collectedAt: string;
  sellPrice: number;
  reseller: string;
  brand: string | null;
  cnpj: string;
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
 * Agrupa por data de coleta e calcula média/mín/máx e o tamanho da amostra.
 * Retorna ordenado por data crescente (pronto para gráfico e estatísticas).
 */
export function aggregateDailySeries(records: FuelPriceRecord[]): DailyAggregate[] {
  const byDate = new Map<string, number[]>();
  for (const r of records) {
    if (!Number.isFinite(r.sellPrice)) continue;
    const arr = byDate.get(r.collectedAt);
    if (arr) arr.push(r.sellPrice);
    else byDate.set(r.collectedAt, [r.sellPrice]);
  }

  const out: DailyAggregate[] = [];
  for (const [date, prices] of byDate) {
    const sum = prices.reduce((a, b) => a + b, 0);
    out.push({
      date,
      avgPrice: round3(sum / prices.length),
      minPrice: round3(Math.min(...prices)),
      maxPrice: round3(Math.max(...prices)),
      sampleSize: prices.length,
    });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
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
