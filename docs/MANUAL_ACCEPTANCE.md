# Sales, Customer Access, Automation and Delivery Acceptance

## Report output verification on 2026-10-03

Daily, Monthly, Overall and Performance now provide browser printing/Save PDF and UTF-8 CSV downloads from the loaded authorized data. The report and performance browser scripts passed: current-period filenames, no export refetch, all sections, raw numeric values, empty periods, leap-year zero rows, quote/comma/newline/non-ASCII handling, formula prefixes, disabled output on failed reports, detailed print tables/restoration, hidden navigation/editors, Manila date-only labels and 320/390px layouts. Sample A4 print PDFs were reviewed. Angular production build passed with the existing 500 kB warning budget exceeded (520.26 kB). No backend or database changes were needed for report output.

| ID | Manual scenario | Expected result |
|---|---|---|
| REPORT-OUT-01 | Load Daily/Monthly/Overall, change an input without applying, then export | File uses the loaded selection, matching summary and sections; empty periods retain zero figures |
| REPORT-OUT-02 | Print or save PDF; cancel once and finish once | Readable A4 tables with all trend values, repeated headers, no navigation/controls or clipped progress bars; collapsed details restore afterward |
| REPORT-OUT-03 | Print each Performance view and export its month | Print reflects the selected view; CSV contains summary, all agents/targets, daily sales and approved rewards, including reasons and timestamps |
| REPORT-OUT-04 | Open CSV in the intended spreadsheet app | UTF-8 names, quoted multiline fields and numeric PHP values read correctly; formula-looking text stays text. Import SKU fields as text when leading zeros matter |

## Delivery verification on 2026-10-03

On 2026-10-04, browser checks passed the admin **View proof of delivery** actions on completed dispatch cards and order details, focus/scroll to evidence above the map, authenticated blob photo retrieval, and expired-photo, admin-exception and missing-evidence states. The Angular production build passed with the existing initial-bundle warning (528.37 kB). Phone-width proof layout was reviewed.

On 2026-10-04, the delivery browser check also passed destination previews before saving, dragging through tracking polls, cancel/clear/replacement pins, invalid coordinate rejection, persistent map/marker DOM during order updates, and dispatch → in transit → out for delivery controls at 320/390/1440px. The completion shortcut focuses the recipient form. The Angular production build passed (528.37 kB initial bundle; existing 500 kB warning budget).

Backend compilation and Angular production build passed. All 58 backend checks passed against disposable MySQL schemas, including the new delivery scenarios; no configured application data was migrated. Additional delivery checks cover old/fresh schema upgrades twice, one active job, owned reads, reassignment fences, GPS fix/receipt age, unchanged milestone timestamps, recipient/photo requirements, oversized/invalid/over-40MP uploads, metadata removal/resizing, unavailable storage rollback, stock/payment/commission races, logout/password/session expiry, proof expiry, and abandoned/orphan cleanup. A concurrent cleanup/completion check verifies that cleanup retains a photo whose completion extended its expiry.

The actual Angular UI passed `frontend/scripts/check-delivery.cjs` in headless Chrome with API/GPS fixtures: Delivery home routing, no sales/customer prefetch (including edit links), restricted navigation, 320/390/1440px layouts, Leaflet rendering/provider failure, denied GPS, hidden-page stale display, resumed fresh fixes, failed upload/retry, completion and expired sessions. Admin employee create/edit/password-reset forms, phone-width dispatch with immediate visibility refresh, and the owned customer portal's private map/authenticated blob proof also passed. Customer order summaries refresh when the delivery stage changes. Screenshots were reviewed. Leaflet JavaScript and CSS load with map screens. The production initial bundle is 516.44 kB against the existing 500 kB warning budget; the build succeeds. These fixtures do not establish physical GPS accuracy or iOS/Android background behavior.

| ID | Scenario | Expected result | Field result |
|---|---|---|---|
| DEL-01 | Create/edit/reset an employee; deactivate with unfinished assignments | Staff login opens My deliveries; unrelated APIs deny access; reassign before deactivation; reset stops sharing and old sessions | Pending business UI acceptance |
| DEL-02 | Assign two orders and attempt simultaneous starts | One active attempt per employee/order; other job remains queued; missing destination pin is allowed | Automated passed; field pending |
| DEL-03 | Deny GPS; pause/resume and report an issue | Milestones remain usable, stock stays reserved, admin resolves before retry | Automated passed; field pending |
| DEL-04 | Reassign during sharing/upload and replay old commands | Old employee cannot read new tracking or consume old proof; no coordinates from ended session | Automated passed; field pending |
| DEL-05 | View admin/own-agent/own-customer maps and proof; try other ownership/public tracking | Private audiences only; no public coordinates or proof; private responses no-store | Automated passed; field pending |
| DEL-06 | Capture/select photo, retry failed storage, complete twice and race payment | One immutable recipient/photo record, one stock deduction, one commission after full payment; admin no-photo exception has required reason | Automated passed; field pending |
| DEL-07 | Android Chrome on trusted HTTPS: stationary/moving, hidden/locked phone, reconnect, expired login | Time/accuracy visible, old fix becomes stale after 60 seconds, disappears after ten minutes, foreground resumes with new fix, completion clears location | **Pending actual Android device** |
| DEL-08 | iPhone Safari: repeat DEL-07, camera capture and permission denial | Same foreground guarantees; record actual suspension and update latency | **Pending actual iPhone device** |
| DEL-09 | Age staged/committed proof, stop worker, then restore coordinated backup | Unused files removed after 24 hours, private access expires at 90 days, metadata remains; cleanup before restored access; backups rotate after 30 days | Automated cleanup passed; deployment/restore pending |

Record tester, date, device/browser version, trusted HTTPS origin, measured acquisition-to-view latency, release revision, outcome and evidence for DEL-07/08. The [delivery guide](DELIVERY.md) contains the rollout and defense sequence. Foreground sharing is the release claim; locked-phone tracking is not guaranteed.

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

## My account follow-up (2026-10-02)

Added My account for Admin, Agent, and verified Customer identities. Staff enter from the account menu; customers enter from the portal header. Profiles support name/phone and customer address, with read-only sign-in email. Password changes require the current password and revoke older sessions. See [account behavior and manual acceptance](ACCOUNTS.md).

Verification: all 49 backend checks passed, including seven account checks with disposable MySQL for ownership/restricted fields, validation, preserved customer assignments/consent/order addresses, password changes, old-session rejection, concurrent requests, reset-link invalidation, and admin password replacement. TypeScript checks and the frontend production build passed; the existing bundle warning remains. The account browser script passed for all three roles on desktop and at 320/390px, including navigation, profile/session refresh, password errors/confirmation/show-hide, token replacement, and cleared inputs. Screenshots were reviewed. Live account reads passed for Admin/Agent/Customer; no real profile or password was edited. The staff session-version column was ensured with a zero default.

## Admin password reset follow-up (2026-10-02)

Admins now reset active agent passwords from Agents and active verified customer portal passwords from Customers. A separate dialog identifies the account and requires a matching replacement password. Customer rows show account status; contacts without an account keep Invite to portal. The server denies agent/customer callers, preserves profiles and verification, revokes old sessions, invalidates customer recovery links, and records credential-free audit events. See [account behavior](ACCOUNTS.md).

Verification: all 50 backend checks passed against disposable MySQL databases, including both reset flows, role restrictions, invalid/multi-byte passwords, missing/inactive/no-account targets, old credentials/sessions and recovery links, unchanged CRM data, and audit payloads. Backend TypeScript and the production frontend build passed; the existing initial-bundle warning remains (513.85 kB versus a 500 kB warning threshold). The fixture browser script passed for both admin pages, denied agent UI access, confirmation/show-password/error/retry states, cleared inputs, Escape/focus restoration, and 320/390px dialogs. Desktop and mobile screenshots were reviewed. No real password or contact was changed during verification.

Manual acceptance: as Admin, use Reset password for an active agent and verified customer, enter and confirm a different password, and verify old sessions/sign-in credentials fail while the replacement works. Open My account as the target and change it again. Try Cancel, Escape, mismatched values, and narrow phone screens. Confirm customers without portal accounts offer invitation instead, inactive accounts cannot be reset, and agents have no customer reset action.

## Office orders verification on 2026-10-04

An agent is optional for admin-created office orders and admin conversion of unassigned customer requests. Omitted/null assignments, pending edits, approval, owned customer reads, delivery/payment completion, one stock deduction and no commission passed against disposable MariaDB 10.4. Existing NOT NULL schemas upgrade twice successfully. All 65 backend checks passed; the expanded delivery/request checks passed again. Backend TypeScript, Angular production build and agent/admin browser checks at desktop and phone widths passed; the existing bundle warning remains. Manually create an office order, assign then clear its agent, approve and complete it, and confirm the customer sees it and no agent commission is earned.

Office-order follow-up: the shared pending-order dialog now preserves an empty agent, offers an explicit office option and sends null rather than zero. Browser checks cover editing that order and converting an unassigned customer request, alongside customer request submission. The configured database's old NOT NULL constraint reproduced ER_BAD_NULL_ERROR; the nullable-column migration was applied, and a rollback-only insert then passed. Order and commission counts were unchanged by the migration.

## Customer catalog filters on 2026-10-04

The customer catalog offers All offers, Products and Packages filters alongside search. It hides offers without available stock, including packages whose components cannot supply a unit. Counts and pagination use the filtered in-stock list and return to page one on type changes. Browser checks passed type/search combinations, sold-out exclusions, pagination reset and request submission at desktop and 390/320px widths. Production build passed with the existing initial-bundle warning; no database migration is needed.

## Destination search verification on 2026-10-04

Geoapify-backed explicit place search previews a pin and centers it without saving automatically. Twelve delivery/geocoding checks passed on disposable MariaDB 10.4, including role denials, short-query validation, missing keys, empty/malformed/provider-error responses and normalized coordinates. Browser fixtures passed result selection, empty/error recovery, visible pins, cancellation and existing delivery workflows at 1440/390/320px. Backend compilation and Angular production build passed with the existing bundle warning. Manual live-provider verification remains pending a configured GEOAPIFY_API_KEY. No geocoding request was sent to the live provider during fixture checks.
