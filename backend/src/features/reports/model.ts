import { z } from "zod";
import { monthBounds, periodSchema } from "../performance/model.js";

export const reportDateSchema = z
  .string()
  .regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Choose a valid calendar date");
export const reportQuerySchema = z.discriminatedUnion("period", [
  z.object({ period: z.literal("daily"), date: reportDateSchema }),
  z.object({ period: z.literal("monthly"), month: periodSchema }),
  z.object({ period: z.literal("overall") }),
]);
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export function reportBounds(query: ReportQuery) {
  if (query.period === "overall") return null;
  if (query.period === "monthly") return monthBounds(query.month);
  const start = new Date(
    new Date(`${query.date}T00:00:00Z`).getTime() - 8 * 3600000,
  );
  return { start, end: new Date(start.getTime() + 86400000) };
}

// Legacy/imported orders have no financial completion timestamp. Use their
// recorded order date and disclose that fallback in the report.
export const saleDateSql = "COALESCE(o.sale_completed_at,o.created_at)";
export const reportSaleSql = `o.order_status NOT IN ('CANCELLED','REJECTED')
  AND o.payment_status='PAID' AND (o.delivery_status='DELIVERED' OR o.order_status='COMPLETED')`;
