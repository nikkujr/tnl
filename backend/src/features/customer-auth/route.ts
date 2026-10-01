import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { config } from "../../config.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { transaction, jsonValue } from "../../shared/transaction.js";
import { normalizePhPhone } from "../../shared/phone.js";
import { rateLimit } from "../../shared/rate-limit.js";
import { enqueue, welcome } from "../automations/events.js";
import { signCustomer } from "./session.js";
const router = Router(),
  email = z
    .string()
    .trim()
    .email()
    .transform((v) => v.toLowerCase()),
  password = z.string().min(8).max(72),
  token = z.string().regex(/^[a-f0-9]{64}$/);
const validation = (body: z.ZodType) =>
  validate(z.object({ body, query: z.any(), params: z.any() }));
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const generic = {
  message:
    "If the address is eligible, an email with the next steps has been queued.",
};
function configured() {
  if (!config.SMTP_HOST || !config.SMTP_FROM)
    throw new HttpError(503, "Customer account email is not configured");
}
async function issue(
  c: any,
  purpose: string,
  address: string,
  payload: object,
  minutes: number,
) {
  const raw = randomBytes(32).toString("hex"),
    tokenHash = hash(raw);
  await c.execute(
    "INSERT INTO customer_auth_tokens(token_hash,purpose,email,payload,expires_at) VALUES(?,?,?,?,?)",
    [
      tokenHash,
      purpose,
      address,
      JSON.stringify(payload),
      new Date(Date.now() + minutes * 60000),
    ],
  );
  const mode = purpose === "RESET" ? "reset" : "verify";
  await enqueue(
    c,
    "ACCOUNT_EMAIL",
    `auth:${tokenHash}`,
    {
      kind: "EMAIL",
      authTokenHash: tokenHash,
      to: address,
      subject:
        purpose === "RESET"
          ? "Reset your TNL Track password"
          : "Activate your TNL Track account",
      text: `Open ${config.PUBLIC_APP_URL}/portal?${mode}=${raw}\nThis link expires in ${minutes} minutes. If you did not request it, ignore this email.`,
    },
    new Date(),
    null,
    true,
  );
}
router.post(
  "/register",
  rateLimit(),
  validation(
    z.object({
      email,
      password,
      fullName: z.string().trim().min(2).max(160),
      phone: z
        .string()
        .refine(
          (v) => Boolean(normalizePhPhone(v)),
          "Enter a PH mobile number",
        ),
      address: z.string().trim().min(5).max(500),
      marketingOptIn: z.boolean().default(false),
    }),
  ),
  async (req, res, next) => {
    try {
      configured();
      const input = req.body,
        passwordHash = await bcrypt.hash(input.password, 12);
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          "SELECT ca.id FROM customer_accounts ca JOIN customers cu ON cu.id=ca.customer_id WHERE cu.email=?",
          [input.email],
        );
        if (!rows.length)
          await issue(
            c,
            "REGISTER",
            input.email,
            {
              fullName: input.fullName,
              phone: normalizePhPhone(input.phone),
              address: input.address,
              passwordHash,
              marketingOptIn: input.marketingOptIn,
            },
            1440,
          );
      });
      res.status(202).json({ data: generic });
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/invite",
  authenticate,
  authorize("ADMIN", "AGENT"),
  validation(z.object({ customerId: z.number().int().positive() })),
  async (req, res, next) => {
    try {
      configured();
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          `SELECT id,email FROM customers WHERE id=?${req.user!.role === "AGENT" ? " AND assigned_agent_id=?" : ""} FOR UPDATE`,
          req.user!.role === "AGENT"
            ? [req.body.customerId, req.user!.id]
            : [req.body.customerId],
        );
        if (!rows[0]) throw new HttpError(404, "Customer not found");
        if (/@(?:placeholder\.)?tnl\.local$/i.test(rows[0].email))
          throw new HttpError(
            409,
            "Set the customer's real email before inviting them",
          );
        const [accounts] = await c.query<any[]>(
          "SELECT id FROM customer_accounts WHERE customer_id=?",
          [rows[0].id],
        );
        if (!accounts.length)
          await issue(
            c,
            "INVITE",
            rows[0].email,
            { customerId: rows[0].id },
            1440,
          );
      });
      res.status(202).json({ data: generic });
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/verify",
  rateLimit(),
  validation(z.object({ token, password: password.optional() })),
  async (req, res, next) => {
    try {
      const chosenPassword = req.body.password
        ? await bcrypt.hash(req.body.password, 12)
        : null;
      const user = await transaction(async (c) => {
        const [tokens] = await c.query<any[]>(
          "SELECT * FROM customer_auth_tokens WHERE token_hash=? AND purpose IN ('REGISTER','INVITE') AND used_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE",
          [hash(req.body.token)],
        );
        const t = tokens[0];
        if (!t)
          throw new HttpError(400, "Activation link is invalid or expired");
        const payload = jsonValue<any>(t.payload);
        const [contacts] = await c.query<any[]>(
          "SELECT * FROM customers WHERE email=? FOR UPDATE",
          [t.email],
        );
        let customer = contacts[0],
          created = false;
        if (
          t.purpose === "INVITE" &&
          (!customer || customer.id !== payload.customerId)
        )
          throw new HttpError(400, "Invitation no longer matches this contact");
        if (!customer) {
          const [r] = await c.execute<any>(
            "INSERT INTO customers(full_name,email,phone,address,marketing_opt_in,marketing_opted_at) VALUES(?,?,?,?,?,IF(?,UTC_TIMESTAMP(),NULL))",
            [
              payload.fullName,
              t.email,
              payload.phone,
              payload.address,
              payload.marketingOptIn,
              payload.marketingOptIn,
            ],
          );
          customer = {
            id: r.insertId,
            full_name: payload.fullName,
            email: t.email,
          };
          created = true;
        }
        const [accounts] = await c.query<any[]>(
          "SELECT id FROM customer_accounts WHERE customer_id=?",
          [customer.id],
        );
        if (accounts.length)
          throw new HttpError(
            409,
            "Account already activated; sign in or reset your password",
          );
        const passwordHash =
          t.purpose === "REGISTER" ? payload.passwordHash : chosenPassword;
        if (!passwordHash)
          throw new HttpError(
            400,
            "Choose a password to activate this invitation",
          );
        const [r] = await c.execute<any>(
          "INSERT INTO customer_accounts(customer_id,password_hash) VALUES(?,?)",
          [customer.id, passwordHash],
        );
        if (!created && payload.marketingOptIn)
          await c.execute(
            "UPDATE customers SET marketing_opt_in=TRUE,marketing_opted_at=UTC_TIMESTAMP() WHERE id=?",
            [customer.id],
          );
        await c.execute(
          "UPDATE customer_auth_tokens SET used_at=UTC_TIMESTAMP() WHERE id=?",
          [t.id],
        );
        if (created) await welcome(c, customer.id);
        return {
          id: Number(r.insertId),
          customerId: Number(customer.id),
          email: customer.email,
          fullName: customer.full_name,
          role: "CUSTOMER" as const,
          tokenVersion: 0,
        };
      });
      res.json({ data: { token: signCustomer(user), user } });
    } catch (e: any) {
      next(
        e.code === "ER_DUP_ENTRY"
          ? new HttpError(
              409,
              "Account is already being activated. Sign in or request a new link.",
            )
          : e,
      );
    }
  },
);
router.post(
  "/login",
  rateLimit(),
  validation(z.object({ email, password })),
  async (req, res, next) => {
    try {
      const [rows] = await db.query<any[]>(
        "SELECT ca.id,ca.customer_id customerId,ca.password_hash,ca.token_version tokenVersion,c.email,c.full_name fullName FROM customer_accounts ca JOIN customers c ON c.id=ca.customer_id WHERE c.email=? AND ca.active=TRUE AND ca.verified_at IS NOT NULL",
        [req.body.email],
      );
      const row = rows[0];
      const valid = await bcrypt.compare(
        req.body.password,
        row?.password_hash ??
          "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
      );
      if (!row || !valid) throw new HttpError(401, "Invalid email or password");
      const { password_hash, ...identity } = row;
      const user = { ...identity, role: "CUSTOMER" as const };
      res.json({ data: { token: signCustomer(user), user } });
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/forgot-password",
  rateLimit(),
  validation(z.object({ email })),
  async (req, res, next) => {
    try {
      configured();
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          "SELECT ca.id FROM customer_accounts ca JOIN customers c ON c.id=ca.customer_id WHERE c.email=? AND ca.active=TRUE",
          [req.body.email],
        );
        if (rows.length)
          await issue(
            c,
            "RESET",
            req.body.email,
            { accountId: rows[0].id },
            30,
          );
      });
      res.status(202).json({ data: generic });
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/reset-password",
  rateLimit(),
  validation(z.object({ token, password })),
  async (req, res, next) => {
    try {
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          "SELECT * FROM customer_auth_tokens WHERE token_hash=? AND purpose='RESET' AND used_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE",
          [hash(req.body.token)],
        );
        if (!rows[0])
          throw new HttpError(400, "Reset link is invalid or expired");
        const payload = jsonValue<any>(rows[0].payload);
        await c.execute(
          "UPDATE customer_accounts SET password_hash=?,token_version=token_version+1 WHERE id=? AND active=TRUE",
          [passwordHash, payload.accountId],
        );
        await c.execute(
          "UPDATE customer_auth_tokens SET used_at=UTC_TIMESTAMP() WHERE email=? AND purpose='RESET' AND used_at IS NULL",
          [rows[0].email],
        );
      });
      res.json({ data: { message: "Password reset. Sign in again." } });
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/unsubscribe",
  rateLimit(60),
  validation(z.object({ token })),
  async (req, res, next) => {
    try {
      await db.execute(
        "UPDATE customers SET marketing_opt_in=FALSE WHERE unsubscribe_token=?",
        [req.body.token],
      );
      res.json({ data: { message: "Marketing emails have been disabled." } });
    } catch (e) {
      next(e);
    }
  },
);
export default router;
