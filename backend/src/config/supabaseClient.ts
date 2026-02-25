import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn("[Supabase] Variáveis SUPABASE_URL / SUPABASE_ANON_KEY não configuradas. Operações remotas serão puladas.");
}

// Service role bypassa RLS: necessário para o backend inserir em prices/tracked_products.
// Em Settings > API do Supabase use a chave "service_role" (secret).
const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
export const supabase =
  SUPABASE_URL && key ? createClient(SUPABASE_URL, key) : null;

