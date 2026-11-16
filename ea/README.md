# TZ Expert Advisors — licence system

- `TZLicense.mqh`: include in every TZ EA. Checks the buyer's key against the site (`/.netlify/functions/license`).
- `TZ_Template.mq5`: starting point for a new EA.
- Sell only the compiled **.ex5** (never the .mq5 source). Zip it and upload to the private Supabase bucket `eas`.
- Each purchase emails one key per EA. A key binds to the first MT5 account that uses it.
- Admin page → Licences: reset a key (buyer changed account) or cancel it (refund/chargeback).
