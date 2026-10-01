import type { PoolConnection } from "mysql2/promise";
/** Payment reversal before an earned sale starts a fresh unpaid reminder episode. */
export async function paymentEpisode(c: PoolConnection, orderId: number) {
  const [orders] = await c.query<any[]>(
    "SELECT origin,sales_version,order_status,payment_status FROM orders WHERE id=?",
    [orderId],
  );
  const o = orders[0];
  if (!o || o.origin !== "LIVE" || o.sales_version !== "PACKAGE") return 0;
  await c.execute(
    "INSERT IGNORE INTO automation_episodes(workflow,entity_id) VALUES('OUTSTANDING_PAYMENT',?)",
    [orderId],
  );
  const [rows] = await c.query<any[]>(
    "SELECT active,generation FROM automation_episodes WHERE workflow='OUTSTANDING_PAYMENT' AND entity_id=? FOR UPDATE",
    [orderId],
  );
  const current = rows[0],
    active =
      ["APPROVED", "COMPLETED"].includes(o.order_status) &&
      o.payment_status !== "PAID";
  const generation = current.generation + (active && !current.active ? 1 : 0);
  if (Boolean(current.active) !== active)
    await c.execute(
      "UPDATE automation_episodes SET active=?,generation=? WHERE workflow='OUTSTANDING_PAYMENT' AND entity_id=?",
      [active, generation, orderId],
    );
  return generation;
}
