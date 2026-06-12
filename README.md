# HomeTaste

HomeTaste is a role-based food ordering system with separate customer, cook, driver, and admin flows.

The current production layer includes real authentication flows, live order routing fields, driver dispatch, scheduled orders, cook verification, meal subscriptions, order tracking, cook analytics, social actions, 15% commission accounting, payment escrow records, and refund review.

## Current stack

- Static frontend hosted on GitHub Pages
- Node.js backend in `server.js`
- Local JSON storage for development
- Supabase-ready production persistence
- Production API hosted at `https://hometaste-api-production.up.railway.app`

## Local run

```bash
npm start
```

Default local URL:

```text
http://localhost:4174
```

## Deployment checks

Before pushing a production change:

```bash
npm run check:static
```

After GitHub Pages finishes deploying:

```bash
npm run check:prod
```

The production check verifies the GitHub Pages routes, the routed marketplace pages, and the live API health endpoint.

After real Railway provider keys are added, verify full live activation:

```bash
npm run check:live
```

`check:live` fails until Stripe, iyzico, PayTR, at least one push provider, OpenStreetMap tracking, and Supabase are active in the live Railway health response.

## System accounts

Production admin, cook, and driver accounts must be created through the app or seeded from private backend environment variables. Do not publish operational emails or passwords in README files, browser JavaScript, screenshots, or GitHub Pages artifacts.

Optional local/Railway seed variables are documented in [`.env.example`](.env.example). Use strong private values and rotate any credential that was previously shared publicly.

### Create / log in as admin locally

Two supported options, both keep credentials private:

**Option A — seed environment variables.** Set these in `.env` (local) or in the host (Railway), then start the backend. The owner account is ensured before the first login automatically:

```text
SEED_OWNER_EMAIL=
SEED_OWNER_PASSWORD=
SEED_OWNER_NAME=
```

**Option B — one-off bootstrap script.** Create or update an admin without restarting:

```bash
npm run create:admin -- --email you@example.com --password "use-a-strong-private-password" --name "HomeTaste Admin"
```

The script writes to `data/db.json` in local mode, or upserts into the Supabase `app_users` table when `SUPABASE_URL` and `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are set. It never prints the password and never writes credentials to any frontend or public file.

### Configure admin login on Railway / Supabase

1. In Railway, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) so the backend uses Supabase.
2. Set `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, and `SEED_OWNER_NAME` in Railway. On the first login the backend ensures the seeded owner exists in `app_users` before checking the password.
3. Alternatively, run `npm run create:admin` against the same Supabase project (with the service role key in the environment) to seed the admin once.
4. Confirm setup safely via `GET /api/health` — the `authSetup` block reports `database`, `ownerSeedConfigured`, `cookSeedConfigured`, `driverSeedConfigured`, and `googleConfigured` without exposing any emails, passwords, or secret keys.

### Google sign-in (OAuth)

The "Continue with Google" button on Sign In and Sign Up uses the backend OAuth routes. To enable it:

1. In Google Cloud Console, create an OAuth 2.0 Client ID (type: Web application).
2. Add an Authorized redirect URI that matches your backend callback exactly, e.g. `https://YOUR-RAILWAY-BACKEND.up.railway.app/api/auth/oauth/google/callback` (or `http://localhost:4173/api/auth/oauth/google/callback` for local backend port 4173).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` on the backend host (never in frontend files).
4. Make sure the frontend origin is in `ALLOWED_ORIGINS` so the redirect back succeeds.
5. Check `GET /api/health` for `authSetup.googleRedirectUri`, `authSetup.googleRedirectUriConfigured`, and `authSetup.allowedOrigins`; these diagnostics do not expose `GOOGLE_CLIENT_SECRET`.

Behavior: when configured, clicking the button starts the Google OAuth flow and returns to the app signed in (same session/token as email login). When not configured, the button stays visible and shows "Google sign-in is not configured." — it never fails silently. `GET /api/health` exposes the safe boolean `authSetup.googleConfigured` (and `auth.google`). The Google client secret is only ever used server-side.

### Frontend API base

- On GitHub Pages, [`public/config.js`](public/config.js) points the frontend at the Railway backend automatically.
- When the frontend is served by the backend itself, the API base is empty (same-origin requests).
- For a separate static/Vite dev server, set the backend URL with either `window.HOMETASTE_API_BASE` (e.g. in `config.js`) or `localStorage.setItem("hometaste_api_base", "http://localhost:4174")`. If the backend is unreachable the login screen now shows a clear "Backend not reachable" message.

## Production database with Supabase

1. Create a Supabase project.
2. Open the SQL Editor in Supabase.
3. Run [`supabase/schema.sql`](supabase/schema.sql).
4. Copy [`.env.example`](.env.example) to `.env` for local testing.
5. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
6. Restart the backend.

Current Supabase project URL:

```text
https://porumrfiwyrfvjigbjtl.supabase.co
```

When those environment variables exist, the backend uses Supabase instead of `data/db.json`.

## Production backend

The live frontend in [`public/config.js`](public/config.js) points to:

```text
https://hometaste-api-production.up.railway.app
```

Set these backend environment variables in the production host:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS`
- `PUBLIC_BASE_URL`
- `API_BASE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `STRIPE_SECRET_KEY`
- `IYZICO_API_KEY`
- `IYZICO_SECRET_KEY`
- `IYZICO_BASE_URL`
- `PAYTR_MERCHANT_ID`
- `PAYTR_MERCHANT_KEY`
- `PAYTR_MERCHANT_SALT`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `ONESIGNAL_APP_ID`
- `ONESIGNAL_REST_API_KEY`
- `MAP_PROVIDER`
- `MAPBOX_PUBLIC_TOKEN`
- `GOOGLE_MAPS_BROWSER_KEY`

Recommended `ALLOWED_ORIGINS`:

```text
https://faresfadly1.github.io,http://localhost:4174,http://localhost:4173,http://127.0.0.1:4174,http://127.0.0.1:4173
```

## Alternative Render deploy

This repo also includes [`render.yaml`](render.yaml) for a Render web service.

Create a Render web service from this GitHub repo and set:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `ALLOWED_ORIGINS`

After Render gives you a backend URL such as:

```text
https://your-service-name.onrender.com
```

set that URL in [`public/config.js`](public/config.js):

```js
window.HOMETASTE_API_BASE = "https://your-service-name.onrender.com";
```

Then push again so the GitHub Pages frontend talks to the live backend.

## Production flow

Once Supabase and the hosted backend are connected:

- customers can create accounts with email verification, request password reset links, and verify phone numbers
- Google login uses the provider OAuth callback when Google client ID and secret are configured
- customers place orders
- customers can schedule orders for later times such as tomorrow at 8 PM or Friday at 6 PM
- cooks accept and finish food
- drivers receive available orders, accept deliveries, update driver location, navigate, mark delivered, and see daily earnings
- admin sees the whole system in one shared dataset
- customers can subscribe to weekly meal plans from a dedicated dashboard, then pause, resume, skip a week, or cancel
- customers can follow cooks, like dishes, comment, and share food photos
- HomeTaste records 15% commission and the cook payout after delivery
- real payment gateway hooks exist for Stripe, iyzico, and PayTR; provider secrets must be configured on the backend host
- push notification device registration exists for Firebase FCM and OneSignal; order accepted, food ready, driver near, and delivered updates use the same notification pipeline
- live tracking stores route provider, ETA, driver/customer coordinates, and location history for Google Maps, Mapbox, or OpenStreetMap clients
- customers can report refund issues for food not delivered, spoiled food, wrong orders, or missing items
- mobile app planning starts in [docs/mobile-flutter-plan.md](docs/mobile-flutter-plan.md)

## Important

Never expose the Supabase secret key in browser JavaScript or public docs. It belongs only on the backend host.
