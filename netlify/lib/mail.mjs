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
