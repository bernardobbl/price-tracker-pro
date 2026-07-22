export interface PriceHistoryItem {
  date: string;
  fullPrice: number;
  discountedPrice: number;
  currency: string;
  title: string;
  url: string;
}

export interface TrackedProduct {
  id: string;
  name: string;
  searchQuery: string;
  marketplace: string;
}

export interface Alert {
  id: string;
  tracked_product_id: string;
  threshold_price: number;
  currency: string;
  enabled: boolean;
  triggered: boolean;
  created_at: string;
}


