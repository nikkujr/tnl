import { z } from "zod";

export const periodSchema = z
  .string()
  .regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/);
export const moneySchema = z
  .number()
  .finite()
  .min(0)
  .max(9999999999.99)
  .multipleOf(0.01);
export const currentPeriod = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);

export function monthBounds(period: string) {
  const valid = periodSchema.parse(period);
  const year = Number(valid.slice(0, 4)),
    month = Number(valid.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - 8 * 3600000),
    end: new Date(Date.UTC(year, month, 1) - 8 * 3600000),
    days: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

// Only live sales with a reliable financial completion timestamp qualify for targets.
export const completedSaleSql = `o.origin='LIVE' AND o.sales_version='PACKAGE'
  AND o.order_status NOT IN ('CANCELLED','REJECTED')
  AND o.delivery_status='DELIVERED' AND o.payment_status='PAID'
  AND o.sale_completed_at>=? AND o.sale_completed_at<?`;
