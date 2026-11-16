// POST { token, action: "push", trades: [...] } | { token, action: "pull" }  -> the user's trade history backup
import { cfg, json, sb } from "../lib/pay.mjs";
import { accessMissing, deviceEmail } from "../lib/access.mjs";
const KEEP = ["t","acct","acctType","market","code","contract","stake","payout","profit","result","balanceAfter","source","bot","entry","exit","digit","cid"];
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const c = cfg(); if (accessMissing(c).length) return json({ error: "Not set up" }, 503);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  try {
    const email = await deviceEmail(c, String(b.token || ""));
    if (!email) return json({ error: "Unlock this device first (Account → My access)." }, 401);
    if (b.action === "push") {
      const rows = (Array.isArray(b.trades) ? b.trades : []).slice(0, 300).filter(t => t && +t.t > 0).map(t => {
        const d = {}; for (const k of KEEP) if (t[k] != null && (typeof t[k] !== "string" || t[k].length < 200)) d[k] = t[k];
        return { email, trade_id: `${+t.t}-${String(t.acct || "").slice(0, 30)}-${String(t.code || "").slice(0, 30)}`, data: d };
      });
      if (rows.length) await sb(c, "trade_history?on_conflict=email,trade_id", { method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows) }).catch(e => { if (!/null|JSON/i.test(e.message)) throw e; });
      return json({ ok: true, saved: rows.length });
    }
    if (b.action === "pull") {
      const rows = await sb(c, "trade_history?select=data&email=eq." + encodeURIComponent(email) + "&order=created_at.desc&limit=5000");
      return json({ ok: true, trades: (rows || []).map(r => r.data) });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: e.message }, 502); }
};
