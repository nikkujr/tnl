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
router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "");
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const offset = (page - 1) * limit;
    const scope = req.user!.role === "AGENT" ? " AND c.assigned_agent_id=?" : "";
    const args: unknown[] = [`%${search}%`, `%${search}%`, `%${search}%`];
    if (req.user!.role === "AGENT") args.push(req.user!.id);
    args.push(limit, offset);
    const [rows] = await db.query(
      `SELECT c.id,c.full_name fullName,c.email,c.phone,c.address,c.assigned_agent_id assignedAgentId,
       u.full_name assignedAgentName FROM customers c LEFT JOIN users u ON u.id=c.assigned_agent_id
       WHERE (c.full_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)${scope}
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, args
    );
    res.json({ data: rows, meta: { page, limit } });
  } catch (error) { next(error); }
});

const createSchema = z.object({
  body: z.object({ fullName: z.string().min(2).max(160), email: z.email(), phone: phoneField, address: z.string().min(5).max(500), assignedAgentId: z.number().int().positive().nullable().optional() }),
  query: z.any(), params: z.any()
});
router.post("/", validate(createSchema), async (req, res, next) => {
  try {
    const agentId = req.user!.role === "AGENT" ? req.user!.id : req.body.assignedAgentId ?? null;
    const [result] = await db.execute<any>("INSERT INTO customers(full_name,email,phone,address,assigned_agent_id) VALUES(?,?,?,?,?)", [req.body.fullName, req.body.email.toLowerCase(), req.body.phone, req.body.address, agentId]);
    res.status(201).json({ data: { id: result.insertId, ...req.body, assignedAgentId: agentId } });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") return next(new HttpError(409, "Customer email already exists"));
    next(error);
  }
});

router.put("/:id", validate(z.object({
  body: createSchema.shape.body,
  query: z.any(),
  params: z.object({ id: z.coerce.number().int().positive() })
})), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (req.user!.role === "AGENT") {
      const [owned] = await db.query<any[]>("SELECT id FROM customers WHERE id=? AND assigned_agent_id=?", [id, req.user!.id]);
      if (!owned.length) throw new HttpError(403, "Agents may update only assigned customers");
    }
    const agentId = req.user!.role === "AGENT" ? req.user!.id : req.body.assignedAgentId ?? null;
    const [result] = await db.execute<any>("UPDATE customers SET full_name=?,email=?,phone=?,address=?,assigned_agent_id=? WHERE id=?", [req.body.fullName, req.body.email.toLowerCase(), req.body.phone, req.body.address, agentId, id]);
    if (!result.affectedRows) throw new HttpError(404, "Customer not found");
    res.json({ data: { id, ...req.body, assignedAgentId: agentId } });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") return next(new HttpError(409, "Customer email already exists"));
    next(error);
  }
});

router.delete("/:id", authorize("ADMIN"), async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    const id = Number(req.params.id);
    await connection.beginTransaction();
    const [orders] = await connection.query<any[]>("SELECT COUNT(*) orderCount FROM orders WHERE customer_id=?", [id]);
    if (orders[0].orderCount > 0) throw new HttpError(409, "Customer has order history and cannot be deleted");
    await connection.execute("UPDATE leads SET converted_customer_id=NULL WHERE converted_customer_id=?", [id]);
    const [result] = await connection.execute<any>("DELETE FROM customers WHERE id=?", [id]);
    if (!result.affectedRows) throw new HttpError(404, "Customer not found");
    await connection.commit();
    res.status(204).send();
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

export default router;
