# Business reports

Admins can open **Reports → Daily reports / Monthly reports / Overall reports**. Daily and monthly pages accept a calendar date or month; overall covers all recorded sales. Filters are reflected in the URL and survive reloads. Reports are admin-only on both frontend and API; agents retain their existing sales, customer, and commission workflows.

Navigation groups are Workspace, Sales, Catalog & stock, Relationships, Reports, and Administration. Performance is now under Reports; sales imports are under Administration. The sidebar scrolls independently and all items remain available in the mobile drawer.

## Print and CSV

Choose **Print / Save PDF** to open the [browser print dialog](https://developer.mozilla.org/en-US/docs/Web/API/Window/print). The A4 portrait layout hides navigation, filters and controls, uses a light background, expands the detailed trend table, repeats table headers and permits long tables to span pages. Canceling or finishing restores previously collapsed details. Select Save as PDF in the browser's printer options where available.

**Export CSV** downloads the loaded report without another API request, using its applied period rather than an unapplied date input. One UTF-8 file includes summary, filled trend rows, product rankings, customers, packages, order/payment statuses and current stock. The `section` column distinguishes datasets; each row carries period/selection, timezone, PHP currency and the report load timestamp. Monetary values are numeric PHP amounts without display separators; current stock remains current, even for historical periods. Empty periods retain zero summary and trend rows where applicable. Files are named `tnl-daily-YYYY-MM-DD.csv`, `tnl-monthly-YYYY-MM.csv` or `tnl-overall.csv`.

CSV fields are quoted, embedded quotes doubled and line endings CRLF, with a UTF-8 BOM for spreadsheet character detection. Formula-looking text receives a leading tab inside its quoted field, following [OWASP's spreadsheet guidance](https://github.com/OWASP/www-community/blob/master/pages/attacks/CSV_Injection.md); that tab remains data for programmatic consumers. Numerical cells retain their values. Printing/export stay on the existing admin-only pages and use the existing authorized response; no new API, dependency or server-generated PDF is required.

## Definitions

- **Completed sales:** non-cancelled, non-rejected orders that are fully paid and delivered (including the legacy delivery-complete `COMPLETED` status). Revenue sums saved standalone prices and saved package selling prices without valuing package components a second time. Average sale value divides that revenue by completed orders; buying customers counts distinct customers.
- **Reporting date:** financial completion (`sale_completed_at`) where recorded; otherwise the historical order date (`created_at`). The report displays how many sales use that fallback. This differs from Performance targets, which deliberately exclude historical/imported sales without qualifying live completion data.
- **Business calendar:** Asia/Manila, UTC+8. Daily/monthly ranges include their start and exclude their end. Daily trends group by hour, monthly trends by day, and overall trends by month. Hours/days without sales show zero; exact trend values are available in an expandable table.
- **Fast-selling products:** up to ten products with completed-sale quantities, descending by units sold, breaking ties by product ID. Inactive products with sales remain included.
- **Slow-moving products:** up to ten currently active products with stock on hand, ascending by units sold in the selected period, including zero sales. Ties prioritize more on-hand stock, then product ID. This is a period sales ranking, not an inventory aging or annualized turnover measure.
- **Product units:** standalone quantities plus each saved package component quantity multiplied by the purchased package quantity. The current package catalog does not change historical movement. Last sale dates refer to the selected reporting period.
- **Customers / packages:** top ten by completed-sale revenue. Package values use saved selling prices; package identity is stable across name changes.
- **Order/payment status:** current statuses for orders created in the selected period. Payment breakdowns exclude cancelled/rejected orders. Values are full order totals, not cash collected or remaining balances; they do not share the completed-sale date filter.
- **Stock health:** current active product quantities, available stock (on hand minus reserved), and products at or below their configured low-stock threshold. These are current figures for every report period, not historical stock snapshots.

All sections are read from one repeatable-read database snapshot. Reports require the existing schema migration but introduce no new tables or postings.

## Verification

Run backend tests with `TNL_INTEGRATION=1` for disposable MySQL checks. `test/reports.test.ts` verifies saved package quantities, overlapping standalone components, historical dates, timezone boundaries, excluded states, zero-sale rankings, limits/ties, current stock, empty periods, and access controls. All integration fixtures use isolated `tnl_test_<random>` schemas.

Run `frontend/scripts/check-reports.cjs` against `ng serve` with Playwright available through `NODE_PATH`. Fixtures cover desktop, tablet, narrow phones, filters and deep links, leap-year zero days, chart/table rows, mobile navigation, dark theme, empty periods, failure/retry, late responses, agent guards, CSV escaping/formula prefixes/downloads and print/table restoration. Set `LAYOUT_SCREENSHOT_DIR` to retain screenshots and a sample print PDF. `check-sidebar-layout.cjs` checks sidebar scrolling, header account controls, and sign-out.
