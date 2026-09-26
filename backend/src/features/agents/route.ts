import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { normalizePhPhone } from "../../shared/phone.js";

const phoneField = z.string().transform((value, ctx) => {
  const normalized = normalizePhPhone(value);
  if (!normalized) { ctx.addIssue({ code: "custom", message: "Enter a valid PH mobile number, e.g. 09171234567" }); return z.NEVER; }
  return normalized;
});

const router = Router();
router.use(authenticate, authorize("ADMIN"));
router.get("/", async (req, res, next) => {
  try {
    const search = `%${String(req.query.search ?? "")}%`;
    const activeOnly = String(req.query.activeOnly ?? "") === "true" ? " AND active=TRUE" : "";
    const [rows] = await db.query(`SELECT id,email,phone,full_name fullName,commission_rate commissionRate,active,created_at createdAt,
      (SELECT COUNT(*) FROM orders o WHERE o.agent_id=users.id AND o.order_status='COMPLETED') closedDeals
      FROM users WHERE role='AGENT'${activeOnly} AND (full_name LIKE ? OR email LIKE ? OR COALESCE(phone,'') LIKE ?) ORDER BY active DESC,full_name`, [search, search, search]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});
router.get("/:id", validate(z.object({ body: z.any(), query: z.any(), params: z.object({ id: z.coerce.number().int().positive() }) })), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [agents] = await db.query<any[]>(
      `SELECT id,email,phone,full_name fullName,commission_rate commissionRate,active,created_at createdAt,
       (SELECT COUNT(*) FROM orders o WHERE o.agent_id=users.id AND o.order_status='COMPLETED') closedDeals
       FROM users WHERE id=? AND role='AGENT'`,
      [id]
    );
    const agent = agents[0];
    if (!agent) throw new HttpError(404, "Agent not found");
    const [customers] = await db.query<any[]>(
      "SELECT id,full_name fullName,email,phone,address,created_at createdAt FROM customers WHERE assigned_agent_id=? ORDER BY created_at DESC",
      [id]
    );
    const [orders] = await db.query<any[]>(
      `SELECT o.id,o.tracking_number trackingNumber,c.full_name customerName,o.order_status orderStatus,
       o.delivery_status deliveryStatus,o.payment_status paymentStatus,o.created_at createdAt,
       (SELECT COALESCE(SUM(oi.quantity*oi.unit_price),0) FROM order_items oi WHERE oi.order_id=o.id) amount
       FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.agent_id=? ORDER BY o.created_at DESC`,
      [id]
    );
    const [commissions] = await db.query<any[]>(
      `SELECT c.id,c.amount,c.rate,c.created_at createdAt,o.id orderId,o.tracking_number trackingNumber,cu.full_name customerName
       FROM commissions c JOIN orders o ON o.id=c.order_id JOIN customers cu ON cu.id=o.customer_id
       WHERE c.agent_id=? ORDER BY c.created_at DESC`,
      [id]
    );
    const totalCommission = commissions.reduce((sum, item) => sum + Number(item.amount), 0);
    res.json({ data: { ...agent, customers, orders, commissions, totalCommission } });
  } catch (error) { next(error); }
});
const body = z.object({ fullName: z.string().min(2).max(160), email: z.email(), phone: phoneField, password: z.string().min(8).optional(), commissionRate: z.number().min(0).max(100) });
router.post("/", validate(z.object({ body: body.extend({ password: z.string().min(8) }), query: z.any(), params: z.any() })), async (req, res, next) => {
  try {
    const hash = await bcrypt.hash(req.body.password, 12);
    const [result] = await db.execute<any>("INSERT INTO users(email,phone,password_hash,full_name,role,commission_rate) VALUES(?,?,?,?,'AGENT',?)", [req.body.email.toLowerCase(), req.body.phone, hash, req.body.fullName, req.body.commissionRate]);
    res.status(201).json({ data: { id: result.insertId, email: req.body.email, phone: req.body.phone, fullName: req.body.fullName, commissionRate: req.body.commissionRate, active: true } });
  } catch (error: any) { if (error?.code === "ER_DUP_ENTRY") return next(new HttpError(409, "Agent email already exists")); next(error); }
});
router.put("/:id", validate(z.object({ body, query: z.any(), params: z.object({ id: z.coerce.number().positive() }) })), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (req.body.password) {
      const hash = await bcrypt.hash(req.body.password, 12);
      const [result] = await db.execute<any>("UPDATE users SET email=?,phone=?,full_name=?,commission_rate=?,password_hash=? WHERE id=? AND role='AGENT'", [req.body.email.toLowerCase(), req.body.phone, req.body.fullName, req.body.commissionRate, hash, id]);
      if (!result.affectedRows) throw new HttpError(404, "Agent not found");
    } else {
      const [result] = await db.execute<any>("UPDATE users SET email=?,phone=?,full_name=?,commission_rate=? WHERE id=? AND role='AGENT'", [req.body.email.toLowerCase(), req.body.phone, req.body.fullName, req.body.commissionRate, id]);
      if (!result.affectedRows) throw new HttpError(404, "Agent not found");
    }
    res.json({ data: { id, email: req.body.email.toLowerCase(), phone: req.body.phone, fullName: req.body.fullName, commissionRate: req.body.commissionRate } });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") return next(new HttpError(409, "Agent email already exists"));
    next(error);
  }
});
router.post("/:id/activate", validate(z.object({ body: z.object({}), query: z.any(), params: z.object({ id: z.coerce.number().int().positive() }) })), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [result] = await db.execute<any>("UPDATE users SET active=TRUE WHERE id=? AND role='AGENT' AND active=FALSE", [id]);
    if (!result.affectedRows) {
      const [agents] = await db.query<any[]>("SELECT active FROM users WHERE id=? AND role='AGENT'", [id]);
      if (!agents.length) throw new HttpError(404, "Agent not found");
      throw new HttpError(409, "Agent is already active");
    }
    res.json({ data: { id, active: true } });
  } catch (error) { next(error); }
});
router.delete("/:id", validate(z.object({body:z.any(),query:z.any(),params:z.object({id:z.coerce.number().int().positive()})})), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [active] = await db.query<any[]>("SELECT COUNT(*) count FROM orders WHERE agent_id=? AND order_status IN ('PENDING','APPROVED')", [id]);
    if (active[0].count > 0) throw new HttpError(409, "Reassign or complete the agent's active orders first");
    const [result] = await db.execute<any>("UPDATE users SET active=FALSE WHERE id=? AND role='AGENT' AND active=TRUE", [id]);
    if (!result.affectedRows) throw new HttpError(404, "Agent not found");
    res.status(204).send();
  } catch (error) { next(error); }
});
export default router;
