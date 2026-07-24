import { Router } from "express";
import { db } from "../../database/connection.js";
import { authenticate } from "../../shared/auth.js";

const router = Router();
router.get("/", authenticate, async (req, res, next) => {
  try {
    const search = `%${String(req.query.search ?? "")}%`;
    const from = String(req.query.from ?? "1900-01-01");
    const to = String(req.query.to ?? "2999-12-31");
    const scope = req.user!.role === "AGENT" ? " AND c.agent_id=?" : "";
    const args: unknown[] = [search, search, from, to];
    if (req.user!.role === "AGENT") args.push(req.user!.id);
    const [rows] = await db.query(`SELECT c.id,c.amount,c.rate,c.created_at createdAt,o.tracking_number orderId,
      cu.full_name customerName,u.full_name agentName FROM commissions c JOIN orders o ON o.id=c.order_id
      JOIN customers cu ON cu.id=o.customer_id JOIN users u ON u.id=c.agent_id
      WHERE (o.tracking_number LIKE ? OR cu.full_name LIKE ?) AND DATE(c.created_at) BETWEEN ? AND ?${scope}
      ORDER BY c.created_at DESC`, args);
    const total = (rows as any[]).reduce((sum, item) => sum + Number(item.amount), 0);
    res.json({ data: rows, meta: { totalCommission: total } });
  } catch (error) { next(error); }
});
export default router;
