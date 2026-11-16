// GET -> plans, prices and which payment methods are switched on
import { useCatalog } from "../lib/catalog.mjs";
import { PLANS, FIRST_BONUS_DAYS, cfg, missing, missingPp, missingDb, json } from "../lib/pay.mjs";
export default async () => {
  const c0 = cfg(); await useCatalog(c0);
  const c = c0, mp = missing(c).length === 0, pp = missingPp(c).length === 0, sandbox = !c.live || (pp && !c.ppLive);
  return json({ mpesa: mp, pesapal: pp, mpesaSandbox: mp && !c.live, pesapalSandbox: pp && !c.ppLive,
    paypal: missingDb(c).length === 0 && !!process.env.ACCESS_SECRET, paypalEmail: process.env.PAYPAL_EMAIL || "dennisombachi234@gmail.com", bonusDays: FIRST_BONUS_DAYS,
    plans: Object.entries(PLANS).filter(([, p]) => !p.hidden && (!p.sandboxOnly || sandbox))
      .map(([id, p]) => ({ id, name: p.name, scope: p.scope, usd: p.usd, kes: p.kes, days: p.days, test: !!p.sandboxOnly })) });
};
