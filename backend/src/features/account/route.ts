import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { PoolConnection } from "mysql2/promise";
import { authenticate, signToken } from "../../shared/auth.js";
import {
  authenticateCustomer,
  signCustomer,
} from "../customer-auth/session.js";
import { HttpError, validate } from "../../shared/http.js";
import { normalizePhPhone } from "../../shared/phone.js";
import { transaction } from "../../shared/transaction.js";
import { rateLimit } from "../../shared/rate-limit.js";
import { newPassword } from "../../shared/password.js";
import { stopEmployeeLocations } from "../delivery/service.js";

const router = Router();
const authenticateAccount: RequestHandler = (req, res, next) => {
  // Decoding only selects a validator. Each validator checks the signature, role,
  // account activity, and current session version before granting access.
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const claims = token ? jwt.decode(token) : null;
  return typeof claims === "object" && claims?.role === "CUSTOMER"
    ? authenticateCustomer(req, res, next)
    : authenticate(req, res, next);
};
router.use(authenticateAccount);
const validateBody = (body: z.ZodType) =>
  validate(z.object({ body, query: z.any(), params: z.any() }));
const phone = z
  .string()
  .transform((value, ctx) => {
    const normalized = normalizePhPhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid PH mobile number, e.g. 09171234567",
      });
      return z.NEVER;
    }
    return normalized;
  })
  .nullable();

async function ownAccount(c: PoolConnection, req: Request) {
  const isCustomer = Boolean(req.customer);
  const [rows] = await c.query<any[]>(
    isCustomer
      ? "SELECT ca.id,ca.customer_id customerId,ca.password_hash passwordHash,ca.token_version tokenVersion,c.email,c.full_name fullName,c.phone,c.address FROM customer_accounts ca JOIN customers c ON c.id=ca.customer_id WHERE ca.id=? AND ca.active=TRUE AND ca.verified_at IS NOT NULL FOR UPDATE"
      : "SELECT id,email,full_name fullName,phone,role,password_hash passwordHash,token_version tokenVersion FROM users WHERE id=? AND active=TRUE FOR UPDATE",
    [isCustomer ? req.customer!.id : req.user!.id],
  );
  const row = rows[0],
    identity = req.customer ?? req.user!;
  if (
    !row ||
    Number(row.tokenVersion) !== Number(identity.tokenVersion ?? 0) ||
    (!isCustomer && row.role !== identity.role)
  )
    throw new HttpError(401, "Your session expired. Sign in again.");
  return {
    ...row,
    role: isCustomer ? "CUSTOMER" : row.role,
    address: isCustomer ? row.address : null,
  };
}
function publicProfile(row: any) {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    address: row.address,
    role: row.role,
  };
}
function sessionResult(row: any) {
  const user = {
    id: Number(row.id),
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    tokenVersion: Number(row.tokenVersion),
    ...(row.role === "CUSTOMER" ? { customerId: Number(row.customerId) } : {}),
  };
  return {
    profile: publicProfile(row),
    user,
    token:
      row.role === "CUSTOMER"
        ? signCustomer({
            ...user,
            role: "CUSTOMER",
            customerId: Number(row.customerId),
          })
        : signToken(user),
  };
}
router.get("/", async (req, res, next) => {
  try {
    res.json({
      data: await transaction(async (c) =>
        publicProfile(await ownAccount(c, req)),
      ),
    });
  } catch (error) {
    next(error);
  }
});
router.patch(
  "/profile",
  validateBody(
    z
      .object({
        fullName: z.string().trim().min(2).max(160),
        phone,
        address: z.string().trim().min(5).max(500).optional(),
      })
      .strict(),
  ),
  async (req, res, next) => {
    try {
      const data = await transaction(async (c) => {
        const account = await ownAccount(c, req);
        if (account.role !== "ADMIN" && !req.body.phone)
          throw new HttpError(
            400,
            "A phone number is required for your profile",
          );
        if (account.role === "CUSTOMER") {
          if (!req.body.address)
            throw new HttpError(
              400,
              "An address is required for your customer profile",
            );
          await c.execute(
            "UPDATE customers SET full_name=?,phone=?,address=? WHERE id=?",
            [
              req.body.fullName,
              req.body.phone,
              req.body.address,
              account.customerId,
            ],
          );
          account.address = req.body.address;
        } else {
          if (req.body.address !== undefined)
            throw new HttpError(
              400,
              "Staff profiles do not include a delivery address",
            );
          await c.execute("UPDATE users SET full_name=?,phone=? WHERE id=?", [
            req.body.fullName,
            req.body.phone,
            account.id,
          ]);
        }
        return sessionResult({
          ...account,
          fullName: req.body.fullName,
          phone: req.body.phone,
        });
      });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);
router.patch(
  "/password",
  rateLimit(),
  validateBody(
    z
      .object({ currentPassword: z.string().min(1).max(1024), newPassword })
      .strict(),
  ),
  async (req, res, next) => {
    try {
      const data = await transaction(async (c) => {
        const account = await ownAccount(c, req);
        if (
          !(await bcrypt.compare(
            req.body.currentPassword,
            account.passwordHash,
          ))
        )
          throw new HttpError(400, "Current password is incorrect");
        if (await bcrypt.compare(req.body.newPassword, account.passwordHash))
          throw new HttpError(400, "Choose a different new password");
        const hash = await bcrypt.hash(req.body.newPassword, 12);
        if (account.role === "DELIVERY") await stopEmployeeLocations(c, account.id);
        await c.execute(
          account.role === "CUSTOMER"
            ? "UPDATE customer_accounts SET password_hash=?,token_version=token_version+1 WHERE id=?"
            : "UPDATE users SET password_hash=?,token_version=token_version+1 WHERE id=?",
          [hash, account.id],
        );
        if (account.role === "CUSTOMER")
          await c.execute(
            "UPDATE customer_auth_tokens SET used_at=UTC_TIMESTAMP() WHERE purpose='RESET' AND used_at IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.accountId'))=?",
            [String(account.id)],
          );
        return sessionResult({
          ...account,
          tokenVersion: Number(account.tokenVersion) + 1,
        });
      });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);
export default router;
