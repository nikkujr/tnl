import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { transaction } from "../../shared/transaction.js";
import { newPassword } from "../../shared/password.js";
import { normalizePhPhone } from "../../shared/phone.js";
import { rateLimit } from "../../shared/rate-limit.js";
import { resetAccountPassword } from "../../shared/admin-password-reset.js";
import { event } from "../automations/events.js";
import { stopEmployeeLocations } from "./service.js";
export const employeeRouter = Router();
employeeRouter.use(authenticate, authorize("ADMIN"));
const profile = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.email().transform((s) => s.toLowerCase()),
  phone: z.string().transform((s, ctx) => {
    const p = normalizePhPhone(s);
    if (!p) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid PH mobile number",
      });
      return z.NEVER;
    }
    return p;
  }),
});
const check = (body: z.ZodType) =>
  validate(z.object({ body, params: z.any(), query: z.any() }));
const employeeId = (value: unknown) => {
  const result = z.coerce.number().int().positive().safeParse(value);
  if (!result.success) throw new HttpError(400, "Invalid employee identifier");
  return result.data;
};
employeeRouter.get("/", async (_req, res) => {
  const [rows] = await db.query(
    "SELECT id,email,phone,full_name fullName,active FROM users WHERE role='DELIVERY' ORDER BY active DESC,full_name",
  );
  res.json({ data: rows });
});
employeeRouter.post(
  "/",
  check(profile.extend({ password: newPassword }).strict()),
  async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 12);
    const data = await transaction(async (c) => {
      const [r] = await c.execute<any>(
        "INSERT INTO users(email,phone,password_hash,full_name,role,commission_rate) VALUES(?,?,?,?,'DELIVERY',0)",
        [req.body.email, req.body.phone, hash, req.body.fullName],
      );
      await event(
        c,
        "delivery.employee_created",
        "USER",
        r.insertId,
        {},
        req.user!.id,
      );
      return { id: r.insertId };
    });
    res.status(201).json({ data });
  },
);
employeeRouter.put(
  "/:id",
  check(profile.extend({ active: z.boolean() }).strict()),
  async (req, res) => {
    const id = employeeId(req.params.id);
    await transaction(async (c) => {
      const [rows] = await c.query<any[]>(
        "SELECT * FROM users WHERE id=? AND role='DELIVERY' FOR UPDATE",
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "Delivery employee not found");
      if (!req.body.active) {
        const [assigned] = await c.query<any[]>(
          "SELECT id FROM orders WHERE delivery_employee_id=? AND order_status='APPROVED' AND delivery_status<>'DELIVERED' LIMIT 1",
          [id],
        );
        if (assigned.length)
          throw new HttpError(
            409,
            "Reassign or remove unfinished deliveries before deactivation",
          );
        await stopEmployeeLocations(c, id);
      }
      await c.execute(
        "UPDATE users SET email=?,phone=?,full_name=?,active=?,token_version=token_version+? WHERE id=?",
        [
          req.body.email,
          req.body.phone,
          req.body.fullName,
          req.body.active,
          Number(Boolean(rows[0].active) !== req.body.active),
          id,
        ],
      );
      await event(
        c,
        "delivery.employee_updated",
        "USER",
        id,
        { active: req.body.active },
        req.user!.id,
      );
    });
    res.json({ data: { id } });
  },
);
employeeRouter.post(
  "/:id/reset-password",
  rateLimit(),
  check(z.object({ newPassword }).strict()),
  async (req, res) => {
    const id = employeeId(req.params.id);
    res.json({
      data: await resetAccountPassword(
        "DELIVERY",
        id,
        req.body.newPassword,
        req.user!.id,
      ),
    });
  },
);
