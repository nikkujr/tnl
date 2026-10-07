# Panel-defense data

This dataset models TNL IT & Mobile Enterprises as an IT/mobile retailer serving
households, students, remote workers and small shops in Metro Manila. Product
configurations and PHP prices are illustrative retail examples. People, phone
numbers and street numbers are fictional; customer and lead emails use
`example.test`. They are demonstration records, not actual business results.

## Load or reset

Delivery SLA examples include deliveries on track, overdue deliveries with a revised ETA, on-time handoffs and late handoffs. The original deliver-by deadline stays independent of the customer-facing estimate.

Dispatched demo orders include an estimated arrival: pending deliveries use a future date/time relative to seeding, and completed deliveries retain their historical estimate. The portal and tracking pages show estimates in Philippine time.

Configure `backend/.env` for a dedicated demo database, then run from `backend/`:

```sh
# Preview counts without connecting to or modifying the database.
npm run db:seed -- --check

# First load: runs migrations and refuses existing application records.
npm run db:seed

# Replace ALL application records; use the exact configured DB_NAME.
npm run db:reset -- --confirm=tnl_track
```

Stop both the API and automation worker before resetting, then restart them.
The confirmation must match `DB_NAME`; a missing/wrong confirmation or
`NODE_ENV=production` is rejected before migrations or data writes. Choose a
dedicated database rather than pointing a development environment at live data.

Reset runs migrations, then deletes child records before parents and inserts the
dataset in one transaction with foreign keys enabled. If an insert fails, the
data deletion and inserts roll back together. Schema migrations run separately
and cannot roll back with the data transaction. IDs may advance between resets;
references and JSON snapshots are mapped to the newly inserted IDs. Tracking
numbers remain `TNL-DEMO-0001` through `TNL-DEMO-0360`.

Workflow settings retain their configured templates but are all disabled. The
seed sends no email and creates no pending email jobs. Historical campaign and
automation results are synthetic and marked as demo in their payloads/results.
Worker heartbeat and live GPS observations are not fabricated. Start the real
worker and enable reviewed workflows if demonstrating reminders; configure a
local SMTP sink before demonstrating mail.

Reset clears proof-photo database records but does not delete private photo
files. Use a separate `DELIVERY_PHOTO_DIR` for the demo. Seeded delivery evidence
uses the application's admin exception with an explicit sample-data explanation;
it does not claim real recipient photos. To demonstrate employee photo proof,
upload a new photo while completing one of the open deliveries.

## Accounts

All demo accounts use **`TnlDemo123!`**.

| Role | Login |
| --- | --- |
| Admin | `admin@tnl.local` |
| Field agents | `agent@tnl.local`, `agent2@tnl.local` through `agent8@tnl.local` |
| Delivery staff | `delivery1@tnl.local`, `delivery2@tnl.local` |
| Customer portal | `mara.santos@example.test` |

All 60 customer contacts have verified portal accounts using their listed email.
The migration's inactive historical-import account remains available for import
attribution and cannot sign in.

## Dataset coverage

| Records | Count / coverage |
| --- | --- |
| Products | 60 across 7 IT/mobile categories, plus the migration's Uncategorized category |
| Packages | 6 with saved component quantities, sensible bundle prices, and fixed/percentage commissions |
| Staff | 1 active admin, 8 active field agents, 2 active delivery employees |
| Customers | 60, including agent-owned contacts and an office-owned contact |
| Orders | 360 live orders using current package sales rules |
| Completed financial sales | 240 delivered and fully paid |
| Delivered, awaiting payment | 24: 8 unpaid and 16 partially paid |
| Approved deliveries | 48: 12 each Preparing, Dispatched, In transit and Out for delivery |
| Pending approval | 30, with recent and overdue examples |
| Cancelled / rejected | 12 / 6; these reserve no stock |
| Customer requests | 24: 12 submitted, 8 converted with matching order terms, 4 declined |
| Leads | 24: 8 converted, 4 each New, Contacted, Qualified and Lost |
| Follow-ups | 16: 8 answered and 8 awaiting agent replies |
| Agent reviews | 80 reviews of agents on completed, fully paid orders, with ratings from 1 to 5 and varied communication/support feedback; no office-order reviews |
| Delivery issues | 4: 2 unresolved and 2 resolved |
| Active delivery jobs | 1 per employee, with assigned queues and destination pins |
| Campaigns | 4: 1 draft, 1 future scheduled, 2 completed with recipient histories |
| Import review | 1 unconfirmed batch with 2 ready and 2 attention rows; no imported sales posted |
| Performance | Monthly targets across the six reporting months, earned package commissions, fixed incentives and admin-approved bonuses |
| Inventory / activity | Reconciled opening balances, reservations and delivery deductions; low-stock, out-of-stock and zero-sale products; staff notifications |

## Demonstration walkthrough

1. Sign in as admin. The dashboard has orders, customer activity, stock alerts
   and a monthly sales trend. Filter orders to show the approval queue and each
   delivery/payment state. The pending set includes orders that can be approved.
2. Open Daily Reports for today, Monthly Reports for the current month, and
   Overall Reports. Completion dates span the current month and five preceding
   months, with sales today. Compare product movement, top customers/packages,
   slow movers and current stock. The first month's order intake can precede
   that month because preparation starts before financial completion.
3. Open Performance in the current month. Show approved incentives, an incentive
   ready for approval, targets in progress, and Enzo Garcia's zero-sales row as a
   new agent. Previous months contain additional sales, targets and reward history.
   One target deliberately has no incentive. Bonuses and commissions remain
   separate from sales and are award records, not payouts.
   Show agent rating averages/counts and open Customer feedback to filter reviews
   by agent; feedback uses its submission month.
4. Open an order with packages and standalone items. The package component
   snapshot drives stock and product movement; standalone prices add to revenue
   without earning agent commission. Office orders have no credited agent or
   commission. Delivered unpaid orders still await financial completion, and
   some completed sales record payment after the delivery date.
5. Sign in as `agent@tnl.local` to view assigned customers, orders, commissions,
   requests and follow-up replies. Sign in through the customer portal as Mara
   Santos to see owned history and submit a new request. Requests reserve nothing
   until their converted order is approved.
   Open a delivered, fully paid order with an agent to read its saved agent review
   or use Rate your agent if it has not been reviewed yet. Office orders show no
   review section.
6. Sign in as either delivery employee to see the assigned queue and active job.
   Open Dispatch as admin to inspect destination pins and resolve an issue.
   Start real location sharing from the employee's browser to demonstrate the map.
7. Show leads at different funnel stages, consent-based campaign recipient
   preview, synthetic campaign results, the import review queue and automation
   history. Enable a reminder only when ready to demonstrate real execution.

The mix is repeatable for the same time anchor. Calendar dates roll forward when
you reset so the default report screens remain populated. Early in a month,
fewer sales are placed in the current month and the rest remain in the previous
month; no sale, approval or reward is dated in the future. Only the scheduled
campaign has a future send time. Exact monthly totals vary with the run date.

## Verification

From `backend/`, `npm test` checks fixture determinism, state/ownership rules,
stock reconciliation, dates, package economics and CLI guards. Disposable MySQL
acceptance also exercises load/refusal, repeated resets, injected-failure rollback,
saved commission calculations, actual report queries, login/portal/performance
responses and completing a seeded delivery through the application's service:

```powershell
$env:TNL_INTEGRATION = '1'
npm test
```

Integration tests create/drop only random `tnl_test_*` schemas; the configured
database user needs those permissions. No configured live schema is seeded or
reset by those tests.
