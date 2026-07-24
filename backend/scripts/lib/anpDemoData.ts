/**
 * Gerador da amostra de demonstração no layout SHPC da ANP (para o seed).
 *
 * Produz um CSV **no formato oficial** (separador `;`, decimal com vírgula, data
 * dd/mm/aaaa, mesmo cabeçalho) cobrindo várias semanas × cidades × produtos × postos,
 * com **endereço** de cada posto (bairro/rua/número/CEP) — para o app mostrar onde
 * abastecer. Fica separado do `seed.ts` para ser importável/testável sem disparar a ingestão.
 *
 * ⚠️ Os preços e endereços são gerados (variação semanal simulada em níveis realistas
 * de mercado, bairros reais de cada cidade) — é uma amostra de demo, não uma cópia do
 * arquivo oficial da ANP. A estrutura e o caminho de ETL (parse/normalize/dedup) são
 * idênticos aos de produção.
 */

/** Nº de levantamentos semanais (dá série temporal ao gráfico/tendência). */
export const WEEKS = 16;

/** Segunda-feira mais recente da amostra (contexto do projeto: 2026-07). */
const LATEST_MONDAY = new Date(Date.UTC(2026, 6, 20)); // 2026-07-20

export interface DemoCity {
  region: string;
  state: string;
  municipality: string;
  /** Multiplicador de nível de preço da praça. */
  factor: number;
  /** Bairros reais da cidade (localização dos postos). */
  neighborhoods: string[];
}

// Maiores cidades das UFs que já temos (SP, RJ, PR, RS, BA), com bairros reais.
export const CITIES: DemoCity[] = [
  { region: "SE", state: "SP", municipality: "SAO PAULO", factor: 1.0, neighborhoods: ["PINHEIROS", "MOEMA", "TATUAPE", "SANTANA", "LAPA", "ITAIM BIBI"] },
  { region: "SE", state: "SP", municipality: "GUARULHOS", factor: 0.99, neighborhoods: ["CENTRO", "VILA GALVAO", "MACEDO", "GOPOUVA"] },
  { region: "SE", state: "SP", municipality: "CAMPINAS", factor: 0.98, neighborhoods: ["CAMBUI", "BARAO GERALDO", "TAQUARAL", "CENTRO"] },
  { region: "SE", state: "RJ", municipality: "RIO DE JANEIRO", factor: 1.03, neighborhoods: ["COPACABANA", "TIJUCA", "BARRA DA TIJUCA", "BOTAFOGO", "MEIER"] },
  { region: "SE", state: "RJ", municipality: "NITEROI", factor: 1.02, neighborhoods: ["ICARAI", "CENTRO", "SAO FRANCISCO", "INGA"] },
  { region: "S", state: "PR", municipality: "CURITIBA", factor: 0.97, neighborhoods: ["BATEL", "AGUA VERDE", "PORTAO", "CENTRO", "SANTA FELICIDADE"] },
  { region: "S", state: "PR", municipality: "LONDRINA", factor: 0.96, neighborhoods: ["CENTRO", "GLEBA PALHANO", "JARDIM SHANGRILA"] },
  { region: "S", state: "RS", municipality: "PORTO ALEGRE", factor: 0.99, neighborhoods: ["MOINHOS DE VENTO", "CIDADE BAIXA", "PETROPOLIS", "CENTRO HISTORICO"] },
  { region: "S", state: "RS", municipality: "CAXIAS DO SUL", factor: 0.98, neighborhoods: ["CENTRO", "SAO PELEGRINO", "EXPOSICAO"] },
  { region: "NE", state: "BA", municipality: "SALVADOR", factor: 1.02, neighborhoods: ["BARRA", "PITUBA", "ONDINA", "ITAPUA", "RIO VERMELHO"] },
  { region: "NE", state: "BA", municipality: "FEIRA DE SANTANA", factor: 1.0, neighborhoods: ["CENTRO", "KALILANDIA", "TOMBA"] },
];

interface DemoProduct {
  name: string;
  base: number;
  unit: string;
}

const PRODUCTS: DemoProduct[] = [
  { name: "GASOLINA", base: 5.89, unit: "R$ / litro" },
  { name: "GASOLINA ADITIVADA", base: 6.09, unit: "R$ / litro" },
  { name: "ETANOL", base: 3.99, unit: "R$ / litro" },
  { name: "DIESEL S10", base: 6.19, unit: "R$ / litro" },
  { name: "DIESEL", base: 5.99, unit: "R$ / litro" },
];

// Pool de 5 bandeiras + 8 postos por cidade → bandeiras se repetem (realista:
// vários postos da mesma bandeira, com preços diferentes).
const BRANDS = ["VIBRA", "SHELL", "IPIRANGA", "RAIZEN", "BRANCA"];
const STREETS = [
  "AV BRASIL",
  "RUA XV DE NOVEMBRO",
  "AV GETULIO VARGAS",
  "RUA DAS FLORES",
  "AV SETE DE SETEMBRO",
  "RUA DO COMERCIO",
  "AV JUSCELINO KUBITSCHEK",
  "RUA MARECHAL DEODORO",
];
const RESELLERS_PER_CITY = 8;

// Prefixo de CEP por UF (1º–2º dígitos das faixas reais dos Correios).
const CEP_PREFIX: Record<string, string> = { SP: "01", RJ: "22", PR: "80", RS: "90", BA: "40" };

/** RNG determinístico (mulberry32) → amostra reproduzível a cada execução. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateBR(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function money(n: number): string {
  return n.toFixed(3).replace(".", ",");
}

/** Fator de tendência da semana: leve queda no período + ondulação suave. */
function weekTrend(weekIndex: number): number {
  const t = weekIndex / (WEEKS - 1); // 0 (mais antigo) → 1 (mais recente)
  const decline = 1.03 - 0.045 * t; // ~ -4,5% no período
  const wiggle = 0.012 * Math.sin(t * Math.PI * 2.2);
  return decline + wiggle;
}

interface DemoReseller {
  name: string;
  cnpj: string;
  brand: string;
  offset: number; // desvio persistente de preço (ranking estável)
  products: DemoProduct[];
  // Endereço (constante ao longo das semanas).
  street: string;
  streetNumber: string;
  neighborhood: string;
  cep: string;
}

function buildResellers(cityIdx: number, rng: () => number): DemoReseller[] {
  const city = CITIES[cityIdx];
  const list: DemoReseller[] = [];
  for (let r = 0; r < RESELLERS_PER_CITY; r++) {
    const digits = String((cityIdx + 11) * 1_000_000 + r).padStart(14, "0");
    const letter = String.fromCharCode(65 + r); // A, B, C...
    const neighborhood = city.neighborhoods[r % city.neighborhoods.length];
    const bairroWord = neighborhood.split(" ")[0];
    // Todos vendem gasolina + etanol; a variação de produtos enriquece o ranking.
    const products = [PRODUCTS[0], PRODUCTS[2]];
    if (r % 2 === 0) products.push(PRODUCTS[1], PRODUCTS[3]);
    else products.push(PRODUCTS[4]);
    list.push({
      name: `AUTO POSTO ${bairroWord} ${letter} LTDA`,
      cnpj: digits,
      brand: BRANDS[r % BRANDS.length], // repete a cada 5 → várias da mesma bandeira
      offset: (rng() - 0.4) * 0.3, // ~ -0,12 a +0,18
      products,
      street: STREETS[(r + cityIdx) % STREETS.length],
      streetNumber: String(100 + ((r * 137 + cityIdx * 53) % 3900)),
      neighborhood,
      cep: `${CEP_PREFIX[city.state] ?? "01"}${String((cityIdx * 100 + r * 13) % 1000).padStart(3, "0")}-${String((r * 137 + 100) % 1000).padStart(3, "0")}`,
    });
  }
  return list;
}

export const ANP_HEADER =
  "Região - Sigla;Estado - Sigla;Município;Revenda;CNPJ da Revenda;Nome da Rua;" +
  "Número Rua;Complemento;Bairro;Cep;Produto;Data da Coleta;Valor de Venda;" +
  "Valor de Compra;Unidade de Medida;Bandeira";

/** Monta o CSV completo da amostra no layout SHPC da ANP. */
export function buildAnpCsv(): string {
  const rng = makeRng(20260720);
  const lines: string[] = [ANP_HEADER];

  for (let c = 0; c < CITIES.length; c++) {
    const city = CITIES[c];
    const resellers = buildResellers(c, rng);

    for (let w = 0; w < WEEKS; w++) {
      const d = new Date(LATEST_MONDAY);
      d.setUTCDate(d.getUTCDate() - (WEEKS - 1 - w) * 7);
      const trend = weekTrend(w);

      for (const reseller of resellers) {
        for (const product of reseller.products) {
          const noise = (rng() - 0.5) * 0.04; // ±0,02
          const price = product.base * city.factor * trend + reseller.offset + noise;
          const sell = Math.max(0.5, Math.round(price * 1000) / 1000);

          lines.push(
            [
              city.region,
              city.state,
              city.municipality,
              reseller.name,
              reseller.cnpj,
              reseller.street,
              reseller.streetNumber,
              "", // complemento
              reseller.neighborhood,
              reseller.cep,
              product.name,
              dateBR(d),
              money(sell),
              "", // valor de compra (revenda: ausente)
              product.unit,
              reseller.brand,
            ].join(";")
          );
        }
      }
    }
  }

  return lines.join("\n");
}
