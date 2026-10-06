# TNL Track HTTP API

Base URL: `http://localhost:3000/api/v1`

Management/sales APIs explicitly accept active ADMIN/AGENT identities as documented. DELIVERY uses separate fulfillment endpoints and shared personal account/notifications only. Customer APIs require a verified CUSTOMER token and derive ownership from its account; customerId inputs never select customer ownership. Public catalog and tracking require no token.

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

Delivery employees use this same login with role DELIVERY. `POST /auth/logout` invalidates the active staff session version and stops delivery location sharing. The delivery dashboard, dispatch, assignment, issue, GPS and private photo endpoints are specified in the [delivery HTTP contract](DELIVERY.md#http-contract).

## My account

Account endpoints accept active Admin/Agent/Delivery sessions or verified Customer sessions and always derive identity from the authenticated account. No submitted user/customer ID selects a profile.

- `GET /account` — own `{id,role,fullName,email,phone,address}`. Staff addresses are null; customer `id` is the login account ID, not an editable CRM ID. Password hashes and session versions are not profile fields.
- `PATCH /account/profile` — `{fullName,phone,address?}`. A normalized PH mobile number is required for agents/customers; admins may submit null. Customers require an address; staff must omit it. Returns `{profile,user,token}` to refresh the current browser. Unknown fields, including email, role, assignment, consent, or another account ID, are rejected. Sign-in email remains read-only; saved order/request addresses are preserved.
- `PATCH /account/password` — `{currentPassword,newPassword}`. Requires the correct current password, a different password of 8–72 characters and at most 72 UTF-8 bytes. Returns `{profile,user,token}` with the new session version. Old tokens are rejected, including from other browsers; outstanding customer reset links are invalidated. The endpoint limits repeated attempts.

Run migrations before using these endpoints. Staff tokens without a version are treated as version zero until a password change. Admin replacement of an agent password also increments its session version. See [My account behavior and acceptance](ACCOUNTS.md).

## Dashboard

### `GET /dashboard`

Returns the role-scoped order counts, recognized paid revenue, total customers,
product count, and low-stock count.

## Reports

### `GET /reports?period=daily&date=YYYY-MM-DD`

Admin only. Also accepts `period=monthly&month=YYYY-MM` or `period=overall`.
Calendar selections must be valid dates/months between 2000 and 2100. Returns
`data: { period, selection, timeZone, totals, trend, fastProducts, slowProducts,
customers, packages, statuses, payments, stockAlerts, stock }`.

Totals contain completed sales count/revenue, average sale value, distinct buying
customers, and the count of sales using historical order dates. Product rankings
include saved package component quantities and current on-hand/reserved/available
stock. Status/payment tables use order creation dates; stock health is always
current. See [report definitions](REPORTS.md) for date, ranking, and value semantics.

## Customers

- `POST /customers/:id/reset-password` — Admin only; `id` is the CRM customer ID. Strict body `{newPassword}`; requires an active verified portal account. Sets a different password (8+ characters, at most 72 UTF-8 bytes), revokes existing customer sessions and unused recovery links, and records a credential-free admin audit event in the same transaction. Returns `{id,reset:true}` without a session token. Missing customer: 404; no active verified account: 409. Does not create, verify, or reactivate an account or send email.
- Customer list rows include `portalAccountExists` and `portalAccountActive` for portal invitation/reset controls.

### `GET /customers?search=&page=1&limit=20`

Admins see all customers. Agents see only customers assigned to them.

### `GET /customers/:id?view=orders&page=1&limit=20`

Admin only. Returns `{data:{customer,summary,records},meta:{page,limit,total}}`. `view` is `orders`, `requests`, `reviews`, or `followups`; pages are positive integers and limit is 1..100. History is newest first with an ID tie-breaker; `meta.total` counts the selected history. Missing customer returns 404; invalid ID, view or pagination returns 400. Agents, customers and delivery staff cannot access this endpoint.

The safe contact profile includes contact details, current agent assignment, creation date, marketing consent and portal account/verification status. No credentials, tokens or recovery links are returned. Summary contains all-time order/request/review/follow-up counts, delivered/completed and fully paid purchase count/value (excluding cancelled/rejected orders), and nullable average customer rating. This customer average combines reviews across agents and office orders; it does not replace per-agent performance averages.

Order records include saved totals, workflow/payment states and delivery addresses. Requests include saved product/package names and quantities, total, status, decline reason and a converted-order link when present. Reviews include rating, comment, submission date and the order's credited agent. Follow-ups include the message, reply, responder and reply date. Reviews and history are scoped to the selected customer regardless of their current agent assignment.

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

`GET /orders/:id` includes `review` for admins (null or `{rating,review,createdAt,agentId,agentName}`). The review retains the agent credited on the original order. This field is omitted for agent sessions; the existing order ownership rules still apply.

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
- `PATCH /orders/:id/delivery-status` — Admin only; requires assignmentVersion and deliveryStatus; forward event/status update; DELIVERED additionally requires recipientName and a staged photoId, or recipientName and exceptionReason. Agents have read-only delivery access.
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
- `POST /agents/:id/reset-password` — Admin only; strict body `{newPassword}`. Requires an active agent; sets a different password (8+ characters, at most 72 UTF-8 bytes), revokes previous agent sessions, and records a credential-free admin audit event in the same transaction. Returns `{id,reset:true}` without a session token. Missing/wrong-role target: 404; inactive agent: 409. Does not change profile details or send email. Reset routes are rate-limited to 20 attempts per IP per 15 minutes.
- `DELETE /agents/:id` — deactivates only after active-order checks

Admin performance endpoints:

- `GET /performance?month=YYYY-MM` — defaults to the current Asia/Manila month; returns `period`, `timeZone`, `totals`, ranked `agents`, complete daily `trend`, reward history, and `reviews`. Completed sales require live current-rule orders delivered and paid, dated by financial completion. Historical imports/legacy sales are excluded. Saved package and standalone prices contribute to sales; commissions remain separate. Each agent includes sales/deals, open orders created in the month, posted commission, target terms/progress, approved incentive/bonus totals, and incentive eligibility. Feedback is dated by review submission in the selected month, including reviews of older completed purchases. Each agent has `reviewCount` and nullable `averageRating` (1..5, rounded to two decimals). Each review includes `orderId`, `trackingNumber`, `customerName`, nullable `agentId`/`agentName`, `rating`, `review`, and `createdAt`. Office feedback has no agent and does not affect agent averages.
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
- GET /customer/orders/:id also returns `canReview` and `review` (null or `{rating,review,createdAt}`). A delivered/completed, fully paid order can receive one immutable customer review.
- POST /customer/orders/:id/review: `{rating:1..5,review:string}` requires an integer rating and 2..2000 characters of trimmed text. Only the verified owning customer can submit. Returns 201 `{rating,review,createdAt,reused:false}`; an identical retry returns 200 with `reused:true`. Incomplete purchases or a different second review return 409; another customer's order returns 404. Agent attribution comes from the order, never the request or the customer's current assignment.
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
- POST /automations/email-preview: admin-only `{workflow,subject,template}` for ORDER_UPDATES, WELCOME, or PURCHASE_FOLLOWUP. Returns `{subject,text,html}` using the outgoing branded renderer and sample customer values; preview links are inert. Does not send, enqueue, or change settings. Subject/body limits are 180/10000 characters; empty drafts use preview placeholders.
- PUT /automations/:workflow: `{enabled,config}` updates a supported workflow. config supports hours (1..8760), delayDays (0..365), subject, template; unspecified fields retain values. Workflow names: ORDER_UPDATES, PENDING_APPROVAL, OUTSTANDING_PAYMENT, STALLED_DELIVERY, LOW_STOCK, SCHEDULED_CAMPAIGN, WELCOME, PURCHASE_FOLLOWUP. Product thresholds use inventory-settings.
- GET /automations/runs?state=UNKNOWN: latest 200 records with state/attempts/dedupe key/result/error.
- POST /automations/runs/:id/retry: `{acknowledgeDuplicateRisk:false}` retries FAILED; UNKNOWN requires true. Other states fail 409.
- GET /automations/legacy-review: historical package-term gaps and posted-without-full-payment discrepancies; read only.
- GET /notifications: authenticated staff's latest persistent notices, link, readAt, and timestamps.
- POST /notifications/read: marks that identity's unread notices read.

Run states: PENDING, PROCESSING, ACCEPTED, SUCCEEDED, FAILED, UNKNOWN, SKIPPED. Leases and retry state persist; known transient failures have bounded retries. UNKNOWN is never automatically resent. Account emails, replies, and explicitly queued campaigns execute as mandatory actions. Other workflows start disabled and check enablement before execution. Reminder and marketing state are checked again at execution.

## Office orders

Admin order creation and pending-order editing accept an omitted or null agentId. Assigned agents must still be active. Agent sign-ins always credit themselves. Approval, delivery and financial completion support orders without an agent; these orders generate no agent commission. Admins may convert unassigned customer requests directly. Office orders remain visible to admins and their owning customers; unrelated agents cannot access them. Run migrations before using this flow so orders.agent_id permits null in existing databases.
