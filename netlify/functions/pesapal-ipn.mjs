// Pesapal calls this (GET) when a payment changes. We never trust the call itself: we ask Pesapal for the real status.
import { cfg, json, dbGet, ppVerdict } from "../lib/pay.mjs";
import { settle } from "../lib/access.mjs";

export default async (req) => {
  const c = cfg(), q = new URL(req.url).searchParams;
  const id = q.get("OrderTrackingId") || "", ref = q.get("OrderMerchantReference") || "", type = q.get("OrderNotificationType") || "IPNCHANGE";
  const reply = (status) => json({ orderNotificationType: type, orderTrackingId: id, orderMerchantReference: ref, status });
  if (!/^[\w-]{6,80}$/.test(id)) return reply(500);
  try {
    const row = await dbGet(c, id);
    if (row && row.status === "pending" && row.provider === "pesapal") {
      const v = await ppVerdict(c, id);
      if (v) await settle(c, id, row, v);
    }
    return reply(200);
  } catch (e) { console.error("pesapal ipn", e.message); return reply(500); }
};
