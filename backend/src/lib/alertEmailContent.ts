/**
 * Texto e link do email de alerta — funções puras, para poder testar o conteúdo
 * sem enviar nada.
 *
 * Duas correções nascem aqui, ambas apontadas na primeira vez que o alerta rodou
 * em produção de verdade:
 *
 * 1. **O link levava para a ANP**, não para o app. Fazia sentido quando não havia
 *    site publicado; hoje o email deve levar o usuário de volta para a série dele.
 *
 * 2. **O texto afirmava que o preço "atingiu o valor desejado"**, mesmo quando o
 *    preço estava MUITO abaixo do alvo (R$ 6,41 para um alvo de R$ 9,00). Isso
 *    sugere um evento que não aconteceu. O texto agora afirma só o que é verdade:
 *    onde o preço está em relação ao alvo.
 */

export interface SeriesRef {
  product: string;
  state: string;
  municipality: string;
  brand?: string | null;
  label: string;
}

const MOEDA_PADRAO = "R$";

/** Formata preço no padrão brasileiro (vírgula decimal, 3 casas — combustível). */
export function formatarPreco(valor: number, moeda = MOEDA_PADRAO): string {
  return `${moeda} ${valor.toFixed(3).replace(".", ",")}`;
}

/**
 * Link de volta para o app, já apontando para a série do alerta.
 * `appUrl` ausente (ou lista separada por vírgula, como o CORS aceita) → usa a
 * primeira origem; sem nada configurado, devolve `null` e o email sai sem link.
 */
export function montarLinkDaSerie(appUrl: string | undefined, series: SeriesRef): string | null {
  const base = appUrl?.split(",")[0]?.trim().replace(/\/+$/, "");
  if (!base) return null;

  const params = new URLSearchParams({
    produto: series.product,
    uf: series.state,
    municipio: series.municipality,
  });
  if (series.brand) params.set("bandeira", series.brand);

  return `${base}/?${params.toString()}`;
}

export interface ConteudoAlerta {
  subject: string;
  text: string;
}

/**
 * Monta assunto e corpo. `currentPrice <= thresholdPrice` é pré-condição (só
 * chamamos quando o alerta dispara), então o texto sempre descreve "no alvo ou
 * abaixo" — mas diferencia os dois casos, porque "está exatamente no alvo" e
 * "está 28% abaixo do alvo" são notícias bem diferentes para quem lê.
 */
export function montarConteudoAlerta(params: {
  series: SeriesRef;
  thresholdPrice: number;
  currentPrice: number;
  currency?: string;
  appUrl?: string;
  collectedAt?: string | null;
}): ConteudoAlerta {
  const { series, thresholdPrice, currentPrice, collectedAt } = params;
  const moeda = params.currency || MOEDA_PADRAO;

  const atual = formatarPreco(currentPrice, moeda);
  const alvo = formatarPreco(thresholdPrice, moeda);
  const diferenca = thresholdPrice - currentPrice;
  const percentual = thresholdPrice > 0 ? (diferenca / thresholdPrice) * 100 : 0;

  const subject = `${series.label}: ${atual} — abaixo do seu alvo de ${alvo}`;

  const abertura =
    diferenca <= 0.0005
      ? `A média de ${series.label} está em ${atual}, exatamente no alvo que você definiu.`
      : `A média de ${series.label} está em ${atual} — ${formatarPreco(diferenca, moeda)} ` +
        `(${percentual.toFixed(0)}%) abaixo do seu alvo de ${alvo}.`;

  const linhas: string[] = [
    abertura,
    "",
    `Preço médio atual: ${atual}`,
    `Seu alvo: ${alvo}`,
  ];

  if (collectedAt) {
    linhas.push(`Levantamento da ANP de ${formatarDataBR(collectedAt)}`);
  }

  const link = montarLinkDaSerie(params.appUrl, series);
  if (link) {
    linhas.push("", `Ver o histórico e os postos mais baratos: ${link}`);
  }

  linhas.push(
    "",
    "Para parar de receber, remova o alerta na sua conta.",
    "Dados públicos da ANP (Agência Nacional do Petróleo)."
  );

  return { subject, text: linhas.join("\n") };
}

/** `2026-06-30` → `30/06/2026` (sem depender de fuso, é data pura). */
function formatarDataBR(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}
