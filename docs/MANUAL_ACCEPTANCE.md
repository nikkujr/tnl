# Packages, Customer Access, and Automation Acceptance

## Verification record

Implementation verification on 2026-10-02 (Asia/Shanghai):

| Check                               | Result                           | Scope and limits                                                                                                                                  |
| ----------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend TypeScript compilation      | Passed                           | API and separate worker                                                                                                                           |
| Backend focused tests               | 16 passed, zero failures         | Three pure business checks and an isolated MySQL acceptance test with twelve business scenarios                                                   |
| Database migration                  | Passed twice in scratch schema   | Idempotence checked; configured application database was not migrated                                                                             |
| Angular production build            | Passed                           | Production bundle and template/type checking                                                                                                      |
| Browser smoke checks                | 10 passed, no browser exceptions | Actual Angular application in headless Chrome, API fixtures, including a 390px viewport; does not substitute for end-to-end production acceptance |
| Paper rendering                     | See paper alignment record       | Native Word PDF export and packaged page rasterizer, visual inspection                                                                            |
| Business user acceptance            | Pending                          | Complete the scenarios below with the business owner and agents                                                                                   |
| Production mail delivery/deployment | Pending                          | Tests use a local SMTP sink; SMTP acceptance does not establish inbox delivery                                                                    |

Backend evidence is reproducible with `cd backend`, `TNL_INTEGRATION=1`, and `npm test` (PowerShell: `$env:TNL_INTEGRATION='1'; npm test`). Integration credentials need permission to create/drop an isolated `tnl_test_<random hex>` schema. The test applies migrations, exercises actual HTTP handlers and MySQL transactions, and drops only its validated scratch schema. It neither modifies the configured schema nor sends real customer mail.

The browser smoke run covered guest catalog availability, personal-action login gates, empty recommendations, customer login and reviewed request submission, owned-order replies and reuse of open follow-ups, phone-width portal layout, admin package editing, agent/admin request queues, uncertain-run acknowledgment, and campaign preview/audience/Manila scheduling. Browser test fixtures and screenshots from this development run are in the ignored `.tmp/` workspace; the acceptance matrix remains the durable release checklist.

## Acceptance environment

Use a staging database and test customers with controlled inboxes. Follow [deployment instructions](DEPLOYMENT.md): back up first, migrate, configure `PUBLIC_APP_URL` and SMTP, run both API and worker, and verify worker heartbeat. Start built-in workflows disabled, review legacy discrepancies, then enable each workflow deliberately. Record tester, date, browser, release revision, result, and evidence per scenario. Use shortened configured delays or aged staging fixtures for reminders; do not alter production dates to simulate events.

## Sales and inventory

| ID      | Action                                                                                                                         | Expected result                                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SALE-01 | Create fixed and percentage packages with repeated component products across packages; add multiple units and standalone lines | Total uses package selling prices plus standalone prices. Stock requirements aggregate all component quantities; standalone items remain separately visible                                                             |
| SALE-02 | Edit a catalog package after creating an order/request                                                                         | Saved names, contents, price, and commission remain unchanged; new sales use new terms                                                                                                                                  |
| SALE-03 | Submit a portal request using an obsolete catalog revision                                                                     | Conflict requires reviewing refreshed terms; no silently changed customer request                                                                                                                                       |
| SALE-04 | Submit a request, convert it, and approve it                                                                                   | Request reserves nothing. Conversion checks stock and preserves saved terms. Approval rechecks stock and fixes credited active agent                                                                                    |
| SALE-05 | Approve competing orders whose combined quantity exceeds availability                                                          | Only available stock is reserved; losing request reports a conflict without partial reservation                                                                                                                         |
| SALE-06 | Deliver before payment, then mark fully paid; repeat in the opposite order                                                     | Stock deducts only at delivery. Completion and commission occur only after both conditions hold                                                                                                                         |
| SALE-07 | Submit concurrent/repeated payment and delivered-stage commands                                                                | Exactly one stock deduction and one package commission posting; repeated stage is a no-op                                                                                                                               |
| SALE-08 | Skip forward delivery stages, then attempt a backward stage                                                                    | Forward skip succeeds with timestamped history; rollback is rejected                                                                                                                                                    |
| SALE-09 | Use quantity three, price 99.99, percentage 7.5%, plus a fixed package                                                         | Percentage line rounds to 22.50; fixed amount multiplies package units; rounded package lines sum. Agent legacy percentage has no effect                                                                                |
| SALE-10 | Complete a standalone-only order                                                                                               | Sale completion and eligible purchase follow-up are recorded; no commission is posted                                                                                                                                   |
| SALE-11 | Attempt payment downgrade after package commission is earned                                                                   | Rejected; earned commission/history remain unchanged                                                                                                                                                                    |
| SALE-12 | Edit a converted request's selections through staff UI/API                                                                     | Rejected; changed selections require a new customer-confirmed request                                                                                                                                                   |
| SALE-13 | Review legacy completed/unpaid or commission discrepancies                                                                     | Displayed for review, with original commissions preserved; no inferred packages, backfill, or historical message replay                                                                                                 |
| SALE-14 | Deactivate a product used by a pending/approved package order                                                                  | Conflict preserves fulfillment availability and history                                                                                                                                                                 |
| SALE-15 | As an agent, create a new order and try to add standalone products through the UI and API; repeat as an admin                  | Agent sees only a package picker; package quantities and totals submit correctly. API rejects agent standalone/mixed creation and new standalone additions on edit with 403. Admin can create product and mixed orders. |

## Customer accounts, requests, and privacy

| ID         | Action                                                                            | Expected result                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACCESS-01  | Register using a current CRM contact email and verify the emailed token           | Account links only after verification; CRM name/contact/assignment are not overwritten                                                            |
| ACCESS-02  | Accept a staff invitation and choose a password                                   | Verified account links to invited CRM contact; invitation is expiring and single use                                                              |
| ACCESS-03  | Use expired/reused verification or recovery tokens                                | Rejected without linking or changing the account                                                                                                  |
| ACCESS-04  | Recover password, then reuse an older login token                                 | New password works; older customer sessions are invalid                                                                                           |
| ACCESS-05  | Customer calls any staff endpoint, or requests another customer's order/follow-up | Staff call denied; foreign owned record is not exposed; customer IDs in submitted input cannot select ownership                                   |
| ACCESS-06  | Browse own order and public tracking for the same order                           | Portal shows safe owned status/payment details; public response excludes contact/payment data, full address, coordinates, IDs, and internal notes |
| REQUEST-01 | Submit request with an active assigned agent, then without one                    | Assigned agent receives durable notice; otherwise admin assignment queue receives it                                                              |
| REQUEST-02 | Assign a queued request, disconnect agent, then sign agent in                     | Queue and unread persisted notification are available after reconnect                                                                             |
| REQUEST-03 | Convert the same request concurrently/repeatedly                                  | One pending order is returned and one order link is saved; normal admin approval remains required                                                 |
| REQUEST-04 | Deactivate an assigned agent before request submission                            | Request routes to the admin queue                                                                                                                 |
| FOLLOW-01  | Request an update twice while open                                                | Current order status is visible; same open tracked follow-up is reused                                                                            |
| FOLLOW-02  | Responsible agent replies                                                         | Reply appears in owned portal history and one transactional customer email is queued                                                              |
| FOLLOW-03  | Unrelated agent attempts assignment/conversion/reply                              | Scope check denies action; admin can resolve routing                                                                                              |
| NOTICE-01  | Mark a persisted staff notice read and reload                                     | Read state remains stored for that staff user                                                                                                     |

## Automation and campaigns

| ID          | Action                                                                       | Expected result                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AUTO-01     | Enable order updates and approve/reject or advance delivery                  | One transactional email action per mutation; repeated stage queues nothing new                                                            |
| AUTO-02     | Leave pending approval for 24h, then resolve before worker execution         | Admin notice once if still pending; resolved action is skipped                                                                            |
| AUTO-03     | Leave approved order not fully paid for 72h, including delivered orders      | Assigned agent/admin notice once per unpaid episode; full payment resolves the episode                                                    |
| AUTO-04     | Before completion, move paid to unpaid again                                 | New qualifying unpaid episode may notify; an old episode's pending action skips                                                           |
| AUTO-05     | Leave delivery unchanged for 48h, then advance before execution              | Agent/admin notice once for unchanged stage; stale action skips after progress                                                            |
| AUTO-06     | Reduce available stock to threshold, recover, and reach threshold again      | One admin notice per episode; old queued episode skips after re-entry; availability accounts for reservations                             |
| AUTO-07     | Create opted-in live contact, unsubscribed contact, and imported placeholder | Welcome only for opted-in live contact; imports do not trigger historical marketing                                                       |
| AUTO-08     | Complete delivered/paid sale and wait three days                             | Opted-in customer receives purchase follow-up, including standalone-only purchase; unsubscribe before sending skips it                    |
| AUTO-09     | Stop worker with a claimed action before send begins, expire lease, restart  | Safe action returns to pending and is processed once; notice deduplication prevents duplicate staff notices                               |
| AUTO-10     | Stop worker after send starts or simulate ambiguous SMTP disconnect          | Run becomes UNKNOWN, is visible to admin, and cannot automatically resend; retry requires explicit uncertainty acknowledgment             |
| AUTO-11     | Simulate SMTP 451 or connection failure before transmission                  | Bounded backoff, at most five attempts; permanent rejection fails, successful SMTP acceptance records ACCEPTED rather than inbox delivery |
| AUTO-12     | Run two workers against the same pending recipient                           | Lease/claim fencing permits only one execution; attempts and result are persisted                                                         |
| AUTO-13     | Disconnect SMTP or stop worker                                               | Admin health/history shows failure/backlog/heartbeat; failed run can be reviewed and safely retried                                       |
| CAMPAIGN-01 | Preview ALL audience and SELECTED audience                                   | Only currently opted-in non-placeholder recipients are eligible; selected IDs determine audience                                          |
| CAMPAIGN-02 | Schedule explicit Manila date/time within campaign date window               | UTC instant is saved independently of start/end window; worker queues one campaign run when due                                           |
| CAMPAIGN-03 | Submit Send twice/concurrently                                               | Same campaign run and captured content are reused; no second recipient batch                                                              |
| CAMPAIGN-04 | Unsubscribe after preview/queuing and before worker sends                    | Recipient is skipped even if previously previewed as eligible                                                                             |
| CAMPAIGN-05 | Open per-recipient results after mixed success/failure                       | Each state, attempts, and error is visible; SMTP acceptance is distinguished from confirmed inbox delivery                                |
| CAMPAIGN-06 | Follow marketing unsubscribe link while signed out                           | Preference is disabled; transactional account/order/reply emails remain separate                                                          |

## Guided chatbot and interface

| ID      | Action                                                                             | Expected result                                                                                                  |
| ------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| CHAT-01 | Guest chooses browse, recommendation, or public tracking                           | Live catalog, available matches, or limited tracking; unavailable selections cannot be submitted                 |
| CHAT-02 | Choose category and maximum budget                                                 | At most five available matches ordered by price and stable identifier; package categories derive from components |
| CHAT-03 | Select budget/category with no available matches                                   | Clear empty-result explanation; no unsupported suitability claim                                                 |
| CHAT-04 | Guest chooses my orders, submit request, or request update                         | Login required; verified ownership then governs access                                                           |
| CHAT-05 | Authenticated user submits request through topic/cart                              | Same validated backend request operation and reviewed catalog terms as ordinary portal                           |
| UI-01   | Admin manages package, conversion queue, automation settings, and campaign results | Role-appropriate controls and actionable conflicts/failures                                                      |
| UI-02   | Agent opens queues and commissions                                                 | Only assigned work; package breakdown and legacy source distinguish records                                      |
| UI-03   | Customer signs out after viewing personal history                                  | Personal records are cleared and customer shell returns to guest state                                           |
| UI-04   | Use portal and staff screens at phone/desktop widths                               | Readable controls, accessible labels, no page-level overflow; record target devices                              |

## Release sign-off

| Field                                  | Value                                  |
| -------------------------------------- | -------------------------------------- |
| Business owner / tester                | Pending                                |
| Release revision                       | Pending (record deployed Git revision) |
| Staging URL / device / browser         | Pending                                |
| Completed acceptance IDs / evidence    | Pending                                |
| Worker heartbeat and SMTP verification | Pending                                |
| Legacy discrepancies reviewed          | Pending                                |
| Workflows deliberately enabled         | Pending                                |
| Approval for production rollout        | Pending                                |

## Admin performance follow-up (2026-10-02)

Implemented **Manage → Performance** with a monthly selector, top-five rankings, completed-sales/deal figures, daily graph and figures, leaderboard, monthly sales targets with optional fixed incentives, one-time incentive approval, and admin-approved bonus history. See [performance rules and manual acceptance](PERFORMANCE.md).

Verification: 30 backend checks passed, including disposable MySQL report/approval checks and the existing sales, stock, authorization, and automation suite. Backend TypeScript compilation passed using a scratch output directory because existing `dist` files were locked for writing. Frontend production build passed with the existing initial-bundle warning (510.22 kB versus a 500 kB warning threshold). `frontend/scripts/check-performance.cjs` passed for admin navigation, target editing, reward approval/retry, empty months, and 320/390px phone layouts; screenshot review covered desktop charts and targets plus mobile figures. Browser checks use API fixtures and make no business writes. The current configured database report was checked through the updated API; order and commission counts remained unchanged. Only the two performance tables were ensured by this implementation; no target or reward was created by the migration.
