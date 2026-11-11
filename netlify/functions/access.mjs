// POST { action, ... }  ->  sendcode | redeem | claim | tester | me | logout
import { cfg, json, sb, dbGet } from "../lib/pay.mjs";
import { accessMissing, normEmail, accessFor, isActive, newDevice, deviceEmail, issueCode, redeemCode, ADMIN_EMAIL } from "../lib/access.mjs";
import { mailReady } from "../lib/mail.mjs";

const out = async (c, email, token) => json({ ok: true, token, access: await accessFor(c, email) });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const c = cfg(), miss = accessMissing(c);
  if (miss.length) return json({ error: "Access isn't set up yet. Missing: " + miss.join(", ") }, 503);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  try {
    switch (b.action) {
      case "sendcode": {
        const email = normEmail(b.email); if (!email) return json({ error: "Enter a valid email address." }, 400);
        if (!mailReady()) return json({ error: "Email codes aren't switched on yet. Contact TRIOZIZZFX support." }, 503);
        const e = encodeURIComponent(email), since = (ms) => encodeURIComponent(new Date(Date.now() - ms).toISOString());
        const [m1, h1] = await Promise.all([sb(c, "access_codes?select=id&email=eq." + e + "&created_at=gte." + since(60000)),
          sb(c, "access_codes?select=id&email=eq." + e + "&created_at=gte." + since(3600000))]);
        if ((m1 || []).length) return json({ error: "A code was just sent. Wait a minute before asking again." }, 429);
        if ((h1 || []).length >= 5) return json({ error: "Too many codes this hour. Try again later." }, 429);
        if (isActive(await accessFor(c, email))) await issueCode(c, email, { ttlMin: 30, why: "Here is your new access code" });
        return json({ ok: true, message: "If this email has an active plan, a 6-digit code is on its way. Check your inbox and spam folder." });
      }
      case "redeem": {
        const email = normEmail(b.email), code = String(b.code || "").replace(/\D/g, "");
        if (!email || code.length !== 6) return json({ error: "Enter your email and the 6-digit code." }, 400);
        const r = await redeemCode(c, email, code); if (r.error) return json({ error: r.error }, 400);
        return out(c, email, await newDevice(c, email, "code"));
      }
      case "claim": { // the browser that just paid unlocks itself once, without waiting for the email
        const id = String(b.id || ""); if (!/^[\w-]{6,80}$/.test(id)) return json({ error: "Bad id" }, 400);
        const row = await dbGet(c, id);
        if (!row || row.status !== "paid" || !row.payer || !row.payer.includes("@")) return json({ error: "Payment not confirmed yet." }, 400);
        const done = await sb(c, "payments?checkout_id=eq." + encodeURIComponent(id) + "&claimed_at=is.null", { method: "PATCH", body: JSON.stringify({ claimed_at: new Date().toISOString() }) });
        if (!done || !done.length) return json({ error: "This payment already unlocked a device. Use the code we emailed you." }, 409);
        return out(c, row.payer, await newDevice(c, row.payer, "payment"));
      }
      case "tester": {
        const email = normEmail(b.email), code = String(b.code || "").trim();
        const want = (process.env.TESTER_CODE || "").trim();
        if (!want) return json({ error: "There's no tester code right now." }, 400);
        if (!email) return json({ error: "Enter your email address." }, 400);
        if (code.toUpperCase() !== want.toUpperCase()) return json({ error: "That tester code isn't right." }, 400);
        const days = Math.max(1, +(process.env.TESTER_DAYS || 7));
        const prev = await sb(c, "grants?select=id&note=eq.tester&email=eq." + encodeURIComponent(email));
        if (prev && prev.length) return json({ error: "This email already used the tester code." }, 409);
        await sb(c, "grants", { method: "POST", body: JSON.stringify({ email, scope: "both", until: new Date(Date.now() + days * 86400000).toISOString(), note: "tester" }) });
        return out(c, email, await newDevice(c, email, "tester"));
      }
      case "me": {
        const email = await deviceEmail(c, String(b.token || ""));
        if (!email) return json({ ok: false, signedOut: true, error: "This device was signed out. Unlock it again with a code." }, 401);
        return json({ ok: true, access: await accessFor(c, email) });
      }
      case "logout": {
        const t = String(b.token || ""); if (t.length >= 20) await sb(c, "devices?token_hash=eq." + (await import("node:crypto")).createHash("sha256").update(t).digest("hex"),
          { method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
        return json({ ok: true });
      }
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) { return json({ error: e.message }, 502); }
};
