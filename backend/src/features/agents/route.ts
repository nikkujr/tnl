import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";

const router = Router();
router.use(authenticate, authorize("ADMIN"));
router.get("/", async (req, res, next) => {
  try {
    const search = `%${String(req.query.search ?? "")}%`;
    const activeOnly = String(req.query.activeOnly ?? "") === "true" ? " AND active=TRUE" : "";
    const [rows] = await db.query(`SELECT id,email,phone,full_name fullName,commission_rate commissionRate,active,created_at createdAt
      FROM users WHERE role='AGENT'${activeOnly} AND (full_name LIKE ? OR email LIKE ? OR COALESCE(phone,'') LIKE ?) ORDER BY active DESC,full_name`, [search, search, search]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});
const body = z.object({ fullName: z.string().min(2).max(160), email: z.email(), phone: z.string().min(7).max(40), password: z.string().min(8).optional(), commissionRate: z.number().min(0).max(100) });
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
