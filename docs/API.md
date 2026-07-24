# TNL Track HTTP API

Base URL: `http://localhost:3000/api/v1`

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

```json
{
  "customerId": 1,
  "agentId": 2,
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
orders. Inventory availability is checked again and each line-item price is
refreshed from the selected product.

### `POST /orders/:id/decision`

Admin only.

```json
{ "decision": "APPROVE" }
```

Approval locks the order and product rows, reserves inventory, initializes
delivery, and records both the inventory movement and delivery event.

- `PATCH /orders/:id/payment-status` — Admin payment-state update
- `PATCH /orders/:id/delivery-status` — role-scoped delivery event and status update
- `DELETE /orders/:id` — delete Pending, Rejected, or otherwise eligible non-delivered orders

Delivery completion deducts reserved stock and posts the commission once.

## Leads

- `GET /leads`
- `POST /leads` — create with contact details, source, assignment, and status
- `PUT /leads/:id` — update a non-converted lead
- `DELETE /leads/:id`
- `POST /leads/:id/convert`

Conversion creates or links a customer and preserves the converted lead.

## Campaigns

- `GET /campaigns`
- `POST /campaigns`
- `PUT /campaigns/:id`
- `DELETE /campaigns/:id`
- `POST /campaigns/:id/send` — sends the campaign to unique customer email
  addresses using BCC

Campaign create and update requests contain `name`, `targetAudience`, `content`,
`startDate`, `endDate`, and `status`. Names are unique and the end date must be
later than the start date.

Campaign email requires `SMTP_HOST` and `SMTP_FROM`. Configure `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASSWORD` when required by the mail
server. Campaign content containing HTML elements is delivered as `text/html`
with a generated plain-text alternative; other content is delivered as
`text/plain`.

## Agents and commissions

- `GET /agents` — optionally pass `activeOnly=true` for assignment controls
- `POST /agents` — create with name, email, phone, password, and commission rate
- `PUT /agents/:id` — update contact/rate and optionally replace the password
- `POST /agents/:id/activate` — restores an inactive agent's access
- `DELETE /agents/:id` — deactivates only after active-order checks
- `GET /commissions` — agent-scoped for Agents and global for Admins

## Public tracking

### `GET /tracking/:trackingNumber`

No authentication is required. Returns non-sensitive order status, delivery
status, destination, and chronological delivery events.

## Health

### `GET /health`

Returns `{ "status": "ok" }`.
