# Distributor OS Lite Alpha

Distributor OS turns WhatsApp/Telegram buying messages into source-backed distributor orders with SKU matching, A/B/C price levels, confirmation links, analytics, and payment status tracking.

The current pilot build also includes a brand-scoped workspace foundation and distributor invite flow. Invites can be created from the Brand Control Center, accepted at `/invite/[token]`, and then opened in the Distributor Portal with the distributor's assigned pricing level.

The demo loop now supports distributor-originated POs: a distributor can submit a cart from `/portal`, the Brand Control Center receives it as an inbound PO request, the brand can approve and request payment, and the distributor can pay through Stripe Checkout.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000/app`.

The app can run locally without Supabase env vars. In that mode, catalog and order actions use browser storage for demo/pilot preview.

## Required Env Vars

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
RESEND_FROM=Distributor OS <hello@yourdomain.com>
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Put it in `.env.local` and Vercel Environment Variables, never in client code or browser-exposed config.

## Supabase Setup

1. Create a Supabase project.
2. Copy the project URL into `NEXT_PUBLIC_SUPABASE_URL`.
3. Copy the anon public key into `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Copy the service role key into `SUPABASE_SERVICE_ROLE_KEY`.
5. Enable email auth if using the login/invite flows.
6. Run migrations in order:

```txt
supabase/migrations/0001_initial_schema.sql
supabase/migrations/0002_real_pilot_orders.sql
supabase/migrations/0003_catalog_analytics_payments.sql
supabase/migrations/0004_v1_production_foundation.sql
supabase/migrations/0005_v1_auth_and_payment_links.sql
```

Run them with the Supabase SQL editor or Supabase CLI. Do not skip migrations; later files assume tables and policies from earlier files.

## Tests And Checks

```bash
npm run test
npx tsc --noEmit
npm run build
```

`npm run build` also runs a postbuild server-chunk repair script for the current Windows/Next.js webpack output issue.

## Vercel Deployment

1. Push the repo to GitHub.
2. Import the repo in Vercel.
3. Set the Framework Preset to Next.js.
4. Add the env vars above in Vercel Project Settings.
5. Set `NEXT_PUBLIC_APP_URL` to your deployed app URL, for example `https://your-app.vercel.app`.
6. Deploy.
7. Open `/app` and use `Demo Reset` to seed local demo data, or connect Supabase and upload a real pilot catalog.
8. From the Brand Control Center, create a distributor portal invite and test `/invite/[token]` before sending it to a real distributor.

## Stripe Webhook

Stripe Checkout payment links are created when the brand requests payment. To auto-mark an order paid after the distributor pays, create a Stripe webhook endpoint:

```txt
https://your-app.vercel.app/api/webhooks/stripe
```

Subscribe to:

```txt
checkout.session.completed
checkout.session.async_payment_succeeded
```

Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET` in Vercel, then redeploy. Use `sk_test_...` and a test-mode webhook for demos unless you intentionally want real payments.

For production pilots, keep `SUPABASE_SERVICE_ROLE_KEY` only in Vercel server-side env vars. The browser should only receive `NEXT_PUBLIC_*` values.

## Operational Notes

- Product upload supports CSV and XLSX.
- If Supabase env vars are missing, the UI shows a safe fallback state and uses local demo storage.
- Invalid order links show an error instead of a fake order.
- Payment actions persist `payment_status`, `payment_method`, `amount_paid`, `outstanding_amount`, payment request records, and audit events.
