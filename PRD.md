# TNL-TRACK: An Integration of Customer Relationship Management, Tracking, and Agent Management

## Tech Stack
- Frontend: Angular 22 (Typescript)
- Backend: Node.js (Express.js) - Typescript
- Database: MySQL

## Architecture
- The system will have a client-server architecture.
- Follow a simple CQRS and Vertical Slice architecture
- No automated test suite is required for the initial release; all acceptance criteria must be verified through documented manual acceptance testing.
- Create a separate backend and frontend project structure to allow for independent development and deployment.
- The frontend and backend are separate deployable projects and communicate only through the documented HTTP API.
- The backend must expose environment-based CORS configuration for the permitted frontend origin or origins.


## Users

### Admin
A person responsible for managing customer relationships, monitoring business operations, overseeing agent performance, and making business decisions. The admin/owner has full access to CRM, inventory, delivery tracking, agent management, and performance monitoring.

### Agent
A person responsible for handling customer interactions, processing orders, updating delivery statuses, managing assigned tasks, and maintaining customer records. Agents have limited access based on their assigned responsibilities.

### Customer
A person who interacts with the business to track deliveries and contact agents for inquiries. Customers have limited access to the system, primarily for tracking their orders and communicating with agents.

## Public Landing Page

- Present the TNL Track service before authentication.
- Provide a prominent "Track my order" form that accepts a tracking number and displays the current order/delivery status and delivery event history.
- Provide a separate staff sign-in section for administrators and agents.
- Public tracking must not expose customer contact or payment information.


# Pages

## Admin POV

- Dashboard Page
  - Total Customers
  - Total Agents
  - Total Orders
  - Pending Orders
  - Approved Orders
  - Completed Orders
  - Cancelled Orders
  - Rejected Orders
  - Total Products
  - Low Stock Products
  - Total Revenue
  - Monthly Revenue Summary
  - Recent Customer Registrations
  - Recent Orders
  - Recent Delivery Activities
    UI:
    - Statistics Cards
    - Revenue Chart
    - Order Status Chart
    - Recent Activities Table
    - Low Stock Notification Panel
    - Quick Action Buttons
    Clickable Areas:
    - Total Customers Card: click to view Customer Management Page
    - Total Orders Card: click to view Order Management Page
    - Low Stock Products Card: click to view Inventory Management Page
    - Agents Card: click to view Agent Management Page

## CRM Pages

- Customer Management Page
  - Add customer information.
      UI:
        - Customer registration form
        - Save button
        - Reset button
      Validation:
        - Ensure required fields are completed.
        - Validate phone number format.
        - Validate email address format.
        - Prevent duplicate customer records.
  - Update and delete customer information.
      UI:
        - Customer information table
        - Edit button
        - Delete button
        - View Details button
      Validation:
        - Ensure required fields are completed.
        - Validate phone number and email address.
        - Prevent duplicate customer records.
  - View list of customers and their details.
      UI:
        - Customer information table
        - Search bar (search in Name, Email, Phone Number, Agent)
        - Pagination controls
      Validation:
        - Ensure search queries are valid.

- Marketing Campaign Management Page
  - Create a new marketing campaign.
      UI:
        - Campaign creation form(campaign name, target audience, campaign content, start date, end date)
        - Save Campaign button
      Validation:
        - Ensure required fields are completed.
        - Validate campaign content.
        - Validate campaign schedule.
  - View and manage marketing campaigns.
      UI:
        - Campaign list table
        - Campaign status badges
        - Actions (view, edit, delete, send email)
      Validation:
        - Campaign name must be unique.
        - End date must be later than start date.
      Notes:
        - Sending emails the campaign to all unique customer email addresses through environment-configured SMTP.
        - Recipient addresses must use BCC so customers cannot view other recipients.
        - A successfully sent Draft or Scheduled campaign becomes Active.

- Lead Management Page
  - List of leads and their details.
      UI:
        - Lead information table(name, email, phone number, source, assigned agent)
        - Search bar (search in Name, Email, Phone Number)
        - Filter options (by source)
        - Pagination controls
        - Convert to Customer button
      Validation:
        - Ensure search queries are valid.
  - Add new leads.
      UI:
        - Lead registration form(name, email, phone number, source, assigned agent, status)
        - Save button
        - Reset button
      Validation:
        - Ensure required fields are completed.
        - Validate phone number and email address.
        - Prevent duplicate lead records.
  - Update and delete leads.
      UI:
        - Lead information table
        - Edit button
        - Delete button
        - View Details button
      Validation:
        - Ensure required fields are completed.
        - Validate phone number and email address.
        - Prevent duplicate lead records.
      Notes:
        - Converted leads are retained as historical records and cannot be edited or deleted.
        - Converting a lead creates a customer or links the lead to an existing customer with the same email address.

## Sales & Inventory Management Pages

- Category Management Page
  - Add new product categories.
      UI:
        - Category creation form(category name, description)
        - Save button
        - Reset button
      Validation:
        - Ensure required fields are completed.
        - Category name must be unique.
  - Update and delete product categories.
      UI:
        - Category information table
        - Actions (edit, delete)
      Validation:
        - Ensure required fields are completed.
        - Category name must be unique.
      Notes:
        - For deletion, the system will check if the category is associated with any products. If so, the system will prevent deletion until those products are reassigned or deleted.
  - View list of product categories.
      UI:
        - Category information table
        - Search bar (search in Category Name, Description)
        - Pagination controls
      Validation:
        - Ensure search queries are valid.

- Product Management Page
  - Add new products.
      UI:
        - Product creation form(product name, category, price, description)
        - Save button
        - Reset button
      Validation:
        - Ensure required fields are completed.
        - Price must be greater than zero.
        - Stock quantity is managed automatically and cannot be negative.
  - Update and delete products.
      UI:
        - Product information table
        - Actions (edit, delete)
      Validation:
        - Ensure required fields are completed.
        - Price must be greater than zero.
        - Stock quantity is managed automatically and cannot be negative.
      Notes:
        - For deletion, the system will check if the product is associated with any pending orders. If so, the system will prevent deletion until those orders are completed or canceled.
  - View list of products and their details.
      UI:
        - Product information table
        - Search bar (search in Product Name)
        - Filter options (by category and price range)
        - Pagination controls
      Validation:
        - Ensure search queries are valid.
        - Validate filter criteria.

- Order Management Page
  - Create customer orders.
      UI:
        - Dedicated New Order Page opened from the Order Management Page
        - Order form(customer, assigned agent, one or more product line items with quantity, delivery address, payment method)
        - Add Item button that opens a product-selection modal
        - Product-selection modal(search, product details, available quantity, quantity input, confirm and cancel actions)
        - Order item table with remove actions and calculated subtotals
        - Admin-editable line-item quantities on the New Order Page
        - Order summary showing item count and total amount
        - Save button
        - Reset or Cancel button
      Validation:
        - Ensure required fields are completed.
        - Assigned agent must be active.
        - Quantity must be greater than zero and cannot exceed available inventory.
      Notes:
        - Admin-created orders must be assigned to an active agent.
        - The tracking number is generated automatically by the system.
  - List of all customer orders and their details.
      UI:
        - Order information table(order ID, customer name, item summary, total amount, order status, delivery address, payment method)
        - Search bar (search in Order ID, Customer Name, Product Name)
        - Filter options (by order status)
        - Pagination controls
        - Mark orders as paid, partially paid, or unpaid.
        - Actions (view, edit, approve, reject, delete)
      Validation:
        - Ensure search queries are valid.
        - Validate filter criteria.
  - Update order status and details.
      UI:
        - Order information table
        - Edit button
        - View Details button
      Validation:
        - Ensure required fields are completed.
        - Validate order status updates.
  - Delete eligible orders.
      UI:
        - Order information table
        - Delete button
      Validation:
        - Ensure required fields are completed.
        - Validate order deletion.
      Notes:
        - The system will check whether the order is in a state that allows deletion (for example, not already delivered or completed).
  - Approve or reject pending orders.
      UI:
        - Pending orders table
        - Approval/rejection buttons
      Validation:
        - Ensure required fields are completed.
        - Validate order approval/rejection.
      Notes:
        - Approved orders will be processed for delivery.
        - For commission calculation, delivery status must be updated to "Delivered" before the commission is calculated and added to the agent's total commission. The commission will be calculated based on the order amount and the agent's commission rate.

- Inventory Management Page
  - Filter inventory by stock health.
      UI:
        - Stock health filter options(All inventory, Low stock, Healthy)
      Notes:
        - Low stock includes products whose on-hand quantity is less than or equal to the configured low-stock threshold.
        - Healthy includes products whose on-hand quantity is greater than the configured low-stock threshold.
  - Add quantity to existing products.
      UI:
        - Inventory update form(product selection, quantity to add)
        - Save button
      Validation:
        - Ensure required fields are completed.
        - Quantity must be greater than zero.
  - Deduct quantity from existing products.
      UI:
        - Inventory update form(product selection, quantity to deduct)
        - Save button
      Validation:
        - Ensure required fields are completed.
        - Quantity must be greater than zero.
        - Stock quantity cannot be negative after deduction.
  - Set low-stock alerts for products.
      UI:
        - Low stock alert settings form(product selection, low stock threshold)
        - Save button
      Validation:
        - Ensure required fields are completed.
        - Low stock threshold must be greater than zero.
  - Set reorder levels for products.
      UI:
        - Reorder level settings form(product selection, reorder level)
        - Save button
      Validation:
        - Ensure required fields are completed.
        - Reorder level must be greater than zero.

## Agent Management Pages

- Agent Management Page
  - List all agents and their details.
      UI:
        - Agent information table(name, email, phone number, commission rate, status)
        - Agent creation form(name, email, phone number, password, commission rate)
        - Agent update form(name, email, phone number, optional new password, commission rate)
        - Actions (create, view, edit, deactivate, activate)
        - Search bar (search in Name, Email, Phone Number)
        - Pagination controls
      Validation:
        - Ensure search queries are valid.
        - Ensure required fields are completed.
        - Validate phone number and email address.
        - Password must contain at least eight characters when creating an agent.
        - Commission rate must be between zero and 100 percent.
      Notes:
        - Agent removal is implemented as deactivation to preserve order and commission history.
        - Before deactivation, the system will check whether the agent has pending or approved orders. The system will require those records to be reassigned, rejected, cancelled, or completed first.
        - An inactive agent can be reactivated by an administrator, restoring login access and availability in assignment controls.

## Agent POV

- Dashboard Page
    - Total Orders
    - Pending Orders
    - Completed Orders
    - Monthly Sales
    - Total Commission
      UI:
      - Statistics Cards
      - Sales Summary Chart
      - Recent Orders Table
      - Customer Activity Panel

- Order Management Page
  - Add new customer orders.
      UI:
        - Dedicated New Order Page opened from the Agent Order Management Page
        - Order form(customer name, one or more product line items with quantity, delivery address, payment method)
        - Add Item button that opens a product-selection modal
        - Product-selection modal(search, product details, available quantity, quantity input, confirm and cancel actions)
        - Order item table with remove actions and calculated subtotals
        - Order summary showing item count and total amount
        - Save button
        - Reset button
      Validation:
        - Ensure required fields are completed.
        - At least one line item is required.
        - Each line-item quantity must be greater than zero.
        - Every selected product must exist and have sufficient available inventory.
        - The same product cannot appear more than once in an order.
      Notes:
        - The tracking number is automatically generated and unique for each order.
        - The system will automatically check the inventory for product availability before allowing the order to be placed.
  - Update and monitor order status.
      UI:
        - Order information table
        - Edit button
        - View Details button
      Validation:
        - Ensure required fields are completed.
        - Validate order status updates.
      Notes:
        - The system will automatically update the order status based on delivery progress and agent updates.
        - If an order is marked as "Approved", the system will reserve every line-item quantity in inventory until the order is completed or canceled.
  - Delete eligible customer orders.
      UI:
        - Order information table
        - Delete button
      Validation:
        - Ensure required fields are completed.
        - Validate order deletion.
      Notes:
        - The system will check whether the order is in a state that allows deletion (for example, not already delivered or completed).

- My Customer Management Page
  - View their registered customers and customer details.
      UI:
        - Customer information table(name, email, phone number, address, pending orders, completed orders)
        - Search bar (search in Name, Email, Phone Number)
        - Pagination controls
      Validation:
        - Ensure search queries are valid.
  - Register new customers.
      UI:
        - Customer registration form(name, email, phone number, address)
        - Save button
        - Reset button
      Validation:
        - Ensure required fields are completed.
        - Validate phone number and email address.
        - Prevent duplicate customer records.
  - Update customers assigned to the authenticated agent.
      UI:
        - Customer update form(name, email, phone number, address)
        - Edit and Save buttons
      Validation:
        - Agents may update only customers assigned to their account.
        - Validate required fields, phone number, and email address.

- My Commission Page
  - View their commission details.
      UI:
        - Commission information table(commission amount, order ID, customer name, date)
        - Total commission summary
        - Search bar (search by Order ID or Customer Name)
        - Filter options (Date Range)
        - Pagination controls
      Validation:
        - Ensure search queries are valid.
        - Validate filter criteria.

## Customer Page

- Tracking Page
  - Track delivery progress using tracking numbers.
      UI:
        - Delivery timeline (delivery stages, timestamps)
        - Tracking search bar
        - Delivery map (displaying available delivery location data)
      Validation:
        - Ensure tracking information is complete.
        - Validate delivery address.
