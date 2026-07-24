# Initial Manual Acceptance Test Plan

Record the date, tester, browser, API version, result, and evidence for every
scenario before release.

## Environment

1. Create a MySQL database and application user.
2. Copy `backend/.env.example` to `backend/.env` and supply valid values.
3. Run the migration and seed commands.
4. Start the backend on port 3000 and frontend on port 4200.
5. Confirm `GET /health` returns HTTP 200.

## Authentication and authorization

| ID | Scenario | Expected result |
|---|---|---|
| AUTH-01 | Sign in with the seeded admin credentials | API returns a token and ADMIN user |
| AUTH-02 | Sign in with an incorrect password | API returns HTTP 401 without identifying which field was wrong |
| AUTH-03 | Call a protected endpoint without a token | API returns HTTP 401 |
| AUTH-04 | Agent calls an admin inventory adjustment | API returns HTTP 403 |
| AUTH-05 | Agent lists customers | Only customers assigned to that agent are returned |
| AUTH-06 | Agent creates and edits an assigned customer | Customer is saved under that agent and updated successfully |
| AUTH-07 | Agent attempts to edit another agent's customer through the API | API returns HTTP 403 |

## Customers

| ID | Scenario | Expected result |
|---|---|---|
| CRM-01 | Create a customer with valid data | Customer is saved and returned with an id |
| CRM-02 | Create a duplicate customer email | Operation fails and no duplicate row is created |
| CRM-03 | Submit an invalid email | API returns HTTP 400 with validation details |
| CRM-04 | Search by name, email, and phone | Matching customers are returned |

## Orders and inventory

| ID | Scenario | Expected result |
|---|---|---|
| ORD-01 | Agent creates an order with available stock | Order is Pending and has a unique generated tracking number |
| ORD-02 | Agent requests more than available stock | API returns HTTP 409 and creates no order |
| ORD-03 | Admin approves a pending order | Order becomes Approved, delivery becomes Preparing, and stock is reserved |
| ORD-04 | Admin approves the same order twice | Second operation returns HTTP 409 and does not reserve stock again |
| ORD-05 | Admin rejects a pending order | Order becomes Rejected and stock is unchanged |
| ORD-06 | Agent edits a pending order | Customer, product, quantity, address, and payment method are updated |
| ORD-07 | Agent tries to edit an approved order | API returns HTTP 409 and leaves the order unchanged |
| ORD-08 | Admin changes payment status | Updated status appears after refresh |
| ORD-09 | Agent advances an assigned approved delivery | A timestamped delivery event is recorded |
| ORD-10 | User deletes an eligible pending/rejected order | Order is removed |
| ORD-11 | User attempts to delete a delivered/completed order | API returns HTTP 409 and preserves history |
| ORD-12 | User creates an order with multiple different products | All line items, captured prices, quantities, and total appear correctly |
| ORD-13 | One line item exceeds available stock | Entire order is rejected and no partial order is created |
| ORD-14 | The same product is submitted twice | Validation rejects the duplicate line item |
| ORD-15 | Multi-item order is approved and delivered | Every item is reserved and deducted, and commission uses the full order total |
| INV-01 | Admin adds inventory | On-hand stock increases and an ADD movement is recorded |
| INV-02 | Admin deducts more than on-hand stock | Operation fails and stock does not become negative |
| CAT-01 | Admin creates a unique category | Category appears in Category Management |
| CAT-02 | Admin deletes a category used by an active product | API returns HTTP 409 and preserves the category |
| PRD-01 | Admin creates a product | Product appears with zero stock |
| PRD-02 | Admin updates product name, category, price, and description | Updated data appears in Product Management |
| PRD-03 | Admin deletes a product with a pending order | API returns HTTP 409 and preserves the product |
| INV-03 | Admin changes low-stock threshold and reorder level | Positive settings are persisted |
| DEL-01 | Agent advances an approved order to Delivered | Order completes, reserved stock is deducted, and one commission is posted |
| LEAD-01 | Admin converts a lead | Customer is created or linked and lead becomes Converted |
| AGT-01 | Admin deactivates an agent with active orders | Operation is rejected until active work is resolved |
| AGT-02 | Admin creates and edits an agent | Contact details and commission rate are saved; an optional edit password replaces the current password |
| AGT-03 | Admin deactivates an eligible agent | Agent remains in management history as Inactive and is removed from new assignment controls |
| AGT-04 | Admin updates an agent to an email already in use | API returns HTTP 409 and preserves both records |
| AGT-05 | Admin activates an inactive agent | Agent becomes Active, can sign in, and appears in assignment controls |
| AGT-06 | Admin activates an already-active agent | API returns HTTP 409 without changing the agent |
| CMP-01 | Admin creates a campaign with valid content and dates | Campaign appears in the management list |
| CMP-02 | Admin edits an existing campaign | Name, audience, content, dates, and status are updated |
| CMP-03 | Admin creates or edits a duplicate campaign name | API returns HTTP 409 |
| CMP-04 | Admin saves an end date on or before the start date | UI blocks submission and API returns HTTP 400 if called directly |
| CMP-05 | Admin deletes a campaign | Campaign is removed from the management list |
| CMP-06 | Admin confirms Send email with SMTP configured | Email is sent to unique customer addresses by BCC and the UI reports the recipient count |
| CMP-07 | Admin sends without SMTP configuration | API returns HTTP 503 without changing campaign status |
| CMP-08 | Admin sends a campaign containing HTML elements | Email is sent as HTML with a generated plain-text alternative |
| CMP-09 | Admin sends a campaign containing plain text | Email is sent as plain text without an HTML body |

## Tracking and interface

| ID | Scenario | Expected result |
|---|---|---|
| TRK-01 | Look up a valid tracking number | Current order/delivery status and ordered events are returned |
| TRK-02 | Look up an unknown tracking number | API returns HTTP 404 without customer contact information |
| UI-01 | Switch the demo shell from Admin to Agent | Admin-only navigation is removed |
| UI-02 | Visitor opens the application without signing in | Landing page displays Track my order and staff sign-in sections |
| UI-03 | Visitor submits a valid tracking number | Delivery state and event history appear without customer contact or payment details |
| UI-04 | Admin changes a line-item quantity on New Order | Subtotal and total update; quantities above available inventory are rejected |
| UI-05 | Agent changes a line-item quantity on New Order | Subtotal and total update; quantities above available inventory are rejected |
| UI-06 | Open the interface at phone width | Navigation and content remain readable without page-level horizontal overflow |
| UI-07 | Select Low stock or Healthy on Inventory | Only products matching the selected threshold classification remain visible |

## Release record

| Field | Value |
|---|---|
| Release | Initial |
| Tester | |
| Date | |
| Browser/device | |
| API commit/version | |
| Result | Not executed |
| Evidence location | |
