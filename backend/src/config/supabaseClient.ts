import { createClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

// Service role bypassa RLS: necessário para o ETL inserir em fuel_prices e ingestion_runs.
// Em Settings > API do Supabase use a chave "service_role" (secret).
const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

// O aviso precisa descrever o estado REAL, e antes não descrevia: ele disparava
// sempre que faltasse a anon key e afirmava "operações remotas serão puladas" —
// mesmo com a service_role presente, quando nada era pulado. O GitHub Actions
// cai exatamente nesse caso (o workflow passa só URL + service_role), então todo
// log de ingestão abria com um alarme falso, e alarme falso recorrente treina
// quem lê a ignorar o log inteiro.
if (!SUPABASE_URL || !key) {
  logger.warn(
    "[Supabase] SUPABASE_URL ausente ou nenhuma chave (SERVICE_ROLE/ANON) configurada. " +
      "Operações remotas serão puladas."
  );
} else if (!SUPABASE_SERVICE_ROLE_KEY) {
  // Funciona, mas com alcance menor: sujeito a RLS, então o ETL não escreve.
  logger.warn(
    "[Supabase] Sem SUPABASE_SERVICE_ROLE_KEY — usando a anon key, que respeita RLS. " +
      "Leitura pública funciona; escrita do ETL, não."
  );
}

export const supabase =
  SUPABASE_URL && key ? createClient(SUPABASE_URL, key) : null;

