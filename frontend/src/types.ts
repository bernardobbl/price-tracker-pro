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


