/**
 * Parser puro da Série Histórica de Preços de Combustíveis da ANP (SHPC — revenda).
 *
 * Recebe o CSV **já decodificado** como string (a decodificação de Latin-1/Windows-1252
 * para UTF-8 é responsabilidade da camada de download/ingestor — ver anpIngestor).
 *
 * Formato oficial (estável):
 *  - separador `;`
 *  - decimal com vírgula ("5,89")
 *  - data no formato dd/mm/aaaa
 *  - cabeçalho com 16 colunas; este parser é **dirigido pelo cabeçalho** (mapeia por
 *    nome de coluna, não por posição), então tolera reordenação/variações de acento.
 *
 * Cabeçalho de referência:
 *  Regiao - Sigla; Estado - Sigla; Municipio; Revenda; CNPJ da Revenda; Nome da Rua;
 *  Numero Rua; Complemento; Bairro; Cep; Produto; Data da Coleta; Valor de Venda;
 *  Valor de Compra; Unidade de Medida; Bandeira
 */

export interface FuelPriceRow {
  region: string;
  state: string;
  municipality: string;
  reseller: string;
  cnpj: string;
  product: string;
  /** Data da coleta em ISO (yyyy-mm-dd). */
  collectedAt: string;
  /** Preço de venda (R$). */
  sellPrice: number;
  /** Preço de compra (R$) — frequentemente ausente na revenda. */
  buyPrice: number | null;
  unit: string;
  brand: string;
  /** Endereço do posto (para localizar onde abastecer). Opcionais: nem toda linha traz. */
  street?: string;
  streetNumber?: string;
  neighborhood?: string;
  cep?: string;
}

/** "5,89" → 5.89 · "R$ 1.234,56" → 1234.56 · "" → null */
export function parseMoneyBR(text: string | undefined): number | null {
  if (text == null) return null;
  const t = text.trim();
  if (!t) return null;
  // Remove tudo que não é dígito, vírgula ou ponto; trata o separador de milhar.
  const cleaned = t.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  // No padrão BR a vírgula é decimal e o ponto é milhar → remove pontos, vírgula vira ponto.
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/** "01/07/2026" → "2026-07-01". Retorna null se inválida. */
export function parseDateBR(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Normaliza um cabeçalho para casar por nome (sem acento, minúsculo, espaços colapsados). */
function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Mapa: chave do nosso modelo → cabeçalho normalizado da ANP.
const COLUMN_MAP: Record<keyof FuelPriceRow, string> = {
  region: "regiao - sigla",
  state: "estado - sigla",
  municipality: "municipio",
  reseller: "revenda",
  cnpj: "cnpj da revenda",
  product: "produto",
  collectedAt: "data da coleta",
  sellPrice: "valor de venda",
  buyPrice: "valor de compra",
  unit: "unidade de medida",
  brand: "bandeira",
  street: "nome da rua",
  streetNumber: "numero rua",
  neighborhood: "bairro",
  cep: "cep"
};

/**
 * Faz o parse do CSV inteiro em linhas estruturadas.
 * Linhas malformadas ou sem preço/produto/data válidos são **descartadas** (não quebram o lote).
 */
export function parseAnpCsv(csv: string): FuelPriceRow[] {
  if (!csv) return [];

  // Remove BOM e normaliza quebras de linha.
  const clean = csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerCells = lines[0].split(";").map(normalizeHeader);

  // Índice de cada coluna do nosso modelo no cabeçalho real.
  const idx = {} as Record<keyof FuelPriceRow, number>;
  (Object.keys(COLUMN_MAP) as (keyof FuelPriceRow)[]).forEach((key) => {
    idx[key] = headerCells.indexOf(COLUMN_MAP[key]);
  });

  // Colunas mínimas para uma linha ser útil.
  if (idx.product < 0 || idx.sellPrice < 0 || idx.collectedAt < 0) {
    return [];
  }

  const rows: FuelPriceRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(";");
    const at = (col: keyof FuelPriceRow) => (idx[col] >= 0 ? cells[idx[col]]?.trim() ?? "" : "");

    const sellPrice = parseMoneyBR(at("sellPrice"));
    const collectedAt = parseDateBR(at("collectedAt"));
    const product = at("product");

    // Descarta linhas sem o essencial.
    if (sellPrice == null || collectedAt == null || !product) continue;

    rows.push({
      region: at("region"),
      state: at("state"),
      municipality: at("municipality"),
      reseller: at("reseller"),
      cnpj: at("cnpj"),
      product,
      collectedAt,
      sellPrice,
      buyPrice: parseMoneyBR(at("buyPrice")),
      unit: at("unit"),
      brand: at("brand"),
      street: at("street"),
      streetNumber: at("streetNumber"),
      neighborhood: at("neighborhood"),
      cep: at("cep")
    });
  }

  return rows;
}
