# Family Tasks

Installable web app (PWA) for family routines. Parents create tasks for their
children; each child's phone gets a reminder when a task is due; the child taps
Done, I need help, or Not done; parents see it live and get a notification when
a child asks for help. Many families, fully isolated from each other.

Stack: React + TypeScript (Vite), Supabase (Postgres, Auth, Realtime, Edge
Functions, pg_cron), Web Push, Cloudflare Pages. Runs on the free tiers.
No Google Cloud, no email provider, no paid services.

## How it fits together

```
Phones (installed web app)                 Supabase
  React app ── reads (RLS) ───────────────▶ Postgres tables
            ── writes (validated RPCs) ───▶ SECURITY DEFINER functions
            ◀─ live updates ─────────────── Realtime
  Service worker ◀── Web Push ──┐
                                └── Edge Function "send-notifications"
                                       ▲ called every minute by pg_cron
```

- Parents sign in with email and password. There is no email server, so a
  forgotten password is reset with a **recovery code** each parent saves at
  sign-up (stored hashed, single use, replaced after every reset).
- Children use a one-time code; their phone gets an anonymous login linked to
  the child's profile. Lost phone: unlink it and link a new one, history is kept.
- All dates and times use the family's time zone.
- Reminders are sent at most once (never spammed). Help alerts are retried
  until a parent device receives them.
- Notes never appear in notifications.

## Launch checklist

You need accounts at GitHub, Supabase and Cloudflare (all free), plus Node 22
on your computer. Write down the values marked ★ as you go.

### 1. Supabase project
1. Create a project at supabase.com. Copy ★ Project URL and ★ anon/publishable key
   (Project Settings → API). Never use the service_role/secret key in the app.
2. SQL Editor → paste and run `supabase/schema.sql`.

### 2. Sign-in settings (Supabase → Authentication)
1. Sign In / Providers → **Email**: enabled, **Confirm email: OFF**
   (there is no email server; sign-up fails with a clear message if this is on).
   Minimum password length: 8.
2. Same page: enable **Anonymous sign-ins** (used by children's phones).
3. Leave every other provider off.

### 3. Notification keys (VAPID)
```
npx web-push generate-vapid-keys
```
Copy ★ public key and ★ private key. The private key is a secret.

### 4. Edge Function
Install the Supabase CLI (supabase.com/docs/guides/cli), then in this folder:
```
supabase init                      # only if supabase/config.toml doesn't exist
supabase login
supabase link --project-ref <PROJECT_REF>
supabase secrets set VAPID_PUBLIC_KEY=<★> VAPID_PRIVATE_KEY=<★> \
  VAPID_SUBJECT=mailto:<your email> CRON_SECRET=<★ random, e.g. openssl rand -hex 32>
supabase secrets set APP_ORIGIN=https://<your-app>.pages.dev   # after step 7; optional but recommended
supabase functions deploy send-notifications --no-verify-jwt
supabase functions deploy reset-password --no-verify-jwt
```
If the function logs say `Missing secret SUPABASE_SERVICE_ROLE_KEY`, also run
`supabase secrets set SERVICE_ROLE_KEY=<your service_role or secret key>`.

### 5. Scheduling
Edit `supabase/cron.sql`: replace `<PROJECT_REF>` and `<CRON_SECRET>`, then run
it in the SQL Editor. Check it after two minutes:
`select status, return_message from cron.job_run_details order by start_time desc limit 5;`

### 6. Bot protection (Turnstile)
Cloudflare dashboard → Turnstile → Add widget, hostname `<your-app>.pages.dev`.
Copy ★ site key and ★ secret key. Supabase → Authentication → Attack Protection →
enable CAPTCHA, provider Turnstile, paste the **secret** key. This protects
parent sign-up, sign-in and children's anonymous sign-in from bots.

### 7. Hosting (Cloudflare Pages)
1. Push this folder to a GitHub repository.
2. Cloudflare → Workers & Pages → Create → Pages → connect the repo.
   Build command `npm run build`, output directory `dist`.
3. Environment variables (Production):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`,
   `VITE_TURNSTILE_SITE_KEY` (the **site** key).
4. Deploy. Your app is at ★ `https://<your-app>.pages.dev`.
5. Supabase → Authentication → URL Configuration: Site URL = that address;
   add it to Redirect URLs too (plus `http://localhost:5173` for development).

### 8. Test on real phones before inviting anyone
- Android (Chrome): open the site → install → create a parent account → save the
  recovery code → create family,
  child and a task 3 minutes from now → link a second phone as the child →
  turn on reminders → wait for the notification → tap it → answer "I need help"
  → the parent phone should get an alert within about a minute.
- iPhone (iOS 16.4+): Share → Add to Home Screen **first**, open the installed
  app, then sign in there. Repeat the test above.
- Password reset: sign out, tap Forgot password, use the saved recovery code.

## Development
```
cp .env.example .env    # fill in your values
npm install
npm run dev             # http://localhost:5173
npm test                # unit tests (dates, progress, notification logic)
npm run build
```
Database tests run against a real Postgres (see `supabase/tests`):
`cd supabase/tests && npm install && PGHOST=... PGPORT=... npm test`.

## Project layout
```
src/
  lib/        api (only Supabase access), dates, push, errors, types
  hooks/      session, queries, realtime, family context
  screens/    SignIn, Onboarding, Today, Week, Tasks, Family, Me, RespondSheet
  components/ UI primitives, week chart, notifications card
  sw.ts       service worker: offline shell, push, notification taps
supabase/
  schema.sql  tables, RLS, RPCs, limits (run once)
  cron.sql    pg_cron, Vault secrets, Realtime publication
  functions/send-notifications/  reminders and help alerts (Deno) + testable core
  functions/reset-password/      recovery-code password reset (Deno) + testable core
  tests/      79 database tests
```

## Known limits
- No email verification: someone could register with an email address that
  isn't theirs. Impact is limited (they only get an empty account), but it is
  why "forgot password" uses recovery codes, never email. A parent who loses
  both password and recovery code can be re-invited by another parent under a
  new account; a family's only parent cannot be recovered.
- To add email later (verified sign-ups, reset emails): buy a domain (about
  $10/year), connect a sender such as Resend or Brevo as custom SMTP in
  Supabase, and turn Confirm email back on.
- Reminders arrive within about a minute of the set time, and only when the
  phone is online. Battery savers can delay them. They are notifications, not alarms.
- Supabase Free pauses a project after 7 days without use. Move to Pro before
  families depend on it.
- Families: up to 4 parents, 10 children, 200 tasks (see `private.limit_of`).
# aria-new-task-app
