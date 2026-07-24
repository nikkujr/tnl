import { Router } from "express";
import { db } from "../../database/connection.js";
import { HttpError } from "../../shared/http.js";

const router = Router();
router.get("/:trackingNumber", async (req, res, next) => {
  try {
    const [orders] = await db.query<any[]>(`SELECT id,tracking_number trackingNumber,order_status orderStatus,
      delivery_status deliveryStatus,delivery_address deliveryAddress FROM orders WHERE tracking_number=?`, [req.params.trackingNumber]);
    const order = orders[0];
    if (!order) throw new HttpError(404, "Tracking number not found");
    const [events] = await db.query("SELECT status,notes,latitude,longitude,occurred_at occurredAt FROM delivery_events WHERE order_id=? ORDER BY occurred_at", [order.id]);
    res.json({ data: { ...order, events } });
  } catch (error) { next(error); }
});
export default router;
