import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { jsonValue } from "../../shared/transaction.js";
export type Connection = Pick<PoolConnection, "query" | "execute">;
export async function notify(
  c: Connection,
  users: number[],
  key: string,
  type: string,
  title: string,
  message: string,
  link: string,
) {
  for (const user of new Set(users))
    await c.execute(
      "INSERT IGNORE INTO staff_notifications(user_id,dedupe_key,type,title,message,link) VALUES(?,?,?,?,?,?)",
      [user, key, type, title, message, link],
    );
}
export async function staffRecipients(
  c: Connection,
  agent?: number | null,
): Promise<number[]> {
  const [rows] = await c.query<any[]>(
    "SELECT id FROM users WHERE active=TRUE AND (role='ADMIN' OR id=?)",
    [agent ?? 0],
  );
  return rows.map((r) => Number(r.id));
}
export async function enqueue(
  c: Connection,
  workflow: string,
  key: string,
  payload: object,
  due = new Date(),
  eventId: string | null = null,
  mandatory = false,
) {
  const [settings] = await c.query<any[]>(
    "SELECT enabled,config FROM automation_settings WHERE workflow=?",
    [workflow],
  );
  if (!mandatory && !settings[0]?.enabled) return;
  const config = settings[0]
    ? jsonValue<Record<string, unknown>>(settings[0].config)
    : {};
  await c.execute(
    "INSERT IGNORE INTO automation_runs(event_id,workflow,dedupe_key,payload,available_at) VALUES(?,?,?,?,?)",
    [eventId, workflow, key, JSON.stringify({ ...payload, config }), due],
  );
}
export async function event(
  c: Connection,
  type: string,
  aggregateType: string,
  aggregateId: number,
  payload: object,
  actorId: number | null = null,
) {
  const id = randomUUID();
  await c.execute(
    "INSERT INTO domain_events(id,type,aggregate_type,aggregate_id,actor_id,payload) VALUES(?,?,?,?,?,?)",
    [id, type, aggregateType, aggregateId, actorId, JSON.stringify(payload)],
  );
  return id;
}
export async function orderChanged(
  c: Connection,
  orderId: number,
  type: string,
  status: string,
  actorId: number,
) {
  const [rows] = await c.query<any[]>(
    "SELECT o.*,c.full_name customer_name FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?",
    [orderId],
  );
  const order = rows[0];
  const id = await event(
    c,
    type,
    "ORDER",
    orderId,
    { status, trackingNumber: order.tracking_number },
    actorId,
  );
  if (type === "order.created" || type === "order.assigned")
    await notify(
      c,
      await staffRecipients(c, order.agent_id),
      id,
      type,
      "Order assigned",
      `${order.tracking_number} · ${order.customer_name}`,
      `/orders/${orderId}`,
    );
  else if (order.sales_version === "PACKAGE" && order.origin === "LIVE")
    await enqueue(
      c,
      "ORDER_UPDATES",
      id,
      {
        kind: "EMAIL",
        customerId: order.customer_id,
        orderId,
        vars: {
          trackingNumber: order.tracking_number,
          status,
          customerName: order.customer_name,
        },
      },
      new Date(),
      id,
    );
}
export async function welcome(c: Connection, customerId: number) {
  const [rows] = await c.query<any[]>(
    "SELECT full_name,marketing_opt_in FROM customers WHERE id=?",
    [customerId],
  );
  const id = await event(c, "customer.created", "CUSTOMER", customerId, {});
  if (rows[0]?.marketing_opt_in)
    await enqueue(
      c,
      "WELCOME",
      `welcome:${customerId}`,
      {
        kind: "EMAIL",
        customerId,
        marketing: true,
        vars: { customerName: rows[0].full_name },
      },
      new Date(),
      id,
    );
}
