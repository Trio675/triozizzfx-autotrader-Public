// Admin only (device unlocked with the admin email). POST { token, op, ... }
import { cfg, json, sb, dbGet, dbUpdate, PLANS } from "../lib/pay.mjs";
import { accessMissing, deviceEmail, ADMIN_EMAIL, normEmail, settle, issueCode } from "../lib/access.mjs";
import { mailReady } from "../lib/mail.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const c = cfg(); if (accessMissing(c).length) return json({ error: "Not set up" }, 503);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  try {
    if ((await deviceEmail(c, String(b.token || ""))) !== ADMIN_EMAIL()) return json({ error: "Admins only." }, 403);
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
      default: return json({ error: "Unknown op" }, 400);
    }
  } catch (e) { return json({ error: e.message }, 502); }
};
