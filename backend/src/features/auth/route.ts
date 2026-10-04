import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { signToken, authenticate } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { transaction } from "../../shared/transaction.js";
import { stopEmployeeLocations } from "../delivery/service.js";

const router = Router();
const schema = z.object({
  body: z.object({ email: z.email(), password: z.string().min(8) }),
  query: z.any(),
  params: z.any(),
});

router.post("/login", validate(schema), async (req, res, next) => {
  try {
    const [rows] = await db.query<any[]>(
      "SELECT id,email,password_hash,full_name,role,token_version tokenVersion FROM users WHERE email=? AND active=TRUE",
      [req.body.email.toLowerCase()],
    );
    const record = rows[0];
    if (
      !record ||
      !(await bcrypt.compare(req.body.password, record.password_hash))
    )
      throw new HttpError(401, "Invalid email or password");
    const user = {
      id: record.id,
      email: record.email,
      fullName: record.full_name,
      role: record.role,
      tokenVersion: Number(record.tokenVersion),
    };
    res.json({ data: { token: signToken(user), user } });
  } catch (error) {
    next(error);
  }
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
