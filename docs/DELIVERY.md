# Delivery dashboard and foreground location

Delivery employees use the existing staff sign-in and land at `/delivery`. Admins create accounts at `/delivery-employees`, monitor `/dispatch`, and open an order to assign its employee or place a destination pin. Sales agent credit is independent of delivery responsibility. Sales agents can view delivery progress for their own orders but cannot change milestones. Verified customers can view their own location and proof in the portal. Public tracking retains its limited timeline.

Order details group employee assignment and milestone buttons under **Dispatch & delivery status**. Employees have a separate **Update delivery status** section; **Record delivery completion** opens the recipient/proof form. Destination pins stay mounted through polling, saves and status refreshes. Admins tap the map, drag the marker or use **Place destination pin** to preview a change, then explicitly **Save destination** or **Cancel pin changes**. Coordinates are available under an expandable control. A missing pin is shown as missing rather than inventing a location for the saved address.

## Workflow and invariants

Admins open **View proof of delivery** from completed dispatch cards or the completed order's action bar. Evidence appears above the map with recipient, completion time, employee and the authenticated photo. Expired photos, admin exceptions and older orders without recorded evidence have explicit messages.

Only approved, unfinished LIVE orders can be assigned to active delivery employees. Existing orders start unassigned. Imported records stay read-only. Accounts cannot be deactivated while unfinished assignments remain; reassign or remove those assignments first.

Employees may have a queue but can start only one job. Database unique keys protect the active employee, order, and attempt. Starting PREPARING advances to DISPATCHED; resuming later retains the stage. The next-stage controls lead through IN_TRANSIT and OUT_FOR_DELIVERY. Completion has a separate form. The shared command still permits skipping forward, rejects backwards changes, and treats repeated milestones as a no-op.

Pause closes the attempt and location session while retaining reserved stock. Reporting an issue requires an explanation, closes the attempt, preserves stage/stock, and notifies the admin and credited agent. An admin must record a resolution before another attempt starts. Assignment versions and attempt/session IDs fence old clients; a 409 requires a refreshed order. Reassignment and unassignment close attempts and clear positions.

Employee completion requires recipient name and a staged photo. Admins can upload proof or give a recipient name and exception explanation. The completion transaction consumes the attachment, records the actor and server time, deducts aggregated stock once, writes history/notices, closes location sharing, and evaluates financial completion. Commission belongs to the credited sales agent and is earned once after both whole-order delivery and full payment. Proof cannot be edited; existing completed orders receive no inferred proof.

## HTTP contract

All paths below have `/api/v1` as their prefix, use bearer authentication, and wrap JSON in `data`. Private reads send `Cache-Control: no-store`. Binary reads return `image/jpeg`. General `/orders` remains restricted to ADMIN/AGENT.

| Endpoint | Audience and request |
|---|---|
| `GET /delivery-employees` | Admin; account list |
| `POST /delivery-employees` | Admin; `{fullName,email,phone,password}`; 201 |
| `PUT /delivery-employees/:id` | Admin; `{fullName,email,phone,active}` |
| `POST /delivery-employees/:id/reset-password` | Admin; `{newPassword}`; revokes sessions |
| `GET /delivery/dispatch?page=1` | Admin; up to 100 orders with latest tracking |
| `PATCH /orders/:id/delivery-assignment` | Admin; `{employeeId: number|null,assignmentVersion}` |
| `PATCH /orders/:id/delivery-destination` | Admin; `{latitude: number|null,longitude: number|null,assignmentVersion}`; both coordinates or both null |
| `POST /orders/:id/delivery-issues/:issueId/resolve` | Admin; `{resolution}` |
| `GET /delivery/orders?page=1` | Delivery employee; up to 100 own assignments |
| `GET /delivery/orders/:id` | Admin, owning sales agent, assigned employee; fulfillment details |
| `POST /delivery/orders/:id/start` | Assigned employee; `{assignmentVersion}`; returns `{attemptId}`, repeated start reuses active attempt |
| `POST /delivery/orders/:id/pause` | Assigned employee; `{assignmentVersion,attemptId}` |
| `POST /delivery/orders/:id/issues` | Assigned employee; fence plus `{explanation}` |
| `PATCH /delivery/orders/:id/status` | Assigned employee; fence plus `{deliveryStatus,notes?,recipientName?,photoId?}` |
| `POST /delivery/orders/:id/tracking/start` | Assigned active employee; fence; returns `{sessionId}` |
| `POST /delivery/orders/:id/tracking/stop` | Assigned active employee; fence plus `{sessionId}` |
| `POST /delivery/orders/:id/positions` | Assigned active employee; fence plus `{sessionId,sequence,latitude,longitude,accuracy,observedAt}` |
| `GET /delivery/orders/:id/tracking` | Scoped staff; latest private tracking |
| `POST /delivery/orders/:id/proof-photo` | Admin/assigned active employee; multipart `photo`, `assignmentVersion`, employee `attemptId`; returns `{id}`, 201 |
| `GET /delivery/orders/:id/proof-photo` | Scoped staff; authenticated binary |
| `GET /customer/orders/:id/delivery` | Verified owning customer; fulfillment view |
| `GET /customer/orders/:id/delivery-tracking` | Verified owning customer; private tracking |
| `GET /customer/orders/:id/proof-photo` | Verified owning customer; authenticated binary |
| `POST /auth/logout` | Active staff; invalidates staff sessions, stops employee location |

The existing admin `PATCH /orders/:id/delivery-status` now takes `{assignmentVersion,deliveryStatus,notes?,recipientName?,photoId?,exceptionReason?}`. DELIVERED requires evidence; without a photo, `recipientName` and `exceptionReason` are required. Sales agent mutation returns 403. This is an intentional client contract change.

Mutation authorization is rechecked inside the order transaction. Private detail/tracking/photo reads hold a shared order lock through ownership verification and retrieval, preventing audience changes midway through reassignment. The fulfillment DTO omits prices, commission terms, payment controls and unrelated customer data. Invalid assignments/attempts/session versions conflict instead of overwriting new state. Invalid images return 400, size overflow 413, expired committed photos 410, and unavailable proof storage 503.

## Map and GPS behavior

Leaflet 1.9.4 is loaded on map screens. Configure tile URL, attribution, center and zoom in `frontend/src/environments/environment.ts`; the current provider is OpenStreetMap raster tiles. Keep attribution visible, normal browser caching enabled and `strict-origin-when-cross-origin` Referer behavior. Do not prefetch/download offline tiles. Admins may explicitly search Philippine places through Geoapify to preview destination coordinates. No autocomplete, road routing or ETA is included. Missing destination coordinates never block delivery; tile failure leaves address and status available.

The employee explicitly enables sharing. While the page is visible, the browser sequentially acquires a high-accuracy fix with `maximumAge: 0` and a 10-second timeout, uploads it, then waits approximately 10 seconds. Acquisition/upload never overlap. Actual intervals include acquisition and network latency. Viewers fetch immediately and poll every 10 seconds while visible. Fix time and accuracy appear beside the map; receipt time is retained. Older sequences or fix timestamps are ignored, and no history is replayed after reconnection.

| State | Meaning |
|---|---|
| LIVE | Position age at most 60 seconds |
| STALE | Over 60 seconds, up to 10 minutes; last known position |
| UNAVAILABLE | No usable fix, denied permission, or position older than 10 minutes; no coordinates |
| STOPPED | No active location session; no coordinates |

Age uses the older of acquisition and receipt times. GPS writes never update `delivery_changed_at` or create milestone events, so movement cannot conceal a stalled stage. Page hiding stops acquisition; returning acquires a new fix. Route exit/logout stop acquisition. Logout, password replacement, assignment changes, pause/issues and completion invalidate sharing; location sessions also expire with the initiating bearer token. The worker removes positions for expired/invalidated sessions. If logout occurs without connectivity, the server cannot receive immediate revocation; the position naturally becomes stale/unavailable and session expiry still applies.

Describe this as **live location while the delivery page is open**. Browser visibility, phone locking, GPS permission, signal, and network conditions constrain updates. A PWA installation does not establish dependable background tracking. Status and completion controls remain usable without GPS.

## Private photo storage and retention

Set an absolute `DELIVERY_PHOTO_DIR` for production to a durable private volume outside every static web root. API and worker must mount the same path and have read/write/delete access. The API never exposes that directory through a static route. The deployment default is one API host; additional hosts require shared durable storage. `DELIVERY_PHOTO_RETENTION_DAYS` defaults to 90; keep 90 for the agreed release.

Decoded JPEG/PNG/WebP input is limited to 10 MiB and 40 megapixels. The server normalizes orientation, resizes to a maximum 1,600-pixel long edge, and writes JPEG without original metadata. Generated names contain no supplied filename. Staging binds order, uploader and assignment version; completion checks metadata and file availability before committing. Failed requests do not display successful delivery. Unconsumed uploads and unknown files older than 24 hours are removed by the worker. Committed photos expire 90 days after completion; reads deny access immediately even if cleanup is delayed. Recipient, time and audit records remain, and the UI shows “Photo expired.”

Read photos through authenticated blob requests and revoke browser object URLs when views close; access tokens never appear in image URLs. Back up the database and private volume together during a coordinated quiescent window or equivalent consistent snapshot. Encrypt/access-control backups and rotate them after 30 days. Live access expires at 90 days; retained backups age out through that rotation. Following restoration, run cleanup before exposing the application so expired proof cannot be served. Monitor worker heartbeat, cleanup failures and free disk space. Keep API, MySQL and device clocks synchronized.

## Verification and field release gate

Automated evidence is in `backend/test/delivery.test.ts` and `frontend/scripts/check-delivery.cjs`. Backend tests use a disposable database and isolated photo directory. Browser fixtures exercise the actual Angular UI but simulate GPS/API responses; they do not prove physical location or mobile background behavior.

Before field release, test Android Chrome and iPhone Safari on a phone-accessible HTTPS origin with a valid trusted certificate. An HTTP laptop LAN address does not get the phone's localhost exception. Record device/browser versions, tester/date, permission choice, movement, stationary fixes, hidden page, locked phone, reconnect, expired session, provider outage, photo capture/retry, and measured acquisition-to-view latency. These real-phone checks and business acceptance are pending until performed on those devices.

Before building for that origin, set `environment.apiUrl` to its reachable HTTPS API URL (or `/api/v1` behind a same-origin reverse proxy). The development `http://localhost:3000` value addresses the phone itself and must not be used in the phone deployment. Configure matching `CORS_ORIGINS` and `PUBLIC_APP_URL`; allow geolocation for the top-level application origin and avoid mixed-content API requests.

For the defense: assign an approved order as admin; start it on the employee phone; enable sharing; show the owned customer and agent views with timestamps/accuracy; hide the employee page until viewers display STALE; return and acquire a fresh fix; record recipient/photo completion; demonstrate that coordinates clear and commission waits for full payment. Use controlled customers and staging orders.

References: [Leaflet downloads](https://leafletjs.com/download.html), [W3C Geolocation](https://www.w3.org/TR/geolocation/), [Chrome lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/EventSource), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/), [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/), [OWASP uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [MDN secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).

## Destination place search

Set GEOAPIFY_API_KEY in the backend environment and restart the API. Obtain a key from a Geoapify project; keep it server-side and restrict it to the API host where supported. The authenticated admin-only GET /api/v1/delivery/location-search?query=... accepts 3–200 characters, returns at most five Philippine places as label/latitude/longitude, and uses an eight-second provider timeout plus a 30-per-minute per-IP limit. Private responses are no-store. It sends only the deliberately entered search text to Geoapify, never a customer's name/contact details or employee GPS position automatically. No provider calls run while typing or polling.

Selecting a result centers the map and previews an unsaved destination. Admins can drag it, cancel, or Save destination through the existing audited assignment-version check. The order's text address remains unchanged. Search failure or a missing key leaves map/coordinate pinning available. Result attribution is visible. See [Geoapify's geocoding documentation](https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/).
