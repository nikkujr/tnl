import { Router } from "express";
import { db } from "../../database/connection.js";
import { HttpError } from "../../shared/http.js";
import { orderSla, slaColumns } from "../delivery/model.js";

const router = Router();
router.get("/:trackingNumber", async (req, res, next) => {
  try {
    const [orders] = await db.query<any[]>(
      `SELECT ${slaColumns},o.id,o.tracking_number trackingNumber,o.order_status orderStatus,
      o.delivery_status deliveryStatus,o.estimated_delivery_at estimatedDeliveryAt,o.delivery_sla_due_at slaDueAt,
      dc.completed_at completedAt FROM orders o LEFT JOIN delivery_completions dc ON dc.order_id=o.id WHERE o.tracking_number=?`,
      [req.params.trackingNumber],
    );
    const order = orders[0];
    if (!order) throw new HttpError(404, "Tracking number not found");
    const [events] = await db.query<any[]>(
      "SELECT status,occurred_at occurredAt FROM delivery_events WHERE order_id=? ORDER BY occurred_at,id",
      [order.id],
    );
    const { trackingNumber, orderStatus, deliveryStatus, estimatedDeliveryAt, completedAt } = order;
    const deliveredAt = completedAt ?? events.filter(e => e.status === "DELIVERED").at(-1)?.occurredAt ?? null;
    res.json({ data: { trackingNumber, orderStatus, deliveryStatus, estimatedDeliveryAt, sla: orderSla(order, deliveredAt, order.deliveryStatus === "DELIVERED"), events } });
  } catch (error) {
    next(error);
  }
});
export default router;
