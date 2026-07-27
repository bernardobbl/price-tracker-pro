/**
 * Regras do campo "me avise quando cair abaixo de X".
 *
 * Motivação real: no 1º teste em produção o usuário definiu alvo de R$ 9,00 numa
 * série que estava em R$ 6,41 e recebeu o email **na hora**, com um texto que
 * dizia que o preço "atingiu o valor desejado". A comparação estava correta
 * (6,41 ≤ 9,00), mas a experiência estava errada: nada tinha acontecido.
 *
 * A correção de raiz é aqui, ANTES de o alerta existir — avisar que aquele alvo
 * já está batido. Não bloqueamos: pode ser intencional (querer confirmação de que
 * o preço segue bom). Só deixamos de fingir que é uma novidade.
 */

export type AvaliacaoAlvo =
  | { tipo: "vazio" }
  | { tipo: "invalido"; mensagem: string }
  | { tipo: "ja-atingido"; mensagem: string }
  | { tipo: "ok" };

/** Converte "6,50" ou "6.50" em número. Devolve `null` se não for número válido. */
export function parseAlvo(entrada: string): number | null {
  const limpo = entrada.trim().replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

const fmt = (v: number) => `R$ ${v.toFixed(3).replace(".", ",")}`;

/**
 * Avalia o alvo digitado contra o preço médio atual.
 * `precoAtual` nulo (série sem levantamento) → não há o que comparar.
 */
export function avaliarAlvo(entrada: string, precoAtual: number | null): AvaliacaoAlvo {
  if (!entrada.trim()) return { tipo: "vazio" };

  const alvo = parseAlvo(entrada);
  if (alvo === null) return { tipo: "invalido", mensagem: "Informe um valor numérico." };
  if (alvo <= 0) return { tipo: "invalido", mensagem: "O valor precisa ser maior que zero." };

  if (precoAtual === null) return { tipo: "ok" };

  if (precoAtual <= alvo) {
    return {
      tipo: "ja-atingido",
      mensagem:
        `O preço médio atual (${fmt(precoAtual)}) já está abaixo desse alvo — ` +
        `você receberia o email imediatamente. Para ser avisado de uma queda futura, ` +
        `use um valor menor que ${fmt(precoAtual)}.`,
    };
  }

  return { tipo: "ok" };
}
