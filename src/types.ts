export type Size = { label: string; available: boolean };

export type Offer = {
  id: string;
  name: string;
  url: string;
  price: number;
  listPrice?: number;
  currency: string;
  sizes: Size[];
  inStock: boolean;
};

export type Match = {
  nameIncludes?: string[];
  nameExcludes?: string[];
  maxPrice?: number;
  minDiscountPct?: number;
  sizes?: string[];
};

export type Selectors = {
  pageMarker: string;
  item: string;
  name: string;
  price: string;
  listPrice?: string;
  sizes?: string;
  link?: string;
};

export type Watch = {
  id: string;
  name: string;
  site: string;
  urls: string[];
  currency: string;
  match: Match;
  note?: string;
  enabled: boolean;
  selectors?: Selectors;
};

export type AlertedOffer = { price: number; sizes: string[] };
export type WatchState = { broken: null | { reason: string; since: string }; alerted: Record<string, AlertedOffer> };
export type State = Record<string, WatchState>;
