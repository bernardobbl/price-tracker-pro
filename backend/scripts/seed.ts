import "dotenv/config";
import { supabase } from "../src/config/supabaseClient";

/**
 * Popula o Supabase com um usuário de demonstração, alguns produtos rastreados
 * e um histórico de preços realista (tendência de queda) para a demo pública.
 *
 * Uso: npm run seed  (requer SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no .env)
 */

const DEMO_EMAIL = process.env.DEMO_EMAIL || "demo@pricetracker.pro";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo123456";

interface SeedProduct {
  id: string;
  name: string;
  searchQuery: string;
  startPrice: number;
  endPrice: number;
}

// Livros reais do books.toscrape.com; startPrice simula um histórico caindo até o preço atual.
const PRODUCTS: SeedProduct[] = [
  { id: "a-light-in-the-attic", name: "A Light in the Attic", searchQuery: "A Light in the Attic", startPrice: 58.9, endPrice: 51.77 },
  { id: "tipping-the-velvet", name: "Tipping the Velvet", searchQuery: "Tipping the Velvet", startPrice: 60.0, endPrice: 53.74 },
  { id: "soumission", name: "Soumission", searchQuery: "Soumission", startPrice: 55.0, endPrice: 50.1 },
];

const CURRENCY = "£";

const DAYS = 30;

async function getOrCreateDemoUser(): Promise<string> {
  if (!supabase) throw new Error("Supabase não configurado.");

  // Tenta criar; se já existir, procura o usuário existente.
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });

  if (!createError && created?.user) {
    console.log(`[seed] Usuário demo criado: ${DEMO_EMAIL}`);
    return created.user.id;
  }

  // Já existe: pagina os usuários e encontra pelo email.
  const { data: list, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;

  const existing = list.users.find((u) => u.email === DEMO_EMAIL);
  if (!existing) throw new Error(`Não foi possível criar nem encontrar o usuário demo (${DEMO_EMAIL}).`);

  console.log(`[seed] Usuário demo já existia: ${DEMO_EMAIL}`);
  return existing.id;
}

function buildPriceSeries(product: SeedProduct, userId: string) {
  const rows = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let i = DAYS - 1; i >= 0; i--) {
    const t = (DAYS - 1 - i) / (DAYS - 1); // 0 → 1 ao longo do período
    const trend = product.startPrice + (product.endPrice - product.startPrice) * t;
    const noise = (Math.random() - 0.5) * product.startPrice * 0.03; // ±1.5%
    const discounted = Math.round((trend + noise) * 100) / 100;
    const full = Math.round(discounted * 1.12 * 100) / 100; // preço "de" ~12% acima

    rows.push({
      user_id: userId,
      tracked_product_id: product.id,
      date: new Date(now - i * dayMs).toISOString(),
      full_price: full,
      discounted_price: discounted,
      currency: CURRENCY,
      title: `${product.name} (demo)`,
      url: "https://books.toscrape.com/",
    });
  }

  return rows;
}

async function main() {
  if (!supabase) {
    console.error("[seed] Supabase não configurado. Preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.");
    process.exit(1);
  }

  const userId = await getOrCreateDemoUser();

  for (const product of PRODUCTS) {
    // Produto (idempotente)
    const { error: upsertProductError } = await supabase.from("tracked_products").upsert(
      {
        user_id: userId,
        id: product.id,
        name: product.name,
        search_query: product.searchQuery,
        marketplace: "books-to-scrape",
      },
      { onConflict: "user_id,id" }
    );
    if (upsertProductError) {
      console.error(`[seed] Erro no produto ${product.id}:`, upsertProductError.message);
      continue;
    }

    // Limpa histórico antigo do produto e reinsere
    await supabase.from("prices").delete().eq("user_id", userId).eq("tracked_product_id", product.id);

    const rows = buildPriceSeries(product, userId);
    const { error: insertError } = await supabase.from("prices").insert(rows);
    if (insertError) {
      console.error(`[seed] Erro ao inserir preços de ${product.id}:`, insertError.message);
      continue;
    }

    console.log(`[seed] ${product.name}: ${rows.length} registros inseridos.`);
  }

  console.log(`\n[seed] Concluído! Login demo → email: ${DEMO_EMAIL} | senha: ${DEMO_PASSWORD}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] Falha:", err);
  process.exit(1);
});
