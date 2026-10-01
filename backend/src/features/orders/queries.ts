export function saleTotalSql(alias: string) {
  return `(COALESCE((SELECT SUM(oi.quantity*oi.unit_price) FROM order_items oi WHERE oi.order_id=${alias}.id),0)+COALESCE((SELECT SUM(op.quantity*op.selling_price) FROM order_packages op WHERE op.order_id=${alias}.id),0))`;
}
export const deliveryStages = [
  "PREPARING",
  "DISPATCHED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;
export function deliveryTransition(
  current: string | null,
  next: string,
): "CHANGE" | "NOOP" | "INVALID" {
  const previous = deliveryStages.indexOf(current as any),
    target = deliveryStages.indexOf(next as any);
  if (target < 0 || previous < 0 || target < previous) return "INVALID";
  return target === previous ? "NOOP" : "CHANGE";
}
