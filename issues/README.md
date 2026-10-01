# TNL Track packages customer access and business automation

## Business flow

Field agent offers a package → customer submits a request or agent enters an order → agent handles the request → admin approves the order → whole-order delivery and full payment complete → package commission is earned once.

Chapter I of paper.docx is the research baseline, expanded by the verified customer portal and guided chatbot. Chapter III must use agent management, package orders, manual payment recording, Angular/Express/TypeScript/MySQL, and a separate automation worker. Employee payroll, POS, payment gateways, PHP/CodeIgniter, PostgreSQL, and general live chat are outside this release.

## Sales foundation

- Admins manage package name, description, component products/quantities, selling price, active status, and FIXED peso or PERCENTAGE commission value. Field agents offer those terms with no substitutions, discounts, or overrides.
- Orders contain multiple package units and standalone products. Package selling prices contribute to sales totals; component product prices do not add again. Standalone lines remain separate and earn no commission.
- Save package identity, contents, price, and commission at order/request entry. Retained pending order selections preserve their saved terms. Customer requests include the reviewed catalog revision; stale submissions require review again. Conversion preserves the submitted snapshot. Changed selections require a new confirmed request.
- Aggregate every component quantity across package units and standalone items. Requests reserve no stock. Creation/conversion check availability; approval locks stock and reserves the aggregate. Forward delivery deducts the aggregate exactly once.
- Approval requires an active field agent and fixes credit. Delivery stages can skip forward, repeat as a no-op, and never go backward.
- Eligibility is whole-order DELIVERED plus PAID, evaluated in both transactions. Fixed commission = package quantity × fixed amount. Percentage = package line selling total × percentage. Round each line half-up to centavos, then sum; save one commission record per package order with a breakdown.
- Completed standalone orders schedule purchase follow-up but post no commission. Earned sales cannot downgrade payment. Refunds, adjustments to earned commissions, payouts, and payroll are outside this release.
- Existing orders and commission postings remain legacy. Do not infer old packages, apply staff percentage rates to new sales, backfill commissions, or email historical events. Admins review discrepancies in Automations. Imported records remain read-only.

## Customer access

- Separate verified customer accounts link one-to-one to CRM contacts. Registration, staff invitation, login, expiring single-use activation/reset tokens, and session revocation after password reset are supported.
- Link existing contacts only after email verification; registration never overwrites their names, phone, address, or agent assignment. Changing the email of an account-linked contact requires a future verified email-change flow.
- Customer ownership comes exclusively from the verified session. Customers are denied every staff API. Staff APIs accept active Admin/Agent identities and retain role/ownership scopes.
- The portal provides catalog, requests, own orders with safe delivery/payment details, marketing preferences, and follow-up replies.
- Route requests to the active assigned agent, else the admin assignment queue. Conversion is idempotent and creates one pending order; admin approval remains necessary. Durable notices cover requests, orders, assignments, and follow-ups.
- Follow-up displays the latest status, then opens one tracked request for the responsible agent. Repeated submissions reuse an open request. Agent replies persist in the portal and enqueue transactional email. This is not a general messaging inbox.

## Guided conversations

Predefined topics: browse catalog, recommend an offer, public tracking, my orders, submit request, and request an update. Use buttons, search, validated inputs, and live API data. No LLM or chatbot platform is required.

Recommendations accept category and maximum budget and return up to five available matches, ordered by price then identifier with a deterministic kind tie-break. Packages match categories through components. Empty results explain how to adjust the filters; no unsupported suitability claims are made.

Guests browse, recommend, and track using limited public status/timestamps. Personal orders, requests, and follow-ups require customer login. Public tracking omits contacts, payment, full address, coordinates, internal notes, and internal IDs.

## Automation

Use Angular/Express/MySQL with a separately supervised MySQL-backed worker. Business mutations write structured events and related pending actions in the same transaction. Deduplication, leases, attempts, outcomes, read state, and low-stock episodes persist in MySQL.

| Workflow | Behavior |
|---|---|
| Order updates | Transactional email for approval/rejection and forward delivery changes |
| Pending approval | Admin notice after 24 hours |
| Outstanding payment | Assigned agent/admin after 72 hours from approval while not fully paid, even if delivered |
| Stalled delivery | Assigned agent/admin after 48 hours without stage progress |
| Low stock | Admin when available stock reaches its per-product threshold; rearms after recovery |
| Scheduled campaign | One run at an explicit date/time, all eligible or selected customers |
| Welcome | Immediate email for a new live contact who explicitly opted in |
| Purchase follow-up | Marketing email three days after whole-order delivery and full payment, including standalone purchases |
| Customer activity | Durable staff notices for requests, orders, assignments, and follow-ups |

Admins configure supported templates, delays, per-product thresholds, and enablement. Business scheduling uses Asia/Manila; storage uses UTC. Reminders fire once per qualifying anchor/episode and recheck before execution. Defaults are disabled for controlled rollout. Marketing starts unsubscribed, excludes placeholder imports, and requires opt-in and unsubscribe. Transactional account/order/reply emails remain separate.

Campaign date windows are independent of scheduledAt. Show eligible recipient previews and per-recipient outcomes. Repeated send commands return the original run. Claimed actions use SKIP LOCKED and leases. Retry only known transient failures with bounded backoff; uncertain send outcomes require admin review. Record SMTP acceptance separately from confirmed inbox delivery.

## Interfaces and implementation locations

| Area | Backend | Frontend |
|---|---|---|
| Packages and public offers | features/packages, features/catalog | Packages, portal, guided chat |
| Totals, stock, commission | features/orders/sales.ts and transactional order handlers | New order, saved order details, commissions |
| Events, worker, notices | features/automations and src/worker.ts | Automations and notification center |
| Accounts | features/customer-auth | Customer portal |
| Requests and follow-up | features/customer-portal | Customer requests queue and portal |
| Campaign audience/execution | features/campaigns and automations/campaigns.ts | Campaign previews/results |

The complete endpoint contract is in ../docs/API.md. Deployment requires both API and worker; see ../docs/DEPLOYMENT.md. CONTEXT.md defines project terms.

## Implementation sequence and verification

1. Sales snapshots and package calculations, stock reservation/deduction, transactional completion.
2. Durable events/actions, worker recovery, staff notices, reminders, and marketing.
3. Verified customer ownership, portal, agent queues, idempotent conversion and follow-ups.
4. Guided topics connected to the settled APIs.
5. Paper/requirements/API alignment, acceptance evidence, controlled rollout.

Focused automated checks cover financial rounding, mixed/repeated components, package quantities, stock contention, both completion orders, duplicate/concurrent mutations, immutable request conversion after catalog changes, verified linking and invitation/expiry, customer/staff separation, cross-customer denial, fallback assignment, follow-up replies, durable read state, reminder resolution, delivered-unpaid reminders, low-stock recovery, campaign single execution/current consent, expired leases, duplicate claims, uncertain SMTP outcomes, no legacy backfill, and empty/deterministic recommendations. Manual UI acceptance is recorded in ../docs/MANUAL_ACCEPTANCE.md.

## Design references

- [AWS transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html): persist dispatch intent with the business transaction.
- [MySQL locking reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html): queue claiming with FOR UPDATE SKIP LOCKED.
- [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): enforce identity and ownership for every operation.
- [Microsoft structured conversation topics](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/topics-overview): predefined conversation flows; no platform dependency is introduced.
