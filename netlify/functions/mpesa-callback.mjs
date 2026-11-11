// Safaricom calls this with the payment result. Protected by the secret ?k= in the callback URL.
import { cfg, json, dbGet, dbUpdate, finalize } from "../lib/pay.mjs";

export default async (req) => {
  const c = cfg(), k = new URL(req.url).searchParams.get("k");
  if (!c.cbSecret || k !== c.cbSecret) return json({ ResultCode: 1, ResultDesc: "Rejected" }, 403);
  let b; try { b = await req.json(); } catch { return json({ ResultCode: 0, ResultDesc: "Accepted" }); }
  const cb = b && b.Body && b.Body.stkCallback;
  if (!cb || !cb.CheckoutRequestID) return json({ ResultCode: 0, ResultDesc: "Accepted" });
  try {
    const row = await dbGet(c, cb.CheckoutRequestID);
    if (row && row.status === "pending" && row.provider !== "pesapal") {
      const items = Object.fromEntries(((cb.CallbackMetadata && cb.CallbackMetadata.Item) || []).map(i => [i.Name, i.Value]));
      await dbUpdate(c, cb.CheckoutRequestID, await finalize(c, row, { ok: +cb.ResultCode === 0, code: cb.ResultCode, desc: cb.ResultDesc,
        receipt: items.MpesaReceiptNumber, paidAmount: items.Amount }));
    }
  } catch (e) { console.error("mpesa callback", e.message); }
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
};
