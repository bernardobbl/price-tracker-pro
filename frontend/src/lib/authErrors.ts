/**
 * Tradução de erros do Supabase Auth para mensagens que fazem sentido para quem
 * está usando o app.
 *
 * Por que existe: a mensagem crua do provedor é escrita para quem desenvolve, não
 * para quem usa. "Invalid API key" não diz nada a um visitante — pior, sugere que
 * ELE errou algo, quando na verdade é uma configuração nossa. O mesmo vale para
 * "Invalid login credentials", que em português direto é "email ou senha errados".
 *
 * Regra de ouro aplicada aqui: **erro de configuração nossa nunca vira culpa do
 * usuário**. Nesses casos avisamos que o problema é do nosso lado e pedimos para
 * tentar mais tarde, em vez de mandar o visitante conferir dados que estão certos.
 */

interface Regra {
  /** Trecho (minúsculo) procurado na mensagem original do provedor. */
  contem: string;
  /** O que o usuário lê. */
  mensagem: string;
}

const REGRAS: Regra[] = [
  // ── Problemas de configuração (culpa nossa) ──────────────────────────────
  {
    contem: "invalid api key",
    mensagem:
      "Não foi possível conectar ao serviço de contas. É um problema de configuração nosso, não seu — tente novamente em alguns minutos.",
  },
  {
    contem: "signups not allowed",
    mensagem: "O cadastro de novas contas está temporariamente desativado.",
  },

  // ── Erros que o usuário consegue resolver ────────────────────────────────
  {
    contem: "invalid login credentials",
    mensagem: "Email ou senha incorretos.",
  },
  {
    contem: "email not confirmed",
    mensagem: "Confirme seu email pelo link que enviamos antes de entrar.",
  },
  {
    contem: "user already registered",
    mensagem: "Já existe uma conta com esse email. Tente entrar em vez de criar.",
  },
  {
    contem: "password should be at least",
    mensagem: "A senha precisa ter pelo menos 6 caracteres.",
  },
  {
    contem: "unable to validate email address",
    mensagem: "Esse email não parece válido. Confira se está escrito corretamente.",
  },
  {
    contem: "email rate limit exceeded",
    mensagem: "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.",
  },
  {
    contem: "over_request_rate_limit",
    mensagem: "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.",
  },

  // ── Rede ─────────────────────────────────────────────────────────────────
  {
    contem: "failed to fetch",
    mensagem: "Sem conexão com o serviço de contas. Verifique sua internet e tente de novo.",
  },
];

/** Mensagem final quando não reconhecemos o erro — genérica, nunca culpa o usuário. */
export const ERRO_GENERICO = "Não foi possível concluir. Tente novamente em instantes.";

/**
 * Converte o erro do Supabase na mensagem que vai para a tela.
 * A mensagem original continua indo para o console, para depuração.
 */
export function traduzirErroAuth(err: unknown): string {
  const original =
    err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown })?.message === "string"
        ? (err as { message: string }).message
        : "";

  if (!original) return ERRO_GENERICO;

  const alvo = original.toLowerCase();
  const regra = REGRAS.find((r) => alvo.includes(r.contem));
  return regra ? regra.mensagem : ERRO_GENERICO;
}
