// GET ?i=<ea id> -> free download of an EA (short-lived link to the private Supabase bucket "eas")
import { cfg, missingDb } from "../lib/pay.mjs";
import { useCatalog } from "../lib/catalog.mjs";
import { eaById } from "../lib/eas.mjs";
const page = (msg, code) => new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:Arial;background:#0b1020;color:#eee;padding:30px"><h2>TRIOZIZZFX</h2><p>${msg}</p>`,
  { status: code, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
export default async (req) => {
  const c = cfg(); if (missingDb(c).length) return page("Downloads aren't set up yet.", 503);
  await useCatalog(c);
  const ea = eaById(new URL(req.url).searchParams.get("i") || "");
  if (!ea || ea.hidden) return page("This EA isn't available.", 404);
  if (!ea.file) return page("This EA is coming soon.", 404);
  try {
    const r = await fetch(`${c.sbUrl}/storage/v1/object/sign/eas/${ea.file.split("/").map(encodeURIComponent).join("/")}`, { method: "POST",
      headers: { apikey: c.sbKey, Authorization: "Bearer " + c.sbKey, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 600 }) });
    const d = await r.json().catch(() => ({})), url = d.signedURL || d.signedUrl;
    if (!r.ok || !url) return page("Couldn't prepare the download. Try again in a minute.", 502);
    return new Response(null, { status: 302, headers: { Location: c.sbUrl + "/storage/v1" + (url.startsWith("/") ? url : "/" + url), "Cache-Control": "no-store" } });
  } catch (e) { return page("Something went wrong. Try again in a minute.", 502); }
};
