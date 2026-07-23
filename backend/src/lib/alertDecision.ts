/**
 * Decisão de alerta (lógica pura, testável) — compartilhada entre os domínios.
 * Extraída do alertService para ser reusada pelo domínio combustível sem acoplar
 * o serviço novo ao antigo (livros).
 */

export type AlertAction = "notify" | "reset" | "none";

/**
 * Decide o que fazer com um alerta dado o preço atual:
 * - "notify": preço atingiu o alvo e o alerta ainda não foi disparado
 * - "reset":  preço voltou a subir acima do alvo → rearmar o alerta
 * - "none":   nada a fazer (ou threshold inválido)
 */
export function decideAlertAction(
  currentPrice: number,
  threshold: number,
  alreadyTriggered: boolean
): AlertAction {
  if (Number.isNaN(threshold)) return "none";
  if (currentPrice <= threshold && !alreadyTriggered) return "notify";
  if (currentPrice > threshold && alreadyTriggered) return "reset";
  return "none";
}
