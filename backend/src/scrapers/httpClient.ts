import axios from "axios";

/** Extrai uma descrição legível do erro do axios (status HTTP quando houver). */
function describeAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.response) return `HTTP ${err.response.status} ${err.response.statusText ?? ""}`.trim();
    if (err.code) return err.code; // ex.: ECONNABORTED (timeout), ENOTFOUND, ECONNREFUSED
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Erro estruturado de scraping — permite ao chamador distinguir o tipo de falha
 * (ex.: rede vs. preço não encontrado) e responder com o status HTTP adequado.
 */
export class ScrapeError extends Error {
  code: "FETCH_FAILED" | "PRICE_NOT_FOUND" | "PARSE_FAILED";
  cause?: unknown;
  /** Status HTTP da resposta, quando houve (ex.: 404 = recurso não publicado). */
  httpStatus?: number;

  constructor(code: ScrapeError["code"], message: string, cause?: unknown) {
    super(message);
    this.name = "ScrapeError";
    this.code = code;
    this.cause = cause;
    if (axios.isAxiosError(cause) && cause.response) {
      this.httpStatus = cause.response.status;
    }
  }
}

/**
 * Erros 4xx (exceto 429) são respostas DEFINITIVAS do servidor — retentar não
 * muda nada (um 404 continua 404) e só martela o host. Retry fica para falhas
 * transitórias: rede (timeout/DNS/conexão), 5xx e 429.
 */
function isRetryable(err: unknown): boolean {
  if (axios.isAxiosError(err) && err.response) {
    const s = err.response.status;
    return s >= 500 || s === 429;
  }
  return true; // sem resposta = erro de rede → vale retentar
}

// Rotaciona o User-Agent para reduzir a chance de bloqueio.
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchHtmlOptions {
  /** Timeout por tentativa (ms). Padrão 10s. */
  timeoutMs?: number;
  /** Número de novas tentativas após a primeira falha. Padrão 2. */
  retries?: number;
}

/**
 * Baixa um recurso como bytes crus (arraybuffer) com timeout e retry.
 * Útil para arquivos que não são UTF-8 (ex.: CSV da ANP em Latin-1/Windows-1252)
 * ou binários. Lança `ScrapeError("FETCH_FAILED")` se todas as tentativas falharem.
 */
export async function fetchBuffer(url: string, options: FetchHtmlOptions = {}): Promise<Buffer> {
  const { timeoutMs = 30_000, retries = 2 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        timeout: timeoutMs,
        responseType: "arraybuffer",
        headers: {
          "User-Agent": randomUserAgent(),
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });
      return Buffer.from(response.data);
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) break; // 4xx definitivo → falha imediata, sem martelar
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  throw new ScrapeError(
    "FETCH_FAILED",
    `Falha ao baixar ${url}. Motivo: ${describeAxiosError(lastError)}`,
    lastError
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REMOVIDO em 09/ago/2026: `fetchLatin1`.
//
// A função afirmava, no próprio docstring, que "os CSVs da ANP são Latin-1 /
// Windows-1252". **Era falso**, e custou caro: o `anpIngestor` seguia a mesma
// suposição com um `toString("latin1")` e gravava no banco "SERVIÃ␇OS" no lugar
// de "SERVIÇOS" — os bytes UTF-8 `C3 87` lidos um a um. O nome torto aparecia no
// ranking "onde está mais barato", que é a tela mais vista do produto.
//
// Duas lições que valem mais que a função:
//
//  1. **Ninguém chamava esta função.** Ela era código morto desde algum refactor,
//     e mesmo assim continuou ensinando a suposição errada a quem lesse o
//     arquivo — inclusive a quem escreveu a linha do ingestor. Código morto não
//     é neutro quando carrega uma afirmação.
//  2. Encoding **se detecta, não se declara**: quem decide agora é
//     `ingest/anpDecode.ts`, olhando os bytes.
//
// Se precisar de novo de um download já decodificado, use `fetchBuffer` +
// `decodeAnpCsv`.
// ─────────────────────────────────────────────────────────────────────────────

export interface ConditionalOptions extends FetchHtmlOptions {
  /** Valor de ETag da última cópia baixada (envia `If-None-Match`). */
  etag?: string | null;
  /** Valor de Last-Modified da última cópia (envia `If-Modified-Since`). */
  lastModified?: string | null;
}

export interface ConditionalResult {
  /** Status HTTP efetivo (200 = novo conteúdo, 304 = não modificado). */
  status: number;
  /** true quando o servidor respondeu 304 (nada mudou) — `body` vem null. */
  notModified: boolean;
  /** Bytes crus quando há conteúdo novo; null em 304. */
  body: Buffer | null;
  /** Validadores devolvidos pelo servidor, para guardar e reusar na próxima vez. */
  etag?: string;
  lastModified?: string;
}

/**
 * GET **condicional** (H2): envia `If-None-Match`/`If-Modified-Since` quando temos
 * validadores da última ingestão. Se o arquivo não mudou, o servidor responde
 * **304** e não baixamos o corpo (economiza a transferência do CSV inteiro).
 *
 * Robusto a servidores que ignoram os cabeçalhos: nesse caso retorna 200 com o
 * corpo, e a deduplicação por **hash de conteúdo** no ingestor ainda evita
 * reprocessar. Retry/backoff só para erros de rede (não para 200/304).
 */
export async function fetchConditional(
  url: string,
  options: ConditionalOptions = {}
): Promise<ConditionalResult> {
  const { timeoutMs = 30_000, retries = 2, etag, lastModified } = options;

  const conditionalHeaders: Record<string, string> = {
    "User-Agent": randomUserAgent(),
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  };
  if (etag) conditionalHeaders["If-None-Match"] = etag;
  if (lastModified) conditionalHeaders["If-Modified-Since"] = lastModified;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        timeout: timeoutMs,
        responseType: "arraybuffer",
        headers: conditionalHeaders,
        // Não tratar 304 como erro.
        validateStatus: (s) => s === 200 || s === 304,
      });

      const respEtag = response.headers["etag"] as string | undefined;
      const respLastModified = response.headers["last-modified"] as string | undefined;

      if (response.status === 304) {
        return { status: 304, notModified: true, body: null, etag: respEtag, lastModified: respLastModified };
      }

      return {
        status: 200,
        notModified: false,
        body: Buffer.from(response.data),
        etag: respEtag,
        lastModified: respLastModified,
      };
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) break; // 4xx definitivo → falha imediata, sem martelar
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  throw new ScrapeError(
    "FETCH_FAILED",
    `Falha ao baixar (condicional) ${url}. Motivo: ${describeAxiosError(lastError)}`,
    lastError
  );
}
