// Called by TZ EAs from MT5:  GET/POST ?key=TZ-XXXX-XXXX-XXXX-XXXX&account=12345678&ea=tz-v1.0
// Reply (text): "OK|<message>" or "NO|<message>". The first account that uses a key keeps it.
import { cfg, sb } from "../lib/pay.mjs";
import { accessMissing } from "../lib/access.mjs";
const reply = (ok, msg) => new Response((ok ? "OK|" : "NO|") + msg, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
export default async (req) => {
  const c = cfg(); if (accessMissing(c).length) return reply(false, "Licence server not set up");
  const u = new URL(req.url); let p = Object.fromEntries(u.searchParams);
  if (req.method === "POST") { try { const t = await req.text(); p = { ...p, ...Object.fromEntries(new URLSearchParams(t)) }; } catch {} }
  const key = String(p.key || "").trim().toUpperCase(), account = String(p.account || "").replace(/\D/g, "").slice(0, 20), ea = String(p.ea || "").toLowerCase();
  if (!/^TZ(-[A-Z0-9]{4}){4}$/.test(key)) return reply(false, "Licence key format is wrong");
  if (!account) return reply(false, "No MT5 account number");
  try {
    const r = await sb(c, "licenses?select=id,ea_id,account,revoked_at&key=eq." + key);
    const L = r && r[0];
    if (!L) return reply(false, "Licence key not found");
    if (L.revoked_at) return reply(false, "Licence was cancelled. Contact TRIOZIZZFX support");
    if (ea && L.ea_id !== ea) return reply(false, "This key is for a different EA (" + L.ea_id + ")");
    const now = new Date().toISOString();
    if (!L.account) {
      const done = await sb(c, "licenses?id=eq." + L.id + "&account=is.null", { method: "PATCH", body: JSON.stringify({ account, bound_at: now, last_check: now }) });
      if (done && done.length) return reply(true, "Licence activated for account " + account);
      return reply(false, "Licence is already in use. Contact TRIOZIZZFX support");
    }
    if (L.account !== account) return reply(false, "Licence is registered to another MT5 account");
    sb(c, "licenses?id=eq." + L.id, { method: "PATCH", body: JSON.stringify({ last_check: now }) }).catch(() => {});
    return reply(true, "Licence OK");
  } catch (e) { return reply(false, "Licence server busy, try again"); }
};
