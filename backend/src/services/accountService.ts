/**
 * Direitos do titular (LGPD art. 18) — exportar e apagar.
 *
 * A Política de Privacidade publicada promete, por escrito: *"Receber uma cópia
 * dos seus dados em formato legível"*, *"Apagar seus dados e encerrar a conta"*,
 * resposta em até 15 dias e exclusão em 30. Até aqui isso existia só como SQL
 * no runbook — promessa cumprida à mão, quando alguém lembrava.
 *
 * ## O conflito que este arquivo resolve
 *
 * A mesma política promete **guardar os registros de pagamento por até 5 anos**,
 * "porque a lei exige comprovação fiscal e contábil". Apagar tudo violaria essa
 * obrigação; guardar tudo violaria o direito do titular.
 *
 * A saída é **anonimizar em vez de deletar** o que é registro de receita: a
 * linha de `subscriptions` e de `billing_charges` continua existindo, com valor
 * e data, mas sem apontar para pessoa nenhuma (`user_id = null`). O vínculo com
 * o ser humano desaparece; o número que o Fisco pode cobrar, não. É por isso que
 * essas duas colunas nasceram *nullable* com `on delete set null`, enquanto
 * favoritos e alertas são `on delete cascade` — a decisão está registrada em
 * `docs/vigencia-do-acesso.md` §3 e é **anterior** a este código.
 *
 * ## Por que a exclusão é imediata, e não em 30 dias
 *
 * O prazo publicado é um teto, não uma meta. Entregar na hora é cumprir melhor
 * do que foi prometido — e não existe fila de aprovação para segurar isso.
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";

export class AccountError extends Error {
  code: "NOT_CONFIGURED" | "USER_NOT_FOUND" | "DELETE_FAILED";

  constructor(code: AccountError["code"], message: string) {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}

export interface AccountExport {
  geradoEm: string;
  aviso: string;
  conta: { id: string; email: string | null; criadaEm: string | null };
  favoritos: unknown[];
  alertas: unknown[];
  assinaturas: unknown[];
  cobrancas: unknown[];
}

/**
 * Cópia de tudo o que guardamos sobre a pessoa.
 *
 * Inclui **os dados de pagamento**: são dela, e "formato legível" não combina
 * com esconder a parte que mais interessa numa disputa. Não inclui dado de
 * preço da ANP — aquilo é público e sobre postos, não sobre o usuário, como a
 * própria política explica no §9.
 */
export async function exportUserData(userId: string): Promise<AccountExport> {
  if (!supabase) throw new AccountError("NOT_CONFIGURED", "Supabase não configurado.");

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError || !userData?.user) {
    throw new AccountError("USER_NOT_FOUND", "Conta não encontrada.");
  }

  const [favoritos, alertas, assinaturas, cobrancas] = await Promise.all([
    supabase.from("tracked_series").select("*").eq("user_id", userId),
    supabase.from("alerts").select("*").eq("user_id", userId),
    supabase.from("subscriptions").select("*").eq("user_id", userId),
    supabase.from("billing_charges").select("*").eq("user_id", userId),
  ]);

  return {
    geradoEm: new Date().toISOString(),
    aviso:
      "Cópia dos seus dados no Price Tracker Pro (LGPD art. 18). Os preços de combustível " +
      "não aparecem aqui porque são dados públicos da ANP sobre postos, não sobre você.",
    conta: {
      id: userData.user.id,
      email: userData.user.email ?? null,
      criadaEm: userData.user.created_at ?? null,
    },
    favoritos: favoritos.data ?? [],
    alertas: alertas.data ?? [],
    assinaturas: assinaturas.data ?? [],
    cobrancas: cobrancas.data ?? [],
  };
}

export interface DeleteAccountResult {
  /** Linhas de receita que foram anonimizadas em vez de apagadas. */
  assinaturasAnonimizadas: number;
  cobrancasAnonimizadas: number;
  /** `true` quando havia acesso pago valendo — vira aviso na resposta. */
  tinhaAssinaturaAtiva: boolean;
}

/**
 * Apaga a conta: anonimiza o registro fiscal e remove o usuário.
 *
 * **A ordem não é negociável.** Anonimizar primeiro, apagar depois:
 *
 *  - o `on delete set null` do banco já faria a anonimização sozinho, mas
 *    depender disso é depender de um detalhe de schema que uma migração futura
 *    pode trocar sem ninguém lembrar do porquê. Fazer explicitamente aqui deixa
 *    a intenção escrita no lugar onde ela é lida;
 *  - se o `delete` falhar depois da anonimização, o pior caso é uma conta que
 *    existe com registro de receita já desvinculado — recuperável. Na ordem
 *    inversa, uma falha deixaria registro fiscal apontando para um usuário que
 *    não existe mais, ou pior, seria apagado em cascata.
 *
 * Favoritos e alertas somem por `on delete cascade`, e é o que deve acontecer:
 * são dados pessoais sem obrigação de guarda.
 */
export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  if (!supabase) throw new AccountError("NOT_CONFIGURED", "Supabase não configurado.");

  const agora = new Date().toISOString();

  // Aviso para a resposta: a pessoa pode estar abrindo mão de acesso já pago.
  const { data: ativas } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("expires_at", agora);

  const tinhaAssinaturaAtiva = (ativas?.length ?? 0) > 0;

  const { data: subs, error: subError } = await supabase
    .from("subscriptions")
    .update({ user_id: null })
    .eq("user_id", userId)
    .select("id");

  if (subError) {
    logger.error({ err: subError.message, userId }, "[Conta] Falha ao anonimizar assinaturas");
    throw new AccountError("DELETE_FAILED", "Não foi possível concluir a exclusão agora.");
  }

  const { data: charges, error: chargeError } = await supabase
    .from("billing_charges")
    .update({ user_id: null })
    .eq("user_id", userId)
    .select("id");

  if (chargeError) {
    logger.error({ err: chargeError.message, userId }, "[Conta] Falha ao anonimizar cobranças");
    throw new AccountError("DELETE_FAILED", "Não foi possível concluir a exclusão agora.");
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);

  if (deleteError) {
    // Estado intermediário: registro já anonimizado, usuário ainda existe. Não é
    // perda de dado, mas precisa de gente — daí o `error` e não `warn`.
    logger.error(
      { err: deleteError.message, userId },
      "[Conta] Registro anonimizado mas o usuário NÃO foi removido — exige intervenção"
    );
    throw new AccountError("DELETE_FAILED", "Não foi possível concluir a exclusão agora.");
  }

  logger.info(
    {
      assinaturasAnonimizadas: subs?.length ?? 0,
      cobrancasAnonimizadas: charges?.length ?? 0,
      tinhaAssinaturaAtiva,
    },
    "[Conta] Conta excluída a pedido do titular (LGPD art. 18)"
  );

  return {
    assinaturasAnonimizadas: subs?.length ?? 0,
    cobrancasAnonimizadas: charges?.length ?? 0,
    tinhaAssinaturaAtiva,
  };
}
