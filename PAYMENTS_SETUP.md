# Payments and access setup (M-Pesa, Pesapal, PayPal, access codes)

Backend: `netlify/functions/` + `netlify/lib/pay.mjs`. Plans and prices: `PLANS` in `netlify/lib/pay.mjs`
(the browser can't change a price). First payment per phone/email gets +5 days; renewals add to the time left.

| Plan | USD | KES | Days |
|---|---|---|---|
| Binary · 1 week | 5 | 650 | 7 |
| Binary · 1 month | 10 | 1,300 | 30 |
| Forex · 2 weeks | 15 | 1,950 | 14 |
| Forex · 1 month | 25 | 3,250 | 30 |
| Binary + Forex · 2 weeks | 20 | 2,600 | 14 |
| Binary + Forex · 1 month | 30 | 3,900 | 30 |

## 1. Supabase
New organization -> New project -> SQL Editor -> paste `netlify/supabase.sql` -> Run.
Project Settings -> API: copy the Project URL and the `service_role` key.

## 2. Netlify environment variables (Site configuration -> Environment variables)
Common: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SITE_URL` = https://functional-website-dba168.netlify.app

M-Pesa (Daraja):
| Name | Sandbox | Live |
|---|---|---|
| MPESA_ENV | sandbox | production |
| MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET / MPESA_PASSKEY | from the Daraja app | production values |
| MPESA_SHORTCODE | 174379 | store / head-office number Safaricom gives for the till |
| MPESA_TILL | 174379 | 4808707 |
| MPESA_TYPE | CustomerPayBillOnline | CustomerBuyGoodsOnline |
| CALLBACK_SECRET | any long random text | same |

Pesapal (Airtel Money, cards, bank):
| Name | Sandbox | Live |
|---|---|---|
| PESAPAL_ENV | sandbox | production |
| PESAPAL_CONSUMER_KEY / PESAPAL_CONSUMER_SECRET | Pesapal sandbox keys | live keys from your Pesapal dashboard |
| PESAPAL_IPN_ID | optional: after the first payment, copy the id from the function log | same |

A payment method only shows in the app once its variables are set.
Functions only deploy when Netlify is linked to this GitHub repo (drag-and-drop doesn't deploy them).

## 3. Access (who has paid)
| Name | Value |
|---|---|
| ACCESS_SECRET | any long random text (keep it secret, never change it later) |
| ADMIN_EMAIL | dennisombachi234@gmail.com (default) |
| TESTER_CODE | the code you share with testers, e.g. TRIO7 |
| TESTER_DAYS | 7 (default) |
| PAYPAL_EMAIL | dennisombachi234@gmail.com (default) |

## 4. Email (sends the 6-digit codes)
Easiest without a domain: Gmail.
1. Google Account -> Security -> turn on 2-Step Verification.
2. Search "App passwords" -> create one named TRIOZIZZFX -> copy the 16 letters.
3. Netlify: `GMAIL_USER` = your Gmail address, `GMAIL_APP_PASSWORD` = the 16 letters.
(With your own domain later you can use Resend instead: `RESEND_API_KEY` + `EMAIL_FROM`.)

## Who can use what
- Free: Six Step Cycle bot on demo or paper.
- Binary plan: everything in the app now. Forex plan: forex tools (coming).
- One device per person: a code unlocks one device; using a code on a new device signs out the old one.
- Admin (ADMIN_EMAIL): full access + Admin page (approve PayPal, give free days, resend codes).
