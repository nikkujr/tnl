import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import type { SessionUser } from "../../shared/auth.js";
import { HttpError } from "../../shared/http.js";
import { deliveryTransition } from "../orders/queries.js";
import { readSale, requirements, completeSale } from "../orders/sales.js";
import { stockEpisode } from "../automations/stock.js";
import {
  event,
  notify,
  orderChanged,
  staffRecipients,
} from "../automations/events.js";
import { config } from "../../config.js";
import { stat } from "node:fs/promises";
import { photoPath } from "./storage.js";
export async function audit(
  c: PoolConnection,
  orderId: number,
  actor: number,
  type: string,
  message: string,
) {
  await c.execute(
    "INSERT INTO order_events(order_id,actor_id,type,message) VALUES(?,?,?,?)",
    [orderId, actor, type, message],
  );
  await event(c, type.toLowerCase(), "ORDER", orderId, { message }, actor);
}
export async function lockOrder(
  c: PoolConnection,
  id: number,
  user: SessionUser,
  version?: number,
) {
  if (user.expiresAt !== undefined && user.expiresAt <= Date.now())
    throw new HttpError(401, "Staff session expired. Sign in again.");
  const [rows] = await c.query<any[]>(
    "SELECT * FROM orders WHERE id=? FOR UPDATE",
    [id],
  );
  const o = rows[0];
  if (
    !o ||
    (user.role === "DELIVERY" && o.delivery_employee_id !== user.id) ||
    (user.role === "AGENT" && o.agent_id !== user.id)
  )
    throw new HttpError(404, "Delivery not found");
  if (o.origin !== "LIVE")
    throw new HttpError(409, "Imported delivery history is read-only");
  if (
    version !== undefined &&
    Number(o.delivery_assignment_version) !== version
  )
    throw new HttpError(
      409,
      "Delivery assignment changed. Refresh this order.",
    );
  // Recheck account state inside the business transaction, including password-reset races.
  const [accounts] = await c.query<any[]>(
    "SELECT id FROM users WHERE id=? AND role=? AND active=TRUE AND token_version=? LOCK IN SHARE MODE",
    [user.id, user.role, user.tokenVersion ?? 0],
  );
  if (!accounts.length)
    throw new HttpError(401, "Staff session expired. Sign in again.");
  if (user.expiresAt !== undefined && user.expiresAt <= Date.now())
    throw new HttpError(401, "Staff session expired. Sign in again.");
  return o;
}
export async function requireAttempt(
  c: PoolConnection,
  o: any,
  user: SessionUser,
  attemptId?: string,
) {
  const [rows] = await c.query<any[]>(
    "SELECT * FROM delivery_active_jobs WHERE order_id=? FOR UPDATE",
    [o.id],
  );
  if (
    !attemptId ||
    rows[0]?.attempt_id !== attemptId ||
    rows[0]?.employee_id !== user.id
  )
    throw new HttpError(
      409,
      "This delivery is not your active job. Refresh and start it.",
    );
  return rows[0];
}
export async function stopLocations(c: PoolConnection, orderId: number) {
  await c.execute(
    "DELETE p FROM delivery_latest_positions p JOIN delivery_location_sessions s ON s.id=p.session_id JOIN delivery_attempts a ON a.id=s.attempt_id WHERE a.order_id=?",
    [orderId],
  );
  await c.execute(
    "UPDATE delivery_location_sessions s JOIN delivery_attempts a ON a.id=s.attempt_id SET s.ended_at=UTC_TIMESTAMP() WHERE a.order_id=? AND s.ended_at IS NULL",
    [orderId],
  );
}
export async function endAttempt(
  c: PoolConnection,
  orderId: number,
  reason: string,
) {
  await stopLocations(c, orderId);
  await c.execute(
    "UPDATE delivery_attempts SET ended_at=UTC_TIMESTAMP(),end_reason=? WHERE order_id=? AND ended_at IS NULL",
    [reason, orderId],
  );
  await c.execute("DELETE FROM delivery_active_jobs WHERE order_id=?", [
    orderId,
  ]);
}
export async function stopEmployeeLocations(
  c: PoolConnection,
  employee: number,
) {
  const [orders] = await c.query<any[]>(
    "SELECT DISTINCT order_id FROM delivery_attempts WHERE employee_id=? AND ended_at IS NULL",
    [employee],
  );
  for (const o of orders) await stopLocations(c, o.order_id);
}
export async function expireLocationSessions(c: PoolConnection) {
  const invalid = `SELECT s.id FROM delivery_location_sessions s JOIN delivery_attempts a ON a.id=s.attempt_id JOIN users u ON u.id=a.employee_id WHERE s.ended_at IS NULL AND (s.expires_at IS NULL OR s.expires_at<=? OR s.token_version<>u.token_version OR u.active=FALSE) FOR UPDATE`;
  const [rows] = await c.query<any[]>(invalid, [new Date()]);
  for (const s of rows) {
    await c.execute(
      "DELETE FROM delivery_latest_positions WHERE session_id=?",
      [s.id],
    );
    await c.execute(
      "UPDATE delivery_location_sessions SET ended_at=UTC_TIMESTAMP() WHERE id=?",
      [s.id],
    );
  }
}
export async function advanceDelivery(
  c: PoolConnection,
  o: any,
  user: SessionUser,
  body: any,
) {
  if (user.role === "AGENT")
    throw new HttpError(403, "Sales agents can view delivery progress only");
  if (!["APPROVED", "COMPLETED"].includes(o.order_status))
    throw new HttpError(
      409,
      "Only approved orders can progress through delivery",
    );
  const transition = deliveryTransition(o.delivery_status, body.deliveryStatus);
  if (transition === "INVALID")
    throw new HttpError(409, "Delivery stages can only move forward");
  if (transition === "NOOP")
    return { id: o.id, deliveryStatus: o.delivery_status };
  if (user.role === "DELIVERY")
    await requireAttempt(c, o, user, body.attemptId);
  if (body.deliveryStatus === "DELIVERED") {
    if (!body.recipientName)
      throw new HttpError(400, "Recipient name is required");
    if (user.role === "DELIVERY" && body.exceptionReason)
      throw new HttpError(403, "Only an admin can record a proof exception");
    if (!body.photoId && !(user.role === "ADMIN" && body.exceptionReason))
      throw new HttpError(
        400,
        "Upload a proof photo before completing delivery",
      );
    if (body.photoId) {
      const [photos] = await c.query<any[]>(
        "SELECT * FROM delivery_photos WHERE id=? AND order_id=? FOR UPDATE",
        [body.photoId, o.id],
      );
      const p = photos[0];
      if (
        !p ||
        p.state !== "STAGED" ||
        p.uploader_id !== user.id ||
        p.assignment_version !== o.delivery_assignment_version ||
        new Date(p.expires_at).getTime() <= Date.now()
      )
        throw new HttpError(
          409,
          "Proof photo expired or belongs to another assignment. Upload again.",
        );
      try {
        const file = await stat(photoPath(p.storage_key));
        if (!file.isFile() || file.size !== Number(p.byte_size))
          throw new Error("Photo missing");
      } catch {
        throw new HttpError(
          503,
          "Proof storage is unavailable. Delivery was not completed; retry after storage is restored.",
        );
      }
      await c.execute(
        "UPDATE delivery_photos SET state='COMMITTED',expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? DAY) WHERE id=?",
        [config.DELIVERY_PHOTO_RETENTION_DAYS, p.id],
      );
    }
    await c.execute(
      "INSERT INTO delivery_completions(order_id,recipient_name,actor_id,photo_id,exception_reason) VALUES(?,?,?,?,?)",
      [
        o.id,
        body.recipientName,
        user.id,
        body.photoId ?? null,
        body.photoId ? null : body.exceptionReason,
      ],
    );
    for (const i of requirements(await readSale(c, o.id))) {
      const [p] = await c.query<any[]>(
        "SELECT stock_on_hand,stock_reserved FROM products WHERE id=? FOR UPDATE",
        [i.productId],
      );
      if (
        !p[0] ||
        p[0].stock_reserved < i.quantity ||
        p[0].stock_on_hand < i.quantity
      )
        throw new HttpError(
          409,
          "Reserved stock is inconsistent; contact admin",
        );
      await c.execute(
        "UPDATE products SET stock_on_hand=stock_on_hand-?,stock_reserved=stock_reserved-? WHERE id=?",
        [i.quantity, i.quantity, i.productId],
      );
      await c.execute(
        "INSERT INTO inventory_movements(product_id,actor_id,type,quantity,order_id) VALUES(?,?,'DEDUCT',?,?)",
        [i.productId, user.id, i.quantity, o.id],
      );
      await stockEpisode(c, i.productId, user.id);
    }
    await endAttempt(c, o.id, "DELIVERED");
  }
  await c.execute(
    "UPDATE orders SET delivery_status=?,order_status=IF(?='DELIVERED','COMPLETED',order_status),delivery_changed_at=UTC_TIMESTAMP() WHERE id=?",
    [body.deliveryStatus, body.deliveryStatus, o.id],
  );
  await c.execute(
    "INSERT INTO delivery_events(order_id,status,notes,latitude,longitude) VALUES(?,?,?,?,?)",
    [
      o.id,
      body.deliveryStatus,
      body.notes ?? null,
      body.latitude ?? null,
      body.longitude ?? null,
    ],
  );
  await audit(
    c,
    o.id,
    user.id,
    "DELIVERY_UPDATED",
    `Delivery advanced to ${body.deliveryStatus}.`,
  );
  if (body.exceptionReason && !body.photoId)
    await audit(
      c,
      o.id,
      user.id,
      "DELIVERY_PROOF_EXCEPTION",
      body.exceptionReason,
    );
  await orderChanged(
    c,
    o.id,
    "order.delivery_changed",
    body.deliveryStatus,
    user.id,
  );
  await completeSale(c, o.id, user.id);
  return { id: o.id, deliveryStatus: body.deliveryStatus };
}
export async function assign(
  c: PoolConnection,
  o: any,
  employee: number | null,
  actor: number,
) {
  if (o.order_status !== "APPROVED" || o.delivery_status === "DELIVERED")
    throw new HttpError(
      409,
      "Only approved unfinished deliveries can be assigned",
    );
  if (employee !== null) {
    const [rows] = await c.query<any[]>(
      "SELECT id FROM users WHERE id=? AND role='DELIVERY' AND active=TRUE LOCK IN SHARE MODE",
      [employee],
    );
    if (!rows.length)
      throw new HttpError(409, "Choose an active delivery employee");
  }
  if (o.delivery_employee_id === employee) return;
  await endAttempt(c, o.id, "REASSIGNED");
  await c.execute(
    "UPDATE orders SET delivery_employee_id=?,delivery_assignment_version=delivery_assignment_version+1 WHERE id=?",
    [employee, o.id],
  );
  await audit(
    c,
    o.id,
    actor,
    "DELIVERY_ASSIGNED",
    `Delivery employee changed from ${o.delivery_employee_id ?? "unassigned"} to ${employee ?? "unassigned"}.`,
  );
  if (employee)
    await notify(
      c,
      [employee],
      randomUUID(),
      "DELIVERY_ASSIGNED",
      "Delivery assigned",
      o.tracking_number,
      `/delivery/${o.id}`,
    );
  await notify(
    c,
    await staffRecipients(c, o.agent_id),
    randomUUID(),
    "DELIVERY_ASSIGNED",
    "Dispatch updated",
    o.tracking_number,
    `/orders/${o.id}`,
  );
}
