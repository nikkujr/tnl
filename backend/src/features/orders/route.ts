import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { transaction, jsonValue } from "../../shared/transaction.js";
import { pesos } from "../../shared/money.js";
import {
  cashPayment,
  checkStock,
  completeSale,
  createSale,
  quote,
  readSale,
  requirements,
  saveSale,
  totalCents,
} from "./sales.js";
import { orderBody } from "./validation.js";
import { assertAgentPackageSelections, enforceAgentPackageCreation } from "./creation-policy.js";
import { deliveryStages, saleTotalSql } from "./queries.js";
import { paymentEpisode } from "../automations/payment-episode.js";
import { stockEpisode } from "../automations/stock.js";
import { event, orderChanged } from "../automations/events.js";
import { completionFields, estimatedDeliveryAt } from "../delivery/model.js";
import { advanceDelivery, lockOrder } from "../delivery/service.js";
import { deliveryManagementRouter } from "../delivery/route.js";

const router = Router();
router.use(authenticate, authorize("ADMIN", "AGENT"));
router.use(deliveryManagementRouter);

async function logOrderEvent(
  connection: any,
  orderId: number,
  actorId: number | null,
  type: string,
  message: string,
): Promise<void> {
  await connection.execute(
    "INSERT INTO order_events(order_id,actor_id,type,message) VALUES(?,?,?,?)",
    [orderId, actorId, type, message],
  );
}

const createSchema = z.object({
  body: orderBody,
  query: z.any(),
  params: z.any(),
});

const STATUS_FILTERS: Record<string, string> = {
  Open: "o.order_status IN ('PENDING','APPROVED')",
  Pending: "o.order_status='PENDING'",
  Approved:
    "o.order_status='APPROVED' AND (o.delivery_status IS NULL OR o.delivery_status NOT IN ('DELIVERED','IN_TRANSIT'))",
  "In transit": "o.delivery_status='IN_TRANSIT'",
  Delivered: "o.delivery_status='DELIVERED'",
  Cancelled: "o.order_status='CANCELLED'",
};

router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 20)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "All");

    const filters: string[] = [];
    const args: unknown[] = [];
    if (req.user!.role === "AGENT") {
      filters.push("o.agent_id=?");
      args.push(req.user!.id);
    }
    if (search) {
      filters.push(
        "(o.tracking_number LIKE ? OR c.full_name LIKE ? OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.product_name LIKE ?))",
      );
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (STATUS_FILTERS[status]) filters.push(STATUS_FILTERS[status]);
    const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";

    const [countRows] = await db.query<any[]>(
      `SELECT COUNT(*) total FROM orders o JOIN customers c ON c.id=o.customer_id${where}`,
      args,
    );
    const [orders] = await db.query<any[]>(
      `SELECT o.id,o.tracking_number trackingNumber,o.customer_id customerId,o.agent_id agentId,o.origin origin,
       c.full_name customerName,o.order_status orderStatus,o.delivery_status deliveryStatus,
       o.payment_status paymentStatus,o.payment_method paymentMethod,o.cash_received cashReceived,
       o.cash_change cashChange,o.amount_paid amountPaid,o.delivery_address deliveryAddress,
       o.created_at createdAt,u.full_name agentName
       FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.agent_id${where}
       ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );
    if (!orders.length)
      return res.json({
        data: [],
        meta: { page, limit, total: countRows[0].total },
      });
    res.json({
      data: await Promise.all(
        orders.map(async (order) => {
          const sale = await readSale(db, order.id);
          return { ...order, ...sale, total: pesos(totalCents(sale)) };
        }),
      ),
      meta: { page, limit, total: countRows[0].total },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/stats", async (req, res, next) => {
  try {
    const scope = req.user!.role === "AGENT" ? " WHERE o.agent_id=?" : "";
    const args = req.user!.role === "AGENT" ? [req.user!.id] : [];
    const revenueExpr = `CASE WHEN o.payment_status='PAID' THEN ${saleTotalSql("o")} ELSE 0 END`;
    const [totalsRows] = await db.query<any[]>(
      `SELECT COUNT(*) totalOrders,
       SUM(o.order_status='PENDING') pendingOrders,
       SUM(o.order_status='COMPLETED') completedOrders,
       SUM(o.order_status IN ('CANCELLED','REJECTED')) cancelledOrders,
       SUM(o.payment_status='PAID') paidOrders,
       COALESCE(SUM(${revenueExpr}),0) totalRevenue
       FROM orders o${scope}`,
      args,
    );
    const [statusRows] = await db.query<any[]>(
      `SELECT
        CASE
          WHEN o.delivery_status='DELIVERED' THEN 'Delivered'
          WHEN o.delivery_status='IN_TRANSIT' THEN 'In transit'
          WHEN o.order_status='PENDING' THEN 'Pending'
          WHEN o.order_status='APPROVED' THEN 'Approved'
          WHEN o.order_status='COMPLETED' THEN 'Completed'
          WHEN o.order_status='CANCELLED' THEN 'Cancelled'
          ELSE 'Rejected'
        END status, COUNT(*) count
       FROM orders o${scope} GROUP BY status`,
      args,
    );
    const monthlyScope = req.user!.role === "AGENT" ? " AND o.agent_id=?" : "";
    const [monthlyRows] = await db.query<any[]>(
      `SELECT DATE_FORMAT(o.created_at,'%Y-%m') month, COUNT(*) orders, COALESCE(SUM(${revenueExpr}),0) revenue
       FROM orders o
       WHERE o.created_at>=DATE_FORMAT(DATE_SUB(CURRENT_DATE,INTERVAL 11 MONTH),'%Y-%m-01')${monthlyScope}
       GROUP BY month ORDER BY month`,
      args,
    );
    const totals = totalsRows[0];
    const totalOrders = Number(totals.totalOrders ?? 0);
    const paidOrders = Number(totals.paidOrders ?? 0);
    const totalRevenue = Number(totals.totalRevenue ?? 0);
    res.json({
      data: {
        totalOrders,
        pendingOrders: Number(totals.pendingOrders ?? 0),
        completedOrders: Number(totals.completedOrders ?? 0),
        cancelledOrders: Number(totals.cancelledOrders ?? 0),
        totalRevenue,
        averageOrderValue: paidOrders > 0 ? totalRevenue / paidOrders : 0,
        statusBreakdown: statusRows.map((row) => ({
          status: row.status,
          count: Number(row.count),
        })),
        monthlyTrend: monthlyRows.map((row) => ({
          month: row.month,
          orders: Number(row.orders),
          revenue: Number(row.revenue),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/:id",
  validate(
    z.object({
      body: z.any(),
      query: z.any(),
      params: z.object({ id: z.coerce.number().int().positive() }),
    }),
  ),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const scope = req.user!.role === "AGENT" ? " AND o.agent_id=?" : "";
      const args = req.user!.role === "AGENT" ? [id, req.user!.id] : [id];
      const [orders] = await db.query<any[]>(
        `SELECT o.id,o.tracking_number trackingNumber,o.customer_id customerId,o.agent_id agentId,o.origin origin,
       c.full_name customerName,c.email customerEmail,c.phone customerPhone,
       o.order_status orderStatus,o.delivery_status deliveryStatus,
       o.payment_status paymentStatus,o.payment_method paymentMethod,o.cash_received cashReceived,
       o.cash_change cashChange,o.amount_paid amountPaid,o.delivery_address deliveryAddress,
       o.created_at createdAt,o.updated_at updatedAt,u.full_name agentName,u.email agentEmail
       FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.agent_id
       WHERE o.id=?${scope}`,
        args,
      );
      const order = orders[0];
      if (!order) throw new HttpError(404, "Order not found");
      const [items] = await db.query<any[]>(
        "SELECT product_id productId,product_name productName,sku,quantity,unit_price unitPrice FROM order_items WHERE order_id=? ORDER BY id",
        [id],
      );
      const [history] = await db.query<any[]>(
        `SELECT e.id,e.type,e.message,e.created_at createdAt,u.full_name actorName
       FROM order_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.order_id=? ORDER BY e.created_at,e.id`,
        [id],
      );
      const [deliveryEvents] = await db.query<any[]>(
        "SELECT status,notes,occurred_at occurredAt FROM delivery_events WHERE order_id=? ORDER BY occurred_at,id",
        [id],
      );
      const sale = await readSale(db, id);
      let review = null;
      if (req.user!.role === "ADMIN") {
        const [reviews] = await db.query<any[]>(
          `SELECT r.rating,r.review,r.created_at createdAt,r.agent_id agentId,u.full_name agentName
           FROM order_reviews r LEFT JOIN users u ON u.id=r.agent_id WHERE r.order_id=?`, [id],
        );
        review = reviews[0] ?? null;
      }
      const [commissions] = await db.query<any[]>(
        "SELECT amount,source,breakdown FROM commissions WHERE order_id=?",
        [id],
      );
      res.json({
        data: {
          ...order,
          ...sale,
          total: pesos(totalCents(sale)),
          history,
          deliveryEvents,
          ...(req.user!.role === "ADMIN" ? { review } : {}),
          commission: commissions[0]
            ? {
                ...commissions[0],
                breakdown: jsonValue(commissions[0].breakdown),
              }
            : null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post("/", validate(createSchema), enforceAgentPackageCreation, async (req, res, next) => {
  try {
    const data = await transaction(async (c) =>
      createSale(
        c,
        {
          ...req.body,
          agentId: req.user!.role === "AGENT" ? req.user!.id : req.body.agentId,
        },
        await quote(c, req.body),
        req.user!.id,
      ),
    );
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});
router.put(
  "/:id",
  validate(
    z.object({
      body: orderBody,
      query: z.any(),
      params: z.object({ id: z.coerce.number().int().positive() }),
    }),
  ),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await transaction(async (c) => {
        const scope = req.user!.role === "AGENT" ? " AND agent_id=?" : "";
        const args = req.user!.role === "AGENT" ? [id, req.user!.id] : [id];
        const [rows] = await c.query<any[]>(
          `SELECT * FROM orders WHERE id=?${scope} FOR UPDATE`,
          args,
        );
        const o = rows[0];
        if (!o) throw new HttpError(404, "Order not found");
        if (o.order_status !== "PENDING")
          throw new HttpError(409, "Only pending orders can be edited");
        const [requests] = await c.query<any[]>(
          "SELECT id FROM customer_order_requests WHERE order_id=?",
          [id],
        );
        if (requests.length)
          throw new HttpError(
            409,
            "Customer-confirmed terms cannot be edited; submit a new confirmed request",
          );
        const agentId =
          req.user!.role === "ADMIN" ? req.body.agentId ?? null : req.user!.id;
        if (agentId != null) {
          const [agents] = await c.query<any[]>(
            "SELECT id FROM users WHERE id=? AND role='AGENT' AND active=TRUE",
            [agentId ?? 0],
          );
          if (!agents.length)
            throw new HttpError(400, "Assigned agent must be active");
        }
        const previous = await readSale(c, id);
        const addedItems = req.body.items.filter(
          (i: any) => !previous.items.some((p) => p.productId === i.productId),
        );
        assertAgentPackageSelections(req.user!.role, addedItems);
        const addedPackages = req.body.packages.filter(
          (p: any) =>
            !previous.packages.some((i) => i.packageId === p.packageId),
        );
        const added =
          addedItems.length + addedPackages.length
            ? await quote(c, { items: addedItems, packages: addedPackages })
            : { items: [], packages: [] };
        const fresh = {
          items: req.body.items.map((i: any) => ({
            ...(previous.items.find((p) => p.productId === i.productId) ??
              added.items.find((p) => p.productId === i.productId)),
            quantity: i.quantity,
          })),
          packages: req.body.packages.map((p: any) => ({
            ...(previous.packages.find((i) => i.packageId === p.packageId) ??
              added.packages.find((i) => i.packageId === p.packageId)),
            quantity: p.quantity,
          })),
        };
        fresh.packages = fresh.packages.map((p: any) => {
          const old = previous.packages.find(
            (x) => x.packageId === p.packageId,
          );
          return old ? { ...old, quantity: p.quantity } : p;
        });
        fresh.items = fresh.items.map((i: any) => {
          const old = previous.items.find((x) => x.productId === i.productId);
          return old ? { ...old, quantity: i.quantity } : i;
        });
        await checkStock(c, fresh);
        if (Number(o.amount_paid ?? 0) > 0 && (req.body.paymentMethod !== o.payment_method || totalCents(fresh) !== totalCents(previous)))
          throw new HttpError(409, "Orders with recorded payments cannot change their total or payment method through editing. Update payment first.");
        const samePayment = req.body.paymentMethod === o.payment_method && totalCents(fresh) === totalCents(previous)
          && (req.body.paymentMethod !== "Cash" || req.body.cashReceived === o.cash_received);
        const payment = cashPayment(
          totalCents(fresh),
          req.body.paymentMethod,
          req.body.cashReceived,
          samePayment ? o.payment_status : req.body.paymentMethod === "Cash" ? undefined : "UNPAID",
          samePayment ? o.cash_received ?? o.amount_paid ?? undefined : undefined,
        );
        await c.execute(
          "UPDATE orders SET customer_id=?,agent_id=?,delivery_address=?,payment_method=?,payment_status=?,cash_received=?,cash_change=?,amount_paid=? WHERE id=?",
          [
            req.body.customerId,
            agentId,
            req.body.deliveryAddress,
            req.body.paymentMethod,
            payment.paymentStatus,
            payment.cashReceived,
            payment.cashChange,
            payment.amountPaid,
            id,
          ],
        );
        await c.execute("DELETE FROM order_items WHERE order_id=?", [id]);
        await c.execute("DELETE FROM order_packages WHERE order_id=?", [id]);
        await saveSale(c, id, fresh);
        await logOrderEvent(
          c,
          id,
          req.user!.id,
          "EDITED",
          "Pending order updated.",
        );
        if (o.agent_id !== agentId)
          await orderChanged(c, id, "order.assigned", "PENDING", req.user!.id);
      });
      res.json({ data: { id } });
    } catch (e) {
      next(e);
    }
  },
);
const decisionSchema = z.object({
  body: z.object({ decision: z.enum(["APPROVE", "REJECT"]) }),
  query: z.any(),
  params: z.object({ id: z.coerce.number().int().positive() }),
});
router.post(
  "/:id/decision",
  authorize("ADMIN"),
  validate(decisionSchema),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id),
        approve = req.body.decision === "APPROVE";
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          "SELECT * FROM orders WHERE id=? FOR UPDATE",
          [id],
        );
        const o = rows[0];
        if (!o || o.order_status !== "PENDING")
          throw new HttpError(409, "Only pending orders can be decided");
        if (approve) {
          if (o.agent_id != null) {
            const [agents] = await c.query<any[]>(
              "SELECT id FROM users WHERE id=? AND role='AGENT' AND active=TRUE LOCK IN SHARE MODE",
              [o.agent_id],
            );
            if (!agents.length)
              throw new HttpError(
                409,
                "Assign an active field agent before approval",
              );
          }
          const sale = await readSale(c, id);
          await checkStock(c, sale, true);
          for (const i of requirements(sale)) {
            await c.execute(
              "UPDATE products SET stock_reserved=stock_reserved+? WHERE id=?",
              [i.quantity, i.productId],
            );
            await c.execute(
              "INSERT INTO inventory_movements(product_id,actor_id,type,quantity,order_id) VALUES(?,?,'RESERVE',?,?)",
              [i.productId, req.user!.id, i.quantity, id],
            );
            await stockEpisode(c, i.productId, req.user!.id);
          }
          await c.execute(
            "UPDATE orders SET order_status='APPROVED',delivery_status='PREPARING',approved_at=UTC_TIMESTAMP(),delivery_changed_at=UTC_TIMESTAMP() WHERE id=?",
            [id],
          );
          await c.execute(
            "INSERT INTO delivery_events(order_id,status) VALUES(?,'PREPARING')",
            [id],
          );
        } else
          await c.execute(
            "UPDATE orders SET order_status='REJECTED' WHERE id=?",
            [id],
          );
        await logOrderEvent(
          c,
          id,
          req.user!.id,
          approve ? "APPROVED" : "REJECTED",
          approve ? "Order approved; stock reserved." : "Order rejected.",
        );
        await paymentEpisode(c, id);
        await orderChanged(
          c,
          id,
          approve ? "order.approved" : "order.rejected",
          approve ? "APPROVED" : "REJECTED",
          req.user!.id,
        );
      });
      res.json({
        data: { id, orderStatus: approve ? "APPROVED" : "REJECTED" },
      });
    } catch (e) {
      next(e);
    }
  },
);
router.patch(
  "/:id/payment-status",
  authorize("ADMIN"),
  validate(
    z.object({
      body: z.object({
        paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]),
        paymentMethod: z.enum([
          "Cash",
          "Cash on delivery",
          "Bank transfer",
          "Card",
        ]),
        cashReceived: z.number().min(0).nullable(),
        amountPaid: z.number().min(0).max(9999999999).optional(),
      }),
      query: z.any(),
      params: z.object({ id: z.coerce.number().int().positive() }),
    }),
  ),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const data = await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          "SELECT o.*,EXISTS(SELECT 1 FROM commissions co WHERE co.order_id=o.id) has_commission FROM orders o WHERE o.id=? FOR UPDATE",
          [id],
        );
        const o = rows[0];
        if (!o) throw new HttpError(404, "Order not found");
        if (o.origin === "IMPORTED")
          throw new HttpError(409, "Imported payment history is read-only");
        if (["REJECTED", "CANCELLED"].includes(o.order_status))
          throw new HttpError(
            409,
            "Closed orders cannot receive payment changes",
          );
        if (
          (o.has_commission || o.sale_completed_at) &&
          req.body.paymentStatus !== "PAID"
        )
          throw new HttpError(409, "Earned sales cannot have payment reversed");
        const payment = cashPayment(
          totalCents(await readSale(c, id)),
          req.body.paymentMethod,
          req.body.cashReceived,
          req.body.paymentStatus,
          req.body.amountPaid ?? (req.body.paymentMethod === o.payment_method && req.body.paymentStatus === o.payment_status
            ? o.cash_received ?? o.amount_paid ?? undefined : undefined),
        );
        if (
          o.payment_status !== payment.paymentStatus ||
          o.payment_method !== req.body.paymentMethod ||
          o.cash_received !== payment.cashReceived || o.amount_paid !== payment.amountPaid
        ) {
          await c.execute(
            "UPDATE orders SET payment_status=?,payment_method=?,cash_received=?,cash_change=?,amount_paid=? WHERE id=?",
            [
              payment.paymentStatus,
              req.body.paymentMethod,
              payment.cashReceived,
              payment.cashChange,
              payment.amountPaid,
              id,
            ],
          );
          await logOrderEvent(
            c,
            id,
            req.user!.id,
            "PAYMENT_UPDATED",
            `Payment marked ${payment.paymentStatus}${payment.amountPaid === null ? '' : `; total amount paid ₱${payment.amountPaid.toFixed(2)}`}.`,
          );
          await event(
            c,
            "order.payment_updated",
            "ORDER",
            id,
            { paymentStatus: payment.paymentStatus },
            req.user!.id,
          );
        }
        await paymentEpisode(c, id);
        await completeSale(c, id, req.user!.id);
        return { id, ...payment, paymentMethod: req.body.paymentMethod };
      });
      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);
const deliveryBody = z.object({
  assignmentVersion: z.number().int().nonnegative(),
  ...completionFields,
  estimatedDeliveryAt: estimatedDeliveryAt.optional(),
  deliveryStatus: z.enum(deliveryStages),
  notes: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});
router.patch(
  "/:id/delivery-status",
  authorize("ADMIN"),
  validate(
    z.object({
      body: deliveryBody,
      query: z.any(),
      params: z.object({ id: z.coerce.number().int().positive() }),
    }),
  ),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await transaction(async c => advanceDelivery(c, await lockOrder(c, id, req.user!, req.body.assignmentVersion), req.user!, req.body));
      res.json({ data: { id, deliveryStatus: req.body.deliveryStatus } });
    } catch (e) {
      next(e);
    }
  },
);
router.delete(
  "/:id",
  validate(
    z.object({
      body: z.any(),
      query: z.any(),
      params: z.object({ id: z.coerce.number().int().positive() }),
    }),
  ),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await transaction(async (c) => {
        const scope = req.user!.role === "AGENT" ? " AND agent_id=?" : "";
        const args = req.user!.role === "AGENT" ? [id, req.user!.id] : [id];
        const [rows] = await c.query<any[]>(
          `SELECT * FROM orders WHERE id=?${scope} FOR UPDATE`,
          args,
        );
        const o = rows[0];
        if (!o) throw new HttpError(404, "Order not found");
        if (!["PENDING", "REJECTED"].includes(o.order_status))
          throw new HttpError(
            409,
            "Only pending or rejected orders can be deleted",
          );
        const [requests] = await c.query<any[]>(
          "SELECT id FROM customer_order_requests WHERE order_id=?",
          [id],
        );
        if (requests.length)
          throw new HttpError(409, "Customer request orders must be retained");
        await c.execute("DELETE FROM order_events WHERE order_id=?", [id]);
        await c.execute("DELETE FROM orders WHERE id=?", [id]);
      });
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);
export default router;
