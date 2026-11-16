import { useCatalog } from "../lib/catalog.mjs";
// Safaricom calls this with the payment result. Protected by the secret ?k= in the callback URL.
import { cfg, json, dbGet } from "../lib/pay.mjs";
import { settle } from "../lib/access.mjs";
import { alertAdmin } from "../lib/mail.mjs";
import { sb } from "../lib/pay.mjs";

export default async (req) => {
  const c = cfg(), k = new URL(req.url).searchParams.get("k");
  await useCatalog(c);
  if (!c.cbSecret || k !== c.cbSecret) return json({ ResultCode: 1, ResultDesc: "Rejected" }, 403);
  let b; try { b = await req.json(); } catch { return json({ ResultCode: 0, ResultDesc: "Accepted" }); }
  const cb = b && b.Body && b.Body.stkCallback;
  if (!cb || !cb.CheckoutRequestID) return json({ ResultCode: 0, ResultDesc: "Accepted" });
  try {
    const row = await dbGet(c, cb.CheckoutRequestID);
    if (row && row.status === "pending" && row.provider !== "pesapal") {
      const items = Object.fromEntries(((cb.CallbackMetadata && cb.CallbackMetadata.Item) || []).map(i => [i.Name, i.Value]));
      await settle(c, cb.CheckoutRequestID, row, { ok: +cb.ResultCode === 0, code: cb.ResultCode, desc: cb.ResultDesc,
        receipt: items.MpesaReceiptNumber, paidAmount: items.Amount });
    }
  } catch (e) { console.error("mpesa callback", e.message); alertAdmin(c, sb, "M-Pesa result couldn't be saved", cb.CheckoutRequestID + ": " + e.message); }
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
};
