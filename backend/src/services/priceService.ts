import fs from "fs";
import path from "path";
import { supabase } from "../config/supabaseClient";
import { evaluateAlertsForPrice } from "./alertService";

export interface ProductToTrack {
  id: string;
  name: string;
  searchQuery: string;
  marketplace: "mercado-livre";
  user_id?: string;

  // Dados vindos do scraper
  price: number;
  originalPrice?: number;
  currency: string;
  title: string;
  url?: string;
}

export interface PriceHistoryItem {
  date: string;
  fullPrice: number;
  discountedPrice: number;
  currency: string;
  title: string;
  url: string;
}

const DATA_DIR = path.join(process.cwd(), "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getCsvPath(productId: string) {
  ensureDataDir();
  return path.join(DATA_DIR, `prices_${productId}.csv`);
}

function appendToCsv(productId: string, item: PriceHistoryItem) {
  const filePath = getCsvPath(productId);
  const exists = fs.existsSync(filePath);

  const line = `${item.date},${item.fullPrice},${item.discountedPrice},${item.currency},${JSON.stringify(
    item.title
  )},${item.url}\n`;

  if (!exists) {
    const header = "date,fullPrice,discountedPrice,currency,title,url\n";
    fs.writeFileSync(filePath, header + line, { encoding: "utf-8" });
  } else {
    fs.appendFileSync(filePath, line, { encoding: "utf-8" });
  }
}

/**
 * 🔹 Agora recebe o preço já buscado pelo frontend (não faz scraping no backend)
 */
export async function trackAndStorePrice(product: ProductToTrack) {
  if (product.marketplace !== "mercado-livre") {
    throw new Error("Marketplace não suportado ainda.");
  }

  const now = new Date().toISOString();

  const fullPrice =
    product.originalPrice && product.originalPrice > 0
      ? product.originalPrice
      : product.price;

  const record: PriceHistoryItem = {
    date: now,
    fullPrice,
    discountedPrice: product.price,
    currency: product.currency,
    title: product.title,
    url: product.url ?? "",
  };

  appendToCsv(product.id, record);

  if (supabase && product.user_id) {
    const { error } = await supabase.from("prices").insert({
      user_id: product.user_id,
      tracked_product_id: product.id,
      date: now,
      full_price: fullPrice,
      discounted_price: product.price,
      currency: product.currency,
      title: product.title,
      url: product.url,
    });

    if (error) {
      console.error("[Supabase] Erro ao inserir registro:", error.message);
    }
  }

  await evaluateAlertsForPrice({
    productId: product.id,
    currentPrice: record.discountedPrice,
    fullPrice: record.fullPrice,
    currency: record.currency,
    title: record.title,
    url: record.url,
  });

  console.log(`[PriceService] Preço registrado para ${product.id}: R$ ${product.price}`);

  return record;
}

export async function getPriceHistory(
  productId: string,
  _userId?: string | null
): Promise<PriceHistoryItem[]> {
  const csvPath = getCsvPath(productId);
  const itemsFromCsv: PriceHistoryItem[] = [];

  if (fs.existsSync(csvPath)) {
    const raw = fs.readFileSync(csvPath, "utf-8");
    const lines = raw.split("\n").slice(1).filter(Boolean);

    for (const line of lines) {
      const [date, fullPriceStr, discountedPriceStr, currency, titleJson, url] =
        line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);

      if (!date || !fullPriceStr || !discountedPriceStr) continue;

      itemsFromCsv.push({
        date,
        fullPrice: Number(fullPriceStr),
        discountedPrice: Number(discountedPriceStr),
        currency,
        title: titleJson ? JSON.parse(titleJson) : "",
        url: url || "",
      });
    }
  }

  if (supabase && _userId) {
    const { data, error } = await supabase
      .from("prices")
      .select("*")
      .eq("user_id", _userId)
      .eq("tracked_product_id", productId)
      .order("date", { ascending: true });

    if (error) {
      console.error("[Supabase] Erro ao buscar histórico:", error.message);
    } else if (data) {
      return data.map((row) => ({
        date: row.date,
        fullPrice: Number(row.full_price),
        discountedPrice: Number(row.discounted_price),
        currency: row.currency,
        title: row.title,
        url: row.url,
      }));
    }
  }

  return itemsFromCsv;
}