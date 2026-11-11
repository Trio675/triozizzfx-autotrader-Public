// POST { phone, plan, account }  ->  sends the M-Pesa PIN prompt to the phone
import { PLANS, cfg, missing, json, normPhone, timestamp, password, token, dbInsert, dbRecentForPhone } from "../lib/mpesa.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const c = cfg(), miss = missing(c);
  if (miss.length) return json({ error: "Payments aren't set up yet. Missing: " + miss.join(", ") }, 503);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const phone = normPhone(b.phone), plan = PLANS[b.plan];
  if (!phone) return json({ error: "Enter a Safaricom number like 0712345678." }, 400);
  if (!plan) return json({ error: "Pick a plan." }, 400);
  const account = String(b.account || "").replace(/[^\w.-]/g, "").slice(0, 40);

  // Stop prompt spamming: one prompt per number every 60 seconds
  try {
    const recent = await dbRecentForPhone(c, phone, new Date(Date.now() - 60000).toISOString());
    if (recent && recent.length) return json({ error: "A prompt was just sent to this number. Wait a minute, then try again." }, 429);
  } catch (e) { return json({ error: e.message }, 502); }

  try {
    const ts = timestamp(), site = c.site || new URL(req.url).origin;
    const body = {
      BusinessShortCode: c.shortcode, Password: password(c, ts), Timestamp: ts, TransactionType: c.type,
      Amount: Math.round(plan.amount), PartyA: phone, PartyB: c.till, PhoneNumber: phone,
      CallBackURL: `${site}/.netlify/functions/mpesa-callback?k=${encodeURIComponent(c.cbSecret)}`,
      AccountReference: "TRIOZIZZFX", TransactionDesc: ("TZ " + plan.name).slice(0, 13),
    };
    const r = await fetch(c.base + "/mpesa/stkpush/v1/processrequest", {
      method: "POST", headers: { Authorization: "Bearer " + (await token(c)), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || String(d.ResponseCode) !== "0")
      return json({ error: "M-Pesa didn't send the prompt: " + (d.errorMessage || d.ResponseDescription || d.CustomerMessage || r.status) }, 502);
    await dbInsert(c, { checkout_id: d.CheckoutRequestID, merchant_request_id: d.MerchantRequestID, phone, amount: plan.amount,
      plan: b.plan, account: account || null, status: "pending" });
    return json({ ok: true, id: d.CheckoutRequestID, amount: plan.amount, plan: plan.name,
      message: "Check your phone and enter your M-Pesa PIN.", sandbox: !c.live });
  } catch (e) { return json({ error: e.message }, 502); }
};
