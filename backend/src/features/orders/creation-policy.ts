import type { RequestHandler } from "express";
import { HttpError } from "../../shared/http.js";

export function assertAgentPackageSelections(
  role: "ADMIN" | "AGENT" | "DELIVERY" | undefined,
  items: ReadonlyArray<{ productId: number }>,
): void {
  if (role === "DELIVERY") throw new HttpError(403, "Delivery employees cannot create orders");
  if (role === "AGENT" && items.length > 0) {
    throw new HttpError(403, "Agents can only add packages to orders.");
  }
}

// Run after orderBody validation, so defaulted selections are present.
export const enforceAgentPackageCreation: RequestHandler = (req, _res, next) => {
  try {
    assertAgentPackageSelections(req.user?.role, req.body.items);
    next();
  } catch (error) {
    next(error);
  }
};
