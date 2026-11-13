/* ---- Expert Advisor shop (one-time purchases). Prices decided here, never by the browser. ----
   file: path of the .ex5/.zip in the private Supabase Storage bucket "eas". null = "Coming soon" (can't be bought). */
export const EAS = [
  { id: "tz-v1.0", version: "TZ V1.0", name: "Triozizz Flipping", kes: 5000, usd: 39, platform: "MetaTrader 5",
    trades: "Volatility indices, forex majors and gold",
    how: "Flips direction with short-term momentum, with a fixed stop loss and take profit on every trade.", file: null },
  { id: "tz-v2.0", version: "TZ V2.0", name: "High-Frequency Scalper", kes: 5000, usd: 39, platform: "MetaTrader 5",
    trades: "Volatility indices, forex, gold and Bitcoin",
    how: "Many quick scalps on small moves, with tight stops, a spread filter and a daily loss limit.", file: null },
  { id: "tz-v3.0", version: "TZ V3.0", name: "EMA Trend", kes: 5000, usd: 39, platform: "MetaTrader 5",
    trades: "Forex majors and gold",
    how: "Trades in the direction of fast/slow EMA crossovers, with stops sized from market volatility (ATR) and a trailing stop.", file: null },
];
/** Bundle discounts: 2 EAs 10%, 3 EAs 15%, 4 EAs 20%, 5 or more 30%. */
export const BUNDLE = [[5, 30], [4, 20], [3, 15], [2, 10]];
export const discountFor = (n) => (BUNDLE.find(([k]) => n >= k) || [0, 0])[1];
export const eaById = (id) => EAS.find(e => e.id === id);
export const eaPublic = (e) => ({ id: e.id, version: e.version, name: e.name, kes: e.kes, usd: e.usd, platform: e.platform,
  trades: e.trades, how: e.how, available: !!e.file });

/** Price a cart. Only EAs that can be downloaded can be bought. */
export function priceCart(ids) {
  const uniq = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 50);
  const items = uniq.map(eaById);
  if (!uniq.length) return { error: "Your cart is empty." };
  if (items.some(x => !x)) return { error: "One of the EAs in your cart doesn't exist." };
  const off = items.filter(x => !x.file);
  if (off.length) return { error: off.map(x => x.version).join(", ") + " isn't on sale yet." };
  const pct = discountFor(items.length);
  const kes = Math.round(items.reduce((s, x) => s + x.kes, 0) * (100 - pct) / 100);
  const usd = Math.round(items.reduce((s, x) => s + x.usd, 0) * (100 - pct)) / 100;
  return { ids: items.map(x => x.id), names: items.map(x => x.version + " " + x.name), pct, kes, usd };
}
