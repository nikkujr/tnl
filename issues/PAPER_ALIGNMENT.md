# Paper alignment record

The updated paper preserves Chapter I's CRM, order/delivery/inventory, and field-agent performance baseline and adds the agreed verified customer portal and guided conversations. It defines captured package terms, commission after whole delivery and full payment, customer ownership, consent, request conversion, and durable automation.

Chapter III now describes Angular/TypeScript, Express/Node.js, MySQL 8, SMTP, and a separate MySQL-backed worker. Employee/payroll management, POS, payment gateways, PHP, and PostgreSQL are excluded from the implemented architecture. Five diagrams were replaced: conceptual flow, architecture, context, process flow, and relational model. Software requirements and hardware guidance were corrected; client specifications do not establish measured server capacity.

Chapter II's introductory scope sentence was aligned with CRM, tracking, automation, and field-agent commissions. Literature summaries and bibliography were retained as supplied; citation accuracy, the original cover date, and the original historical Gantt schedule have not been independently validated or replaced with invented dates/results. This revision is implementation alignment, not a completed academic literature audit or business acceptance sign-off.

Verification on 2026-10-02: exported through hidden Microsoft Word to PDF, rasterized with the bundled document renderer, and inspected at original image resolution. The paper contains 46 rendered pages, including two landscape figures. Captions, tables, five replacement diagrams, and chapter transitions were checked; blank spacer pages and diagram overflow were corrected. Rendering previews remain under the ignored `.tmp/paper-final-qa/` directory. The supplied original is retained under `.tmp/paper-original.docx` in this workspace.

The authoritative business specification is [issues/README.md](README.md), with [API contracts](../docs/API.md), [deployment](../docs/DEPLOYMENT.md), and the [acceptance record](../docs/MANUAL_ACCEPTANCE.md).

## Delivery revision on 2026-10-03

Chapter I now includes delivery employees, independent dispatch assignment, one active job, private owned-order maps, recipient/photo proof, issue resolution, and read-only agent delivery milestones. Chapter III describes Leaflet 1.9.4, sequential foreground GPS acquisition and private REST polling, assignment/session fences, durable private photo storage, image normalization, 24-hour staged cleanup, 90-day live photo expiry, and coordinated backups with a 30-day rotation.

The five implementation diagrams were updated to include delivery dispatch, attempts, location sessions, completion evidence, and the Delivery role. Primary technical references were added for Leaflet, browser geolocation/lifecycle, secure contexts, OpenStreetMap tile policy, and upload handling. Existing literature, cover date, and historical Gantt schedule remain as previously supplied.

The saved manuscript was exported through hidden Microsoft Word, rasterized with the bundled document renderer, and all 50 pages inspected at original resolution. Diagram widths, captions, tables and chapter transitions were checked. Verification files remain in ignored `.tmp/paper-delivery-release-qa/`; the prior manuscript is retained as `.tmp/paper-before-delivery.docx`.

The manuscript explicitly describes live location while the delivery page is visible. Android Chrome and iPhone Safari field verification over trusted, phone-accessible HTTPS and measured update latency remain pending; automated browser fixtures are not represented as physical-device results. See [delivery release and defense guide](../docs/DELIVERY.md) and acceptance scenarios DEL-01 through DEL-09.
