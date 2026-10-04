# TNL sales and customer relationships

TNL Track records sales offered by human field agents, customer communication, inventory, and package commissions.

## Language

**Delivery employee**: A staff member responsible for handing over assigned orders. Delivery responsibility is separate from the field agent credited for the sale.
_Avoid_: Sales agent, courier integration

**Delivery attempt**: One employee's active effort to hand over an order. Pausing or reporting an issue ends an attempt without undoing delivery milestones or releasing reserved stock.

**Live delivery location**: The latest reported employee position for the current delivery while location sharing is active. Its time and accuracy describe how current and precise it is.
_Avoid_: Continuous GPS, guaranteed real-time location

**Delivery proof**: The recorded recipient, employee, handover time, and photo, or an admin's explained exception. It establishes delivery completion separately from payment completion.

**Field agent**: A staff representative who offers catalog packages and handles assigned customers, requests, orders, and follow-ups.
_Avoid_: AI agent, employee management, payroll

**Package**: An admin-defined offer with component products and quantities, its own selling price, and fixed or percentage commission terms.
_Avoid_: Discount, interchangeable bundle

**Saved terms**: The package contents, identity, selling price, and commission captured when an order or customer request is entered. Later catalog changes apply to future selections.

**Customer request**: A verified customer's confirmed selections awaiting agent handling; it reserves no inventory. Conversion creates one pending order with the submitted terms.
_Avoid_: Approved order, stock reservation

**Approval**: The admin decision that fixes the credited agent and reserves all required component stock.

**Completed sale**: A whole order that is delivered and fully paid, whichever occurs last. The legacy order status COMPLETED still denotes delivery completion; sale_completed_at records financial completion for new sales.
_Avoid_: Delivery alone, paid order alone

**Earned commission**: One immutable posting for an eligible package order, with rounded per-package amounts. Standalone items earn no commission.
_Avoid_: Agent percentage on new sales, payout, payroll

**Available stock**: On-hand quantity minus reserved quantity. Package requirements and standalone quantities aggregate by product.

**Follow-up**: One open, tracked customer request for an agent update on an owned order; its reply is persisted in the portal and emailed.
_Avoid_: Live chat, general inbox

**Campaign run**: The single durable execution of a campaign, with independent recipient outcomes and consent rechecked before sending.

**SMTP accepted**: The mail server accepted a recipient's email. It does not confirm inbox delivery.

**Unknown outcome**: An email may have been accepted before a connection or worker failure. An admin must review it and acknowledge duplicate risk before retrying.
