// Admin only (device unlocked with the admin email). POST { token, op, ... }
import { cfg, json, sb, dbGet, dbUpdate, PLANS } from "../lib/pay.mjs";
import { accessMissing, deviceEmail, ADMIN_EMAIL, normEmail, settle, issueCode } from "../lib/access.mjs";
import { mailReady } from "../lib/mail.mjs";
import { useCatalog, saveSetting, cleanPlans, cleanEas, catalogDefaults } from "../lib/catalog.mjs";
import { EAS } from "../lib/eas.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const c = cfg(); if (accessMissing(c).length) return json({ error: "Not set up" }, 503);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  try {
    if ((await deviceEmail(c, String(b.token || ""))) !== ADMIN_EMAIL()) return json({ error: "Admins only." }, 403);
    await useCatalog(c, true);
    switch (b.op) {
      case "list": {
        const [review, recent, grants] = await Promise.all([
          sb(c, "payments?select=*&provider=eq.paypal&status=eq.pending&order=created_at.desc&limit=50"),
          sb(c, "payments?select=created_at,provider,payer,phone,plan,kind,items,amount,currency,status,receipt,expires_at,bonus_days&order=created_at.desc&limit=60"),
          sb(c, "grants?select=*&order=created_at.desc&limit=60") ]);
        const paid = (recent || []).filter(p => p.status === "paid");
        return json({ ok: true, review, recent, grants, mail: mailReady(), plans: PLANS,
          stats: { paid: paid.length, kes: paid.filter(p => p.currency === "KES").reduce((s, p) => s + +p.amount, 0),
            usd: paid.filter(p => p.currency === "USD").reduce((s, p) => s + +p.amount, 0) } });
      }
      case "approve": case "reject": {
        const id = String(b.id || ""), row = await dbGet(c, id);
        if (!row || row.provider !== "paypal" || row.status !== "pending") return json({ error: "Nothing to review with that id." }, 400);
        const upd = b.op === "approve" ? await settle(c, id, row, { ok: true, code: 0, desc: "Approved by admin", receipt: row.receipt })
          : await dbUpdate(c, id, { status: "failed", result_desc: "Rejected by admin" });
        return json({ ok: true, row: upd });
      }
      case "grant": {
        const email = normEmail(b.email), days = Math.round(+b.days), scope = ["binary", "forex", "both"].includes(b.scope) ? b.scope : "both";
        if (!email || !(days >= 1 && days <= 3650)) return json({ error: "Enter an email and 1–3650 days." }, 400);
        const until = new Date(Date.now() + days * 86400000).toISOString();
        await sb(c, "grants", { method: "POST", body: JSON.stringify({ email, scope, until, note: String(b.note || "admin").slice(0, 60) }) });
        const r = b.sendCode ? await issueCode(c, email, { ttlMin: 7 * 24 * 60, why: `You've been given ${days} days of TRIOZIZZFX access. Here is your access code`, expires: until }) : null;
        return json({ ok: true, until, sent: r ? r.sent : false });
      }
      case "sendcode": {
        const email = normEmail(b.email); if (!email) return json({ error: "Enter a valid email." }, 400);
        const r = await issueCode(c, email, { ttlMin: 7 * 24 * 60, why: "Here is your TRIOZIZZFX access code" });
        return json({ ok: true, sent: r.sent });
      }
      case "announce": {
        const text = String(b.text || "").replace(/[<>]/g, "").trim().slice(0, 300);
        if (!text) return json({ error: "Write the announcement first." }, 400);
        const kind = ["info", "offer", "warning"].includes(b.kind) ? b.kind : "info", days = Math.round(+b.days) || 0;
        const link = /^https?:\/\/[^\s"'<>]{3,200}$/.test(String(b.link || "")) ? b.link : null;
        await sb(c, "announcements", { method: "POST", body: JSON.stringify({ text, kind, link, active: true,
          expires_at: days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null }) });
        return json({ ok: true });
      }
      case "announcements": return json({ ok: true, items: await sb(c, "announcements?select=*&order=created_at.desc&limit=30") });
      case "unannounce": {
        await sb(c, "announcements?id=eq." + (+b.id || 0), { method: "PATCH", body: JSON.stringify({ active: false }) });
        return json({ ok: true });
      }
      case "catalog": return json({ ok: true, plans: PLANS, eas: EAS, defaults: catalogDefaults() });
      case "saveplans": { await saveSetting(c, "plans", cleanPlans(b.plans)); await useCatalog(c, true); return json({ ok: true, plans: PLANS }); }
      case "saveeas": {
        const list = cleanEas(b.eas); if (!list || !list.length) return json({ error: "Add at least one EA with an id and a price." }, 400);
        await saveSetting(c, "eas", list); await useCatalog(c, true); return json({ ok: true, eas: EAS });
      }
      case "licenses": {
        const q = normEmail(b.email);
        return json({ ok: true, items: await sb(c, "licenses?select=*" + (q ? "&email=eq." + encodeURIComponent(q) : "") + "&order=created_at.desc&limit=60") });
      }
      case "license_reset": case "license_revoke": {
        const key = String(b.key || "").toUpperCase(); if (!/^TZ(-[A-Z0-9]{4}){4}$/.test(key)) return json({ error: "Bad key" }, 400);
        await sb(c, "licenses?key=eq." + key, { method: "PATCH", body: JSON.stringify(b.op === "license_reset" ? { account: null, bound_at: null } : { revoked_at: new Date().toISOString() }) });
        return json({ ok: true });
      }
      default: return json({ error: "Unknown op" }, 400);
    }
  } catch (e) { return json({ error: e.message }, 502); }
};
