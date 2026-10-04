import bcrypt from "bcryptjs";
import { transaction } from "./transaction.js";
import { HttpError } from "./http.js";
import { event } from "../features/automations/events.js";
import { stopEmployeeLocations } from "../features/delivery/service.js";

export async function resetAccountPassword(
  kind: "AGENT" | "DELIVERY" | "CUSTOMER",
  id: number,
  password: string,
  adminId: number,
) {
  return transaction(async (c) => {
    const [rows] = await c.query<any[]>(
      kind !== "CUSTOMER"
        ? "SELECT id,password_hash FROM users WHERE id=? AND role=? AND active=TRUE FOR UPDATE"
        : "SELECT id,password_hash FROM customer_accounts WHERE customer_id=? AND active=TRUE AND verified_at IS NOT NULL FOR UPDATE",
      kind !== "CUSTOMER" ? [id, kind] : [id],
    );
    const account = rows[0];
    if (!account) {
      const [targets] = await c.query<any[]>(
        kind !== "CUSTOMER"
          ? "SELECT id FROM users WHERE id=? AND role=?"
          : "SELECT id FROM customers WHERE id=?",
        kind !== "CUSTOMER" ? [id, kind] : [id],
      );
      if (!targets.length)
        throw new HttpError(
          404,
          kind === "DELIVERY" ? "Delivery employee not found" : kind === "AGENT" ? "Agent not found" : "Customer not found",
        );
      throw new HttpError(
        409,
        kind !== "CUSTOMER"
          ? `Activate the ${kind === "DELIVERY" ? "delivery employee" : "agent"} before resetting their password`
          : "This customer has no active verified portal account. Invite them to the portal first.",
      );
    }
    if (await bcrypt.compare(password, account.password_hash))
      throw new HttpError(400, "Choose a different new password");
    const hash = await bcrypt.hash(password, 12);
    await c.execute(
      kind !== "CUSTOMER"
        ? "UPDATE users SET password_hash=?,token_version=token_version+1 WHERE id=?"
        : "UPDATE customer_accounts SET password_hash=?,token_version=token_version+1 WHERE id=?",
      [hash, account.id],
    );
    if (kind === "CUSTOMER")
      await c.execute(
        "UPDATE customer_auth_tokens SET used_at=UTC_TIMESTAMP() WHERE purpose='RESET' AND used_at IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.accountId'))=?",
        [String(account.id)],
      );
    if (kind === "DELIVERY") await stopEmployeeLocations(c, id);
    // Audit contains the actor and target only; credentials never enter events.
    await event(
      c,
      "account.password_reset",
      kind !== "CUSTOMER" ? "USER" : "CUSTOMER",
      id,
      { role: kind },
      adminId,
    );
    return { id, reset: true };
  });
}
