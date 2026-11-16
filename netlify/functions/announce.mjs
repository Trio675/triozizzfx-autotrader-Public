// GET -> current announcements (posted by the admin), newest first
import { cfg, json, sb, missingDb } from "../lib/pay.mjs";
export default async () => {
  const c = cfg(); if (missingDb(c).length) return json({ items: [] });
  try {
    const now = encodeURIComponent(new Date().toISOString());
    const rows = await sb(c, "announcements?select=id,created_at,text,kind,link&active=eq.true&or=(expires_at.is.null,expires_at.gt." + now + ")&order=created_at.desc&limit=3");
    return new Response(JSON.stringify({ items: rows || [] }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
  } catch (e) { return json({ items: [] }); }
};
