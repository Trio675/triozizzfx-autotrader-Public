// Sends email with Resend (RESEND_API_KEY + EMAIL_FROM) or Gmail (GMAIL_USER + GMAIL_APP_PASSWORD).
const env = (k) => process.env[k] || "";
export const mailReady = () => !!((env("RESEND_API_KEY") && env("EMAIL_FROM")) || (env("GMAIL_USER") && env("GMAIL_APP_PASSWORD")));

export async function sendMail(to, subject, html) {
  try {
    if (env("RESEND_API_KEY") && env("EMAIL_FROM")) {
      const r = await fetch("https://api.resend.com/emails", { method: "POST",
        headers: { Authorization: "Bearer " + env("RESEND_API_KEY"), "Content-Type": "application/json" },
        body: JSON.stringify({ from: env("EMAIL_FROM"), to: [to], subject, html }) });
      if (!r.ok) throw new Error("Resend " + r.status + " " + (await r.text()).slice(0, 160));
      return true;
    }
    if (env("GMAIL_USER") && env("GMAIL_APP_PASSWORD")) {
      const nodemailer = (await import("nodemailer")).default;
      const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD").replace(/\s/g, "") } });
      await t.sendMail({ from: `TRIOZIZZFX <${env("GMAIL_USER")}>`, to, subject, html });
      return true;
    }
    console.log("Email not set up; would send to", to, ":", subject);
    return false;
  } catch (e) { console.error("sendMail", e.message); return false; }
}

const wrap = (body) => `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:20px;color:#111">
<h2 style="margin:0 0 12px">TRIOZIZZFX</h2>${body}
<p style="color:#777;font-size:12px;margin-top:24px">Trading carries risk. Payments are non-refundable. If you didn't ask for this, ignore this email.</p></div>`;

export function codeEmail(code, { plan, expires, why }) {
  return wrap(`<p>${why || "Here is your access code"}:</p>
<p style="font-size:34px;letter-spacing:8px;font-weight:bold;margin:8px 0">${code}</p>
<p>Open the TRIOZIZZFX app → <b>Account</b> → <b>My access</b>, enter your email and this code, and tap <b>Unlock</b>.</p>
<p>The code works <b>once</b>, on <b>one device</b>. Using it on a new device signs out the old one.</p>
${plan ? `<p>Plan: <b>${plan}</b>${expires ? `<br>Active until: <b>${new Date(expires).toUTCString()}</b>` : ""}</p>` : ""}`);
}
export const plainEmail = (html) => wrap(html);

/** Emails the admin when something breaks (at most once per 30 minutes per kind). */
export async function alertAdmin(c, sbFn, kind, msg) {
  try {
    const admin = (process.env.ADMIN_EMAIL || "dennisombachi234@gmail.com").trim();
    if (!mailReady() || !c.sbUrl) return;
    const since = encodeURIComponent(new Date(Date.now() - 30 * 60000).toISOString());
    const recent = await sbFn(c, "alerts?select=id&kind=eq." + encodeURIComponent(kind) + "&created_at=gte." + since);
    await sbFn(c, "alerts", { method: "POST", body: JSON.stringify({ kind, msg: String(msg).slice(0, 500) }) });
    if (recent && recent.length) return;
    await sendMail(admin, "TRIOZIZZFX alert: " + kind, wrap(`<p><b>${kind}</b></p><p>${String(msg).replace(/</g, "&lt;").slice(0, 500)}</p>
<p>More of the same in the next 30 minutes won't be emailed. Check Netlify → Logs → Functions.</p>`));
  } catch (e) { console.error("alertAdmin", e.message); }
}
