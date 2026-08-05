import type { Entitlement } from "../types";

interface PlanBadgeProps {
  entitlement: Entitlement | null;
  /** Só aparece para quem está logado — visitante não tem plano a mostrar. */
  logged: boolean;
}

/** Formata ISO → DD/MM/AAAA sem depender de biblioteca de data. */
function dataBR(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

/**
 * O que o usuário vê sobre o próprio plano, no header.
 *
 * Três estados, e cada um resolve uma falha concreta que existia antes:
 *
 *  - **Premium com folga** — quem pagou não via prova nenhuma dentro do app. Um
 *    selo com a data de validade é a confirmação de que o dinheiro virou algo.
 *  - **Premium vencendo** (≤ 8 dias, a mesma janela do aviso por e-mail) — o
 *    aviso chegava só por e-mail, e e-mail se perde. Quem abre o app na semana
 *    do vencimento precisa ver isso na tela, com o caminho para renovar.
 *  - **Sem plano** — não havia link nenhum para `/premium` dentro do app. Quem
 *    quisesse assinar precisava adivinhar a URL.
 *
 * O link vai para a landing, não direto para o checkout: quem ainda não decidiu
 * precisa ler o que está comprando antes de ver um QR Code.
 *
 * ⚠️ **Com `.html`, sempre.** A URL curta `/premium` só existe na Vercel, que
 * faz o rewrite; no `vite dev` ela cai no fallback do SPA e a pessoa continua no
 * dashboard achando que o clique não funcionou — foi exatamente o que aconteceu
 * quando este componente nasceu. Os links do rodapé já usavam `.html` pelo mesmo
 * motivo. O arquivo real funciona nos dois ambientes; a URL bonita, só num.
 */
export function PlanBadge({ entitlement, logged }: PlanBadgeProps) {
  if (!logged) return null;

  if (!entitlement?.active) {
    return (
      <a className="plan-badge plan-badge--free" href="/premium.html">
        Plano gratuito · <strong>conhecer o Premium</strong>
      </a>
    );
  }

  const dias = entitlement.daysLeft;
  const vence = entitlement.expiresAt ? dataBR(entitlement.expiresAt) : null;
  const acabando = dias != null && dias <= 8;

  if (acabando) {
    return (
      <a className="plan-badge plan-badge--expiring" href="/premium.html">
        Premium vence em {dias === 0 ? "menos de 1 dia" : `${dias} ${dias === 1 ? "dia" : "dias"}`}
        {" · "}
        <strong>renovar</strong>
      </a>
    );
  }

  return (
    <span
      className="plan-badge plan-badge--active"
      title={vence ? `Acesso pago válido até ${vence}` : undefined}
    >
      Premium{vence ? ` até ${vence}` : ""}
    </span>
  );
}
