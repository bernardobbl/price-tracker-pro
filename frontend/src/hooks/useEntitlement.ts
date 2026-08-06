import { useCallback, useEffect, useState } from "react";
import { fetchEntitlement } from "../api/client";
import type { Entitlement } from "../types";

/**
 * Situação da assinatura do usuário logado.
 *
 * ## Por que este hook precisou existir
 *
 * O endpoint `GET /api/fuel/entitlement` foi construído junto com o gate, em
 * 04/ago/2026, descrito como sendo "para a interface" — e durante um mês
 * **nenhuma interface o consultou**. Na prática: quem pagava voltava para o app
 * e não via diferença nenhuma; quem não pagava não tinha como chegar ao
 * checkout por dentro do produto. O dinheiro entrava e o app fingia que nada
 * tinha acontecido.
 *
 * ## O que ele NÃO é
 *
 * Não é controle de acesso. O portão de verdade está no backend, no
 * `POST /api/fuel/alerts`, que consulta o banco e falha fechado. Esconder botão
 * no navegador nunca protegeu nada — isto aqui é só para a pessoa entender o
 * que ela tem.
 *
 * Silencioso por opção: sem sessão, ou com o backend fora, devolve `null` e o
 * app segue normal. A situação do plano é informação secundária e não pode
 * quebrar a tela de quem só quer consultar preço.
 */
export function useEntitlement(userId: string | null | undefined) {
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setEntitlement(null);
      return;
    }
    setLoading(true);
    try {
      setEntitlement(await fetchEntitlement());
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Recarrega quando o usuário muda (login, logout, troca de conta). Sem isso,
  // quem sai e entra com outra conta veria o plano da conta anterior.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entitlement, loading, refresh };
}
