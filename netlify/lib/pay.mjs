// Shared helpers for M-Pesa (Daraja) + Supabase. Secrets come ONLY from Netlify environment variables.
const env = (k, d) => (process.env[k] ?? d);

/* ---- Plans: the price is decided here on the server, never by the browser ----
   kes = what M-Pesa / Pesapal charge. usd is shown next to it. days = access length.
   scope: binary | forex | both.  "test" only appears while MPESA_ENV / PESAPAL_ENV are sandbox. */
export const FIRST_BONUS_DAYS = 5;
export const PLANS = {
  b1w: { name: "Binary · 1 week",          scope: "binary", usd: 5,  kes: 650,  days: 7  },
  b1m: { name: "Binary · 1 month",         scope: "binary", usd: 10, kes: 1300, days: 30 },
  f2w: { name: "Forex · 2 weeks",          scope: "forex",  usd: 15, kes: 1950, days: 14 },
  f1m: { name: "Forex · 1 month",          scope: "forex",  usd: 25, kes: 3250, days: 30 },
  a2w: { name: "Binary + Forex · 2 weeks", scope: "both",   usd: 20, kes: 2600, days: 14 },
  a1m: { name: "Binary + Forex · 1 month", scope: "both",   usd: 30, kes: 3900, days: 30 },
  test:{ name: "Test payment",             scope: "binary", usd: 0,  kes: 1,    days: 1, sandboxOnly: true },
};
export const planFor = (id, sandbox) => { const p = PLANS[id]; return p && (!p.sandboxOnly || sandbox) ? p : null; };

export const cfg = () => {
  const live = env("MPESA_ENV", "sandbox") === "production";
  return {
    live,
    base: live ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke",
    key: env("MPESA_CONSUMER_KEY", ""),
    secret: env("MPESA_CONSUMER_SECRET", ""),
    passkey: env("MPESA_PASSKEY", ""),
    // Sandbox: 174379 for both. Till (Buy Goods): SHORTCODE = your store/head-office number, TILL = till number.
    shortcode: env("MPESA_SHORTCODE", "174379"),
    till: env("MPESA_TILL", env("MPESA_SHORTCODE", "174379")),
    type: env("MPESA_TYPE", live ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline"),
    site: (env("SITE_URL", env("URL", "")) || "").replace(/\/$/, ""),
    cbSecret: env("CALLBACK_SECRET", ""),
    sbUrl: (env("SUPABASE_URL", "") || "").replace(/\/$/, ""),
    sbKey: env("SUPABASE_SERVICE_KEY", ""),
    // Pesapal (Airtel Money, cards, bank)
    ppLive: env("PESAPAL_ENV", "sandbox") === "production",
    ppBase: env("PESAPAL_ENV", "sandbox") === "production" ? "https://pay.pesapal.com/v3/api" : "https://cybqa.pesapal.com/pesapalv3/api",
    ppKey: env("PESAPAL_CONSUMER_KEY", ""),
    ppSecret: env("PESAPAL_CONSUMER_SECRET", ""),
    ppIpnId: env("PESAPAL_IPN_ID", ""),
  };
};

export function missingDb(c) {
  return Object.entries({ SUPABASE_URL: c.sbUrl, SUPABASE_SERVICE_KEY: c.sbKey }).filter(([, v]) => !v).map(([k]) => k);
}
export function missingPp(c) {
  return [...missingDb(c), ...Object.entries({ PESAPAL_CONSUMER_KEY: c.ppKey, PESAPAL_CONSUMER_SECRET: c.ppSecret }).filter(([, v]) => !v).map(([k]) => k)];
}
export function missing(c) {
  const need = { MPESA_CONSUMER_KEY: c.key, MPESA_CONSUMER_SECRET: c.secret, MPESA_PASSKEY: c.passkey,
    CALLBACK_SECRET: c.cbSecret, SUPABASE_URL: c.sbUrl, SUPABASE_SERVICE_KEY: c.sbKey };
  return Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
}

export const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** 07xx / 01xx / +2547xx / 2547xx  ->  2547xxxxxxxx (or null) */
export function normPhone(p) {
  const d = String(p || "").replace(/[^\d]/g, "");
  let m = d.match(/^(?:254|0)?([17]\d{8})$/);
  return m ? "254" + m[1] : null;
}

/** Daraja wants Kenyan local time, YYYYMMDDHHmmss */
export function timestamp(date = new Date()) {
  const t = new Date(date.getTime() + 3 * 3600 * 1000); // EAT = UTC+3, no daylight saving
  const z = n => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}${z(t.getUTCMonth() + 1)}${z(t.getUTCDate())}${z(t.getUTCHours())}${z(t.getUTCMinutes())}${z(t.getUTCSeconds())}`;
}
export const password = (c, ts) => Buffer.from(c.shortcode + c.passkey + ts).toString("base64");

let tokCache = { v: "", exp: 0 };
export async function token(c) {
  if (tokCache.v && Date.now() < tokCache.exp) return tokCache.v;
  const r = await fetch(c.base + "/oauth/v1/generate?grant_type=client_credentials", {
    headers: { Authorization: "Basic " + Buffer.from(c.key + ":" + c.secret).toString("base64") } });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw new Error("M-Pesa login failed (" + r.status + "). Check the consumer key and secret.");
  tokCache = { v: t.access_token, exp: Date.now() + (Math.max(60, +t.expires_in || 3599) - 60) * 1000 };
  return tokCache.v;
}

/* ---- Supabase REST (service key stays on the server) ---- */
export async function sb(c, path, opt = {}) {
  const r = await fetch(c.sbUrl + "/rest/v1/" + path, { ...opt, headers: {
    apikey: c.sbKey, Authorization: "Bearer " + c.sbKey, "Content-Type": "application/json",
    Prefer: "return=representation", ...(opt.headers || {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Database error (" + r.status + "): " + JSON.stringify(body).slice(0, 200));
  return body;
}
export const dbInsert = (c, row) => sb(c, "payments", { method: "POST", body: JSON.stringify(row) }).then(r => r && r[0]);
// Only moves a payment out of "pending" once, so a late callback can't overwrite a result.
export const dbUpdate = (c, checkoutId, patch) =>
  sb(c, "payments?checkout_id=eq." + encodeURIComponent(checkoutId) + "&status=eq.pending", { method: "PATCH", body: JSON.stringify(patch) }).then(r => r && r[0]);
const dbPaidForPayer = (c, payer) =>
  sb(c, "payments?select=scope,expires_at&status=eq.paid&payer=eq." + encodeURIComponent(payer));
export const dbGet = (c, checkoutId) =>
  sb(c, "payments?select=*&checkout_id=eq." + encodeURIComponent(checkoutId)).then(r => r && r[0]);
export const dbRecentForPhone = (c, phone, sinceIso) =>
  sb(c, "payments?select=checkout_id,created_at,status&phone=eq." + phone + "&created_at=gte." + encodeURIComponent(sinceIso) + "&order=created_at.desc&limit=5");

/** Final result -> row update. On success: +5 days on the payer's first ever payment,
    and renewals start when their current plan of the same type ends. */
export async function finalize(c, row, { ok, code, desc, receipt, paidAmount }) {
  if (!ok) return { status: +code === 1032 ? "cancelled" : "failed", result_code: +code || null, result_desc: desc || "Not paid" };
  if (paidAmount != null && +paidAmount < +row.amount)
    return { status: "failed", result_code: +code || 0, result_desc: `Paid ${paidAmount}, expected ${row.amount}` };
  const plan = PLANS[row.plan] || { days: 0, scope: row.scope };
  let prior = [];
  try { prior = row.payer ? (await dbPaidForPayer(c, row.payer)) || [] : []; } catch (e) { prior = []; }
  const bonus = prior.length === 0 && !plan.sandboxOnly ? FIRST_BONUS_DAYS : 0;
  const now = Date.now();
  const start = Math.max(now, ...prior.filter(p => p.scope === plan.scope && p.expires_at).map(p => new Date(p.expires_at).getTime()));
  return { status: "paid", result_code: +code || 0, result_desc: desc || "Paid", receipt: receipt || row.receipt || null,
    paid_at: new Date(now).toISOString(), bonus_days: bonus,
    expires_at: new Date(start + (plan.days + bonus) * 86400000).toISOString() };
}

/* ---- Pesapal API 3.0 ---- */
let ppTok = { v: "", exp: 0, base: "" };
export async function ppToken(c) {
  if (ppTok.v && ppTok.base === c.ppBase && Date.now() < ppTok.exp) return ppTok.v;
  const r = await fetch(c.ppBase + "/Auth/RequestToken", { method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ consumer_key: c.ppKey, consumer_secret: c.ppSecret }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error("Pesapal login failed: " + ((d.error && d.error.message) || r.status));
  ppTok = { v: d.token, exp: Date.now() + 4 * 60000, base: c.ppBase }; // Pesapal tokens last 5 minutes
  return ppTok.v;
}
export async function ppCall(c, path, body) {
  const r = await fetch(c.ppBase + path, { method: body ? "POST" : "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + (await ppToken(c)) },
    body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || (d.error && (d.error.message || d.error.code))) throw new Error("Pesapal: " + ((d.error && (d.error.message || d.error.code)) || r.status));
  return d;
}
let ppIpnCache = "";
/** IPN id: from PESAPAL_IPN_ID if set, otherwise registered once per server instance. */
export async function ppIpn(c, site) {
  if (c.ppIpnId) return c.ppIpnId;
  if (ppIpnCache) return ppIpnCache;
  const d = await ppCall(c, "/URLSetup/RegisterIPN", { url: site + "/.netlify/functions/pesapal-ipn", ipn_notification_type: "GET" });
  console.log("Pesapal IPN registered. Set PESAPAL_IPN_ID =", d.ipn_id);
  return (ppIpnCache = d.ipn_id);
}
/** Pesapal's verdict for an order -> finalize() input, or null while still pending. */
export async function ppVerdict(c, trackingId) {
  const d = await ppCall(c, "/Transactions/GetTransactionStatus?orderTrackingId=" + encodeURIComponent(trackingId));
  const sc = +d.status_code; // 1 completed, 2 failed, 3 reversed, 0 invalid / not finished
  const desc = d.payment_status_description || d.description || "";
  if (sc === 1) {
    const wrongCur = d.currency && String(d.currency).toUpperCase() !== "KES";
    return { ok: !wrongCur, code: 0, desc: wrongCur ? "Paid in " + d.currency + ", expected KES" : (desc + (d.payment_method ? " · " + d.payment_method : "")),
      receipt: d.confirmation_code || null, paidAmount: d.amount };
  }
  if (sc === 2 || sc === 3) return { ok: false, code: sc, desc: desc || (sc === 3 ? "Reversed" : "Failed") };
  return null;
}
