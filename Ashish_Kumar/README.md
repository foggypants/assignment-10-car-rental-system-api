# Car Rental & Fleet Booking API

Express + Supabase (PostgreSQL & Auth) backend with date-overlap collision prevention, automatic billing, and JWT-protected routes.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Project Settings > API).
3. Run `schema.sql` in the Supabase SQL Editor (creates tables, indexes, the overlap guard, and 3 sample vehicles).
4. In Supabase, Authentication > Providers > Email: disable "Confirm email" for easy local testing.
5. `npm run dev`

> Tables created in the SQL Editor have Row Level Security **off** by default, so the anon key works from the server. If you enable RLS, add policies or switch the server to a service-role key.

## Endpoints
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | /api/auth/register | No | `email, password, name` |
| POST | /api/auth/login | No | returns `access_token` |
| GET | /api/vehicles | No | filters `?category=SUV&status=available` |
| GET | /api/vehicles/:id | No | vehicle + rental history (no customer PII) |
| POST | /api/vehicles | Yes | add vehicle |
| PUT | /api/vehicles/:id | Yes | update rate/status/etc. |
| DELETE | /api/vehicles/:id | Yes | 400 if active/upcoming bookings |
| POST | /api/rentals | Yes | collision check + cost calculation |
| GET | /api/rentals/my-bookings | Yes | current user's rentals (joined with vehicle) |
| PATCH | /api/rentals/:id/cancel | Yes | only `booked` rentals that haven't started |
| PATCH | /api/rentals/:id/complete | Yes | vehicle returns to `available` |

Send the token as `Authorization: Bearer <access_token>`.

## Key design decisions
- **Collision algorithm:** two inclusive ranges overlap iff `existing.start <= new.end AND existing.end >= new.start`. Only `booked`/`active` rentals count, so cancelled/completed ones free the dates. Back-to-back rentals that share a date are treated as a conflict (inclusive days).
- **Race-condition guard:** the app-level check can be beaten by two simultaneous requests, so `schema.sql` also adds a PostgreSQL `EXCLUDE USING gist` constraint. The API maps that violation (`23P01`) to the same 400 error.
- **Billing:** `days = (end - start) + 1` (inclusive), `total_cost = days * daily_rate`, computed server-side. 2026-05-01 to 2026-05-05 = 5 days.
- **Status transitions:** `booked` (future) or `active` (covers today, vehicle becomes `rented`) then `completed` (vehicle `available`) or `cancelled`. Vehicles in `maintenance` can't be booked.
- **Ownership:** cancel/complete return 403 if the rental belongs to another user.
- **Admin (optional):** set `ADMIN_EMAILS` to restrict fleet management to specific users.

## Testing
Import `postman_collection.json`. Run in order: Login (saves the token automatically), Book Vehicle 1 (May 1-5), then Conflict Test (May 3-7), which must return `400 Vehicle already reserved during this timeframe`.

## Deploying to Render
1. Push this project to a GitHub repo (`.env` is git-ignored, so your keys stay private).
2. On [render.com](https://render.com): **New > Blueprint**, pick the repo. Render reads `render.yaml`.
   *(Or **New > Web Service** manually: Runtime `Node`, Build `npm install`, Start `npm start`, Health Check Path `/health`.)*
3. When prompted, set the environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `ADMIN_EMAILS` (optional), `CORS_ORIGIN` (optional)
4. Deploy. Your API will be live at `https://<service-name>.onrender.com`.
5. Verify: open `https://<service-name>.onrender.com/health`, then in Postman change the collection variable `baseUrl` to your Render URL and rerun the tests.

Notes:
- The app reads Render's `PORT` automatically and binds to `0.0.0.0`.
- Free-tier services sleep after ~15 minutes idle, so the first request afterwards can take up to a minute. Hit `/health` before a demo to wake it.
- Run `schema.sql` in Supabase **before** the first deploy; Render only hosts the API, the database lives in Supabase.
