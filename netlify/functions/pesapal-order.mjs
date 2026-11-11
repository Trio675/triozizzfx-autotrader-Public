// POST { plan, email, phone, account }  ->  { redirect } to Pesapal's page (Airtel Money, cards, bank, M-Pesa)
import { normEmail } from "../lib/access.mjs";
import { planFor, cfg, missingPp, json, normPhone, dbInsert, ppCall, ppIpn } from "../lib/pay.mjs";
import { randomUUID } from "node:crypto";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const c = cfg(), miss = missingPp(c);
  if (miss.length) return json({ error: "Card / Airtel payments aren't set up yet. Missing: " + miss.join(", ") }, 503);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const plan = planFor(b.plan, !c.ppLive);
  if (!plan) return json({ error: "Pick a plan." }, 400);
  const email = normEmail(b.email);
  if (!email) return json({ error: "Enter your email address. Your access code is sent there." }, 400);
  const phone = b.phone ? normPhone(b.phone) || String(b.phone).replace(/[^\d+]/g, "").slice(0, 16) : "";
  const account = String(b.account || "").replace(/[^\w.-]/g, "").slice(0, 40);
  try {
    const site = c.site || new URL(req.url).origin, ref = "TZ-" + randomUUID().slice(0, 18);
    const d = await ppCall(c, "/Transactions/SubmitOrderRequest", {
      id: ref, currency: "KES", amount: plan.kes, description: "TRIOZIZZFX " + plan.name,
      callback_url: site + "/?pay=pesapal", notification_id: await ppIpn(c, site),
      billing_address: { email_address: email, phone_number: phone || undefined, country_code: "KE" } });
    if (!d.order_tracking_id || !d.redirect_url) return json({ error: "Pesapal didn't start the payment." }, 502);
    await dbInsert(c, { provider: "pesapal", checkout_id: d.order_tracking_id, merchant_request_id: ref, phone: phone || "", email,
      payer: email, amount: plan.kes, currency: "KES", plan: b.plan, scope: plan.scope, account: account || null, status: "pending" });
    return json({ ok: true, id: d.order_tracking_id, redirect: d.redirect_url, sandbox: !c.ppLive });
  } catch (e) { return json({ error: e.message }, 502); }
};
