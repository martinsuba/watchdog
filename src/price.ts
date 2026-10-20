export type Price = { amount: number; currency?: string };

const SYMBOLS: [RegExp, string][] = [
  [/€|\bEUR\b/i, "EUR"],
  [/\$|\bUSD\b/i, "USD"],
  [/£|\bGBP\b/i, "GBP"],
  [/\bCZK\b|Kč/i, "CZK"],
];

/**
 * Parses shop price strings ("2 999,00 €", "€2,999.00", "2.999 €", "371.95") into a number.
 * The currency is only set when the text names one. Throws on text without a number.
 */
export function parsePrice(text: string): Price {
  const currency = SYMBOLS.find(([re]) => re.test(text))?.[1];
  // first number-like run: digits with space, nbsp, thin space, dot, comma inside
  const m = /\d[\d\s\u00a0\u202f.,]*/.exec(text);
  if (!m) throw new Error(`cannot parse price from ${JSON.stringify(text.slice(0, 40))}`);
  const raw = m[0].replace(/[\s\u00a0\u202f]/g, "").replace(/[.,]+$/, "");
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    normalized = raw.replaceAll(thousands, "").replace(decimal, ".");
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
    if (sep === "") normalized = raw;
    else {
      const count = raw.split(sep).length - 1;
      const decimals = raw.length - raw.lastIndexOf(sep) - 1;
      // several separators, or exactly three digits after one: thousands separator
      normalized = count > 1 || decimals === 3 ? raw.replaceAll(sep, "") : raw.replace(sep, ".");
    }
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) throw new Error(`cannot parse price from ${JSON.stringify(text.slice(0, 40))}`);
  return currency === undefined ? { amount } : { amount, currency };
}
