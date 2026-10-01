import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { HttpError } from "./http.js";
import { db } from "../database/connection.js";

export type Role = "ADMIN" | "AGENT";
export interface SessionUser {
  id: number;
  email: string;
  fullName: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export const signToken = (user: SessionUser) =>
  jwt.sign(user, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as NonNullable<
      jwt.SignOptions["expiresIn"]
    >,
  });

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return next(new HttpError(401, "Authentication required"));
  try {
    const claims = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ["HS256"],
    }) as SessionUser;
    if (claims.role !== "ADMIN" && claims.role !== "AGENT")
      return next(new HttpError(403, "Staff access required"));
    const [rows] = await db.query<any[]>(
      "SELECT id,email,full_name,role FROM users WHERE id=? AND active=TRUE AND role=?",
      [claims.id, claims.role],
    );
    if (!rows[0]) return next(new HttpError(401, "Staff account is inactive"));
    req.user = {
      id: rows[0].id,
      email: rows[0].email,
      fullName: rows[0].full_name,
      role: rows[0].role,
    };
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
};

export const authorize =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return next(new HttpError(403, "Insufficient permission"));
    next();
  };
