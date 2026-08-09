import { Icon } from "./Icon";
import { FuelGauge } from "./FuelGauge";
import type { FuelAlert, SeriesView, TrackedSeries } from "../types";
import { titleCase } from "../lib/seriesLabel";
import { fmt, sameSeries } from "../lib/format";

interface SidebarProps {
  products: string[];
  states: string[];
  municipalities: string[];
  selProduct: string;
  selState: string;
  selMunicipality: string;
  onSelProduct: (v: string) => void;
  onSelState: (v: string) => void;
  onSelMunicipality: (v: string) => void;
  onExplore: (e: React.FormEvent) => void;
  /** Só para feedback visual no botão — não altera o fluxo da consulta. */
  loading?: boolean;

  canManage: boolean;
  view: SeriesView | null;
  tracked: TrackedSeries[];
  deletingId: string | null;
  onOpenView: (v: SeriesView) => void;
  onDeleteFavorite: (t: TrackedSeries) => void;

  alerts: FuelAlert[];
  onDeleteAlert: (id: string) => void;
}

/** Coluna esquerda do dashboard: consultar preço, favoritos e alertas ativos. */
export function Sidebar({
  products,
  states,
  municipalities,
  selProduct,
  selState,
  selMunicipality,
  onSelProduct,
  onSelState,
  onSelMunicipality,
  onExplore,
  loading = false,
  canManage,
  view,
  tracked,
  deletingId,
  onOpenView,
  onDeleteFavorite,
  alerts,
  onDeleteAlert,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="panel">
        <h2>Consultar preço</h2>
        <form className="explore-form" onSubmit={onExplore}>
          <div className="input-group">
            <label htmlFor="sel-product">Combustível</label>
            <select id="sel-product" value={selProduct} onChange={(e) => onSelProduct(e.target.value)}>
              {products.length === 0 && <option value="">Carregando…</option>}
              {products.map((p) => (
                <option key={p} value={p}>{titleCase(p)}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="sel-state">Estado (UF)</label>
            <select id="sel-state" value={selState} onChange={(e) => onSelState(e.target.value)}>
              <option value="">Selecione…</option>
              {states.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="sel-municipality">Município</label>
            <select
              id="sel-municipality"
              value={selMunicipality}
              onChange={(e) => onSelMunicipality(e.target.value)}
              disabled={!selState || municipalities.length === 0}
            >
              <option value="">
                {!selState ? "Escolha a UF primeiro" : municipalities.length === 0 ? "Sem dados" : "Selecione…"}
              </option>
              {municipalities.map((m) => (
                <option key={m} value={m}>{titleCase(m)}</option>
              ))}
            </select>
          </div>
          {/* O `disabled` continua sendo só a validação dos campos: carregar não
              bloqueia o botão, para não mudar o comportamento que já existia. */}
          <button type="submit" className="btn-primary" disabled={!selProduct || !selState || !selMunicipality}>
            {loading && <FuelGauge />}
            Ver preços
          </button>
        </form>
        {states.length === 0 && (
          <p className="muted empty-hint">Sem dados carregados ainda. Rode a ingestão da ANP no backend.</p>
        )}
      </div>

      {canManage && (
        <div className="panel">
          <h2>
            Favoritos <span className="count-badge">{tracked.length}</span>
          </h2>
          {tracked.length === 0 ? (
            <p className="muted empty-hint">Nenhum favorito ainda. Consulte um preço e clique em “Favoritar”.</p>
          ) : (
            <ul className="product-list">
              {tracked.map((t) => (
                <li key={t.id} className={`product-card${view && sameSeries(view, t) ? " active" : ""}`}>
                  <button
                    type="button"
                    className="product-card-btn"
                    onClick={() =>
                      onOpenView({
                        product: t.product,
                        state: t.state,
                        municipality: t.municipality,
                        brand: t.brand,
                        label: t.label,
                      })
                    }
                  >
                    <span className="product-card-name">{t.label}</span>
                    <span className="product-card-id">{titleCase(t.municipality)}/{t.state}</span>
                  </button>
                  <button
                    type="button"
                    className="product-card-remove"
                    onClick={() => onDeleteFavorite(t)}
                    disabled={deletingId === t.id}
                    aria-label={`Excluir ${t.label}`}
                    title="Excluir favorito"
                  >
                    {deletingId === t.id ? "..." : <Icon name="trash" size={15} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canManage && alerts.length > 0 && (
        <div className="panel">
          {/* O título dizia "Alertas ativos" para todos, sempre — e depois que a
              cota passou a valer também na hora de disparar, isso virou uma
              afirmação falsa para quem deixou a assinatura vencer: os alertas
              excedentes continuam salvos e nunca mais enviam e-mail. Com
              dormentes na lista, o título deixa de prometer atividade e a
              explicação vem logo abaixo. */}
          <h2>{alerts.some((a) => a.dormant) ? "Seus alertas" : "Alertas ativos"}</h2>

          {alerts.some((a) => a.dormant) && (
            <p className="alert-dormant-note" role="status">
              O plano gratuito envia e-mail de{" "}
              <strong>{alerts.filter((a) => !a.dormant).length}</strong>{" "}
              {alerts.filter((a) => !a.dormant).length === 1 ? "alerta" : "alertas"}. Os demais
              ficam guardados e voltam a funcionar se você assinar — nada foi apagado.{" "}
              <a href="/premium.html">Ver o Premium</a>
            </p>
          )}

          <ul className="alert-list">
            {alerts.map((a) => (
              <li key={a.id} className={`alert-item${a.dormant ? " alert-item--dormant" : ""}`}>
                <div className="alert-item-info">
                  <span className="alert-item-product">{a.tracked_series?.label ?? "Série"}</span>
                  <span className="alert-item-threshold">
                    abaixo de {a.currency} {fmt(Number(a.threshold_price))}
                    {a.dormant ? (
                      // O badge fala do EFEITO ("não avisa"), não do estado
                      // interno ("dormente"): quem lê quer saber se vai receber
                      // e-mail, não o nome que demos à situação no código.
                      <span
                        className="alert-badge alert-badge--dormant"
                        title="Fora da cota do plano gratuito: este alerta está salvo, mas não envia e-mail."
                      >
                        não avisa
                      </span>
                    ) : (
                      a.triggered && <span className="alert-badge">disparado</span>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-icon-danger"
                  onClick={() => onDeleteAlert(a.id)}
                  aria-label={`Remover alerta de ${a.tracked_series?.label ?? "série"}`}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
