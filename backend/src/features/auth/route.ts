import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { signToken } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";

const router = Router();
const schema = z.object({ body: z.object({ email: z.email(), password: z.string().min(8) }), query: z.any(), params: z.any() });

router.post("/login", validate(schema), async (req, res, next) => {
  try {
    const [rows] = await db.query<any[]>("SELECT id,email,password_hash,full_name,role FROM users WHERE email=? AND active=TRUE", [req.body.email.toLowerCase()]);
    const record = rows[0];
    if (!record || !(await bcrypt.compare(req.body.password, record.password_hash))) throw new HttpError(401, "Invalid email or password");
    const user = { id: record.id, email: record.email, fullName: record.full_name, role: record.role };
    res.json({ data: { token: signToken(user), user } });
  } catch (error) { next(error); }
});

export default router;
