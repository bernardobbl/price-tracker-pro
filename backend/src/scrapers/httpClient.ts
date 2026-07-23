import axios from "axios";

/**
 * Erro estruturado de scraping — permite ao chamador distinguir o tipo de falha
 * (ex.: rede vs. preço não encontrado) e responder com o status HTTP adequado.
 */
export class ScrapeError extends Error {
  code: "FETCH_FAILED" | "PRICE_NOT_FOUND" | "PARSE_FAILED";
  cause?: unknown;

  constructor(code: ScrapeError["code"], message: string, cause?: unknown) {
    super(message);
    this.name = "ScrapeError";
    this.code = code;
    this.cause = cause;
  }
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
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  throw new ScrapeError(
    "FETCH_FAILED",
    `Falha ao baixar ${url} após ${retries + 1} tentativa(s).`,
    lastError
  );
}

/**
 * Baixa um arquivo de texto codificado em **Latin-1 / Windows-1252** (padrão dos
 * CSVs da ANP) e o decodifica para uma string JS (UTF-16 interno). O parser
 * (`parseAnpCsv`) recebe essa string já decodificada.
 *
 * Nota: "latin1" no Node é ISO-8859-1; para os acentos usados pela ANP
 * (á, ç, ã, õ...) o resultado é equivalente ao Windows-1252 na prática.
 */
export async function fetchLatin1(url: string, options: FetchHtmlOptions = {}): Promise<string> {
  const buffer = await fetchBuffer(url, options);
  return buffer.toString("latin1");
}

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
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  throw new ScrapeError(
    "FETCH_FAILED",
    `Falha ao baixar (condicional) ${url} após ${retries + 1} tentativa(s).`,
    lastError
  );
}
