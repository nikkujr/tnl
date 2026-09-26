# Historical Sales Import — Plan

Source file analyzed: `TNL-SALES-REPORT-2026.xlsx` (271 sheets, one per calendar day, e.g. `JAN 01`).

## Source file structure

Each day-sheet stacks several independent sub-tables vertically, each with its own header row:

1. **STORE SALES** — No., Customer, Unit (product name, e.g. "SMART 10 4+128GB/BLACK"), IMEI/SN No., Freebies, OR No., Cash, GCash
2. **HOME CREDIT** — No., Customer, Unit, IMEI/SN No., Freebies, OR No., DP (down payment), Unit Price (full price)
3. **C.I/AGENT** — like Home Credit, plus an Agent column
4. **C.I PAYMENT** — No., Customer, Agent, Unit, Status (e.g. "1ST,2ND PAYMENT"), OR No., Cash, GCash — these are follow-up installment payments on a sale that started on an earlier day, not new sales
5. **EXPENSES** — outflows (e.g. "SHOWER COINS"), not a sale — excluded entirely
6. A daily summary block (totals, cash remit, remarks) — not imported, informational only

Cell A1 of each sheet holds an Excel date serial for that day — used to derive the exact date instead of parsing the sheet name text.

None of this maps directly onto `orders`/`order_items`: customers have no email/phone/address (schema requires all three), `orders.agent_id` is `NOT NULL` and must reference a real `users` row (most rows say "STORE" or are blank), products are free-text needing fuzzy matching, and IMEI/freebies/OR No. have no home in the schema.

## Decisions made with the user

- **Sections imported as orders**: STORE SALES, HOME CREDIT, C.I/AGENT, and C.I PAYMENT. EXPENSES is always excluded.
- **C.I PAYMENT rows**: imported as their own independent orders (not linked back to the original financed sale). Accepted tradeoff: this double-counts unit/revenue totals for financed sales, since there's no reliable link between a payment row and its originating sale.
- **Financed sales (HOME CREDIT, C.I/AGENT)**: order total = Unit Price (full price); `payment_status = PARTIALLY_PAID`; `cash_received` = DP.
- **STORE SALES and C.I PAYMENT**: order total = Cash + GCash; `payment_status = PAID`.
- **Agent mapping**: default to a single system "Historical Import" user when the sheet says "STORE" or is blank; reviewer can override per row to a real agent during the review step.
- **Customer mapping**: auto-create new customers with placeholder email/phone/address when no name match is found (no forced manual entry per row).
- **Order lifecycle**: imported rows are inserted directly as `order_status='COMPLETED'`, `delivery_status='DELIVERED'`, with `created_at` back-dated to the sheet's date — they don't go through the live pending → approve → deliver workflow.
- **Inventory**: not adjusted. These units are long gone; deducting stock now would incorrectly shrink current real inventory.
- **Commissions**: not generated for imported orders, to avoid double-payment confusion with commissions already tracked historically outside the system.
- **IMEI / Freebies**: kept, written as a note on the created order (an `order_events` entry), not discarded.

## Schema changes

- **`import_batches`**: `id, file_name, uploaded_by (→users), status ENUM('PROCESSING','NEEDS_REVIEW','CONFIRMED','CANCELLED','FAILED'), total_rows, ready_rows, error_rows, created_at, confirmed_at`.
- **`import_rows`** (staging, one row per spreadsheet line): `id, batch_id, sheet_name, section ENUM('STORE_SALES','HOME_CREDIT','CI_AGENT','CI_PAYMENT'), row_number, order_date, raw_customer_name, raw_product_name, raw_agent_name, raw_imei, raw_freebies, raw_or_no, quantity, unit_price, cash_received, payment_status, matched_customer_id, new_customer_name, matched_product_id, new_product_name, matched_agent_id, status ENUM('READY','NEEDS_ATTENTION','SKIPPED'), issue, created_order_id`.
- **`orders`**: add `origin ENUM('LIVE','IMPORTED') NOT NULL DEFAULT 'LIVE'` and `import_batch_id BIGINT UNSIGNED NULL` (FK to `import_batches`) for auditability and to allow a back-dated `created_at`.
- **Seed data**: an `Uncategorized` category (create if missing), and one system user (e.g. "Store (Historical Import)") used as the default agent fallback.

## Backend (`backend/src/features/imports/route.ts`, admin-only)

New dependencies: `multer` (file upload) + `exceljs` (xlsx parsing).

- **`POST /imports/sales-report`** — upload `.xlsx`. Parses every day-sheet: reads the date from cell A1, walks column A for the 4 known section headers (tolerant of stray spaces/slashes, e.g. "C.I PAYMENT ", "C.I/ AGENT"), then the header row, then data rows until a "TOTAL" row. For each row, resolves:
  - **Product** — normalize + exact match on `products.name`, else fuzzy match, else flag as a new product (name = raw text, category = Uncategorized, price = the row's unit price, SKU auto-generated).
  - **Customer** — normalize + exact match on `customers.full_name`, else flag as new with placeholder contact info.
  - **Agent** — match raw name to `users.full_name`; "STORE"/blank → default system user.
  - **Amount/status** — per the rules above.
  - Rows with no usable price get `NEEDS_ATTENTION` instead of being silently dropped or defaulted.
  - Persists rows into `import_batches`/`import_rows`, returns `batchId` + summary counts.
- **`GET /imports/:batchId/rows`** — paginated/filterable (section, needs-attention, date range) for the review grid.
- **`PATCH /imports/:batchId/rows/:rowId`** — edit any field (reassign product/customer/agent, fix amount/date, toggle skip).
- **`POST /imports/:batchId/confirm`** — transaction: create flagged new customers/products, then insert `orders` + `order_items` (+ an `order_events` IMEI/freebies note) per non-skipped row with `origin='IMPORTED'` and back-dated `created_at`. No inventory movement, no commission row. Marks batch `CONFIRMED`.
- **`DELETE /imports/:batchId`** — discard a batch before confirming.

## Frontend

- New admin-only route `/imports` (upload) → `/imports/:batchId` (review).
- **Upload page**: `.xlsx` file picker, submits, shows parse summary (rows found per section, auto-matched vs. needs-attention counts), links to review.
- **Review page**: paginated table filterable to "needs attention only"; each row inline-editable (product/customer/agent dropdowns with "create new" fallback, amount, date, include/skip checkbox); summary bar (orders to be created, new products, new customers); **Confirm Import** button disabled until zero `NEEDS_ATTENTION` rows remain among included rows.
- Imported orders appear in the normal Orders list/detail with a small "Imported" badge (via `origin`) — no separate imported-orders view.

## Explicitly out of scope for v1

- No stock adjustment, no commission generation for imported orders.
- No attempt to link `CI_PAYMENT` rows back to their originating `HOME_CREDIT`/`CI_AGENT` sale.
- Section header parsing is pattern-matched, not hardcoded to exact strings; an unrecognized sheet layout flags its rows `NEEDS_ATTENTION` with a reason rather than crashing the whole import.
