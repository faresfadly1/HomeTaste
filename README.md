# HomeTaste System

HomeTaste is now a working full-stack local system with:

- Login and signup
- Admin view for HomeTaste management
- Customer browsing, cart, checkout, order tracking, and chat
- Cook application flow
- Cook studio for dish creation and order status updates
- Admin controls for users, cooks, dish featuring, dish visibility, and marketplace status
- JSON database persistence in `data/db.json`

## Run

```bash
node server.js
```

Open:

```text
http://localhost:4174
```

## Seed Accounts

Admin:

```text
FirstProj77@gmail.com
HomeTasteadmin77$
```

The login and signup screens let users choose Turkey or Germany. Marketplace cooks, dishes, cities, and favorites are filtered to the selected country.

## Files

- `server.js` contains the HTTP server, API routes, auth, sessions, and database persistence.
- `public/app.js` contains the role-based browser application.
- `public/styles.css` contains the UI system.
- `data/db.json` is created automatically on first run and is ignored by git.

## Supabase Production Database

The app still runs locally with `data/db.json`, but it can now use Supabase for real data.

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Paste and run `supabase/schema.sql`.
4. Copy `.env.example` to `.env`.
5. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
6. Restart the server.

When those environment values exist, `server.js` stores users, cooks, dishes, orders, messages, notifications, and sessions in Supabase instead of the local JSON file.

Keep `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` private. It belongs only on the backend server, never inside browser JavaScript.
