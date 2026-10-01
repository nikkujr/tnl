# TNL Track HTTP API

Base URL: `http://localhost:3000/api/v1`

All staff APIs explicitly accept active ADMIN/AGENT identities. Customer APIs require a verified CUSTOMER token and derive ownership from its account; customerId inputs never select customer ownership. Public catalog and tracking require no token.

Authenticated requests use:

```http
Authorization: Bearer <access-token>
Content-Type: application/json
```

All successful responses wrap their payload in `data`. Validation and runtime
errors use `{ "error": { "message": "...", "details": {} } }`.

## Authentication

### `POST /auth/login`

```json
{
  "email": "admin@tnl.local",
  "password": "TnlDemo123!"
}
```

Returns an access token and the authenticated user.

## Dashboard

### `GET /dashboard`

Returns the role-scoped order counts, recognized paid revenue, total customers,
product count, and low-stock count.

## Customers

### `GET /customers?search=&page=1&limit=20`

Admins see all customers. Agents see only customers assigned to them.

### `POST /customers`

```json
{
  "fullName": "Mara Santos",
  "email": "mara@example.com",
  "phone": "+63 917 555 0112",
  "address": "128 Maginhawa Street, Quezon City",
  "assignedAgentId": 2
}
```

For agent sessions, `assignedAgentId` is ignored and ownership is assigned to
the authenticated agent.

## Products and inventory

## Categories

- `GET /categories` — paginated category query
- `POST /categories` — create a unique category
- `PUT /categories/:id` — update a category
- `DELETE /categories/:id` — delete only when no active product references it

### `GET /products?search=lamp`

Returns active products with category and stock information.

The query also accepts `categoryId`, `minPrice`, `maxPrice`, `page`, and
`limit`.

- `POST /products` — create a product without directly setting stock
- `PUT /products/:id` — update product catalog information
- `DELETE /products/:id` — deactivate when no pending/approved orders exist

### `POST /products/:id/inventory-adjustments`

Admin only.

```json
{
  "type": "ADD",
  "quantity": 10,
  "note": "Supplier delivery"
}
```

Stock is updated and an inventory movement is recorded in one transaction.

### `PUT /products/:id/inventory-settings`

Updates the positive low-stock threshold and reorder level.

## Orders

### `GET /orders`

Admins see all orders. Agents see only their orders.

### `POST /orders`

Agent and Admin. Agents are assigned automatically; Admin requests include an
active `agentId`.

Agents select packages only; nonempty standalone `items` are rejected with 403.
Admins may create package, product, or mixed orders.

```json
{
  "customerId": 1,
  "agentId": 2,
  "packages": [{ "packageId": 1, "quantity": 2 }],
  "items": [
    { "productId": 1, "quantity": 2 },
    { "productId": 3, "quantity": 1 }
  ],
  "deliveryAddress": "128 Maginhawa Street, Quezon City",
  "paymentMethod": "Bank transfer"
}
```

The server checks every line item against available stock, captures each unit
price and product identity, and generates the tracking number.

### `PUT /orders/:id`

Updates customer, assigned agent where permitted, line items, delivery address,
and payment method for a Pending order. Agents may update only their own
orders. Agents may add packages but cannot introduce new standalone products; existing product lines can be retained. Inventory is checked again. Retained package/product selections keep captured terms; added selections capture current terms. Converted customer request orders cannot be edited.

### `POST /orders/:id/decision`

Admin only.

```json
{ "decision": "APPROVE" }
```

Approval locks the order and product rows, reserves inventory, initializes
delivery, and records both the inventory movement and delivery event.

- `PATCH /orders/:id/payment-status` — Admin payment-state update
- `PATCH /orders/:id/delivery-status` — role-scoped delivery event and status update
- `DELETE /orders/:id` — delete Pending or Rejected orders that are not linked to a customer request

Delivery completion deducts reserved component stock once. Commission posts once only when the whole order is DELIVERED and PAID, evaluated in payment and delivery transactions. A repeated stage is a no-op; backward stages fail with 409. New package commission uses saved fixed/percentage rules and per-line centavo rounding; standalone products earn no commission. Earned sales cannot downgrade payment. Outputs include packages, saved terms/components, total, and commission breakdown.

## Leads

- `GET /leads`
- `POST /leads` — create with contact details, source, assignment, and status
- `PUT /leads/:id` — update a non-converted lead
- `DELETE /leads/:id`
- `POST /leads/:id/convert`

Conversion creates or links a customer and preserves the converted lead.

## Campaigns

Admin only. GET /campaigns lists the catalog. POST creates and PUT /campaigns/:id edits unqueued campaigns; DELETE refuses campaigns with execution history.

```json
{
  "name": "October offer",
  "content": "Our latest catalog",
  "startDate": "2026-10-01",
  "endDate": "2026-10-31",
  "status": "SCHEDULED",
  "audienceType": "SELECTED",
  "customerIds": [1, 2],
  "scheduledAt": "2026-10-05T10:00:00+08:00"
}
```

status inputs are DRAFT/SCHEDULED; worker-managed states are ACTIVE/COMPLETED. Scheduled campaigns require an offset-qualified ISO timestamp inside the inclusive Manila date window. End date must be later than start date. ALL ignores customerIds; SELECTED requires IDs. Date windows do not themselves specify a send time.

- GET /campaigns/:id/recipients returns currently eligible opted-in recipients, excluding import placeholders.
- POST /campaigns/:id/send returns 202 with `{id,recipientCount,reused}`. Commands reuse the campaign's single run. Terms become immutable after queuing.
- GET /campaigns/:id/results returns recipient customerId, state, attempts, result, and lastError.

Consent is rechecked before each recipient send. SMTP configuration is checked by the worker; missing configuration records FAILED outcomes for admin resolution. HTML content gets a text alternative and marketing unsubscribe footer. ACCEPTED means SMTP acceptance, not inbox delivery.

## Agents and commissions

- `GET /agents` — optionally pass `activeOnly=true` for assignment controls; `totalCommission` sums posted earnings in pesos, including retained legacy postings. `commissionRate` is a legacy field, not an earned amount.
- `GET /agents/:id` — includes posted commissions, their total, and each order's `commissionAmount` and `commissionStatus`: EARNED, STANDALONE, CANCELLED, LEGACY_REVIEW, OTHER_AGENT, POSTING_REVIEW, AWAITING_APPROVAL, AWAITING_PAYMENT, AWAITING_DELIVERY, or AWAITING_COMPLETION. A standalone-only sale earns no commission even when delivered and paid. Status reads never create or backfill postings.
- `POST /agents` — create with name, email, phone, password, and optional legacy commission rate
- `PUT /agents/:id` — update contact/legacy rate and optionally replace the password
- `POST /agents/:id/activate` — restores an inactive agent's access
- `DELETE /agents/:id` — deactivates only after active-order checks

Admin performance endpoints:

- `GET /performance?month=YYYY-MM` — defaults to the current Asia/Manila month; returns `period`, `timeZone`, `totals`, ranked `agents`, complete daily `trend`, and reward history. Completed sales require live current-rule orders delivered and paid, dated by financial completion. Historical imports/legacy sales are excluded. Saved package and standalone prices contribute to sales; commissions remain separate. Each agent includes sales/deals, open orders created in the month, posted commission, target terms/progress, approved incentive/bonus totals, and incentive eligibility.
- `PUT /performance/targets/:agentId/:period` — `{salesTarget, incentiveAmount}`; one target per agent/month, positive sales target, nonnegative fixed incentive. Approved incentive terms are locked.
- `POST /performance/incentives/:targetId/approve` — `{idempotencyKey}`; checks the target and current completed sales in a transaction, records its fixed incentive at most once, and returns `{id,reused}`. Repeats reuse the reward; conflicting keys return 409.
- `POST /performance/bonuses` — `{agentId,period,amount,reason,idempotencyKey}`; positive amount to centavos and a 3–500 character reason. Saves immutable admin approval details. Repeated identical keys reuse the record; changed payloads return 409. Keys use 16–64 alphanumeric, underscore, or hyphen characters.

- `GET /performance/agents/:agentId/rewards?month=YYYY-MM` — read-only monthly rewards for an Admin or the matching Agent; other agent identities return 403. Defaults to the current Asia/Manila month. Returns completed sales, target terms/progress/status, approved incentive and bonus totals, and reward history with reasons and approval details. Unapproved incentives are excluded from approved totals.

Team reports and reward management require an active Admin identity. Agents can read only their own monthly rewards. Rewards do not create commission postings or record payouts. See [performance behavior and acceptance](PERFORMANCE.md).

- `GET /commissions` — agent-scoped for Agents and global for Admins

## Public tracking

### `GET /tracking/:trackingNumber`

No authentication is required. Returns non-sensitive order status, delivery
status and chronological stage timestamps. No full address, coordinates, internal notes, contact/payment information, or internal IDs are returned.

## Health

### `GET /health`

Returns `{ "status": "ok" }`.

## Packages and public offers

- GET /packages: staff catalog with components, available package units, commissionType/value; agents see active packages.
- POST /packages, PUT /packages/:id: admin terms; DELETE /packages/:id deactivates without removing snapshots.

```json
{
  "name": "Starter package",
  "description": "Catalog offer",
  "sellingPrice": 1500,
  "commissionType": "PERCENTAGE",
  "commissionValue": 5,
  "active": true,
  "components": [
    { "productId": 1, "quantity": 2 },
    { "productId": 3, "quantity": 1 }
  ]
}
```

Fixed value is pesos per package unit; percentage value is 0..100. Prices/values use at most two decimals. Components and order selection IDs must be unique with positive integer quantities. Agent inputs cannot override prices, components, or commission.

- GET /catalog?search= returns public PRODUCT/PACKAGE offers, revision, price, safe components, and availability. It omits commission values.
- GET /catalog/categories lists categories.
- GET /catalog/recommendations?categoryId=1&budget=2000 returns up to five available matches sorted by price, ID, then kind. Packages match through component categories. categoryId may be omitted for all categories.

## Customer authentication

- POST /customer-auth/register: `{email,password,fullName,phone,address,marketingOptIn:false}` queues verification and returns a generic 202. No contact is linked/created until verification. Existing CRM fields are preserved.
- POST /customer-auth/invite: staff `{customerId}`; agents may invite only assigned contacts. Queues a 24-hour activation link to the contact's real email.
- POST /customer-auth/verify: `{token,password?}` consumes a valid single-use activation token and returns `{token,user}`. Invitations require a chosen password; registration uses the submitted password hash.
- POST /customer-auth/login: `{email,password}` returns CUSTOMER token/user for an active verified account.
- POST /customer-auth/forgot-password: `{email}` returns generic 202 and queues a 30-minute reset link when eligible.
- POST /customer-auth/reset-password: `{token,password}` consumes the reset token, invalidates other reset links, and revokes previous account sessions.
- POST /customer-auth/unsubscribe: `{token}` disables marketing only.

Registration/login/verification/recovery routes have IP rate limits. Passwords must be 8..72 characters. Invalid/expired activation/reset tokens return 400. Expired/revoked/inactive-account sessions return 401. Staff tokens cannot authenticate customers and CUSTOMER tokens receive 403 from staff APIs. SMTP_HOST/SMTP_FROM and PUBLIC_APP_URL are required for account links.

## Customer portal and requests

All `/customer` routes derive customer ownership from the verified account.

- GET /customer/me returns safe profile and current marketingOptIn.
- PATCH /customer/preferences: `{marketingOptIn:boolean}`.
- GET /customer/orders and GET /customer/orders/:id return only owned orders, saved sales terms without commission, total, safe payment/delivery details, and (detail) stage timestamps and follow-ups. Other customers' IDs return 404.
- GET /customer/requests returns owned submitted/converted/declined requests and saved terms.
- POST /customer/requests requires reviewed catalog revisions and non-cash-on-entry payment selection:

```json
{
  "items": [{ "productId": 1, "quantity": 1 }],
  "packages": [{ "packageId": 2, "quantity": 1 }],
  "reviewedTerms": [
    { "kind": "PRODUCT", "id": 1, "revision": "<64-hex catalog revision>" },
    { "kind": "PACKAGE", "id": 2, "revision": "<64-hex catalog revision>" }
  ],
  "deliveryAddress": "Confirmed delivery address",
  "paymentMethod": "Cash on delivery"
}
```

Payment methods for requests are Cash on delivery, Bank transfer, Card. No online payment is collected. Availability and reviewed terms are checked; changed terms fail 409. Requests reserve no stock. Active assigned agent gets the request; otherwise the admin queue receives it.

- POST /customer/orders/:id/followups: `{message}` (2..1000 characters); returns 201 `{id,reused}` and reuses an open follow-up. Ownership is checked before any write.

Staff `/requests` routes:

- GET /requests returns agent-owned or global admin requests with snapshots.
- PATCH /requests/:id/assignment: admin `{agentId}` assigns an active agent and stores a notice.
- POST /requests/:id/convert: `{}` converts once to a pending order preserving snapshot; repeat returns original order and reused=true. Availability is rechecked. Agent may convert only assigned requests. Unassigned requests require assignment first.
- POST /requests/:id/decline: `{reason}` closes a submitted request and queues customer email.
- GET /requests/followups/open returns open agent-owned or global follow-ups.
- POST /requests/followups/:id/reply: `{reply}` (2..2000 characters) records one response, visible in portal, and queues transactional customer email. Repeated reply fails 409.

## Automation and durable notifications

- GET /automations: admin settings, worker heartbeats, backlog grouped by state.
- PUT /automations/:workflow: `{enabled,config}` updates a supported workflow. config supports hours (1..8760), delayDays (0..365), subject, template; unspecified fields retain values. Workflow names: ORDER_UPDATES, PENDING_APPROVAL, OUTSTANDING_PAYMENT, STALLED_DELIVERY, LOW_STOCK, SCHEDULED_CAMPAIGN, WELCOME, PURCHASE_FOLLOWUP. Product thresholds use inventory-settings.
- GET /automations/runs?state=UNKNOWN: latest 200 records with state/attempts/dedupe key/result/error.
- POST /automations/runs/:id/retry: `{acknowledgeDuplicateRisk:false}` retries FAILED; UNKNOWN requires true. Other states fail 409.
- GET /automations/legacy-review: historical package-term gaps and posted-without-full-payment discrepancies; read only.
- GET /notifications: authenticated staff's latest persistent notices, link, readAt, and timestamps.
- POST /notifications/read: marks that identity's unread notices read.

Run states: PENDING, PROCESSING, ACCEPTED, SUCCEEDED, FAILED, UNKNOWN, SKIPPED. Leases and retry state persist; known transient failures have bounded retries. UNKNOWN is never automatically resent. Account emails, replies, and explicitly queued campaigns execute as mandatory actions. Other workflows start disabled and check enablement before execution. Reminder and marketing state are checked again at execution.
