// POST { phone, plan, account }  ->  sends the M-Pesa PIN prompt to the phone
import { normEmail } from "../lib/access.mjs";
import { priceCart } from "../lib/eas.mjs";
import { planFor, cfg, missing, json, normPhone, timestamp, password, token, dbInsert, dbRecentForPhone } from "../lib/pay.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const c = cfg(), miss = missing(c);
  if (miss.length) return json({ error: "M-Pesa payments aren't set up yet. Missing: " + miss.join(", ") }, 503);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const cart = Array.isArray(b.eas) ? priceCart(b.eas) : null;
  if (cart && cart.error) return json({ error: cart.error }, 400);
  const phone = normPhone(b.phone), plan = cart ? { kes: cart.kes, name: cart.names.join(" + "), scope: null } : planFor(b.plan, !c.live);
  if (!phone) return json({ error: "Enter a Safaricom number like 0712345678." }, 400);
  const email = normEmail(b.email);
  if (!email) return json({ error: "Enter your email address. Your access code is sent there." }, 400);
  if (!plan) return json({ error: "Pick a plan." }, 400);
  const account = String(b.account || "").replace(/[^\w.-]/g, "").slice(0, 40);

  try {
    const recent = await dbRecentForPhone(c, phone, new Date(Date.now() - 60000).toISOString());
    if (recent && recent.length) return json({ error: "A prompt was just sent to this number. Wait a minute, then try again." }, 429);
  } catch (e) { return json({ error: e.message }, 502); }

  try {
    const ts = timestamp(), site = c.site || new URL(req.url).origin;
    const body = {
      BusinessShortCode: c.shortcode, Password: password(c, ts), Timestamp: ts, TransactionType: c.type,
      Amount: Math.round(plan.kes), PartyA: phone, PartyB: c.till, PhoneNumber: phone,
      CallBackURL: `${site}/.netlify/functions/mpesa-callback?k=${encodeURIComponent(c.cbSecret)}`,
      AccountReference: "TRIOZIZZFX", TransactionDesc: cart ? "TZ EA" : "TZ " + b.plan,
    };
    const r = await fetch(c.base + "/mpesa/stkpush/v1/processrequest", {
      method: "POST", headers: { Authorization: "Bearer " + (await token(c)), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || String(d.ResponseCode) !== "0")
      return json({ error: "M-Pesa didn't send the prompt: " + (d.errorMessage || d.ResponseDescription || d.CustomerMessage || r.status) }, 502);
    await dbInsert(c, { provider: "mpesa", checkout_id: d.CheckoutRequestID, merchant_request_id: d.MerchantRequestID, phone, email, payer: email,
      amount: plan.kes, currency: "KES", plan: cart ? "ea" : b.plan, scope: plan.scope, kind: cart ? "ea" : "plan", items: cart ? cart.ids.join(",") : null,
      account: account || null, status: "pending" });
    return json({ ok: true, id: d.CheckoutRequestID, amount: plan.kes, plan: plan.name, sandbox: !c.live });
  } catch (e) { return json({ error: e.message }, 502); }
};
