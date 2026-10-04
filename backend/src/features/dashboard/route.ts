import { Router } from "express";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { saleTotalSql } from "../orders/queries.js";

const router = Router();
router.get("/", authenticate, authorize("ADMIN", "AGENT"), async (req, res, next) => {
  try {
    const agentFilter = req.user!.role === "AGENT" ? " WHERE agent_id=?" : "";
    const args = req.user!.role === "AGENT" ? [req.user!.id] : [];
    const [orderRows] = await db.query<any[]>(
      `SELECT COUNT(*) totalOrders,
      SUM(order_status='PENDING') pendingOrders,SUM(order_status='COMPLETED') completedOrders,
      SUM(order_status IN ('PENDING','APPROVED')) openOrders,
      SUM(order_status='APPROVED' AND delivery_status IS NOT NULL AND delivery_status<>'DELIVERED') activeDeliveries,
      COALESCE(SUM(CASE WHEN payment_status='PAID' THEN
        ${saleTotalSql("orders")}
        ELSE 0 END),0) revenue
      FROM orders${agentFilter}`,
      args,
    );
    const customerFilter =
      req.user!.role === "AGENT" ? " WHERE assigned_agent_id=?" : "";
    const [customerRows] = await db.query<any[]>(
      `SELECT COUNT(*) totalCustomers FROM customers${customerFilter}`,
      args,
    );
    const [productRows] = await db.query<any[]>(
      "SELECT COUNT(*) totalProducts,SUM(stock_on_hand-stock_reserved<=low_stock_threshold) lowStockProducts FROM products WHERE active=TRUE",
    );
    const monthlyFilter = req.user!.role === "AGENT" ? " AND o.agent_id=?" : "";
    const [monthlyRows] = await db.query<any[]>(
      `SELECT DATE_FORMAT(o.created_at,'%Y-%m') month,
      COALESCE(SUM(${saleTotalSql("o")}),0) revenue
      FROM orders o
      WHERE o.payment_status='PAID'
        AND o.created_at>=DATE_FORMAT(DATE_SUB(CURRENT_DATE,INTERVAL 5 MONTH),'%Y-%m-01')
        ${monthlyFilter}
      GROUP BY DATE_FORMAT(o.created_at,'%Y-%m')
      ORDER BY month`,
      args,
    );
    const activityScope = req.user!.role === "AGENT" ? " AND agent_id=?" : "";
    const customerActivityScope =
      req.user!.role === "AGENT" ? " AND assigned_agent_id=?" : "";
    const activityArgs =
      req.user!.role === "AGENT" ? [req.user!.id, req.user!.id] : [];
    const [activityRows] = await db.query<any[]>(
      "SELECT CAST(id AS CHAR) id,type,title,message,link,read_at readAt,created_at createdAt FROM staff_notifications WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
      [req.user!.id],
    );
    const totals = { ...orderRows[0], ...customerRows[0], ...productRows[0] };
    res.json({
      data: {
        totalOrders: Number(totals.totalOrders ?? 0),
        pendingOrders: Number(totals.pendingOrders ?? 0),
        completedOrders: Number(totals.completedOrders ?? 0),
        openOrders: Number(totals.openOrders ?? 0),
        activeDeliveries: Number(totals.activeDeliveries ?? 0),
        revenue: Number(totals.revenue ?? 0),
        totalCustomers: Number(totals.totalCustomers ?? 0),
        totalProducts: Number(totals.totalProducts ?? 0),
        lowStockProducts: Number(totals.lowStockProducts ?? 0),
        monthlyRevenue: monthlyRows.map((row) => ({
          month: row.month,
          revenue: Number(row.revenue),
        })),
        notifications: activityRows,
      },
    });
  } catch (error) {
    next(error);
  }
});
export default router;
