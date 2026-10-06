import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { transaction, jsonValue } from "../../shared/transaction.js";
import { pesos } from "../../shared/money.js";
import { authenticateCustomer } from "../customer-auth/session.js";
import { selection } from "../orders/validation.js";
import {
  createSale,
  quote,
  readSale,
  totalCents,
  type Sale,
} from "../orders/sales.js";
import {
  enqueue,
  event,
  notify,
  staffRecipients,
} from "../automations/events.js";
import { termsRevision } from "../catalog/terms.js";
import { reportSaleSql } from "../reports/model.js";
export const customerRouter = Router(),
  staffRouter = Router();
customerRouter.use(authenticateCustomer);
staffRouter.use(authenticate, authorize("ADMIN", "AGENT"));
const valid = (body: z.ZodType) =>
  validate(z.object({ body, query: z.any(), params: z.any() }));
export function customerSale(s: Sale) {
  return {
    items: s.items,
    packages: s.packages.map(({ commissionType, commissionValue, ...p }) => p),
    total: pesos(totalCents(s)),
  };
}
customerRouter.get("/me", async (req, res, next) => {
  try {
    const [rows] = await db.query<any[]>(
      "SELECT id,full_name fullName,email,phone,address,marketing_opt_in marketingOptIn FROM customers WHERE id=?",
      [req.customer!.customerId],
    );
    res.json({ data: rows[0] });
  } catch (e) {
    next(e);
  }
});
customerRouter.patch(
  "/preferences",
  valid(z.object({ marketingOptIn: z.boolean() })),
  async (req, res, next) => {
    try {
      await db.execute(
        "UPDATE customers SET marketing_opt_in=?,marketing_opted_at=IF(?,UTC_TIMESTAMP(),marketing_opted_at) WHERE id=?",
        [
          req.body.marketingOptIn,
          req.body.marketingOptIn,
          req.customer!.customerId,
        ],
      );
      res.json({ data: { marketingOptIn: req.body.marketingOptIn } });
    } catch (e) {
      next(e);
    }
  },
);
customerRouter.get("/orders", async (req, res, next) => {
  try {
    const [rows] = await db.query<any[]>(
      "SELECT o.id,o.tracking_number trackingNumber,o.order_status orderStatus,o.delivery_status deliveryStatus,o.payment_status paymentStatus,o.payment_method paymentMethod,o.delivery_address deliveryAddress,o.created_at createdAt,u.full_name agentName FROM orders o LEFT JOIN users u ON u.id=o.agent_id WHERE o.customer_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 200",
      [req.customer!.customerId],
    );
    res.json({
      data: await Promise.all(
        rows.map(async (o) => ({
          ...o,
          ...customerSale(await readSale(db, o.id)),
        })),
      ),
    });
  } catch (e) {
    next(e);
  }
});
customerRouter.get("/orders/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await db.query<any[]>(
      `SELECT o.id,o.tracking_number trackingNumber,CASE WHEN u.role='AGENT' THEN o.agent_id END agentId,o.order_status orderStatus,o.delivery_status deliveryStatus,o.payment_status paymentStatus,o.payment_method paymentMethod,o.delivery_address deliveryAddress,o.created_at createdAt,u.full_name agentName,(${reportSaleSql} AND u.role='AGENT') reviewEligible FROM orders o LEFT JOIN users u ON u.id=o.agent_id WHERE o.id=? AND o.customer_id=?`,
      [id, req.customer!.customerId],
    );
    if (!rows[0]) throw new HttpError(404, "Order not found");
    const [reviews] = await db.query<any[]>(
      "SELECT rating,review,created_at createdAt FROM order_reviews WHERE order_id=? AND customer_id=?",
      [id, req.customer!.customerId],
    );
    const { reviewEligible, ...order } = rows[0];
    const [deliveryEvents] = await db.query(
      "SELECT status,occurred_at occurredAt FROM delivery_events WHERE order_id=? ORDER BY occurred_at,id",
      [id],
    );
    const [followups] = await db.query(
      "SELECT id,message,reply,created_at createdAt,replied_at repliedAt FROM order_followups WHERE order_id=? AND customer_id=? ORDER BY created_at,id",
      [id, req.customer!.customerId],
    );
    res.json({
      data: {
        ...order,
        review: order.agentId ? reviews[0] ?? null : null,
        canReview: Boolean(reviewEligible) && !reviews.length,
        ...customerSale(await readSale(db, id)),
        deliveryEvents,
        followups,
      },
    });
  } catch (e) {
    next(e);
  }
});
customerRouter.post(
  "/orders/:id/review",
  validate(z.object({
    body: z.object({ rating: z.number().int().min(1).max(5), review: z.string().trim().min(2).max(2000) }).strict(),
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: z.any(),
  })),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const data = await transaction(async (c) => {
        const [orders] = await c.query<any[]>(
          `SELECT CASE WHEN u.role='AGENT' THEN o.agent_id END agent_id,(${reportSaleSql}) eligible FROM orders o LEFT JOIN users u ON u.id=o.agent_id WHERE o.id=? AND o.customer_id=? FOR UPDATE`,
          [id, req.customer!.customerId],
        );
        if (!orders[0]) throw new HttpError(404, "Order not found");
        if (!orders[0].agent_id) throw new HttpError(409, "This order has no agent to review.");
        if (!orders[0].eligible) throw new HttpError(409, "Agent reviews are available after delivery and full payment.");
        const [existing] = await c.query<any[]>("SELECT rating,review,created_at createdAt FROM order_reviews WHERE order_id=?", [id]);
        if (existing.length) {
          if (existing[0].rating !== req.body.rating || existing[0].review !== req.body.review)
            throw new HttpError(409, "You have already reviewed this order.");
          return { ...existing[0], reused: true };
        }
        await c.execute("INSERT INTO order_reviews(order_id,customer_id,agent_id,rating,review) VALUES(?,?,?,?,?)",
          [id, req.customer!.customerId, orders[0].agent_id, req.body.rating, req.body.review]);
        const [saved] = await c.query<any[]>("SELECT rating,review,created_at createdAt FROM order_reviews WHERE order_id=?", [id]);
        return { ...saved[0], reused: false };
      });
      res.status(data.reused ? 200 : 201).json({ data });
    } catch (error) { next(error); }
  },
);
const requestBody = selection.safeExtend({
  deliveryAddress: z.string().trim().min(5).max(500),
  paymentMethod: z
    .enum(["Cash on delivery", "Bank transfer", "Card"])
    .default("Cash on delivery"),
  reviewedTerms: z
    .array(
      z.object({
        kind: z.enum(["PRODUCT", "PACKAGE"]),
        id: z.number().int().positive(),
        revision: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(100),
});
customerRouter.post("/requests", valid(requestBody), async (req, res, next) => {
  try {
    const data = await transaction(async (c) => {
      const snapshot = await quote(c, req.body);
      const reviewed = req.body.reviewedTerms;
      if (reviewed.length !== snapshot.items.length + snapshot.packages.length)
        throw new HttpError(
          409,
          "Review each selected offer before submitting",
        );
      for (const i of snapshot.items)
        if (
          !reviewed.some(
            (r: any) =>
              r.kind === "PRODUCT" &&
              r.id === i.productId &&
              r.revision ===
                termsRevision(
                  "PRODUCT",
                  i.productId,
                  i.productName,
                  i.unitPrice,
                ),
          )
        )
          throw new HttpError(
            409,
            "Catalog terms changed. Refresh and review a new request.",
          );
      for (const p of snapshot.packages)
        if (
          !reviewed.some(
            (r: any) =>
              r.kind === "PACKAGE" &&
              r.id === p.packageId &&
              r.revision ===
                termsRevision(
                  "PACKAGE",
                  p.packageId,
                  p.name,
                  p.sellingPrice,
                  p.components,
                  p.commissionType,
                  p.commissionValue,
                ),
          )
        )
          throw new HttpError(
            409,
            "Catalog terms changed. Refresh and review a new request.",
          );
      const [contacts] = await c.query<any[]>(
        "SELECT c.assigned_agent_id FROM customers c JOIN users u ON u.id=c.assigned_agent_id AND u.role='AGENT' AND u.active=TRUE WHERE c.id=?",
        [req.customer!.customerId],
      );
      const agentId = contacts[0]?.assigned_agent_id ?? null;
      const [r] = await c.execute<any>(
        "INSERT INTO customer_order_requests(customer_id,agent_id,snapshot,delivery_address,payment_method) VALUES(?,?,?,?,?)",
        [
          req.customer!.customerId,
          agentId,
          JSON.stringify(snapshot),
          req.body.deliveryAddress,
          req.body.paymentMethod,
        ],
      );
      const id = Number(r.insertId),
        eventId = await event(c, "request.created", "REQUEST", id, {
          customerId: req.customer!.customerId,
          agentId,
        });
      await notify(
        c,
        await staffRecipients(c, agentId),
        eventId,
        "REQUEST",
        "New customer request",
        `${req.customer!.fullName} submitted request #${id}`,
        "/requests",
      );
      return { id, status: "SUBMITTED", ...customerSale(snapshot) };
    });
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});
customerRouter.get("/requests", async (req, res, next) => {
  try {
    const [rows] = await db.query<any[]>(
      "SELECT r.id,r.status,r.snapshot,r.delivery_address deliveryAddress,r.created_at createdAt,r.order_id orderId,r.decline_reason declineReason,u.full_name agentName FROM customer_order_requests r LEFT JOIN users u ON u.id=r.agent_id WHERE r.customer_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 200",
      [req.customer!.customerId],
    );
    res.json({
      data: rows.map(({ snapshot, ...r }) => ({
        ...r,
        ...customerSale(jsonValue<Sale>(snapshot)),
      })),
    });
  } catch (e) {
    next(e);
  }
});
customerRouter.post(
  "/orders/:id/followups",
  valid(z.object({ message: z.string().trim().min(2).max(1000) })),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const data = await transaction(async (c) => {
        const [orders] = await c.query<any[]>(
          "SELECT id,agent_id,tracking_number FROM orders WHERE id=? AND customer_id=? FOR UPDATE",
          [id, req.customer!.customerId],
        );
        if (!orders[0]) throw new HttpError(404, "Order not found");
        const [existing] = await c.query<any[]>(
          "SELECT id FROM order_followups WHERE order_id=? AND customer_id=? AND replied_at IS NULL ORDER BY id LIMIT 1",
          [id, req.customer!.customerId],
        );
        if (existing[0]) return { id: existing[0].id, reused: true };
        const [r] = await c.execute<any>(
          "INSERT INTO order_followups(order_id,customer_id,message) VALUES(?,?,?)",
          [id, req.customer!.customerId, req.body.message],
        );
        const eventId = await event(
          c,
          "followup.created",
          "FOLLOWUP",
          r.insertId,
          { orderId: id },
        );
        await notify(
          c,
          await staffRecipients(c, orders[0].agent_id),
          eventId,
          "FOLLOWUP",
          "Customer requests an update",
          orders[0].tracking_number,
          "/requests",
        );
        return { id: r.insertId, reused: false };
      });
      res.status(201).json({ data });
    } catch (e) {
      next(e);
    }
  },
);
staffRouter.get("/", async (req, res, next) => {
  try {
    const filter = req.user!.role === "AGENT" ? " WHERE r.agent_id=?" : "";
    const [rows] = await db.query<any[]>(
      `SELECT r.*,c.full_name customerName,u.full_name agentName FROM customer_order_requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.agent_id${filter} ORDER BY r.created_at DESC,r.id DESC LIMIT 200`,
      req.user!.role === "AGENT" ? [req.user!.id] : [],
    );
    res.json({
      data: rows.map((r) => ({ ...r, snapshot: jsonValue(r.snapshot) })),
    });
  } catch (e) {
    next(e);
  }
});
staffRouter.patch(
  "/:id/assignment",
  authorize("ADMIN"),
  valid(z.object({ agentId: z.number().int().positive() })),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await transaction(async (c) => {
        const [requests] = await c.query<any[]>(
          "SELECT * FROM customer_order_requests WHERE id=? FOR UPDATE",
          [id],
        );
        if (!requests[0] || requests[0].status !== "SUBMITTED")
          throw new HttpError(409, "Only submitted requests can be assigned");
        const [agents] = await c.query<any[]>(
          "SELECT id FROM users WHERE id=? AND role='AGENT' AND active=TRUE",
          [req.body.agentId],
        );
        if (!agents.length)
          throw new HttpError(400, "Choose an active field agent");
        if (requests[0].agent_id === req.body.agentId) return;
        await c.execute(
          "UPDATE customer_order_requests SET agent_id=? WHERE id=?",
          [req.body.agentId, id],
        );
        const eventId = await event(
          c,
          "request.assigned",
          "REQUEST",
          id,
          { agentId: req.body.agentId },
          req.user!.id,
        );
        await notify(
          c,
          await staffRecipients(c, req.body.agentId),
          eventId,
          "REQUEST",
          "Customer request assigned",
          `Request #${id}`,
          "/requests",
        );
      });
      res.json({ data: { id } });
    } catch (e) {
      next(e);
    }
  },
);
staffRouter.post(
  "/:id/convert",
  valid(z.object({})),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const data = await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          `SELECT * FROM customer_order_requests WHERE id=?${req.user!.role === "AGENT" ? " AND agent_id=?" : ""} FOR UPDATE`,
          req.user!.role === "AGENT" ? [id, req.user!.id] : [id],
        );
        const r = rows[0];
        if (!r) throw new HttpError(404, "Request not found");
        if (r.order_id) {
          const [orders] = await c.query<any[]>(
            "SELECT id,tracking_number trackingNumber FROM orders WHERE id=?",
            [r.order_id],
          );
          return { ...orders[0], reused: true };
        }
        if (r.status !== "SUBMITTED")
          throw new HttpError(409, "Only submitted requests can be converted");
        const order = await createSale(
          c,
          {
            customerId: r.customer_id,
            agentId: r.agent_id,
            deliveryAddress: r.delivery_address,
            paymentMethod: r.payment_method,
          },
          jsonValue<Sale>(r.snapshot),
          req.user!.id,
        );
        await c.execute(
          "UPDATE customer_order_requests SET status='CONVERTED',order_id=? WHERE id=?",
          [order.id, id],
        );
        await event(
          c,
          "request.converted",
          "REQUEST",
          id,
          { orderId: order.id },
          req.user!.id,
        );
        return order;
      });
      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);
staffRouter.post(
  "/:id/decline",
  valid(z.object({ reason: z.string().trim().min(2).max(500) })),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          `SELECT * FROM customer_order_requests WHERE id=?${req.user!.role === "AGENT" ? " AND agent_id=?" : ""} FOR UPDATE`,
          req.user!.role === "AGENT" ? [id, req.user!.id] : [id],
        );
        if (!rows[0]) throw new HttpError(404, "Request not found");
        if (rows[0].status !== "SUBMITTED")
          throw new HttpError(409, "Only submitted requests can be declined");
        await c.execute(
          "UPDATE customer_order_requests SET status='DECLINED',decline_reason=? WHERE id=?",
          [req.body.reason, id],
        );
        await enqueue(
          c,
          "FOLLOWUP_REPLY",
          `request-declined:${id}`,
          {
            kind: "EMAIL",
            customerId: rows[0].customer_id,
            subject: "Your TNL Track order request",
            text: `Request #${id} could not be converted: ${req.body.reason}`,
          },
          new Date(),
          null,
          true,
        );
      });
      res.json({ data: { id } });
    } catch (e) {
      next(e);
    }
  },
);
staffRouter.get("/followups/open", async (req, res, next) => {
  try {
    const [rows] = await db.query<any[]>(
      `SELECT f.id,f.message,f.created_at createdAt,o.id orderId,o.tracking_number trackingNumber,c.full_name customerName FROM order_followups f JOIN orders o ON o.id=f.order_id JOIN customers c ON c.id=f.customer_id WHERE f.replied_at IS NULL${req.user!.role === "AGENT" ? " AND o.agent_id=?" : ""} ORDER BY f.created_at,f.id`,
      req.user!.role === "AGENT" ? [req.user!.id] : [],
    );
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});
staffRouter.post(
  "/followups/:id/reply",
  valid(z.object({ reply: z.string().trim().min(2).max(2000) })),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          `SELECT f.*,o.tracking_number,o.agent_id FROM order_followups f JOIN orders o ON o.id=f.order_id WHERE f.id=?${req.user!.role === "AGENT" ? " AND o.agent_id=?" : ""} FOR UPDATE`,
          req.user!.role === "AGENT" ? [id, req.user!.id] : [id],
        );
        const f = rows[0];
        if (!f) throw new HttpError(404, "Follow-up not found");
        if (f.replied_at)
          throw new HttpError(409, "Follow-up already answered");
        await c.execute(
          "UPDATE order_followups SET reply=?,replied_by=?,replied_at=UTC_TIMESTAMP() WHERE id=?",
          [req.body.reply, req.user!.id, id],
        );
        const eventId = await event(
          c,
          "followup.answered",
          "FOLLOWUP",
          id,
          { orderId: f.order_id },
          req.user!.id,
        );
        await enqueue(
          c,
          "FOLLOWUP_REPLY",
          `followup:${id}`,
          {
            kind: "EMAIL",
            customerId: f.customer_id,
            orderId: f.order_id,
            subject: `Update for ${f.tracking_number}`,
            text: req.body.reply,
          },
          new Date(),
          eventId,
          true,
        );
      });
      res.json({ data: { id } });
    } catch (e) {
      next(e);
    }
  },
);
