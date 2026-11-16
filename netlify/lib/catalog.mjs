// Admin-editable prices and EA list (Supabase "settings" table), merged over the defaults in code.
import { sb, PLANS } from "./pay.mjs";
import { EAS } from "./eas.mjs";
const DEFAULT_PLANS = JSON.parse(JSON.stringify(PLANS)), DEFAULT_EAS = JSON.parse(JSON.stringify(EAS));
let cache = { at: 0 };
const num = (v, lo, hi) => { v = +v; return isFinite(v) && v >= lo && v <= hi ? v : null; };
const str = (v, n) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, n);

export function cleanPlans(o) {
  const out = {};
  for (const [id, p] of Object.entries(o || {})) {
    if (!DEFAULT_PLANS[id] || DEFAULT_PLANS[id].sandboxOnly) continue;
    const r = {};
    if (num(p.kes, 1, 1e6) != null) r.kes = Math.round(+p.kes);
    if (num(p.usd, 0, 1e5) != null) r.usd = Math.round(+p.usd * 100) / 100;
    if (num(p.days, 1, 3650) != null) r.days = Math.round(+p.days);
    if (p.name) r.name = str(p.name, 60);
    r.hidden = !!p.hidden;
    out[id] = r;
  }
  return out;
}
export function cleanEas(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set(), out = [];
  for (const e of list.slice(0, 100)) {
    const id = str(e.id, 30).toLowerCase().replace(/[^a-z0-9.-]/g, "");
    if (!id || seen.has(id) || num(e.kes, 1, 1e7) == null) continue; seen.add(id);
    out.push({ id, version: str(e.version, 20) || id.toUpperCase(), name: str(e.name, 60), kes: Math.round(+e.kes), usd: num(e.usd, 0, 1e5) ?? 0,
      platform: str(e.platform, 30) || "MetaTrader 5", trades: str(e.trades, 160), how: str(e.how, 400),
      file: e.file ? str(e.file, 120).replace(/^\/+/, "").replace(/\.\./g, "") : null, hidden: !!e.hidden });
  }
  return out;
}
/** Loads the admin's overrides into PLANS and EAS (cached 60 s). Call at the start of a handler. */
export async function useCatalog(c, force) {
  if (!c.sbUrl || !c.sbKey) return;
  if (!force && Date.now() - cache.at < 60000) return;
  try {
    const rows = await sb(c, "settings?select=key,value&key=in.(plans,eas)");
    const m = Object.fromEntries((rows || []).map(r => [r.key, r.value]));
    for (const k of Object.keys(PLANS)) PLANS[k] = { ...DEFAULT_PLANS[k] };
    for (const [id, o] of Object.entries(cleanPlans(m.plans))) Object.assign(PLANS[id], o);
    const eas = cleanEas(m.eas) || DEFAULT_EAS;
    EAS.splice(0, EAS.length, ...JSON.parse(JSON.stringify(eas)));
    cache.at = Date.now();
  } catch (e) { console.error("catalog", e.message); }
}
export const catalogDefaults = () => ({ plans: DEFAULT_PLANS, eas: DEFAULT_EAS });
export async function saveSetting(c, key, value) {
  await sb(c, "settings?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
  cache.at = 0;
}
