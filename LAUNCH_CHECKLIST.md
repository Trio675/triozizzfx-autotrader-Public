# TRIOZIZZFX launch checklist

## 1. Netlify (each site you use)
- [ ] Site configuration → Build & deploy → Link repository → GitHub → `Trio675/triozizzfx-autotrader-Public`, branch `main`, build command empty, publish directory `.`
- [ ] Environment variables (same values on every site): see PAYMENTS_SETUP.md
- [ ] Deploys → Trigger deploy

## 2. Supabase
- [ ] New project → SQL Editor → paste `netlify/supabase.sql` → Run (safe to run again after every update)
- [ ] Storage → New bucket `eas` (PRIVATE) for EA files

## 3. Email (codes, download links, alerts)
- [ ] Google Account → Security → 2-Step Verification ON → App passwords → create "TRIOZIZZFX"
- [ ] Netlify: `GMAIL_USER`, `GMAIL_APP_PASSWORD`

## 4. Payments
- [ ] Daraja sandbox keys → test with the KES 1 test plan
- [ ] Daraja → Go Live with Till 4808707 → set `MPESA_ENV=production`, live keys, `MPESA_SHORTCODE` (store number), `MPESA_TILL=4808707`, `MPESA_TYPE=CustomerBuyGoodsOnline`
- [ ] Pesapal keys (sandbox, then live) → `PESAPAL_*`

## 5. Deriv
- [ ] Developer dashboard → app 34VbCtDEa50PGXxGDLNvP → Redirect URIs: every site address you use, ending with `/`

## 6. First run
- [ ] Open the site → Account → My access → admin email → Send me a code → Unlock → Admin page appears
- [ ] (Everything is free now: plans and payment keys are optional)
- [ ] Admin → Announcements: post a welcome message
- [ ] Share the tester code (`TESTER_CODE`) with the group

## 7. Later
- [ ] Own domain (e.g. triozizzfx.com) → Netlify → Domain management
- [ ] Have a lawyer review the Terms and Privacy Policy (home page → Legal)
- [ ] Build TZ V1.0 from `ea/TZ_Template.mq5`, upload the .ex5 zip, set its file in Admin → EAs
