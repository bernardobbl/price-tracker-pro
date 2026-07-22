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
 * Baixa o HTML de uma URL com timeout e retry (backoff exponencial).
 * Lança `ScrapeError("FETCH_FAILED")` se todas as tentativas falharem.
 */
export async function fetchHtml(url: string, options: FetchHtmlOptions = {}): Promise<string> {
  const { timeoutMs = 10_000, retries = 2 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get<string>(url, {
        timeout: timeoutMs,
        responseType: "text",
        headers: {
          "User-Agent": randomUserAgent(),
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });
      return response.data;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt); // 500ms, 1s, 2s...
      }
    }
  }

  throw new ScrapeError(
    "FETCH_FAILED",
    `Falha ao acessar ${url} após ${retries + 1} tentativa(s).`,
    lastError
  );
}
