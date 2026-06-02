# HomeTaste

HomeTaste is a role-based food ordering system with separate customer, cook, driver, and admin flows.

The current production layer includes cook verification, meal subscriptions, order tracking, cook analytics, social actions, 15% commission accounting, payment escrow records, and refund review.

## Current stack

- Static frontend hosted on GitHub Pages
- Node.js backend in `server.js`
- Local JSON storage for development
- Supabase-ready production persistence

## Local run

```bash
npm start
```

Default local URL:

```text
http://localhost:4174
```

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

## Render deploy

This repo includes [`render.yaml`](/Users/faresfadly/Desktop/HomeTaste/render.yaml) for a Render web service.

Create a Render web service from this GitHub repo and set:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `ALLOWED_ORIGINS`

Recommended `ALLOWED_ORIGINS`:

```text
https://faresfadly1.github.io,http://localhost:4174,http://localhost:4173
```

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

- customers place orders
- cooks accept and finish food
- drivers receive pickup and delivery tasks
- admin sees the whole system in one shared dataset
- customers can subscribe to weekly meal plans
- customers can follow cooks, like dishes, comment, and share food photos
- HomeTaste records 15% commission and the cook payout after delivery
- customers can report refund issues for food not delivered, spoiled food, wrong orders, or missing items

## Important

Never expose the Supabase secret key in browser JavaScript or public docs. It belongs only on the backend host.
