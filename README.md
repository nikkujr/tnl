# TNL Track

TNL Track is a CRM, package sales, inventory, delivery, customer portal, and field-agent management system. Angular, the Express API, and a durable MySQL-backed automation worker deploy independently.

Delivery staff use the existing sign-in and a mobile `/delivery` workspace. Admins manage `/delivery-employees` and `/dispatch`; private Leaflet maps share location while the active delivery page is open. Recipient/photo proof is required for employee completion. Configure durable private photo storage and migrate before rollout; see [delivery setup and acceptance](docs/DELIVERY.md).

## Projects

- `frontend/` — Angular 22 standalone application
- `backend/` — Express 5 TypeScript API using simple CQRS and vertical slices
- `docs/` — HTTP contract and manual acceptance plan
- `PRD.md` — product requirements

## Prerequisites

- Node.js 24.15 or a compatible Angular 22 runtime
- MySQL 8+ or MariaDB 10.4+ with InnoDB and utf8mb4
- npm 11+

## Backend setup

For a Linux VPS with Docker, use the [deployment folder](deployment/README.md) for HTTPS, migrations, admin creation and backup/restore scripts.

1. Copy `backend/.env.example` to `backend/.env`.
2. Create the configured database and user. Use `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` for the database so names and peso symbols are preserved.
3. Install dependencies in `backend/`.
4. Run `npm run db:migrate`.
5. Run `npm run db:seed`.
6. Run `npm run dev`.
7. In a separate backend process, run `npm run worker`.

Use `npm run build`, `npm start`, and `npm run worker:start` for compiled production processes. Both API and worker require the same database and mail configuration. Set `PUBLIC_APP_URL` to the customer-facing HTTPS origin for activation, reset, and unsubscribe links. Run migrations before either process starts. Do not run the demo seed against production data.

The panel-defense seed creates 60 IT/mobile products, 6 packages, 8 agents,
2 delivery staff, 60 customers with portal accounts, and 360 orders across six
reporting months, plus CRM, inventory, delivery, campaign and performance data.
Dates follow the day you run it using the Manila business calendar.

- Admin: `admin@tnl.local`
- Agents: `agent@tnl.local`, `agent2@tnl.local` through `agent8@tnl.local`
- Delivery: `delivery1@tnl.local`, `delivery2@tnl.local`
- Customer portal: `mara.santos@example.test`
- Password for every demo account: `TnlDemo123!`

`db:seed` refuses existing application data. To replace it with the defense
dataset, stop the API and worker and run from `backend/`:

```sh
npm run db:reset -- --confirm=tnl_track
```

Replace `tnl_track` with the exact `DB_NAME` in your backend environment. This
deletes all application records in that database and reloads the demo data.
Both seed and reset refuse `NODE_ENV=production`; `npm run db:seed -- --check`
previews counts without database writes. See [the defense guide](docs/DEMO_DATA.md)
for state counts, sample scenarios, reset behavior and verification.

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

Customer emails use a shared TNL Track HTML layout with purple branding, action buttons, and a plain-text alternative. **Automations → Settings** previews the same design as you edit a message, without sending an email. See [email templates and verification](docs/EMAILS.md).

Admins can use **Reports → Performance** for monthly agent sales rankings, figures/charts, targets, fixed incentives, admin-approved bonuses, and customer ratings/reviews. Customers can rate their agent once per delivered, fully paid order from the portal. Office orders show no review section. See [performance rules and acceptance](docs/PERFORMANCE.md). Run migrations before using the updated API; no targets, rewards or reviews are created automatically.

In **Customers**, admins can select **View** for contact and account information, completed purchase totals, and paginated requests, orders, reviews and follow-ups. Admin order details also display the customer's saved review and link to their customer profile.

Customer **My orders** supports server-side search (order number, product/package, agent or address), order/delivery/payment status filters, and 10/20/50 orders per page. Returning from order details restores the applied filters and page.

Paid and partially paid bank/card updates require a transaction reference number, retained in admin order details and payment history. Cash/COD amount entry defaults to the full order total and remains editable. Run migrations before deploying these payment changes.

Admin **Update payment** records the cumulative amount received for Cash, Cash on delivery, Bank transfer and Card. Partial payments must be below the order total; full bank/card payments must equal it, while cash/COD may include change. Order details show amount paid and balance, and payment history records the amount. Run `npm run db:migrate` before starting the updated API; older payments without a recorded amount remain unknown. Overview order amounts use the complete saved total, including packages.

**Reports → Daily / Monthly / Overall reports** includes completed sales revenue and trends, top 10 fast-selling and slow-moving products with charts and tables, top customers and packages, order/payment status breakdowns, and current low-stock products. Product movement includes saved package components; slow movers include active stocked products with zero sales. See [report definitions and checks](docs/REPORTS.md).

Daily, Monthly, Overall and Performance reports include **Print / Save PDF** and **Export CSV** for the loaded report. Printing hides navigation and editing controls; CSV includes the report period, timezone, load timestamp and unformatted numerical values. See [output conventions](docs/REPORTS.md#print-and-csv).
