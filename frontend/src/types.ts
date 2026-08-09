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
  /**
   * `true` quando este alerta está **salvo mas não dispara** — o dono está no
   * plano gratuito e já tem outro alerta ocupando a cota.
   *
   * ⚠️ **Quem decide é o backend, e tem de continuar sendo.** A conta parece
   * trivial de refazer aqui (o app já sabe se a assinatura está ativa e recebe
   * a lista ordenada), mas ela embute o limite do plano, a regra de quais
   * alertas sobrevivem e o desempate por `id`. Duas cópias disso divergem no
   * primeiro ajuste, e a tela passaria a marcar como parado um alerta que
   * dispara — trocando uma mentira por outra.
   *
   * Ausente = trate como ativo: resposta antiga de um backend não atualizado
   * não pode fazer a interface acusar alertas de mortos.
   */
  dormant?: boolean;
  tracked_series: {
    product: string;
    state: string;
    municipality: string;
    brand: string | null;
    label: string;
  } | null;
}

/**
 * Situação da assinatura, vinda de `GET /api/fuel/entitlement`.
 *
 * ⚠️ Isto é **para a interface**, não é o portão. O gate de verdade roda no
 * backend, no `POST /api/fuel/alerts` — esconder um botão nunca foi controle de
 * acesso. Aqui serve só para a pessoa saber o que ela tem.
 */
export interface Entitlement {
  active: boolean;
  plan: "mensal" | "anual" | null;
  expiresAt: string | null;
  daysLeft: number | null;
}

/**
 * Palavra exigida para confirmar a exclusão da conta.
 *
 * Mora aqui, e não no componente, porque o **backend** valida contra este texto
 * exato (`deleteAccountSchema`, com `z.literal`). São duas cópias da mesma
 * verdade em pacotes diferentes, e não há como o compilador ligar uma na outra
 * — o mínimo é que do lado do front exista **uma** cópia, referenciada tanto
 * pela tela que pede quanto pelo teste que confere.
 *
 * ⚠️ Ao mudar aqui, mude junto em `backend/src/schemas/requestSchemas.ts`.
 */
export const CONFIRMACAO_EXCLUSAO = "EXCLUIR MINHA CONTA";
