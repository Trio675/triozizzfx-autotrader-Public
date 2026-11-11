// GET ?id=<CheckoutRequestID or Pesapal OrderTrackingId>  ->  pending | paid | cancelled | failed
import { cfg, missingDb, json, timestamp, password, token, dbGet, dbUpdate, finalize, ppVerdict, PLANS } from "../lib/pay.mjs";

export default async (req) => {
  const c = cfg(); if (missingDb(c).length) return json({ error: "Payments aren't set up yet." }, 503);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[\w-]{6,80}$/.test(id)) return json({ error: "Bad id" }, 400);
  try {
    let row = await dbGet(c, id);
    if (!row) return json({ error: "Payment not found" }, 404);
    if (row.status === "pending") {
      let v = null;
      if (row.provider === "pesapal") v = await ppVerdict(c, id).catch(() => null);
      else if (Date.now() - new Date(row.created_at).getTime() > 20000) {
        const ts = timestamp();
        const r = await fetch(c.base + "/mpesa/stkpushquery/v1/query", { method: "POST",
          headers: { Authorization: "Bearer " + (await token(c)), "Content-Type": "application/json" },
          body: JSON.stringify({ BusinessShortCode: c.shortcode, Password: password(c, ts), Timestamp: ts, CheckoutRequestID: id }) });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.ResultCode != null && String(d.ResultCode) !== "")
          v = { ok: +d.ResultCode === 0, code: d.ResultCode, desc: d.ResultDesc, receipt: null, paidAmount: null };
      }
      if (v) row = (await dbUpdate(c, id, await finalize(c, row, v))) || (await dbGet(c, id)) || row;
    }
    const p = PLANS[row.plan] || {};
    return json({ status: row.status, desc: row.result_desc || "", receipt: row.receipt || "", expires: row.expires_at || null,
      plan: p.name || row.plan, amount: row.amount, bonus: row.bonus_days || 0, provider: row.provider });
  } catch (e) { return json({ error: e.message }, 502); }
};
