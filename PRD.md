# TNL Track product requirements

TNL Track integrates CRM, order and delivery tracking, inventory, human field-agent management, verified customer access, and built-in business automation for TNL IT & Mobile Enterprises.

The agreed specification is [issues/README.md](issues/README.md). It is the authority for package snapshots, commission eligibility, customer ownership, operational reminders, marketing consent, and guided conversations. The HTTP contract is [docs/API.md](docs/API.md), the domain vocabulary is [CONTEXT.md](CONTEXT.md), and rollout requirements are [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Technology and roles

Angular 22 and TypeScript frontend; Express 5/Node TypeScript API; MySQL 8/InnoDB persistence; independent MySQL-backed worker; SMTP email. Frontend and backend communicate through the documented HTTP API with environment-based CORS. Business transactions share sales validation across staff creation, request conversion, and chatbot-selected requests.

Admins manage CRM, packages, products, stock, order approvals/payment recording, agents, delivery employees and dispatch, campaigns, automation configuration, history, and discrepancies. Field agents manage assigned customers, requests, orders, follow-up replies, and their earned commissions; delivery progress is read-only. Delivery employees use the existing staff login, work on one active assigned order, update milestones, report issues, and record recipient/photo evidence. Customers verify email before accessing owned records; guests access public catalog, recommendations, and privacy-limited tracking.

## Required screens

- Public landing, tracking, and guided conversation topics.
- Staff dashboard, leads/conversion, customer contacts/invitations, categories/products/inventory, agent records, orders/details, and commissions.
- Package catalog and admin package editor.
- Customer request assignment/conversion/decline and agent follow-up response queues.
- Automation settings, heartbeat/backlog, execution failures/retries, and legacy review.
- Campaign editor with real all/selected audiences, Manila send time, recipient preview, and per-recipient results.
- Customer portal with verified account registration/invitation/recovery, catalog/request review, request history, owned orders/timelines/replies, and marketing preferences.
- Mobile delivery queue/details, admin delivery employee management and dispatch overview, private Leaflet maps, manual destination pins, issue resolution, and immutable handoff evidence.

## Business constraints

Catalog terms cannot be overridden by field agents. Requests reserve no stock. Admin approval reserves aggregated component quantities; delivery deducts once. Delivery plus full payment earns saved package commission once, with line rounding; standalone items earn no commission. Existing commission history is retained without package inference or backfill.

Account and order messages are transactional. Marketing is explicitly opt-in, starts false, excludes import placeholders, and checks consent again before each dispatch. Operational reminders recheck current state and fire once per episode. Campaigns run once. An uncertain email is held for admin review instead of automatic resend.

## Scope and verification

No POS, payment gateway, external banking/logistics integration, employee payroll, refunds/payouts, arbitrary rule builder, LLM dependency, or general live-chat inbox. Payments remain admin-managed. Location is shared only for an active delivery while its employee page is open; no dependable background tracking, road routing, ETA or offline synchronization is included. See [delivery behavior and release gates](docs/DELIVERY.md).

Focused backend automated checks are required for financial calculations, concurrent inventory/commission operations, authorization, token expiry, and worker recovery. Manual UI and deployment acceptance remains required; see [docs/MANUAL_ACCEPTANCE.md](docs/MANUAL_ACCEPTANCE.md). Workflows remain disabled until deliberate business review.
