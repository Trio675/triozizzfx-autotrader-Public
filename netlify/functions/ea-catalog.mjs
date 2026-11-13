// GET -> the EA shop: products, bundle discounts, which payment methods are on
import { cfg, missing, missingPp, missingDb, json } from "../lib/pay.mjs";
import { EAS, BUNDLE, eaPublic } from "../lib/eas.mjs";
export default async () => {
  const c = cfg();
  return json({ eas: EAS.map(eaPublic), bundle: BUNDLE.map(([n, pct]) => ({ n, pct })).reverse(),
    mpesa: missing(c).length === 0, pesapal: missingPp(c).length === 0, paypal: missingDb(c).length === 0 && !!process.env.ACCESS_SECRET,
    paypalEmail: process.env.PAYPAL_EMAIL || "dennisombachi234@gmail.com", mpesaSandbox: !c.live, pesapalSandbox: !c.ppLive });
};
