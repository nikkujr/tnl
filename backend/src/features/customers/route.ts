import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { normalizePhPhone } from "../../shared/phone.js";
import { transaction } from "../../shared/transaction.js";
import {
  welcome,
  event,
  notify,
  staffRecipients,
} from "../automations/events.js";

const phoneField = z.string().transform((value, ctx) => {
  const normalized = normalizePhPhone(value);
  if (!normalized) {
    ctx.addIssue({
      code: "custom",
      message: "Enter a valid PH mobile number, e.g. 09171234567",
    });
    return z.NEVER;
  }
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
    const filterAgentId =
      req.user!.role === "AGENT"
        ? req.user!.id
        : Number(req.query.agentId ?? 0) || 0;
    const scope = filterAgentId ? " AND c.assigned_agent_id=?" : "";
    const args: unknown[] = [
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
    ];
    if (filterAgentId) args.push(filterAgentId);
    args.push(limit, offset);
    const [rows] = await db.query(
      `SELECT c.id,c.full_name fullName,c.email,c.phone,c.address,c.marketing_opt_in marketingOptIn,c.assigned_agent_id assignedAgentId,
       u.full_name assignedAgentName FROM customers c LEFT JOIN users u ON u.id=c.assigned_agent_id
       WHERE (c.full_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.address LIKE ? OR u.full_name LIKE ?)${scope}
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      args,
    );
    const countArgs = args.slice(0, args.length - 2);
    const [counts] = await db.query<any[]>(
      `SELECT COUNT(*) total FROM customers c LEFT JOIN users u ON u.id=c.assigned_agent_id
       WHERE (c.full_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.address LIKE ? OR u.full_name LIKE ?)${scope}`,
      countArgs,
    );
    res.json({ data: rows, meta: { page, limit, total: counts[0].total } });
  } catch (error) {
    next(error);
  }
});

const createSchema = z.object({
  body: z.object({
    fullName: z.string().min(2).max(160),
    email: z.email(),
    phone: phoneField,
    address: z.string().min(5).max(500),
    assignedAgentId: z.number().int().positive().nullable().optional(),
    marketingOptIn: z.boolean().optional(),
  }),
  query: z.any(),
  params: z.any(),
});
router.post("/", validate(createSchema), async (req, res, next) => {
  try {
    const agentId =
      req.user!.role === "AGENT"
        ? req.user!.id
        : (req.body.assignedAgentId ?? null);
    const id = await transaction(async (c) => {
      const [result] = await c.execute<any>(
        "INSERT INTO customers(full_name,email,phone,address,assigned_agent_id,marketing_opt_in,marketing_opted_at) VALUES(?,?,?,?,?,?,IF(?,UTC_TIMESTAMP(),NULL))",
        [
          req.body.fullName,
          req.body.email.toLowerCase(),
          req.body.phone,
          req.body.address,
          agentId,
          req.body.marketingOptIn ?? false,
          req.body.marketingOptIn ?? false,
        ],
      );
      await welcome(c, result.insertId);
      return result.insertId;
    });
    res
      .status(201)
      .json({ data: { id, ...req.body, assignedAgentId: agentId } });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY")
      return next(new HttpError(409, "Customer email already exists"));
    next(error);
  }
});

router.put(
  "/:id",
  validate(
    z.object({
      body: createSchema.shape.body,
      query: z.any(),
      params: z.object({ id: z.coerce.number().int().positive() }),
    }),
  ),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const agentId =
        req.user!.role === "AGENT"
          ? req.user!.id
          : (req.body.assignedAgentId ?? null);
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          "SELECT c.*,EXISTS(SELECT 1 FROM customer_accounts ca WHERE ca.customer_id=c.id) linked FROM customers c WHERE c.id=? FOR UPDATE",
          [id],
        );
        const contact = rows[0];
        if (!contact) throw new HttpError(404, "Customer not found");
        if (
          req.user!.role === "AGENT" &&
          contact.assigned_agent_id !== req.user!.id
        )
          throw new HttpError(403, "Agents may update only assigned customers");
        if (
          contact.linked &&
          contact.email.toLowerCase() !== req.body.email.toLowerCase()
        )
          throw new HttpError(
            409,
            "A verified account is linked to this email; account email changes require a new verification flow",
          );
        if (agentId) {
          const [agents] = await c.query<any[]>(
            "SELECT id FROM users WHERE id=? AND role='AGENT' AND active=TRUE FOR SHARE",
            [agentId],
          );
          if (!agents.length)
            throw new HttpError(400, "Choose an active field agent");
        }
        const optIn =
          req.body.marketingOptIn ?? Boolean(contact.marketing_opt_in);
        await c.execute(
          "UPDATE customers SET full_name=?,email=?,phone=?,address=?,assigned_agent_id=?,marketing_opt_in=?,marketing_opted_at=IF(?,UTC_TIMESTAMP(),marketing_opted_at) WHERE id=?",
          [
            req.body.fullName,
            req.body.email.toLowerCase(),
            req.body.phone,
            req.body.address,
            agentId,
            optIn,
            optIn,
            id,
          ],
        );
        if (contact.assigned_agent_id !== agentId) {
          const eid = await event(
            c,
            "customer.assigned",
            "CUSTOMER",
            id,
            { agentId },
            req.user!.id,
          );
          await notify(
            c,
            await staffRecipients(c, agentId),
            eid,
            "ASSIGNMENT",
            "Customer assigned",
            req.body.fullName,
            "/customers",
          );
        }
      });
      res.json({ data: { id, ...req.body, assignedAgentId: agentId } });
    } catch (error: any) {
      if (error?.code === "ER_DUP_ENTRY")
        return next(new HttpError(409, "Customer email already exists"));
      next(error);
    }
  },
);

router.delete("/:id", authorize("ADMIN"), async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    const id = Number(req.params.id);
    await connection.beginTransaction();
    await connection.query("SELECT id FROM customers WHERE id=? FOR UPDATE", [
      id,
    ]);
    const [links] = await connection.query<any[]>(
      "SELECT (SELECT COUNT(*) FROM customer_accounts WHERE customer_id=?)+(SELECT COUNT(*) FROM customer_order_requests WHERE customer_id=?) count",
      [id, id],
    );
    if (links[0].count)
      throw new HttpError(
        409,
        "Customer has an account or request history and must be retained",
      );
    const [orders] = await connection.query<any[]>(
      "SELECT COUNT(*) orderCount FROM orders WHERE customer_id=?",
      [id],
    );
    if (orders[0].orderCount > 0)
      throw new HttpError(
        409,
        "Customer has order history and cannot be deleted",
      );
    await connection.execute(
      "UPDATE leads SET converted_customer_id=NULL WHERE converted_customer_id=?",
      [id],
    );
    const [result] = await connection.execute<any>(
      "DELETE FROM customers WHERE id=?",
      [id],
    );
    if (!result.affectedRows) throw new HttpError(404, "Customer not found");
    await connection.commit();
    res.status(204).send();
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

export default router;
