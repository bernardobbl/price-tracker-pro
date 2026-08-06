/**
 * Validação de e-mail no cadastro — deliberadamente mais estrita que a RFC.
 *
 * ## Por que isto existe
 *
 * O campo usava só `type="email"`, e a validação do HTML5 aceita `alguem@gmail`
 * — sem domínio de topo. É **tecnicamente correto** pela RFC 5322 (endereços
 * como `root@localhost` são válidos numa rede interna) e completamente inútil
 * aqui: nenhum email sai da internet pública para um domínio sem TLD.
 *
 * Aconteceu de verdade. Uma conta foi criada com `...@gmail` em 23/jul/2026 e
 * ficou meses recebendo nada: nem alerta de preço, nem aviso de vencimento, nem
 * recuperação de senha. O navegador não reclamou, o Supabase não reclamou, e o
 * único sintoma era silêncio — o pior tipo de defeito num produto cujo valor
 * inteiro é **mandar email**.
 *
 * ## O que esta função NÃO tenta fazer
 *
 * Não valida se o endereço existe, se a caixa aceita mensagem ou se o domínio
 * tem MX — nada disso dá para saber no navegador. Ela só barra o que é
 * comprovadamente indeliverável, que é onde está o erro real de digitação.
 *
 * Preferimos o falso negativo ao falso positivo: é melhor deixar passar um
 * endereço estranho porém válido do que recusar o email legítimo de alguém.
 * Por isso nada de lista de domínios conhecidos nem regex gigante da internet.
 *
 * ## Onde é aplicada
 *
 * Só no **cadastro**. No login não: quem já tem conta com endereço torto (o
 * caso acima) precisa continuar conseguindo entrar para pedir a correção.
 * Barrar o login puniria a pessoa por um defeito nosso.
 */

/** Motivo da recusa, em português e sem culpar quem digitou. */
export type EmailProblem = "vazio" | "formato" | "sem-dominio" | "sem-tld";

export interface EmailCheck {
  valid: boolean;
  problem: EmailProblem | null;
  /** Mensagem pronta para a tela. Vazia quando válido. */
  message: string;
}

const OK: EmailCheck = { valid: true, problem: null, message: "" };

function fail(problem: EmailProblem, message: string): EmailCheck {
  return { valid: false, problem, message };
}

export function checkSignupEmail(raw: string): EmailCheck {
  const email = (raw ?? "").trim();

  if (!email) return fail("vazio", "Informe seu e-mail.");

  // Espaço em branco no meio é sempre erro de digitação ou de colagem.
  if (/\s/.test(email)) {
    return fail("formato", "O e-mail não pode conter espaços.");
  }

  // Exatamente um @: zero é campo incompleto, dois ou mais é erro de colagem.
  const partes = email.split("@");
  if (partes.length !== 2) {
    return fail("formato", "E-mail inválido — confira se digitou tudo certo.");
  }

  const [local, dominio] = partes;

  if (!local) return fail("formato", "Falta a parte antes do @.");
  if (!dominio) return fail("sem-dominio", "Falta o domínio depois do @ (ex.: gmail.com).");

  // Ponto no começo/fim do domínio, ou dois pontos seguidos: sempre digitação.
  if (dominio.startsWith(".") || dominio.endsWith(".") || dominio.includes("..")) {
    return fail("formato", "E-mail inválido — confira os pontos do domínio.");
  }

  // O ponto central desta função: domínio precisa de um TLD.
  // "gmail" não recebe email; "gmail.com" recebe.
  const rotulos = dominio.split(".");
  if (rotulos.length < 2) {
    return fail(
      "sem-tld",
      `Faltou o final do domínio — você quis dizer "${local}@${dominio}.com"?`
    );
  }

  const tld = rotulos[rotulos.length - 1];
  if (!/^[a-zA-Z]{2,}$/.test(tld)) {
    return fail("sem-tld", "E-mail inválido — confira o final do domínio (ex.: .com, .com.br).");
  }

  return OK;
}
