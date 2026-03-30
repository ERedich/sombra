# CMMS (scaffold)

Work-order–oriented CMMS monorepo: **React + PrimeReact** in [`frontend/`](frontend/) and **Express + PostgreSQL** in [`backend/`](backend/). See [`Guidelines.md`](Guidelines.md) for project rules.

## Prerequisites

- Node.js 20+ (22 LTS recommended)
- A PostgreSQL database ([Neon](https://neon.tech/) is supported), or local Postgres (see below)
- For copying a database to another server: PostgreSQL client tools (`pg_dump`, `pg_restore`) on your `PATH`, or set `PG_DUMP` / `PG_RESTORE` to those binaries

## Security

- Never commit real credentials. Copy [`backend/.env.example`](backend/.env.example) to `backend/.env` and fill in values locally.
- If a database URL was ever shared in chat or committed by mistake, **rotate the database password** in the Neon console.

## Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET (and optional variables)

npm install
# If the database in DATABASE_URL does not exist yet (and your user may create DBs):
# npm run db:create
npm run migrate
npm run dev
```

### Local PostgreSQL

Set `DATABASE_URL` in `backend/.env` to your instance:

`postgresql://USER:PASSWORD@HOST:PORT/sombra`

Example: `postgresql://postgres:mypassword@localhost:5432/sombra`. If that database does not exist yet and your role can create databases, run `npm run db:create` once, then `npm run migrate`. Otherwise create the empty database in `psql` or your admin UI first.

Optional: a [`docker-compose.yml`](docker-compose.yml) at the repo root is available only if you want a disposable Postgres in Docker—you do not need it when using your own server.

### Copy database to another server

The target database must already exist (empty or disposable). Set `SOURCE_DATABASE_URL` and `TARGET_DATABASE_URL` in `backend/.env` (or pass `--from` / `--to`). Remote hosts often need `?sslmode=require` in the URL.

```bash
cd backend
npm run db:copy
```

Optional: `npm run db:copy -- --clean` adds `pg_restore --clean --if-exists` (drops existing objects on the target before restore—only use when you intend to replace everything).

The target Postgres version should be the same major version as the source, or newer.

Default API URL: `http://localhost:3001`

- **Health:** `GET /api/health` — returns `{ ok, db }` where `db` is whether PostgreSQL responded.
- **Auth:** `POST /api/auth/login` — body `{ "login_name": "<login name or email>", "password": "..." }` returns `{ token, user }` (JWT, 7-day expiry; legacy body field `key` is still accepted as an alias for `login_name`). The `user` object includes site-assignment fields (`working_site_id`, `additional_site_ids`, `allow_site_change_on_login`, `selectable_working_sites`, …). `GET /api/auth/me` returns the same shape. `POST /api/auth/working-site` (Bearer token) with `{ "working_site_id": "<uuid>" }` updates the user’s working site and returns a new token when login-time site selection is used.
- **Users (authenticated):** `GET/POST /api/users`, `GET/PATCH/DELETE /api/users/:id` — manage users (`password_hash` never returned; audit logged). **Sites:** unchanged paths under `/api/sites` (rows include `created_by` / `updated_by` and display names from joins).
- **AI (stub):** `POST /api/ai/suggest` — returns `503` until `OPENAI_API_KEY` is set; then `501` until implemented.

### Environment variables (backend)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. Neon pooler with `sslmode=require`). Also used by `npm run db:create` to know which database name to create. |
| `MAINTENANCE_DATABASE` | No | Used only by `npm run db:create`: database to connect to first (default `postgres`). |
| `JWT_SECRET` | Yes | Secret for signing JWTs; use a long random string in production. |
| `PORT` | No | Default `3001`. |
| `FRONTEND_ORIGIN` | No | CORS origin for the SPA; default `http://localhost:5173`. |
| `OPENAI_API_KEY` | No | When set, enables future AI routes (currently not implemented). |
| `SOURCE_DATABASE_URL` | No | Used only by `npm run db:copy` (source for `pg_dump`). |
| `TARGET_DATABASE_URL` | No | Used only by `npm run db:copy` (destination for `pg_restore`). |
| `PG_DUMP` / `PG_RESTORE` | No | Optional paths to client binaries if not on `PATH`. |

## Frontend

```bash
cd frontend
cp .env.example .env
# Optional: VITE_API_URL=http://localhost:3001

npm install
npm run dev
```

Default dev server: `http://localhost:5173`

The app opens on **`/login`**. Use the seeded admin **login name** `admin` and password `admin`, then you are redirected to the home dashboard. **Log out** clears the stored token.

### Environment variables (frontend)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | No | Backend base URL; default `http://localhost:3001`. |

## Initial admin user

After `npm run migrate`, a single user exists if the table was empty:

- **Login name:** `admin`
- **Password:** `admin` (change immediately in production)

No other seed data is applied.

The SPA stores the JWT in `localStorage` and sends it on authenticated API calls as needed.

## Production builds

```bash
cd backend && npm run build && npm start
cd frontend && npm run build
```

Serve `frontend/dist/` with any static host; point `VITE_API_URL` at the public API URL at build time.
