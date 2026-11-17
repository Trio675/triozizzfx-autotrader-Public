# Triozizz Journal — setup (once)

The app is already connected to Supabase project `jgnbtjjtasyzkcddjpvv` (see `config.js`).
Do these 5 steps in the Supabase dashboard, then the Journal keeps every trade permanently.

## 1. Create the tables (2 minutes)
SQL Editor → New query → paste ALL of `journal/supabase/schema.sql` → Run.
Check: Table Editor shows `profiles`, `trades`, `cashflows`, `weekly_reviews` (each "RLS enabled"),
and Storage shows a private bucket `screenshots`.

## 2. Website addresses
Authentication → URL Configuration
- Site URL: `https://triozizzfx-trader.netlify.app/journal/`
- Redirect URLs → Add: `https://triozizzfx-trader.netlify.app/journal/` and `https://triozizzfx-trader.netlify.app/journal/`

## 3. Send emails from your Gmail (required: Supabase's own sender only emails your team, 2 per hour)
Google Account → Security → 2-Step Verification ON → "App passwords" → create "Triozizz Journal" → copy the 16 letters.
Supabase → Authentication → Emails → SMTP Settings → Enable custom SMTP:
- Sender email: your Gmail address · Sender name: Triozizz Journal
- Host: `smtp.gmail.com` · Port: `465`
- Username: your Gmail address · Password: the 16-letter app password
Save. (Gmail sends up to about 500 emails a day: plenty to start.)

## 4. Email codes
Authentication → Emails → Templates → **Magic Link**: make sure the body contains `{{ .Token }}`
(e.g. "Your Triozizz Journal code is {{ .Token }}"). Without it, "Email me a sign-in code" sends a link instead of a code.

## 5. Phone sign-in (optional, costs money per SMS)
Leave Authentication → Providers → Phone OFF until you choose an SMS provider (Twilio etc.).
The app then tells people to use email.

## Keeping data safe
- Each person sees only their own trades (row-level security, tested: user B sees 0 of user A's rows).
- Free Supabase projects pause after about a week with no use; data is NOT deleted — press Restore in the dashboard.
- The free plan has no automatic backups you can download: use Setup → Export backup (JSON) in the Journal now and then.
