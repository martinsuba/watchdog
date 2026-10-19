// Builders for synthetic listing pages matching DEFAULT_SELECTORS in harness.ts.
export type TestSize = string | { label: string; available: boolean };
export type TestProduct = {
  name: string;
  price: number;
  listPrice?: number;
  sizes?: TestSize[];
  /** href of the product link, default /p/<slug of name> */
  href?: string;
  /** currency symbol, default € */
  symbol?: string;
};

export function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** 2999 -> "2 999,00 €" (one of the formats parsePrice must understand) */
export function fmtPrice(amount: number, symbol = "€"): string {
  const [int = "", dec = "00"] = amount.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return symbol === "€" ? `${grouped},${dec} €` : `${symbol}${int}.${dec}`;
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "x"
  );
}

export function productHtml(p: TestProduct): string {
  const sizes = (p.sizes ?? [])
    .map((s) => (typeof s === "string" ? { label: s, available: true } : s))
    .map((s) => `<li class="size${s.available ? "" : " unavailable"}">${escapeHtml(s.label)}</li>`)
    .join("");
  return `<article class="item">
  <a class="link" href="${escapeHtml(p.href ?? `/p/${slug(p.name)}`)}"><h2 class="name">${escapeHtml(p.name)}</h2></a>
  <span class="price">${fmtPrice(p.price, p.symbol)}</span>
  ${p.listPrice === undefined ? "" : `<span class="list-price">${fmtPrice(p.listPrice, p.symbol)}</span>`}
  <ul class="sizes">${sizes}</ul>
</article>`;
}

/** A correctly structured listing page (has the #product-list marker); zero products is valid. */
export function listingHtml(products: TestProduct[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sale</title></head>
<body><main id="product-list">
${products.map(productHtml).join("\n")}
</main></body></html>`;
}
