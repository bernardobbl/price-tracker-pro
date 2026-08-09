import type {
  Entitlement,
  FuelAlert,
  FuelSeriesPoint,
  SnapshotSummary,
  TrackedSeries,
} from "../types";
import { supabase } from "../supabaseClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

// ── Resiliência a cold start ────────────────────────────────────────────────
// No free tier (Render/Railway) o backend hiberna após ~15 min parado e a 1ª
// requisição precisa acordá-lo — o que leva de 30 a 60 s. Sem tratamento, o
// visitante vê um spinner infinito ou um erro genérico logo na primeira visita.
//
// Três defesas, todas nesta camada (os componentes não mudam de contrato):
//   1. timeout explícito — melhor um erro claro do que esperar para sempre;
//   2. retry só em leitura (GET), porque repetir POST/DELETE poderia duplicar
//      favorito ou alerta — nunca repetimos o que escreve;
//   3. aviso de "acordando" para a UI quando a requisição passa do normal.

const REQUEST_TIMEOUT_MS = 45_000; // acomoda o cold start sem travar indefinidamente
const SLOW_REQUEST_MS = 3_500; // a partir daqui avisamos a UI
const MAX_GET_ATTEMPTS = 2;

type WakingListener = (waking: boolean) => void;

const wakingListeners = new Set<WakingListener>();
let slowRequestsInFlight = 0;

/**
 * Assina o aviso de "requisição demorada" (provável cold start do backend).
 * Devolve a função de cancelamento — use no cleanup do `useEffect`.
 */
export function onApiWaking(listener: WakingListener): () => void {
  wakingListeners.add(listener);
  return () => {
    wakingListeners.delete(listener);
  };
}

function emitWaking(waking: boolean): void {
  wakingListeners.forEach((listener) => listener(waking));
}

function markSlowStart(): void {
  slowRequestsInFlight += 1;
  if (slowRequestsInFlight === 1) emitWaking(true);
}

function markSlowEnd(wasSlow: boolean): void {
  if (!wasSlow) return;
  slowRequestsInFlight = Math.max(0, slowRequestsInFlight - 1);
  if (slowRequestsInFlight === 0) emitWaking(false);
}

/** Só para os testes: zera o estado global entre casos. */
export function __resetApiWakingState(): void {
  wakingListeners.clear();
  slowRequestsInFlight = 0;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `fetch` com timeout por AbortController + sinalização de lentidão. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let wasSlow = false;
  const slowId = setTimeout(() => {
    wasSlow = true;
    markSlowStart();
  }, SLOW_REQUEST_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    clearTimeout(slowId);
    markSlowEnd(wasSlow);
  }
}

/**
 * Cliente HTTP interno. Leituras (GET) são repetidas uma vez em falha de rede ou
 * timeout — o caso típico do backend acordando. Escritas nunca são repetidas.
 */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? MAX_GET_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchWithTimeout(`${API_BASE_URL}${path}`, init);
    } catch {
      // Rede caiu, DNS falhou ou estourou o timeout: só a última tentativa vira erro.
      if (attempt === attempts) {
        throw new Error(
          "Não consegui falar com o servidor. Ele pode estar iniciando — tente novamente em alguns segundos."
        );
      }
      await delay(1_500);
    }
  }

  // Inalcançável (o laço sempre retorna ou lança), mas o TS exige o retorno.
  throw new Error("Não consegui falar com o servidor.");
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!supabase) {
    return {};
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return {};
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
  };
}

/**
 * Extrai a mensagem de erro do corpo da resposta.
 * Suporta o formato padrão `{ error: { code, message } }`.
 */
async function extractError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  const err = body?.error;
  if (err && typeof err === "object" && typeof err.message === "string") return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

/**
 * Erro da API que carrega o **código** junto da mensagem.
 *
 * A mensagem serve para ler; o código serve para decidir. Sem ele, a única
 * forma de a interface reagir a um caso específico — como a cota de alertas
 * estourada — seria procurar palavras dentro do texto, que quebra no dia em que
 * alguém melhorar a redação.
 */
export class ApiError extends Error {
  code: string | null;
  status: number;

  constructor(message: string, code: string | null, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function toApiError(response: Response, fallback: string): Promise<ApiError> {
  const body = await response.clone().json().catch(() => null);
  const code = typeof body?.error?.code === "string" ? body.error.code : null;
  return new ApiError(await extractError(response, fallback), code, response.status);
}

// ── Consulta pública (dados da ANP) ─────────────────────────────────────────

/** Produtos canônicos disponíveis (gasolina, etanol, diesel…). */
export async function fetchFuelProducts(): Promise<string[]> {
  const response = await apiFetch("/api/fuel/products");
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar produtos"));
  }
  return response.json();
}

/** UFs que têm dados. */
export async function fetchStates(): Promise<string[]> {
  const response = await apiFetch("/api/fuel/locations");
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar estados"));
  }
  const body = (await response.json()) as { states?: string[] };
  return body.states ?? [];
}

/** Municípios com dados numa UF. */
export async function fetchMunicipalities(state: string): Promise<string[]> {
  const response = await apiFetch(
    `/api/fuel/locations?state=${encodeURIComponent(state)}`
  );
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar municípios"));
  }
  const body = (await response.json()) as { municipalities?: string[] };
  return body.municipalities ?? [];
}

export interface SeriesQuery {
  product: string;
  state: string;
  municipality: string;
  brand?: string | null;
}

function seriesQueryString({ product, state, municipality, brand }: SeriesQuery): string {
  const params = new URLSearchParams({ product, state, municipality });
  if (brand) params.set("brand", brand);
  return params.toString();
}

/** Série temporal agregada (média/mín/máx por data). */
export async function fetchSeries(query: SeriesQuery): Promise<FuelSeriesPoint[]> {
  const response = await apiFetch(`/api/fuel/series?${seriesQueryString(query)}`);
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar a série de preços"));
  }
  return response.json();
}

/** Levantamento mais recente + ranking de postos ("onde está mais barato"). */
export async function fetchSnapshot(query: SeriesQuery): Promise<SnapshotSummary> {
  const response = await apiFetch(`/api/fuel/snapshot?${seriesQueryString(query)}`);
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar o levantamento mais recente"));
  }
  return response.json();
}

// ── Favoritos (tracked_series) ──────────────────────────────────────────────

export async function fetchTrackedSeries(): Promise<TrackedSeries[]> {
  const headers = await getAuthHeaders();
  const response = await apiFetch("/api/fuel/tracked", { headers });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar favoritos"));
  }
  return response.json();
}

export interface CreateTrackedSeriesPayload {
  product: string;
  state: string;
  municipality: string;
  brand?: string | null;
  label?: string;
}

export async function createTrackedSeries(
  payload: CreateTrackedSeriesPayload
): Promise<TrackedSeries> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) {
    throw new Error("Faça login para salvar favoritos.");
  }
  const response = await apiFetch("/api/fuel/tracked", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao salvar favorito"));
  }
  return response.json();
}

export async function deleteTrackedSeries(id: string): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await apiFetch(`/api/fuel/tracked/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
  });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao excluir favorito"));
  }
}

// ── Alertas por série ───────────────────────────────────────────────────────

export async function fetchFuelAlerts(): Promise<FuelAlert[]> {
  const headers = await getAuthHeaders();
  const response = await apiFetch("/api/fuel/alerts", { headers });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar alertas"));
  }
  return response.json();
}

export interface CreateFuelAlertPayload {
  seriesId: string;
  thresholdPrice: number;
  currency?: string;
  channel?: "email";
  enabled?: boolean;
}

export async function createFuelAlert(payload: CreateFuelAlertPayload): Promise<FuelAlert> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  const response = await apiFetch("/api/fuel/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // `ApiError` e não `Error`: a cota do plano gratuito (402
    // `ALERT_QUOTA_EXCEEDED`) precisa virar um convite na tela, não só um texto
    // vermelho — e a interface só consegue distinguir esse caso pelo código.
    throw await toApiError(response, "Erro ao salvar alerta");
  }
  return response.json();
}

export async function deleteFuelAlert(alertId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await apiFetch(`/api/fuel/alerts/${encodeURIComponent(alertId)}`, {
    method: "DELETE",
    headers,
  });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao excluir alerta"));
  }
}

// ── Assinatura ──────────────────────────────────────────────────────────────

/**
 * Situação do plano do usuário.
 *
 * Sem sessão devolve `null` em vez de erro: visitante não logado não tem
 * assinatura, e isso é estado normal, não falha. Erro de rede também vira
 * `null` — a situação do plano é informação secundária e não pode derrubar o
 * dashboard de quem só quer ver preço.
 */
export async function fetchEntitlement(): Promise<Entitlement | null> {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) return null;

  try {
    const response = await apiFetch("/api/fuel/entitlement", { headers });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// ── Direitos do titular (LGPD art. 18) ──────────────────────────────────────
//
// A Política de Privacidade promete, por escrito, "receber uma cópia dos seus
// dados em formato legível" e "apagar seus dados e encerrar a conta". As rotas
// existiam e **nenhuma tela chamava** — na prática, a promessa dependia de
// alguém escrever um e-mail e outro alguém rodar um comando. Estas duas funções
// são o que fecha a distância entre o texto publicado e o produto.

/**
 * Baixa a cópia dos dados do usuário como arquivo JSON.
 *
 * Devolve o nome do arquivo salvo. O download é feito aqui, e não no
 * componente, por um motivo prático: a resposta exige o header `Authorization`,
 * então não dá para simplesmente apontar um `<a href>` para a rota — o
 * navegador não mandaria o token. É preciso buscar, virar `blob` e disparar o
 * clique num link temporário.
 */
export async function downloadAccountData(): Promise<string> {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) {
    throw new Error("Sessão expirada. Entre de novo para exportar seus dados.");
  }

  const response = await apiFetch("/api/account/export", { headers });
  if (!response.ok) {
    throw await toApiError(response, "Não consegui gerar a cópia dos seus dados");
  }

  const blob = await response.blob();
  const nome = `price-tracker-pro-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // ⚠️ O revoke é ADIADO de propósito. Sem o revoke, o blob fica preso na
  // memória da aba até ela fechar; revogando na linha seguinte ao `click()`, a
  // URL pode morrer antes de o navegador ter começado a ler o arquivo — e o
  // download é cancelado sem erro, sem log e sem nada na tela. O sintoma é o
  // pior possível para esta função em particular: a pessoa clica em "baixar meus
  // dados" (um direito da LGPD que a Política de Privacidade promete por
  // escrito), a tela diz que deu certo, e nenhum arquivo aparece.
  //
  // O atraso não trava nada: o `setTimeout` roda depois desta função retornar.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  return nome;
}

export interface DeleteAccountResult {
  assinaturasAnonimizadas: number;
  cobrancasAnonimizadas: number;
  tinhaAssinaturaAtiva: boolean;
  /**
   * Códigos das cobranças que ficaram anônimas.
   *
   * ⚠️ **Precisam chegar aos olhos da pessoa antes de a tela virar.** Depois da
   * exclusão, `user_id` é `null` e não existe mais busca por pessoa que alcance
   * aquele pagamento: estes códigos são a única forma de identificá-lo num
   * pedido de reembolso.
   */
  cobrancasParaReembolso: string[];
  mensagem: string;
}

/**
 * Exclui a conta do usuário logado.
 *
 * A palavra de confirmação é exigida pelo backend, não inventada aqui — o
 * schema recusa qualquer corpo que não traga exatamente `EXCLUIR MINHA CONTA`.
 * Repetir a constante no cliente seria criar uma segunda fonte da verdade para
 * um texto que, se divergir, quebra a operação inteira; por isso ela vem do
 * `types.ts`, num lugar só.
 */
export async function deleteAccount(confirm: string): Promise<DeleteAccountResult> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) {
    throw new Error("Sessão expirada. Entre de novo para excluir a conta.");
  }

  const response = await apiFetch("/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ confirm }),
  });

  if (!response.ok) {
    throw await toApiError(response, "Não consegui excluir a conta agora");
  }

  return response.json();
}
