// Shared helpers for M-Pesa (Daraja) + Supabase. Secrets come ONLY from Netlify environment variables.
const env = (k, d) => (process.env[k] ?? d);

/* ---- Plans: the price is decided here on the server, never by the browser ----
   Edit these to your real prices. days = how long access lasts after paying. */
export const PLANS = {
  test:  { name: "Test payment",  amount: 1,    days: 1  },
  week:  { name: "1 week",        amount: 500,  days: 7  },
  month: { name: "1 month",       amount: 1500, days: 30 },
};

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
  };
};

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
async function sb(c, path, opt = {}) {
  const r = await fetch(c.sbUrl + "/rest/v1/" + path, { ...opt, headers: {
    apikey: c.sbKey, Authorization: "Bearer " + c.sbKey, "Content-Type": "application/json",
    Prefer: "return=representation", ...(opt.headers || {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Database error (" + r.status + "): " + JSON.stringify(body).slice(0, 200));
  return body;
}
export const dbInsert = (c, row) => sb(c, "payments", { method: "POST", body: JSON.stringify(row) }).then(r => r && r[0]);
export const dbUpdate = (c, checkoutId, patch) =>
  sb(c, "payments?checkout_id=eq." + encodeURIComponent(checkoutId), { method: "PATCH", body: JSON.stringify(patch) }).then(r => r && r[0]);
export const dbGet = (c, checkoutId) =>
  sb(c, "payments?select=*&checkout_id=eq." + encodeURIComponent(checkoutId)).then(r => r && r[0]);
export const dbRecentForPhone = (c, phone, sinceIso) =>
  sb(c, "payments?select=checkout_id,created_at,status&phone=eq." + phone + "&created_at=gte." + encodeURIComponent(sinceIso) + "&order=created_at.desc&limit=5");

/** Turns a final result into the row update (sets access expiry on success). */
export function resultPatch(row, code, desc, receipt, paidAmount) {
  code = +code;
  if (code === 0) {
    if (paidAmount != null && +paidAmount < +row.amount)
      return { status: "failed", result_code: code, result_desc: `Paid ${paidAmount}, expected ${row.amount}` };
    const days = (PLANS[row.plan] || { days: 0 }).days;
    const now = new Date();
    return { status: "paid", result_code: 0, result_desc: desc || "Paid", receipt: receipt || row.receipt || null,
      paid_at: now.toISOString(), expires_at: new Date(now.getTime() + days * 86400000).toISOString() };
  }
  return { status: code === 1032 ? "cancelled" : "failed", result_code: code, result_desc: desc || "Not paid" };
}
