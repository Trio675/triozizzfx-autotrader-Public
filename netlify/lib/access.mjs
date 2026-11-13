// Access control: who has paid, one-time email codes, one device per person, testers and admin.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { sb, cfg, missingDb, dbUpdate, finalize, PLANS } from "./pay.mjs";
import { sendMail, codeEmail, plainEmail } from "./mail.mjs";
import { eaById } from "./eas.mjs";

export const ADMIN_EMAIL = () => (process.env.ADMIN_EMAIL || "dennisombachi234@gmail.com").trim().toLowerCase();
const SECRET = () => process.env.ACCESS_SECRET || "";
export const accessMissing = (c) => [...missingDb(c), ...(SECRET() ? [] : ["ACCESS_SECRET"])];
export const normEmail = (e) => { e = String(e || "").trim().toLowerCase(); return /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120 ? e : null; };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const codeHash = (email, code) => sha(email + "|" + code + "|" + SECRET());
const FAR = "2099-12-31T00:00:00.000Z";
const nowIso = () => new Date().toISOString();

/** What this email can use right now. */
export async function accessFor(c, email) {
  if (!email) return { email: null, admin: false, binaryUntil: null, forexUntil: null };
  if (email === ADMIN_EMAIL()) return { email, admin: true, binaryUntil: FAR, forexUntil: FAR };
  const e = encodeURIComponent(email);
  const [pays, grants] = await Promise.all([
    sb(c, "payments?select=scope,expires_at&status=eq.paid&kind=eq.plan&payer=eq." + e),
    sb(c, "grants?select=scope,until&email=eq." + e) ]);
  const rows = [...(pays || []).map(p => ({ scope: p.scope, t: p.expires_at })), ...(grants || []).map(g => ({ scope: g.scope, t: g.until }))];
  const max = (ok) => rows.filter(r => r.t && ok(r.scope)).map(r => r.t).sort().pop() || null;
  return { email, admin: false, binaryUntil: max(s => s === "binary" || s === "both"), forexUntil: max(s => s === "forex" || s === "both") };
}
export const isActive = (a) => !!a && (a.admin || [a.binaryUntil, a.forexUntil].some(t => t && new Date(t) > new Date()));

/** New device token for an email. Signs out this email's other devices (admin may keep several). */
export async function newDevice(c, email, kind) {
  const token = randomBytes(32).toString("base64url"), h = sha(token);
  await sb(c, "devices", { method: "POST", body: JSON.stringify({ token_hash: h, email, kind: kind || "code" }) });
  if (email !== ADMIN_EMAIL())
    await sb(c, "devices?email=eq." + encodeURIComponent(email) + "&revoked_at=is.null&token_hash=neq." + h,
      { method: "PATCH", body: JSON.stringify({ revoked_at: nowIso() }) });
  return token;
}
export async function deviceEmail(c, token) {
  if (!token || token.length < 20) return null;
  const r = await sb(c, "devices?select=email,revoked_at,last_seen&token_hash=eq." + sha(token));
  const d = r && r[0];
  if (!d || d.revoked_at) return null;
  if (!d.last_seen || Date.now() - new Date(d.last_seen).getTime() > 3600000)
    sb(c, "devices?token_hash=eq." + sha(token), { method: "PATCH", body: JSON.stringify({ last_seen: nowIso() }) }).catch(() => {});
  return d.email;
}

/** Creates a one-time 6-digit code and emails it. */
export async function issueCode(c, email, { ttlMin, why, plan, expires } = {}) {
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  await sb(c, "access_codes", { method: "POST", body: JSON.stringify({ email, code_hash: codeHash(email, code),
    expires_at: new Date(Date.now() + (ttlMin || 30) * 60000).toISOString() }) });
  const sent = await sendMail(email, `Your TRIOZIZZFX access code: ${code}`, codeEmail(code, { why, plan, expires }));
  return { sent };
}
/** Checks a code. Right -> used up. Wrong 5 times -> the code is burned. */
export async function redeemCode(c, email, code) {
  const e = encodeURIComponent(email);
  const recent = await sb(c, "access_codes?select=id,attempts,created_at&email=eq." + e + "&created_at=gte." + encodeURIComponent(new Date(Date.now() - 15 * 60000).toISOString()));
  if ((recent || []).reduce((n, r) => n + (r.attempts || 0), 0) >= 8) return { error: "Too many wrong codes. Wait 15 minutes, then ask for a new code." };
  const live = await sb(c, "access_codes?select=id,code_hash,attempts&used_at=is.null&email=eq." + e +
    "&expires_at=gt." + encodeURIComponent(nowIso()) + "&order=created_at.desc&limit=5");
  if (!live || !live.length) return { error: "No valid code for this email. Ask for a new code." };
  const hit = live.find(r => r.code_hash === codeHash(email, code));
  if (!hit) {
    const top = live[0], n = (top.attempts || 0) + 1;
    await sb(c, "access_codes?id=eq." + top.id, { method: "PATCH", body: JSON.stringify(n >= 5 ? { attempts: n, used_at: nowIso() } : { attempts: n }) });
    return { error: n >= 5 ? "Wrong code too many times. Ask for a new code." : "That code isn't right. Check your email and try again." };
  }
  const used = await sb(c, "access_codes?id=eq." + hit.id + "&used_at=is.null", { method: "PATCH", body: JSON.stringify({ used_at: nowIso() }) });
  if (!used || !used.length) return { error: "That code was already used. Ask for a new code." };
  return { ok: true };
}

/** Signed, permanent download links for a paid EA order. */
export const dlSig = (orderId, eaId) => sha("dl|" + orderId + "|" + eaId + "|" + SECRET()).slice(0, 32);
export function downloadLinks(row, site) {
  return String(row.items || "").split(",").filter(Boolean).map(id => {
    const e = eaById(id);
    return { id, name: e ? e.version + " " + e.name : id,
      url: `${site}/.netlify/functions/ea-download?o=${encodeURIComponent(row.checkout_id)}&i=${encodeURIComponent(id)}&s=${dlSig(row.checkout_id, id)}` };
  });
}

/** Marks a pending payment with a verdict; when it becomes paid, emails the access code. */
export async function settle(c, id, row, verdict) {
  const upd = await dbUpdate(c, id, await finalize(c, row, verdict));
  if (upd && upd.status === "paid" && upd.kind === "ea" && upd.payer && upd.payer.includes("@")) {
    const site = (c.site || "").replace(/\/$/, ""), links = downloadLinks(upd, site);
    await sendMail(upd.payer, "Your TRIOZIZZFX Expert Advisors", plainEmail(`<p>Thank you for your purchase. Download your EAs here:</p><ul>${
      links.map(l => `<li><a href="${l.url}">${l.name}</a></li>`).join("")}</ul>
<p>These links keep working: save this email. Install: copy the file into MetaTrader 5 → File → Open Data Folder → MQL5 → Experts, then restart MT5.</p>
<p>Always test an EA on a demo account first.</p>`)).catch(e => console.error("ea email", e.message));
    return upd;
  }
  if (upd && upd.status === "paid" && upd.payer && upd.payer.includes("@")) {
    await issueCode(c, upd.payer, { ttlMin: 7 * 24 * 60, why: "Thank you for your payment. Here is your access code",
      plan: (PLANS[upd.plan] || {}).name, expires: upd.expires_at }).catch(e => console.error("code email", e.message));
  }
  return upd;
}
