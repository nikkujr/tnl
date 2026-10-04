import type { PoolConnection } from "mysql2/promise";
import { saleTotalSql } from "../orders/queries.js";
import {
  reportBounds,
  reportSaleSql,
  saleDateSql,
  type ReportQuery,
} from "./model.js";

export async function getReport(c: PoolConnection, query: ReportQuery) {
  const bounds = reportBounds(query);
  const args = bounds ? [bounds.start, bounds.end] : [];
  const range = (date: string) =>
    bounds ? ` AND ${date}>=? AND ${date}<?` : "";
  const eligible = `SELECT o.*,${saleTotalSql("o")} saleTotal,${saleDateSql} reportDate
    FROM orders o WHERE ${reportSaleSql}${range(saleDateSql)}`;
  const [totals] = await c.query<any[]>(
    `WITH sales AS (${eligible})
    SELECT COUNT(*) completedSales,COALESCE(SUM(saleTotal),0) revenue,
    COALESCE(AVG(saleTotal),0) averageSale,COUNT(DISTINCT customer_id) buyingCustomers,
    COALESCE(SUM(sale_completed_at IS NULL),0) historicalDateSales FROM sales`,
    args,
  );
  const bucket =
    query.period === "daily"
      ? "%Y-%m-%d %H:00"
      : query.period === "monthly"
        ? "%Y-%m-%d"
        : "%Y-%m";
  const [trend] = await c.query<any[]>(
    `WITH sales AS (${eligible})
    SELECT DATE_FORMAT(DATE_ADD(reportDate,INTERVAL 8 HOUR),'${bucket}') label,
    SUM(saleTotal) revenue,COUNT(*) orders FROM sales GROUP BY label ORDER BY label`,
    args,
  );
  // Expand saved package components, never the current package catalog.
  const [products] = await c.query<any[]>(
    `WITH sales AS (${eligible}), units AS (
    SELECT oi.product_id productId,oi.quantity,s.reportDate FROM order_items oi JOIN sales s ON s.id=oi.order_id
    UNION ALL
    SELECT part.productId,part.quantity*op.quantity,s.reportDate
    FROM order_packages op JOIN sales s ON s.id=op.order_id
    JOIN JSON_TABLE(op.components,'$[*]' COLUMNS(productId BIGINT PATH '$.productId',quantity INT PATH '$.quantity')) part ON TRUE
  ), movement AS (SELECT productId,SUM(quantity) unitsSold,MAX(reportDate) lastSoldAt FROM units GROUP BY productId)
    SELECT p.id,p.name,p.sku,p.active,p.stock_on_hand stockOnHand,p.stock_reserved stockReserved,
      p.stock_on_hand-p.stock_reserved available,p.low_stock_threshold lowStockThreshold,
      COALESCE(m.unitsSold,0) unitsSold,DATE_FORMAT(DATE_ADD(m.lastSoldAt,INTERVAL 8 HOUR),'%Y-%m-%d') lastSoldDate
    FROM products p LEFT JOIN movement m ON m.productId=p.id
    WHERE p.active=TRUE OR m.unitsSold>0`,
    args,
  );
  const fastProducts = products
    .filter((p) => Number(p.unitsSold) > 0)
    .sort(
      (a, b) =>
        Number(b.unitsSold) - Number(a.unitsSold) ||
        Number(a.id) - Number(b.id),
    )
    .slice(0, 10);
  const slowProducts = products
    .filter((p) => p.active && Number(p.stockOnHand) > 0)
    .sort(
      (a, b) =>
        Number(a.unitsSold) - Number(b.unitsSold) ||
        Number(b.stockOnHand) - Number(a.stockOnHand) ||
        Number(a.id) - Number(b.id),
    )
    .slice(0, 10);
  const stockAlerts = products
    .filter(
      (p) => p.active && Number(p.available) <= Number(p.lowStockThreshold),
    )
    .sort(
      (a, b) =>
        Number(a.available) - Number(b.available) ||
        Number(a.id) - Number(b.id),
    );
  const [customers] = await c.query<any[]>(
    `WITH sales AS (${eligible})
    SELECT cu.id,cu.full_name name,SUM(s.saleTotal) revenue,COUNT(*) orders
    FROM sales s JOIN customers cu ON cu.id=s.customer_id GROUP BY cu.id,cu.full_name
    ORDER BY revenue DESC,cu.id LIMIT 10`,
    args,
  );
  const [packages] = await c.query<any[]>(
    `WITH sales AS (${eligible})
    SELECT op.package_id id,MAX(op.name) name,SUM(op.quantity) unitsSold,
    SUM(op.quantity*op.selling_price) revenue FROM order_packages op JOIN sales s ON s.id=op.order_id
    GROUP BY op.package_id ORDER BY revenue DESC,op.package_id LIMIT 10`,
    args,
  );
  // Open/unpaid orders use their intake date rather than financial completion.
  const [statuses] = await c.query<any[]>(
    `SELECT o.order_status status,COUNT(*) orders,
    COALESCE(SUM(${saleTotalSql("o")}),0) value FROM orders o WHERE TRUE${range("o.created_at")}
    GROUP BY o.order_status ORDER BY o.order_status`,
    args,
  );
  const [payments] = await c.query<any[]>(
    `SELECT o.payment_status status,COUNT(*) orders,
    COALESCE(SUM(${saleTotalSql("o")}),0) value FROM orders o
    WHERE o.order_status NOT IN ('CANCELLED','REJECTED')${range("o.created_at")}
    GROUP BY o.payment_status ORDER BY o.payment_status`,
    args,
  );
  return {
    period: query.period,
    selection:
      query.period === "daily"
        ? query.date
        : query.period === "monthly"
          ? query.month
          : "All time",
    timeZone: "Asia/Manila",
    totals: totals[0],
    trend,
    fastProducts,
    slowProducts,
    customers,
    packages,
    statuses,
    payments,
    stockAlerts,
    stock: {
      activeProducts: products.filter((p) => p.active).length,
      lowStockProducts: stockAlerts.length,
      availableUnits: products
        .filter((p) => p.active)
        .reduce((sum, p) => sum + Number(p.available), 0),
    },
  };
}
