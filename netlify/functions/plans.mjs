// GET -> plans, prices and which payment methods are switched on
import { PLANS, FIRST_BONUS_DAYS, cfg, missing, missingPp, json } from "../lib/pay.mjs";
export default async () => {
  const c = cfg(), mp = missing(c).length === 0, pp = missingPp(c).length === 0, sandbox = !c.live || (pp && !c.ppLive);
  return json({ mpesa: mp, pesapal: pp, mpesaSandbox: mp && !c.live, pesapalSandbox: pp && !c.ppLive, bonusDays: FIRST_BONUS_DAYS,
    plans: Object.entries(PLANS).filter(([, p]) => !p.sandboxOnly || sandbox)
      .map(([id, p]) => ({ id, name: p.name, scope: p.scope, usd: p.usd, kes: p.kes, days: p.days, test: !!p.sandboxOnly })) });
};
