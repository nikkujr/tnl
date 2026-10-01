# API and worker deployment

Require MySQL 8 with InnoDB and Node compatible with Angular 22. Take a database backup, then run `npm run db:migrate` once from backend before starting updated processes. The migration is repeatable, preserves existing posted commissions, labels existing orders LEGACY, and defaults customer marketing consent and workflow enablement to false. It does not infer packages, backfill commissions, or enqueue historical emails.

Build backend with `npm run build` and frontend with `npm run build`. Serve frontend's browser output with a fallback to index.html for portal links. Run `npm start` for the API and `npm run worker:start` as a separate supervised process. Keep source SQL files available for the migration command. Configure both processes with the same DB and SMTP values; storage and database sessions use UTC. Campaign controls interpret dates and send times in Asia/Manila.

Set `PUBLIC_APP_URL` to the external HTTPS portal origin, `CORS_ORIGINS` to frontend origins, and a long random `JWT_SECRET`. Customer verification and recovery require working SMTP. Existing staff seed credentials are for development only. Use the API/worker application's restricted database identity in production; disposable integration schema privileges belong to a separate test identity.

## Rollout

1. Review the admin Automations legacy queue. Retain historical commissions and resolve discrepancies outside this release; no automatic backfill occurs.
2. Define packages and stock thresholds; verify component stock and commission rules with business owners.
3. Validate activation/recovery links and transactional order emails using controlled recipients.
4. Start the worker. Confirm a recent heartbeat, then inspect backlog, FAILED, and UNKNOWN outcomes in Automations.
5. Enable supported workflows individually. Review reminder delays and templates, then enable scheduled campaigns and consent-based marketing when ready.
6. Complete the manual acceptance matrix, including phone-width screens, account recovery, recipient preview, and agent reply visibility.

## Operations

`GET /health` measures API availability. Admin `GET /api/v1/automations` exposes worker heartbeats and backlog by state; the admin UI treats a heartbeat older than three minutes as stale. Monitor PENDING counts, the oldest pending available_at, and FAILED/UNKNOWN counts. Alert the operator when no recent worker heartbeat exists or failures accumulate. The scheduler checks once a minute; worker polling defaults to five seconds (`WORKER_POLL_MS`, minimum one second).

Claims use row locks with SKIP LOCKED, a 120-second persisted lease, and an owner fence. SMTP operations use bounded connection/socket timeouts. Expired claims without a send start return to PENDING; started sends become UNKNOWN. Known SMTP 4xx and pre-send connection failures retry after 1, 5, 15, and 60 minutes, with at most five attempts. Permanent failures stop. UNKNOWN must be reviewed before an explicit duplicate-risk acknowledgment allows retry. ACCEPTED records SMTP acceptance only, never confirmed inbox delivery.

Disable a workflow to skip its remaining configured actions. Account emails, follow-up replies, and explicitly queued campaign runs are mandatory actions; already queued campaigns continue independently of the scheduled-campaign switch, with current consent checked for each recipient. Campaign content/audience and order request terms are immutable after queuing/conversion. Template/delay edits affect future queued actions; queued actions retain their captured configuration.

If stopping the worker, allow its current action to finish. Abrupt restart follows persisted lease recovery. Preserve automation history during restore and avoid restoring an old outbox independently of business state. Restoring a database backup containing already accepted actions requires operator reconciliation before enabling sends.
