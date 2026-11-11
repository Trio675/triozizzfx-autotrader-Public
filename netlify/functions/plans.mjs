// GET -> the plans and prices (so the app always shows the server's real prices)
import { PLANS, cfg, missing, json } from "../lib/mpesa.mjs";
export default async () => {
  const c = cfg();
  return json({ ready: missing(c).length === 0, sandbox: !c.live,
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name, amount: p.amount, days: p.days })) });
};
