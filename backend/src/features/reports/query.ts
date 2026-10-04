import type { PoolConnection } from "mysql2/promise";
import { jsonValue } from "../../shared/transaction.js";
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
  const [movement] = await c.query<any[]>(
    `WITH sales AS (${eligible})
    SELECT oi.product_id productId,SUM(oi.quantity) unitsSold,
      DATE_FORMAT(DATE_ADD(MAX(s.reportDate),INTERVAL 8 HOUR),'%Y-%m-%d') lastSoldDate
    FROM order_items oi JOIN sales s ON s.id=oi.order_id GROUP BY oi.product_id`,
    args,
  );
  const units = new Map<number, { unitsSold: number; lastSoldDate: string }>(
    movement.map(row => [Number(row.productId), { unitsSold: Number(row.unitsSold), lastSoldDate: row.lastSoldDate }]),
  );
  const [snapshots] = await c.query<any[]>(
    `WITH sales AS (${eligible})
    SELECT op.components,op.quantity,DATE_FORMAT(DATE_ADD(s.reportDate,INTERVAL 8 HOUR),'%Y-%m-%d') lastSoldDate
    FROM order_packages op JOIN sales s ON s.id=op.order_id`, args,
  );
  // ponytail: expand saved components in memory for MariaDB 10.4; stream if report volumes outgrow memory.
  for (const snapshot of snapshots) {
    for (const part of jsonValue<{ productId: number; quantity: number }[]>(snapshot.components)) {
      const id = Number(part.productId), current = units.get(id);
      units.set(id, {
        unitsSold: (current?.unitsSold ?? 0) + Number(part.quantity) * Number(snapshot.quantity),
        lastSoldDate: current && current.lastSoldDate > snapshot.lastSoldDate ? current.lastSoldDate : snapshot.lastSoldDate,
      });
    }
  }
  const [catalog] = await c.query<any[]>(
    `SELECT id,name,sku,active,stock_on_hand stockOnHand,stock_reserved stockReserved,
      stock_on_hand-stock_reserved available,low_stock_threshold lowStockThreshold FROM products`,
  );
  const products = catalog.map(p => ({ ...p, unitsSold: 0, lastSoldDate: null, ...units.get(Number(p.id)) }))
    .filter(p => p.active || p.unitsSold > 0);
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
