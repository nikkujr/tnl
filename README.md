# TNL Track

TNL Track is a CRM, package sales, inventory, delivery, customer portal, and field-agent management system. Angular, the Express API, and a durable MySQL-backed automation worker deploy independently.

## Projects

- `frontend/` — Angular 22 standalone application
- `backend/` — Express 5 TypeScript API using simple CQRS and vertical slices
- `docs/` — HTTP contract and manual acceptance plan
- `PRD.md` — product requirements

## Prerequisites

- Node.js 24.15 or a compatible Angular 22 runtime
- MySQL 8+
- npm 11+

## Backend setup

1. Copy `backend/.env.example` to `backend/.env`.
2. Create the configured MySQL database and user.
3. Install dependencies in `backend/`.
4. Run `npm run db:migrate`.
5. Run `npm run db:seed`.
6. Run `npm run dev`.
7. In a separate backend process, run `npm run worker`.

Use `npm run build`, `npm start`, and `npm run worker:start` for compiled production processes. Both API and worker require the same database and mail configuration. Set `PUBLIC_APP_URL` to the customer-facing HTTPS origin for activation, reset, and unsubscribe links. Run migrations before either process starts. Do not run the demo seed against production data.

The seed creates:

- `admin@tnl.local`
- `agent@tnl.local`
- Password for both: `TnlDemo123!`

Change these credentials outside local development.

## Frontend setup

1. Install dependencies in `frontend/`.
2. Update `src/environments/environment.ts` if the API is not on port 3000.
3. Run `npm start`.
4. Open `http://localhost:4200`.

## Architecture

Each backend feature lives in `backend/src/features/<feature>`. Routes,
validation, commands/queries, and feature-specific data access remain together.
Commands perform mutations, while queries return read models. MySQL
transactions protect stock-sensitive order operations.

The frontend and backend share no runtime code and communicate only through the
HTTP contract in `docs/API.md`. Permitted frontend origins are configured with
`CORS_ORIGINS`.

Run `npm test` in backend for focused calculations and recovery checks. To include disposable MySQL integration checks, set `TNL_INTEGRATION=1` before running `npm test`. The configured database user must be able to create/drop an isolated `tnl_test_<random>` schema; tests never migrate the configured live schema. Integration tests use a local SMTP sink, not the configured email provider.

See [the implementation specification](issues/README.md), [API contract](docs/API.md), [deployment and rollout](docs/DEPLOYMENT.md), and [acceptance record](docs/MANUAL_ACCEPTANCE.md). Workflows start disabled. Review legacy discrepancies, configure SMTP/templates, and enable each deliberately in the admin Automations screen.

Admins can use **Manage → Performance** for monthly agent sales rankings, figures/charts, targets, fixed incentives, and admin-approved bonuses. See [performance rules and acceptance](docs/PERFORMANCE.md). Run migrations before using the updated API; no targets or rewards are created automatically.
