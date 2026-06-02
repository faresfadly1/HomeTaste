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

## System accounts

Admin:

```text
FirstProj77@gmail.com
HomeTasteadmin77$
```

Driver:

```text
Drive1K202@gmail.com
DriveTaste$$7
```

Cook:

```text
cook1@hometaste.local
CookTaste$$7
```

## Production database with Supabase

1. Create a Supabase project.
2. Open the SQL Editor in Supabase.
3. Run [`supabase/schema.sql`](/Users/faresfadly/Desktop/HomeTaste/supabase/schema.sql).
4. Copy [`.env.example`](/Users/faresfadly/Desktop/HomeTaste/.env.example) to `.env` for local testing.
5. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
6. Restart the backend.

Current Supabase project URL:

```text
https://porumrfiwyrfvjigbjtl.supabase.co
```

When those environment variables exist, the backend uses Supabase instead of `data/db.json`.

## Production backend

The live frontend in [`public/config.js`](/Users/faresfadly/Desktop/HomeTaste/public/config.js) points to:

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
- `APPLE_CLIENT_ID`
- `APPLE_CLIENT_SECRET`
- `APPLE_REDIRECT_URI`

Recommended `ALLOWED_ORIGINS`:

```text
https://faresfadly1.github.io,http://localhost:4174,http://localhost:4173,http://127.0.0.1:4174,http://127.0.0.1:4173
```

## Alternative Render deploy

This repo also includes [`render.yaml`](/Users/faresfadly/Desktop/HomeTaste/render.yaml) for a Render web service.

Create a Render web service from this GitHub repo and set:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `ALLOWED_ORIGINS`

After Render gives you a backend URL such as:

```text
https://your-service-name.onrender.com
```

set that URL in [`public/config.js`](/Users/faresfadly/Desktop/HomeTaste/public/config.js):

```js
window.HOMETASTE_API_BASE = "https://your-service-name.onrender.com";
```

Then push again so the GitHub Pages frontend talks to the live backend.

## Production flow

Once Supabase and the hosted backend are connected:

- customers can create accounts with email verification, request password reset links, and verify phone numbers
- Google and Apple login buttons use provider OAuth callbacks when provider client IDs and secrets are configured
- customers place orders
- customers can schedule orders for later times such as tomorrow at 8 PM or Friday at 6 PM
- cooks accept and finish food
- drivers receive available orders, accept deliveries, update driver location, navigate, mark delivered, and see daily earnings
- admin sees the whole system in one shared dataset
- customers can subscribe to weekly meal plans from a dedicated dashboard, then pause, resume, skip a week, or cancel
- customers can follow cooks, like dishes, comment, and share food photos
- HomeTaste records 15% commission and the cook payout after delivery
- customers can report refund issues for food not delivered, spoiled food, wrong orders, or missing items

## Important

Never expose the Supabase secret key in browser JavaScript or public docs. It belongs only on the backend host.
