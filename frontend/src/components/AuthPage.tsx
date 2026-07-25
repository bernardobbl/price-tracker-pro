import { Icon } from "./Icon";
import type { AuthMode } from "../hooks/useAuth";

interface AuthPageProps {
  mode: AuthMode;
  email: string;
  password: string;
  error: string | null;
  submitting: boolean;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSwitchMode: (m: AuthMode) => void;
  onSubmit: (e: React.FormEvent) => void;
  /** Volta para o dashboard público (explorar sem login). */
  onBack?: () => void;
}

/** Tela de login/cadastro (Supabase Auth). Estado vive no `useAuth`. */
export function AuthPage({
  mode,
  email,
  password,
  error,
  submitting,
  onEmailChange,
  onPasswordChange,
  onSwitchMode,
  onSubmit,
  onBack,
}: AuthPageProps) {
  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <span className="brand-mark"><Icon name="chart" size={20} /></span>
          <div>
            <h1>Price Tracker Pro</h1>
            <p>Preços reais de combustível (dados abertos da ANP)</p>
          </div>
        </div>
      </header>

      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-card-logo">
            <h2>Price Tracker Pro</h2>
            <p>Entre para salvar favoritos e criar alertas de preço</p>
          </div>

          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab${mode === "login" ? " active" : ""}`}
              onClick={() => onSwitchMode("login")}
            >
              Entrar
            </button>
            <button
              type="button"
              className={`auth-tab${mode === "signup" ? " active" : ""}`}
              onClick={() => onSwitchMode("signup")}
            >
              Criar conta
            </button>
          </div>

          <form onSubmit={onSubmit}>
            <div className="auth-fields">
              <div className="input-group">
                <label htmlFor="auth-email">E-mail</label>
                <input
                  id="auth-email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => onEmailChange(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="input-group">
                <label htmlFor="auth-password">Senha</label>
                <input
                  id="auth-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                />
              </div>
            </div>

            {error && <p className="error">{error}</p>}

            <button
              type="submit"
              className="btn-primary"
              style={{ marginTop: error ? "1rem" : "0.25rem" }}
              disabled={submitting}
            >
              {submitting ? "Aguarde..." : mode === "login" ? "Entrar na conta" : "Criar conta"}
            </button>
          </form>

          {onBack && (
            <button type="button" className="auth-back" onClick={onBack}>
              ← Explorar preços sem login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
