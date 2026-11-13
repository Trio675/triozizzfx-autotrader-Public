// GET ?o=<order>&i=<ea id>&s=<signature> -> short-lived link to the EA file in private Supabase Storage
import { cfg, json, dbGet } from "../lib/pay.mjs";
import { dlSig, accessMissing } from "../lib/access.mjs";
import { eaById } from "../lib/eas.mjs";
const page = (msg, code) => new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:Arial;background:#0b1020;color:#eee;padding:30px"><h2>TRIOZIZZFX</h2><p>${msg}</p><p><a style="color:#8aa0ff" href="/home/#shop">Back to the EA shop</a></p>`,
  { status: code, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
export default async (req) => {
  const c = cfg(); if (accessMissing(c).length) return page("Downloads aren't set up yet.", 503);
  const q = new URL(req.url).searchParams, o = q.get("o") || "", i = q.get("i") || "", s = q.get("s") || "";
  if (!o || !i || s !== dlSig(o, i)) return page("This download link isn't valid. Use the link from your purchase email.", 403);
  try {
    const row = await dbGet(c, o), ea = eaById(i);
    if (!row || row.kind !== "ea" || row.status !== "paid" || !String(row.items || "").split(",").includes(i)) return page("This order isn't paid or doesn't include this EA.", 403);
    if (!ea || !ea.file) return page("This file isn't available right now. Contact TRIOZIZZFX support.", 404);
    const r = await fetch(`${c.sbUrl}/storage/v1/object/sign/eas/${ea.file.split("/").map(encodeURIComponent).join("/")}`, { method: "POST",
      headers: { apikey: c.sbKey, Authorization: "Bearer " + c.sbKey, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 600 }) });
    const d = await r.json().catch(() => ({}));
    const url = d.signedURL || d.signedUrl;
    if (!r.ok || !url) return page("Couldn't prepare the download. Try again in a minute.", 502);
    return new Response(null, { status: 302, headers: { Location: c.sbUrl + "/storage/v1" + (url.startsWith("/") ? url : "/" + url), "Cache-Control": "no-store" } });
  } catch (e) { return page("Something went wrong. Try again in a minute.", 502); }
};
