import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config.js";
import { db } from "../../database/connection.js";
import { HttpError } from "../../shared/http.js";
export interface CustomerSession {
  id: number;
  customerId: number;
  fullName: string;
  email: string;
  role: "CUSTOMER";
  tokenVersion: number;
}
declare global {
  namespace Express {
    interface Request {
      customer?: CustomerSession;
    }
  }
}
export const signCustomer = (user: CustomerSession) =>
  jwt.sign(user, config.JWT_SECRET, { audience: "customer", expiresIn: "8h" });
export const authenticateCustomer: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Customer login required");
    const claims = jwt.verify(token, config.JWT_SECRET, {
      audience: "customer",
      algorithms: ["HS256"],
    }) as CustomerSession;
    if (claims.role !== "CUSTOMER")
      throw new HttpError(403, "Customer access required");
    const [rows] = await db.query<any[]>(
      "SELECT ca.id,ca.customer_id customerId,ca.token_version tokenVersion,c.full_name fullName,c.email FROM customer_accounts ca JOIN customers c ON c.id=ca.customer_id WHERE ca.id=? AND ca.active=TRUE AND ca.verified_at IS NOT NULL",
      [claims.id],
    );
    const row = rows[0];
    if (!row || row.tokenVersion !== claims.tokenVersion)
      throw new HttpError(401, "Customer session expired");
    req.customer = { ...row, role: "CUSTOMER" };
    next();
  } catch (e) {
    next(
      e instanceof HttpError
        ? e
        : new HttpError(401, "Invalid or expired customer session"),
    );
  }
};
