import { db } from "../../database/connection.js";
import type { SessionUser } from "../../shared/auth.js";
import { HttpError } from "../../shared/http.js";
import { positionState } from "./model.js";
import type { PoolConnection } from "mysql2/promise";
import { transaction, jsonValue } from "../../shared/transaction.js";
import type { Component } from "../orders/sales.js";
type Viewer = SessionUser | { role: "CUSTOMER"; customerId: number };
type Reader = typeof db | PoolConnection;
export async function privateRead<T>(
  id: number,
  user: Viewer,
  read: (order: any, c: PoolConnection) => Promise<T>,
) {
  return transaction(async (c) => {
    // Hold the authorization row through the read so reassignment cannot change its audience midway.
    const o = await scopedOrder(id, user, c, true);
    return read(o, c);
  });
}
export async function scopedOrder(
  id: number,
  user: Viewer,
  c: Reader = db,
  lock = false,
) {
  const [rows] = await c.query<any[]>(
    "SELECT * FROM orders WHERE id=?" + (lock ? " LOCK IN SHARE MODE" : ""),
    [id],
  );
  const o = rows[0];
  if (
    !o ||
    (user.role === "AGENT" && o.agent_id !== user.id) ||
    (user.role === "DELIVERY" && o.delivery_employee_id !== user.id) ||
    (user.role === "CUSTOMER" && o.customer_id !== user.customerId)
  )
    throw new HttpError(404, "Delivery not found");
  return o;
}
export async function tracking(id: number, c: Reader = db) {
  // One statement gives a consistent assignment/session/position view during reassignment.
  const [rows] = await c.query<any[]>(
    `SELECT o.destination_latitude latitude,o.destination_longitude longitude,
 o.delivery_status deliveryStatus,o.estimated_delivery_at estimatedDeliveryAt,u.full_name employeeName,a.id attemptId,s.id sessionId,
 p.latitude positionLatitude,p.longitude positionLongitude,p.accuracy,p.observed_at observedAt,p.received_at receivedAt
 FROM orders o LEFT JOIN users u ON u.id=o.delivery_employee_id
 LEFT JOIN delivery_active_jobs j ON j.order_id=o.id LEFT JOIN delivery_attempts a ON a.id=j.attempt_id
 LEFT JOIN delivery_location_sessions s ON s.attempt_id=a.id AND s.ended_at IS NULL AND s.expires_at>? AND s.token_version=u.token_version AND u.active=TRUE
 LEFT JOIN delivery_latest_positions p ON p.session_id=s.id WHERE o.id=?`,
    [new Date(), id],
  );
  const r = rows[0],
    now = Date.now();
  const state = !r?.sessionId
    ? "STOPPED"
    : !r.observedAt
      ? "UNAVAILABLE"
      : positionState(r.observedAt, r.receivedAt, now);
  return {
    state,
    serverTime: new Date(now).toISOString(),
    deliveryStatus: r?.deliveryStatus ?? null,
    estimatedDeliveryAt: r?.estimatedDeliveryAt ?? null,
    employeeName: r?.employeeName ?? null,
    destination:
      r?.latitude != null
        ? { latitude: r.latitude, longitude: r.longitude }
        : null,
    position: ["LIVE", "STALE"].includes(state)
      ? {
          latitude: r.positionLatitude,
          longitude: r.positionLongitude,
          accuracy: r.accuracy,
          observedAt: r.observedAt,
          receivedAt: r.receivedAt,
        }
      : null,
  };
}
export async function orderList(user: SessionUser, page = 1) {
  const [rows] = await db.query<any[]>(
    `SELECT o.id,o.tracking_number trackingNumber,o.delivery_address address,
 o.delivery_status deliveryStatus,o.estimated_delivery_at estimatedDeliveryAt,o.order_status orderStatus,o.delivery_employee_id employeeId,
 o.delivery_assignment_version assignmentVersion,o.destination_latitude latitude,o.destination_longitude longitude,
 c.full_name recipientName,c.phone recipientPhone,u.full_name employeeName,j.attempt_id attemptId,
 (SELECT COUNT(*) FROM delivery_issues i WHERE i.order_id=o.id AND i.resolved_at IS NULL) issueCount
 FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.delivery_employee_id
 LEFT JOIN delivery_active_jobs j ON j.order_id=o.id
 WHERE o.origin='LIVE' AND o.order_status IN ('APPROVED','COMPLETED') ${user.role === "DELIVERY" ? "AND o.delivery_employee_id=?" : ""}
 ORDER BY (j.attempt_id IS NOT NULL) DESC,(o.delivery_status='DELIVERED'),o.approved_at DESC,o.id DESC LIMIT 100 OFFSET ?`,
    user.role === "DELIVERY" ? [user.id, (page - 1) * 100] : [(page - 1) * 100],
  );
  return rows;
}
export async function orderDetail(o: any, user: Viewer, c: Reader = db) {
  const [rows] = await c.query<any[]>(
    `SELECT o.id,o.tracking_number trackingNumber,o.delivery_address address,o.delivery_status deliveryStatus,o.estimated_delivery_at estimatedDeliveryAt,
 o.delivery_assignment_version assignmentVersion,o.delivery_employee_id employeeId,c.full_name recipientName,c.phone recipientPhone,
 u.full_name employeeName,j.attempt_id attemptId FROM orders o JOIN customers c ON c.id=o.customer_id
 LEFT JOIN users u ON u.id=o.delivery_employee_id LEFT JOIN delivery_active_jobs j ON j.order_id=o.id WHERE o.id=?`,
    [o.id],
  );
  const [items] = await c.query(
    "SELECT product_name name,quantity FROM order_items WHERE order_id=?",
    [o.id],
  );
  const [packages] = await c.query<any[]>(
    "SELECT name,quantity,components FROM order_packages WHERE order_id=?",
    [o.id],
  );
  const [history] = await c.query(
    "SELECT status,occurred_at occurredAt FROM delivery_events WHERE order_id=? ORDER BY occurred_at,id",
    [o.id],
  );
  const [issues] =
    user.role === "CUSTOMER"
      ? [[]]
      : await c.query(
          "SELECT id,explanation,created_at createdAt,resolution,resolved_at resolvedAt FROM delivery_issues WHERE order_id=? ORDER BY id DESC",
          [o.id],
        );
  const [proof] = await c.query<any[]>(
    `SELECT d.recipient_name recipientName,d.completed_at completedAt,u.full_name employeeName,d.exception_reason exceptionReason,
 CASE WHEN d.photo_id IS NULL THEN 'EXCEPTION' WHEN p.state='PURGED' OR p.expires_at<=UTC_TIMESTAMP() THEN 'EXPIRED' ELSE 'AVAILABLE' END photoState
 FROM delivery_completions d JOIN users u ON u.id=d.actor_id LEFT JOIN delivery_photos p ON p.id=d.photo_id WHERE d.order_id=?`,
    [o.id],
  );
  if (proof[0] && user.role !== "ADMIN") delete proof[0].exceptionReason;
  const detail = {
    ...rows[0],
    items,
    packages: packages.map((p) => ({ ...p, components: jsonValue<Component[]>(p.components) })),
    history,
    issues,
    completion: proof[0] ?? null,
    tracking: await tracking(o.id, c),
  };
  if (user.role === "CUSTOMER") {
    delete detail.recipientPhone;
    delete detail.employeeId;
    delete detail.assignmentVersion;
    delete detail.attemptId;
  }
  return detail;
}
