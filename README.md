# TNL Track

TNL Track is a CRM, sales, inventory, delivery-tracking, and agent-management
system implemented as independently deployable Angular and Express projects.

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

Automated tests are intentionally omitted for the initial release. Follow and
record the scenarios in `docs/MANUAL_ACCEPTANCE.md`.
