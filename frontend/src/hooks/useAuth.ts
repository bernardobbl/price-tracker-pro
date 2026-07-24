import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";

export type AuthMode = "login" | "signup";

/**
 * Sessão + formulário de autenticação (Supabase Auth). Concentra todo o estado
 * de login/signup para que o `App` e a `AuthPage` fiquem livres dessa lógica.
 * Quando o Supabase não está configurado (`supabase === null`), roda em modo
 * demo: sem usuário, sem loading travado.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const timeout = setTimeout(() => setLoading(false), 2000);
    void (async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user ?? null);
      clearTimeout(timeout);
      setLoading(false);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const switchMode = useCallback((next: AuthMode) => {
    setMode(next);
    setError(null);
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!supabase) return;
      setError(null);
      setSubmitting(true);
      try {
        if (mode === "login") {
          const { error: err } = await supabase.auth.signInWithPassword({ email, password });
          if (err) throw err;
        } else {
          const { data, error: err } = await supabase.auth.signUp({ email, password });
          if (err) throw err;
          if (!data.session) {
            setMode("login");
            setError("Conta criada. Confirme o email para conseguir entrar.");
            return;
          }
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : (err as { message?: string })?.message ?? "Erro de autenticação";
        setError(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [mode, email, password]
  );

  const logout = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  return {
    user,
    loading,
    /** true quando há Supabase configurado e usuário logado (pode gerenciar dados). */
    canManage: Boolean(supabase && user),
    form: { email, password, mode, error, submitting, setEmail, setPassword, switchMode },
    submit,
    logout,
  };
}
