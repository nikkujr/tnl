import type { PoolConnection } from "mysql2/promise";
import { HttpError } from "../../shared/http.js";
import { orderChanged } from "../automations/events.js";
import { paymentEpisode } from "../automations/payment-episode.js";
import { stockEpisode } from "../automations/stock.js";
import { endAttempt } from "../delivery/service.js";

export async function cancelOrder(c: PoolConnection, id: number, actor: { staffId: number } | { customerId: number }) {
  const customer = "customerId" in actor;
  const [orders] = await c.query<any[]>(
    `SELECT origin,order_status,payment_status,delivery_status FROM orders WHERE id=?${customer ? " AND customer_id=?" : ""} FOR UPDATE`,
    customer ? [id, actor.customerId] : [id],
  );
  const order = orders[0];
  if (!order) throw new HttpError(404, "Order not found");
  if (order.order_status === "CANCELLED") return;
  const preparing = order.order_status === "APPROVED" && order.delivery_status === "PREPARING";
  const pending = order.order_status === "PENDING" && !order.delivery_status;
  if (order.origin !== "LIVE" || (customer ? !pending || order.payment_status !== "UNPAID" : !pending && !preparing))
    throw new HttpError(409, customer ? "Only unpaid orders awaiting approval can be cancelled online. Contact staff for help." : "Only orders awaiting approval or being prepared can be cancelled.");

  if (!customer && preparing) {
    const [reservations] = await c.query<any[]>(
      `SELECT product_id productId, SUM(IF(type='RESERVE', quantity, -quantity)) units
       FROM inventory_movements WHERE order_id=? AND type IN ('RESERVE','RELEASE','DEDUCT')
       GROUP BY product_id HAVING units>0 ORDER BY product_id`,
      [id],
    );
    for (const { productId, units } of reservations) {
      const [result] = await c.execute<any>(
        "UPDATE products SET stock_reserved=stock_reserved-? WHERE id=? AND stock_reserved>=?",
        [units, productId, units],
      );
      if (!result.affectedRows) throw new HttpError(409, "Reserved stock needs review before this order can be cancelled.");
      await c.execute(
        "INSERT INTO inventory_movements(product_id,actor_id,type,quantity,order_id) VALUES(?,?,'RELEASE',?,?)",
        [productId, actor.staffId, units, id],
      );
      await stockEpisode(c, productId);
    }
    await endAttempt(c, id, "CANCELLED");
  }
  const staffId = customer ? null : actor.staffId;
  await c.execute(
    "UPDATE orders SET order_status='CANCELLED',delivery_status=NULL,delivery_assignment_version=delivery_assignment_version+1 WHERE id=?",
    [id],
  );
  await c.execute(
    "INSERT INTO order_events(order_id,actor_id,type,message) VALUES(?,?,'CANCELLED',?)",
    [id, staffId, customer ? "Order cancelled by the customer." : "Order cancelled by an administrator."],
  );
  await paymentEpisode(c, id);
  await orderChanged(c, id, "order.cancelled", "CANCELLED", staffId);
}
