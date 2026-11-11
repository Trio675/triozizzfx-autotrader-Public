# M-Pesa (STK Push) setup

Backend: `netlify/functions/` (plans, stk-push, mpesa-callback, pay-status) + `netlify/lib/mpesa.mjs`.
Prices: edit `PLANS` in `netlify/lib/mpesa.mjs`. The browser can't change the price.

## 1. Supabase
1. New organization -> New project (save the database password).
2. SQL Editor -> New query -> paste `netlify/supabase.sql` -> Run.
3. Project Settings -> API: copy the Project URL and the `service_role` secret key.

## 2. Netlify environment variables (Site configuration -> Environment variables)
| Name | Sandbox value | Live value |
|---|---|---|
| MPESA_ENV | sandbox | production |
| MPESA_CONSUMER_KEY | from Daraja app | production key |
| MPESA_CONSUMER_SECRET | from Daraja app | production secret |
| MPESA_PASSKEY | from Daraja app | production passkey |
| MPESA_SHORTCODE | 174379 | store / head-office number Safaricom gives for the till |
| MPESA_TILL | 174379 | 4808707 |
| MPESA_TYPE | CustomerPayBillOnline | CustomerBuyGoodsOnline |
| CALLBACK_SECRET | any long random text | same |
| SUPABASE_URL | Project URL | same |
| SUPABASE_SERVICE_KEY | service_role key | same |
| SITE_URL | https://functional-website-dba168.netlify.app | same |

Functions only deploy when Netlify is linked to this GitHub repo (drag-and-drop doesn't deploy them).
