// POST { plan, email, txn } -> records a PayPal payment for the admin to check and approve
import { cfg, json, planFor, dbInsert } from "../lib/pay.mjs";
import { accessMissing, normEmail, ADMIN_EMAIL } from "../lib/access.mjs";
import { sendMail, plainEmail } from "../lib/mail.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const c = cfg(); if (accessMissing(c).length) return json({ error: "PayPal payments aren't set up yet." }, 503);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const plan = planFor(b.plan, false), email = normEmail(b.email), txn = String(b.txn || "").trim().toUpperCase();
  if (!plan) return json({ error: "Pick a plan." }, 400);
  if (!email) return json({ error: "Enter your email address. Your access code is sent there." }, 400);
  if (!/^[A-Z0-9]{10,24}$/.test(txn)) return json({ error: "Enter the PayPal transaction ID from your PayPal receipt (letters and numbers, about 17 characters)." }, 400);
  try {
    await dbInsert(c, { provider: "paypal", checkout_id: "PP-" + txn, receipt: txn, phone: "", email, payer: email, amount: plan.usd, currency: "USD",
      plan: b.plan, scope: plan.scope, account: String(b.account || "").replace(/[^\w.-]/g, "").slice(0, 40) || null, status: "pending" });
  } catch (e) {
    if (/409|duplicate/i.test(e.message)) return json({ error: "This transaction ID was already submitted." }, 409);
    return json({ error: e.message }, 502);
  }
  sendMail(ADMIN_EMAIL(), `PayPal payment to check: $${plan.usd} · ${plan.name}`,
    plainEmail(`<p><b>${email}</b> says they paid <b>$${plan.usd}</b> for <b>${plan.name}</b>.</p><p>PayPal transaction ID: <b>${txn}</b></p>
<p>Check it in your PayPal account, then approve or reject it on the app's <b>Admin</b> page.</p>`)).catch(() => {});
  return json({ ok: true, id: "PP-" + txn, message: "Thank you! We'll check your PayPal payment and email your access code once it's approved." });
};
