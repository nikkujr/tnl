import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { HttpError } from "./http.js";

export type Role = "ADMIN" | "AGENT";
export interface SessionUser { id: number; email: string; fullName: string; role: Role }

declare global {
  namespace Express { interface Request { user?: SessionUser } }
}

export const signToken = (user: SessionUser) =>
  jwt.sign(user, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as NonNullable<jwt.SignOptions["expiresIn"]>
  });

export const authenticate: RequestHandler = (req, _res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return next(new HttpError(401, "Authentication required"));
  try {
    req.user = jwt.verify(token, config.JWT_SECRET) as SessionUser;
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
};

export const authorize = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, "Insufficient permission"));
  next();
};
