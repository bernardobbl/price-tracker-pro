import { PriceChart } from "./PriceChart";
import { Icon } from "./Icon";
import type { FuelSeriesPoint, SeriesView, SnapshotSummary } from "../types";
import { computePriceStats } from "../lib/priceStats";
import { computeDealSignal } from "../lib/dealSignal";
import { filterByPeriod, computeTrend, computeVolatility, PERIODS, type Period } from "../lib/priceInsights";
import { seriesToHistory, ANP_SOURCE_URL } from "../lib/seriesToHistory";
import { titleCase } from "../lib/seriesLabel";
import { fmt, formatLocation, mapsUrl } from "../lib/format";
import { useCountUp } from "../hooks/useCountUp";

interface DetailPanelProps {
  view: SeriesView | null;
  series: FuelSeriesPoint[];
  snapshot: SnapshotSummary | null;
  loading: boolean;
  error: string | null;
  period: Period;
  onPeriodChange: (p: Period) => void;

  canManage: boolean;
  isFavorited: boolean;
  favSaving: boolean;
  onFavorite: () => void;

  alertThreshold: string;
  onAlertThresholdChange: (v: string) => void;
  alertSaving: boolean;
  alertError: string | null;
  onCreateAlert: (e: React.FormEvent) => void;
}

/** Painel direito: preço-herói, sinal de compra, stats, gráfico, ranking e alerta. */
export function DetailPanel({
  view,
  series,
  snapshot,
  loading,
  error,
  period,
  onPeriodChange,
  canManage,
  isFavorited,
  favSaving,
  onFavorite,
  alertThreshold,
  onAlertThresholdChange,
  alertSaving,
  alertError,
  onCreateAlert,
}: DetailPanelProps) {
  // ── Derivados (recortados pelo período) ──
  const history = seriesToHistory(series, view?.label ?? "");
  const viewHistory = filterByPeriod(history, period);
  const stats = computePriceStats(viewHistory);
  const deal = computeDealSignal(stats);
  const trend = computeTrend(viewHistory);
  const volatility = computeVolatility(stats);
  const latestAvg = history.length ? history[history.length - 1].discountedPrice : 0;
  const animatedPrice = useCountUp(latestAvg);
  const collectedDate = snapshot?.date ?? (series.length ? series[series.length - 1].date : null);

  if (!view) {
    return (
      <section className="detail">
        <div className="detail-empty">
          <span className="detail-empty-icon"><Icon name="chart" size={34} /></span>
          <p>Escolha um combustível e um município para ver o histórico de preços.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="detail">
      <div className="card detail-card">
        {error && <p className="error">{error}</p>}

        {loading && <div className="skeleton skeleton--summary" aria-hidden="true" />}

        {!loading && series.length === 0 && !error && (
          <p className="muted">Sem dados de preço para esta série ainda.</p>
        )}

        {!loading && series.length > 0 && (
          <>
            <div className="detail-head">
              <div className="detail-head-info">
                <p className="detail-eyebrow">{view.label}</p>
                <p className="price">
                  R$ {fmt(animatedPrice)}
                  <span className="price-unit">/L</span>
                  {deal.available && deal.tone === "success" && stats.isLowestEver && (
                    <span className="price-badge">Menor preço!</span>
                  )}
                </p>
                <p className="meta">média do município no levantamento mais recente</p>
              </div>
              {canManage && (
                <button
                  type="button"
                  className={`btn-fav${isFavorited ? " btn-fav--on" : ""}`}
                  onClick={onFavorite}
                  disabled={favSaving || isFavorited}
                  title={isFavorited ? "Já está nos favoritos" : "Salvar nos favoritos"}
                >
                  <Icon name={isFavorited ? "check" : "tag"} size={14} />{" "}
                  {isFavorited ? "Favorito" : favSaving ? "Salvando…" : "Favoritar"}
                </button>
              )}
            </div>

            {deal.available && (
              <div className={`deal deal--${deal.tone}`}>
                <div className="deal-signal">
                  <span className="deal-label">{deal.label}</span>
                  <span className="deal-hint">{deal.hint}</span>
                </div>
                <div className="deal-score">
                  <span className="deal-score-value">{deal.score}</span>
                  <span className="deal-score-max">/100</span>
                </div>
              </div>
            )}

            {stats.min != null && stats.max != null && stats.max > stats.min && (
              <div className="position">
                <div className="position-labels">
                  <span>Menor · R$ {fmt(stats.min)}</span>
                  <span>Maior · R$ {fmt(stats.max)}</span>
                </div>
                <div className="position-track">
                  <div
                    className={`position-fill position-fill--${deal.tone}`}
                    style={{ width: `${Math.max(2, deal.positionPct)}%` }}
                  />
                  <div
                    className="position-marker"
                    style={{ left: `${deal.positionPct}%` }}
                    title={`Preço atual: R$ ${fmt(latestAvg)}`}
                  />
                </div>
              </div>
            )}

            <div className="segmented" role="group" aria-label="Período">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`segmented-btn${period === p.value ? " active" : ""}`}
                  onClick={() => onPeriodChange(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {viewHistory.length > 1 && (
              <div className="stat-grid">
                <div className="stat">
                  <span className="stat-label">Menor</span>
                  <span className="stat-value stat-value--low">R$ {fmt(stats.min ?? 0)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Média</span>
                  <span className="stat-value">R$ {fmt(stats.avg ?? 0)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Maior</span>
                  <span className="stat-value stat-value--high">R$ {fmt(stats.max ?? 0)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Variação</span>
                  <span
                    className={`stat-value ${
                      stats.changePct == null || stats.changePct === 0
                        ? ""
                        : stats.changePct > 0
                          ? "stat-value--high"
                          : "stat-value--low"
                    }`}
                  >
                    {stats.changePct == null
                      ? "—"
                      : `${stats.changePct > 0 ? "▲" : stats.changePct < 0 ? "▼" : ""} ${Math.abs(stats.changePct).toFixed(1)}%`}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Tendência</span>
                  <span
                    className={`stat-value ${
                      !trend.available
                        ? ""
                        : trend.dir === "up"
                          ? "stat-value--high"
                          : trend.dir === "down"
                            ? "stat-value--low"
                            : ""
                    }`}
                  >
                    {!trend.available
                      ? "—"
                      : `${trend.dir === "up" ? "↗" : trend.dir === "down" ? "↘" : "→"} ${trend.label}`}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Volatilidade</span>
                  <span className="stat-value">{volatility.available ? volatility.level : "—"}</span>
                </div>
              </div>
            )}

            <div className="detail-chart">
              <div className="detail-chart-head">
                <h2>Evolução de preço</h2>
              </div>
              <PriceChart data={viewHistory} decimals={3} />
            </div>

            {/* ── Ranking de postos: onde está mais barato (I2) ── */}
            {snapshot && snapshot.quotes.length > 0 && (
              <div className="ranking">
                <div className="detail-chart-head">
                  <h2>Onde está mais barato</h2>
                  {snapshot.date && (
                    <span className="ranking-date">
                      levantamento de {new Date(snapshot.date).toLocaleDateString("pt-BR")}
                    </span>
                  )}
                </div>
                <ul className="ranking-list">
                  {snapshot.quotes.slice(0, 8).map((q, i) => {
                    const loc = formatLocation(q);
                    return (
                      <li key={q.cnpj || i} className={`ranking-row${i === 0 ? " ranking-row--best" : ""}`}>
                        <span className="ranking-pos">{i + 1}</span>
                        <div className="ranking-info">
                          <span className="ranking-name">
                            {titleCase(q.reseller || "Posto")}
                            {q.brand && <span className="ranking-brand">{titleCase(q.brand)}</span>}
                          </span>
                          <a
                            className="ranking-loc"
                            href={mapsUrl(q, view)}
                            target="_blank"
                            rel="noreferrer"
                            title="Ver no Google Maps"
                          >
                            <Icon name="map-pin" size={12} />
                            {loc || "Ver no mapa"}
                          </a>
                        </div>
                        <span className="ranking-price">R$ {fmt(q.sellPrice)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <p className="meta detail-meta">
              {collectedDate && `Atualizado em ${new Date(collectedDate).toLocaleDateString("pt-BR")}`}
              {series.length > 1 && ` · ${series.length} levantamentos`}
              {" · "}
              <a href={ANP_SOURCE_URL} target="_blank" rel="noreferrer">
                Fonte: ANP
              </a>
            </p>

            {canManage && (
              <form className="form alert-form" onSubmit={onCreateAlert}>
                <h3 className="alert-form-title">Alerta de preço</h3>
                <div className="alert-field">
                  <label htmlFor="alert-threshold">Me avise quando a média cair abaixo de (R$/L)</label>
                  <div className="alert-controls">
                    <input
                      id="alert-threshold"
                      type="number"
                      step="0.001"
                      placeholder={(stats.avg ?? latestAvg).toFixed(3)}
                      value={alertThreshold}
                      onChange={(e) => onAlertThresholdChange(e.target.value)}
                    />
                    <button type="submit" className="btn-alert" disabled={alertSaving}>
                      {alertSaving ? "Salvando..." : "Ativar alerta"}
                    </button>
                  </div>
                </div>
                {alertError && <p className="error">{alertError}</p>}
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}
