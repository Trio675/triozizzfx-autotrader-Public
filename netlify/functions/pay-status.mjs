// GET ?id=<CheckoutRequestID>  ->  pending | paid | cancelled | failed (asks M-Pesa directly if the callback is late)
import { cfg, missing, json, timestamp, password, token, dbGet, dbUpdate, resultPatch, PLANS } from "../lib/mpesa.mjs";

export default async (req) => {
  const c = cfg(); if (missing(c).length) return json({ error: "Payments aren't set up yet." }, 503);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[\w-]{6,80}$/.test(id)) return json({ error: "Bad id" }, 400);
  try {
    let row = await dbGet(c, id);
    if (!row) return json({ error: "Payment not found" }, 404);
    if (row.status === "pending" && Date.now() - new Date(row.created_at).getTime() > 20000) {
      const ts = timestamp();
      const r = await fetch(c.base + "/mpesa/stkpushquery/v1/query", { method: "POST",
        headers: { Authorization: "Bearer " + (await token(c)), "Content-Type": "application/json" },
        body: JSON.stringify({ BusinessShortCode: c.shortcode, Password: password(c, ts), Timestamp: ts, CheckoutRequestID: id }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ResultCode != null && String(d.ResultCode) !== "") {
        row = (await dbUpdate(c, id, resultPatch(row, d.ResultCode, d.ResultDesc, null, null))) || row;
      }
    }
    return json({ status: row.status, desc: row.result_desc || "", receipt: row.receipt || "", expires: row.expires_at || null,
      plan: (PLANS[row.plan] || {}).name || row.plan, amount: row.amount });
  } catch (e) { return json({ error: e.message }, 502); }
};
