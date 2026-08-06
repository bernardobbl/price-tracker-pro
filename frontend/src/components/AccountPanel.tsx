import { useState } from "react";
import { ApiError, deleteAccount, downloadAccountData } from "../api/client";
import { Icon } from "./Icon";
import { CONFIRMACAO_EXCLUSAO, type Entitlement } from "../types";

interface AccountPanelProps {
  email: string | null;
  entitlement: Entitlement | null;
  /** Chamado depois da exclusão concluída — o App desloga e limpa o estado. */
  onDeleted: () => void;
  onClose: () => void;
}

/**
 * Os direitos do titular, com botão.
 *
 * ## Por que esta tela existe
 *
 * A Política de Privacidade promete, por escrito, "receber uma cópia dos seus
 * dados em formato legível" e "apagar seus dados e encerrar a conta". As rotas
 * (`GET /api/account/export`, `DELETE /api/account`) foram escritas, testadas —
 * e **nenhuma interface as chamava**. Na prática a promessa continuava sendo
 * cumprida à mão: a pessoa escrevia um e-mail e alguém rodava um comando.
 *
 * É a mesma falha do `GET /entitlement`, que passou um mês existindo "para a
 * interface" sem interface nenhuma. Endpoint sem tela é promessa sem porta.
 *
 * ## As duas decisões de desenho que não são óbvias
 *
 * **1. O aviso sobre assinatura ativa aparece ANTES, não depois.** O backend já
 * devolve `tinhaAssinaturaAtiva` na resposta — mas resposta chega depois de a
 * conta ter sumido. Quem está prestes a jogar fora acesso já pago precisa saber
 * disso enquanto ainda dá para desistir, e é o `entitlement` que permite dizer.
 *
 * **2. Os códigos de cobrança ficam na tela até a pessoa fechar.** Depois da
 * exclusão, `user_id` vira `null` e o pagamento não é mais alcançável por
 * nenhuma busca por pessoa: aqueles códigos são a única alça para um pedido de
 * reembolso. Deslogar direto seria varrer para debaixo do tapete a informação
 * mais importante da operação — por isso `onDeleted` só é chamado no fechamento.
 */
export function AccountPanel({ email, entitlement, onDeleted, onClose }: AccountPanelProps) {
  const [exportando, setExportando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [pedindoExclusao, setPedindoExclusao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [excluida, setExcluida] = useState<{ codigos: string[]; mensagem: string } | null>(null);

  const confirmacaoOk = confirmacao.trim().toUpperCase() === CONFIRMACAO_EXCLUSAO;

  async function exportar() {
    setErro(null);
    setAviso(null);
    setExportando(true);
    try {
      const nome = await downloadAccountData();
      setAviso(`Arquivo ${nome} baixado.`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não consegui gerar a cópia dos seus dados.");
    } finally {
      setExportando(false);
    }
  }

  async function excluir() {
    // Revalidada no clique: o `disabled` do botão é dica de interface, não
    // garantia — e aqui o que está do outro lado é irreversível.
    if (!confirmacaoOk) return;

    setErro(null);
    setExcluindo(true);
    try {
      const r = await deleteAccount(CONFIRMACAO_EXCLUSAO);
      setExcluida({ codigos: r.cobrancasParaReembolso ?? [], mensagem: r.mensagem });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 503
          ? "O serviço não conseguiu concluir a exclusão agora. Sua conta segue intacta — " +
            "tente de novo em alguns minutos."
          : err instanceof Error
            ? err.message
            : "Não consegui excluir a conta agora.";
      setErro(msg);
      setExcluindo(false);
    }
  }

  // ── Depois da exclusão ────────────────────────────────────────────────────
  // Tela própria, sem os botões: não há mais conta sobre a qual agir, e deixar
  // "Excluir" clicável seria oferecer uma ação que só pode dar erro.
  if (excluida) {
    return (
      <div className="account-overlay" role="dialog" aria-modal="true" aria-label="Conta excluída">
        <div className="account-card">
          <h2>Conta excluída</h2>
          <p className="account-lead">{excluida.mensagem}</p>

          {excluida.codigos.length > 0 && (
            <div className="account-danger" role="alert">
              <strong>Guarde estes códigos de cobrança</strong>
              <p>
                Seus pagamentos foram mantidos de forma anônima por obrigação fiscal. Como não estão
                mais ligados a nenhuma conta, <strong>estes códigos são a única forma de
                identificá-los</strong> num pedido de reembolso.
              </p>
              <ul className="account-codes">
                {excluida.codigos.map((c) => (
                  <li key={c}><code>{c}</code></li>
                ))}
              </ul>
            </div>
          )}

          <div className="account-actions">
            <button type="button" className="btn-logout" onClick={onDeleted}>
              Entendi, sair
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="account-overlay" role="dialog" aria-modal="true" aria-label="Minha conta">
      <div className="account-card">
        <div className="account-head">
          <h2>Minha conta</h2>
          <button type="button" className="account-close" onClick={onClose} aria-label="Fechar">
            <Icon name="x" size={16} />
          </button>
        </div>

        <p className="account-lead">
          {email ?? "Conta sem email"}
          {entitlement?.active ? " · Premium ativo" : " · Plano gratuito"}
        </p>

        {erro && <div className="account-msg account-msg--bad" role="alert">{erro}</div>}
        {aviso && <div className="account-msg account-msg--ok" role="status">{aviso}</div>}

        {/* ── Exportar ─────────────────────────────────────────────────────── */}
        <section className="account-section">
          <h3>Seus dados</h3>
          <p>
            Baixe uma cópia de tudo o que guardamos sobre você: conta, favoritos, alertas,
            assinaturas e pagamentos. Os preços da ANP não entram — são dados públicos sobre postos,
            não sobre você.
          </p>
          <button type="button" className="btn-quiet-app" onClick={exportar} disabled={exportando}>
            {exportando ? "Gerando…" : "Baixar meus dados (JSON)"}
          </button>
        </section>

        {/* ── Excluir ──────────────────────────────────────────────────────── */}
        <section className="account-section">
          <h3>Excluir a conta</h3>
          <p>
            Apaga seus favoritos e alertas, e encerra a conta. Os registros de pagamento são
            mantidos de forma <strong>anônima</strong> por até 5 anos — a lei exige comprovação
            fiscal, e eles deixam de apontar para você.
          </p>

          {/* O aviso mais caro da tela, e ele precisa vir ANTES do clique. */}
          {entitlement?.active && (
            <div className="account-danger" role="alert">
              <strong>Você tem Premium valendo</strong>
              <p>
                {entitlement.expiresAt
                  ? `Seu acesso vale até ${new Date(entitlement.expiresAt).toLocaleDateString("pt-BR")}. `
                  : ""}
                Excluir a conta <strong>não devolve o dinheiro automaticamente</strong>. Se quiser
                reembolso, peça <a href="/reembolso.html" target="_blank" rel="noopener">pela
                política</a> <em>antes</em> de excluir — depois, o pagamento fica anônimo e mais
                difícil de localizar.
              </p>
            </div>
          )}

          {!pedindoExclusao ? (
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                setPedindoExclusao(true);
                setErro(null);
              }}
            >
              Quero excluir minha conta
            </button>
          ) : (
            <div className="account-confirm">
              <label htmlFor="confirmExclusao">
                Isto é irreversível. Para confirmar, digite{" "}
                <strong>{CONFIRMACAO_EXCLUSAO}</strong>:
              </label>
              <input
                id="confirmExclusao"
                type="text"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                autoComplete="off"
                placeholder={CONFIRMACAO_EXCLUSAO}
                disabled={excluindo}
              />
              <div className="account-actions">
                <button
                  type="button"
                  className="btn-danger"
                  onClick={excluir}
                  disabled={!confirmacaoOk || excluindo}
                >
                  {excluindo ? "Excluindo…" : "Excluir definitivamente"}
                </button>
                <button
                  type="button"
                  className="btn-quiet-app"
                  onClick={() => {
                    setPedindoExclusao(false);
                    setConfirmacao("");
                  }}
                  disabled={excluindo}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </section>

        <p className="account-foot">
          O que fazemos com seus dados está na{" "}
          <a href="/privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>.
        </p>
      </div>
    </div>
  );
}
