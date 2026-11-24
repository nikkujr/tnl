import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { signToken, authenticate } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { transaction } from "../../shared/transaction.js";
import { stopEmployeeLocations } from "../delivery/service.js";
import { dummyLoginHash, findCustomerLogin, signCustomer } from "../customer-auth/session.js";
import { rateLimit } from "../../shared/rate-limit.js";

const router = Router();
const schema = z.object({
  body: z.object({ email: z.email(), password: z.string().min(8) }),
  query: z.any(),
  params: z.any(),
});

async function findStaffLogin(email: string) {
  const [rows] = await db.query<any[]>(
    "SELECT id,email,password_hash,full_name,role,token_version tokenVersion FROM users WHERE email=? AND active=TRUE",
    [email],
  );
  return rows[0];
}

function staffSession(record: any) {
  const user = {
    id: record.id,
    email: record.email,
    fullName: record.full_name,
    role: record.role,
    tokenVersion: Number(record.tokenVersion),
  };
  return { token: signToken(user), user };
}

router.post("/login", validate(schema), async (req, res, next) => {
  try {
    const record = await findStaffLogin(req.body.email.toLowerCase());
    if (
      !record ||
      !(await bcrypt.compare(req.body.password, record.password_hash))
    )
      throw new HttpError(401, "Invalid email or password");
    res.json({ data: staffSession(record) });
  } catch (error) {
    next(error);
  }
});

router.post("/sign-in", rateLimit(), validate(schema.extend({
  body: z.object({ email: z.string().trim().email(), password: z.string().min(8).max(1024) }),
})), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const [staff, customer] = await Promise.all([findStaffLogin(email), findCustomerLogin(email)]);
    const [staffValid, customerValid] = await Promise.all([
      bcrypt.compare(req.body.password, staff?.password_hash ?? dummyLoginHash),
      bcrypt.compare(req.body.password, customer?.password_hash ?? dummyLoginHash),
    ]);
    if (staff && staffValid) {
      if (customer && customerValid)
        throw new HttpError(409, "These credentials match two accounts. Reset your customer password or contact staff for help.");
      res.json({ data: staffSession(staff) });
    } else if (customer && customerValid) {
      const { password_hash, ...identity } = customer;
      const user = { ...identity, role: "CUSTOMER" as const };
      res.json({ data: { token: signCustomer(user), user } });
    } else {
      throw new HttpError(401, "Invalid email or password");
    }
  } catch (error) { next(error); }
});

router.post("/logout", authenticate, async (req, res) => {
  await transaction(async (c) => {
    const [rows] = await c.query<any[]>(
      "SELECT id FROM users WHERE id=? AND token_version=? FOR UPDATE",
      [req.user!.id, req.user!.tokenVersion ?? 0],
    );
    if (rows.length) {
      await c.execute(
        "UPDATE users SET token_version=token_version+1 WHERE id=?",
        [req.user!.id],
      );
      if (req.user!.role === "DELIVERY")
        await stopEmployeeLocations(c, req.user!.id);
    }
  });
  res.json({ data: { loggedOut: true } });
});
export default router;
