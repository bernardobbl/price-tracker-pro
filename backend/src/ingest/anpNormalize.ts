/**
 * Normalização e deduplicação das linhas da ANP (etapa pura do ETL, entre o
 * parser e a persistência). Sem I/O — recebe `FuelPriceRow[]` e devolve linhas
 * limpas e sem duplicatas, além de estatísticas de rejeição (para observabilidade).
 *
 * Por que existe: o CSV bruto tem variações históricas de rótulo de produto,
 * CNPJ formatado de formas diferentes, espaçamento inconsistente e, ocasionalmente,
 * valores absurdos (erro de digitação/coleta). Padronizar aqui deixa a chave
 * natural (cnpj+produto+data) estável e o upsert idempotente confiável.
 */

import type { FuelPriceRow } from "./anpParser";

/** Linha já normalizada, pronta para persistir. */
export interface NormalizedFuelRow extends FuelPriceRow {
  /** CNPJ só com dígitos (14 chars quando válido) — chave natural estável. */
  cnpj: string;
  /** Produto canônico (ver `canonicalProduct`). */
  product: string;
  /** Bandeira normalizada; string vazia/ausente vira null. */
  brand: string;
}

export interface NormalizeStats {
  /** Linhas recebidas. */
  read: number;
  /** Linhas mantidas após normalização (antes do dedup). */
  kept: number;
  /** Total rejeitado. */
  rejected: number;
  /** Rejeições por motivo (para o log/observabilidade). */
  rejectedReasons: Record<string, number>;
}

export interface NormalizeResult {
  rows: NormalizedFuelRow[];
  stats: NormalizeStats;
}

/**
 * Faixa plausível para o valor de venda. É intencionalmente ampla porque a
 * unidade varia: combustível por litro (~R$ 3–8) e GLP por botijão de 13 kg
 * (~R$ 80–180). O objetivo é só descartar lixo óbvio (0, negativo, ou valores
 * ordens de grandeza acima — ex.: vírgula decimal perdida virando 5890).
 */
const MIN_SELL_PRICE = 0.1;
const MAX_SELL_PRICE = 1000;

/** Colapsa espaços e remove acentos para casar rótulos de produto de forma robusta. */
function foldProduct(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Mapeia variações históricas de rótulo da ANP para um produto canônico estável.
 * A ANP mudou nomes ao longo dos anos (ex.: "GASOLINA COMUM" → "GASOLINA",
 * "GAS NATURAL VEICULAR" → "GNV"). Padronizar mantém a série temporal contínua.
 */
export function canonicalProduct(raw: string | undefined): string {
  const p = foldProduct(raw ?? "");
  if (!p) return "";

  // Aliases explícitos (chave já "folded": sem acento, upper, espaços colapsados).
  const ALIASES: Record<string, string> = {
    "GASOLINA COMUM": "GASOLINA",
    "GASOLINA C": "GASOLINA",
    "GASOLINA ADITIVADA C": "GASOLINA ADITIVADA",
    "ETANOL HIDRATADO": "ETANOL",
    "ALCOOL": "ETANOL",
    "GAS NATURAL VEICULAR": "GNV",
    "GNV - GAS NATURAL VEICULAR": "GNV",
    "OLEO DIESEL": "DIESEL",
    "OLEO DIESEL S10": "DIESEL S10",
    "DIESEL S-10": "DIESEL S10",
    "OLEO DIESEL S500": "DIESEL S500",
    "DIESEL S-500": "DIESEL S500",
    "GLP P13": "GLP",
    "GAS LIQUEFEITO DE PETROLEO (GLP)": "GLP",
    "GLP (P13)": "GLP",
  };

  return ALIASES[p] ?? p;
}

/** CNPJ só com dígitos (remove pontos, barras e hífens). */
export function normalizeCnpj(raw: string | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/** Trim + colapsa espaços internos + uppercase (para UF, município, bandeira, revenda). */
function cleanUpper(raw: string | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

function bump(reasons: Record<string, number>, key: string) {
  reasons[key] = (reasons[key] ?? 0) + 1;
}

/**
 * Normaliza um lote de linhas do parser. Descarta linhas inválidas (sem produto
 * canônico, sem UF/município, ou com preço fora da faixa plausível) e contabiliza
 * o motivo de cada rejeição.
 */
export function normalizeFuelRows(rows: FuelPriceRow[]): NormalizeResult {
  const out: NormalizedFuelRow[] = [];
  const reasons: Record<string, number> = {};

  for (const row of rows) {
    const product = canonicalProduct(row.product);
    const state = cleanUpper(row.state);
    const municipality = cleanUpper(row.municipality);

    if (!product) {
      bump(reasons, "produto_invalido");
      continue;
    }
    if (!state || !municipality) {
      bump(reasons, "local_incompleto");
      continue;
    }
    if (
      !Number.isFinite(row.sellPrice) ||
      row.sellPrice < MIN_SELL_PRICE ||
      row.sellPrice > MAX_SELL_PRICE
    ) {
      bump(reasons, "preco_fora_da_faixa");
      continue;
    }

    const brand = cleanUpper(row.brand);
    const buyPrice =
      row.buyPrice != null && Number.isFinite(row.buyPrice) && row.buyPrice > 0
        ? row.buyPrice
        : null;

    out.push({
      region: cleanUpper(row.region),
      state,
      municipality,
      reseller: (row.reseller ?? "").replace(/\s+/g, " ").trim(),
      cnpj: normalizeCnpj(row.cnpj),
      product,
      collectedAt: row.collectedAt,
      sellPrice: row.sellPrice,
      buyPrice,
      unit: (row.unit ?? "").replace(/\s+/g, " ").trim(),
      brand,
    });
  }

  return {
    rows: out,
    stats: {
      read: rows.length,
      kept: out.length,
      rejected: rows.length - out.length,
      rejectedReasons: reasons,
    },
  };
}

/** Chave natural de uma linha: mesmo posto + produto + data de coleta. */
export function naturalKey(row: Pick<NormalizedFuelRow, "cnpj" | "product" | "collectedAt">): string {
  return `${row.cnpj}|${row.product}|${row.collectedAt}`;
}

export interface DedupeResult {
  rows: NormalizedFuelRow[];
  /** Quantas linhas foram colapsadas (duplicatas removidas). */
  removed: number;
}

/**
 * Remove duplicatas pela chave natural (cnpj+produto+data). Se a mesma chave
 * aparece mais de uma vez no arquivo, **a última vence** (determinístico).
 * Isso torna o upsert idempotente mesmo com repetições dentro do próprio CSV.
 */
export function dedupeFuelRows(rows: NormalizedFuelRow[]): DedupeResult {
  const byKey = new Map<string, NormalizedFuelRow>();
  for (const row of rows) {
    byKey.set(naturalKey(row), row);
  }
  return { rows: [...byKey.values()], removed: rows.length - byKey.size };
}
