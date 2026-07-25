import { useEffect, useState } from "react";
import { createFuelAlert } from "./api/client";
import { Icon } from "./components/Icon";
import { AuthPage } from "./components/AuthPage";
import { Sidebar } from "./components/Sidebar";
import { DetailPanel } from "./components/DetailPanel";
import { ToastContainer } from "./components/Toast";
import { useAuth } from "./hooks/useAuth";
import { useFuelSeries } from "./hooks/useFuelSeries";
import { useFavorites } from "./hooks/useFavorites";
import { useAlerts } from "./hooks/useAlerts";
import { useToasts } from "./hooks/useToasts";
import { sameSeries } from "./lib/format";
import { supabase } from "./supabaseClient";
import type { TrackedSeries } from "./types";

/** Modo demonstração: quando ligado (`VITE_DEMO_MODE=true`), a UI avisa que os
 *  dados são uma amostra ilustrativa (postos/endereços gerados no seed), e não a
 *  base real da ANP. Desligado por padrão → em produção (dado real) nada aparece. */
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

function App() {
  const auth = useAuth();
  const { canManage } = auth;

  const fuel = useFuelSeries();
  const favorites = useFavorites(canManage);
  const { alerts, reload: reloadAlerts, remove: removeAlert } = useAlerts(canManage);
  const { toasts, push, remove: removeToast } = useToasts();

  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);

  // Login é OPT-IN (padrão Keepa/CamelCamelCamel): o dashboard de consulta é
  // público — a tela de auth só aparece quando o usuário pede (ou quando uma
  // ação exige conta, como favoritar/alertar).
  const [showAuth, setShowAuth] = useState(false);
  useEffect(() => {
    if (auth.user) setShowAuth(false); // logou → volta ao dashboard
  }, [auth.user]);
  const requestLogin = () => setShowAuth(true);

  const { view } = fuel;
  const isFavorited = Boolean(view && favorites.tracked.some((t) => sameSeries(view, t)));

  // ── Handlers que cruzam hooks (favoritos ↔ alertas ↔ toasts) ──
  const handleFavorite = async () => {
    if (!view) return;
    if (!canManage) {
      requestLogin(); // a AuthPage explica: entrar para favoritar/alertar
      return;
    }
    try {
      await favorites.saveFavorite(view);
      push("success", `"${view.label}" salvo nos favoritos.`);
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "Erro ao salvar favorito");
    }
  };

  const handleDeleteFavorite = async (ts: TrackedSeries) => {
    try {
      await favorites.removeFavorite(ts.id);
      await reloadAlerts();
      push("success", `"${ts.label}" removido dos favoritos.`);
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "Erro ao excluir favorito");
    }
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertError(null);

    if (!canManage) {
      requestLogin();
      return;
    }
    if (!view) {
      setAlertError("Escolha uma série primeiro.");
      return;
    }
    const numericThreshold = Number(alertThreshold.replace(",", "."));
    if (!numericThreshold || Number.isNaN(numericThreshold)) {
      setAlertError("Informe um valor válido para o alerta.");
      return;
    }

    setAlertSaving(true);
    try {
      const favorite = await favorites.ensureFavorite(view);
      await createFuelAlert({
        seriesId: favorite.id,
        thresholdPrice: numericThreshold,
        currency: "R$",
        channel: "email",
        enabled: true,
      });
      setAlertThreshold("");
      await Promise.all([reloadAlerts(), favorites.reload()]);
      push("success", "Alerta salvo! Você será avisado por email.");
    } catch (err: unknown) {
      setAlertError(err instanceof Error ? err.message : "Erro ao salvar alerta");
    } finally {
      setAlertSaving(false);
    }
  };

  const handleDeleteAlert = async (alertId: string) => {
    try {
      await removeAlert(alertId);
      push("success", "Alerta removido.");
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "Erro ao excluir alerta");
    }
  };

  // ── Telas de loading / login ──
  if (auth.loading) {
    return (
      <div className="app">
        <div className="auth-loading">Verificando sessão...</div>
      </div>
    );
  }

  // Auth só quando pedida (botão "Entrar" ou ação que exige conta) — a consulta
  // de preços é pública, então ninguém esbarra num formulário logo de cara.
  if (showAuth && supabase && !auth.user) {
    return (
      <AuthPage
        mode={auth.form.mode}
        email={auth.form.email}
        password={auth.form.password}
        error={auth.form.error}
        submitting={auth.form.submitting}
        onEmailChange={auth.form.setEmail}
        onPasswordChange={auth.form.setPassword}
        onSwitchMode={auth.form.switchMode}
        onSubmit={auth.submit}
        onBack={() => setShowAuth(false)}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <h1>
            Price Tracker Pro
            {DEMO_MODE && (
              <span className="demo-badge" title="Amostra ilustrativa no layout da ANP — postos e endereços fictícios. Em produção, ingere o arquivo real da ANP.">
                dados de demonstração
              </span>
            )}
          </h1>
          <p>Preços reais de combustível (dados abertos da ANP)</p>
        </div>
        {canManage ? (
          <div className="auth-row auth-row--logged">
            <span className="auth-email"><Icon name="user" size={14} /> {auth.user!.email}</span>
            <button type="button" className="btn-logout" onClick={auth.logout}>
              <Icon name="logout" size={14} /> Sair
            </button>
          </div>
        ) : (
          supabase && (
            <div className="auth-row">
              <button type="button" className="btn-login" onClick={requestLogin}>
                <Icon name="user" size={14} /> Entrar
              </button>
            </div>
          )
        )}
      </header>

      <main className="dashboard">
        <Sidebar
          products={fuel.options.products}
          states={fuel.options.states}
          municipalities={fuel.options.municipalities}
          selProduct={fuel.selection.selProduct}
          selState={fuel.selection.selState}
          selMunicipality={fuel.selection.selMunicipality}
          onSelProduct={fuel.selection.setSelProduct}
          onSelState={fuel.selection.setSelState}
          onSelMunicipality={fuel.selection.setSelMunicipality}
          onExplore={(e) => {
            e.preventDefault();
            fuel.explore();
          }}
          canManage={canManage}
          view={view}
          tracked={favorites.tracked}
          deletingId={favorites.deletingId}
          onOpenView={fuel.openView}
          onDeleteFavorite={handleDeleteFavorite}
          alerts={alerts}
          onDeleteAlert={handleDeleteAlert}
        />

        <DetailPanel
          view={view}
          series={fuel.series}
          snapshot={fuel.snapshot}
          loading={fuel.loading}
          error={fuel.error}
          period={fuel.period}
          onPeriodChange={fuel.setPeriod}
          canManage={canManage}
          isFavorited={isFavorited}
          favSaving={favorites.favSaving}
          onFavorite={handleFavorite}
          onRequestLogin={requestLogin}
          alertThreshold={alertThreshold}
          onAlertThresholdChange={setAlertThreshold}
          alertSaving={alertSaving}
          alertError={alertError}
          onCreateAlert={handleCreateAlert}
        />
      </main>

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}

export default App;
