import { z } from "zod";
import { deliveryStages } from "../orders/queries.js";
export const fence = z.object({
  assignmentVersion: z.number().int().nonnegative(),
  attemptId: z.uuid().optional(),
});
export const estimatedDeliveryAt = z.iso.datetime({ offset: true });
export const completionFields = {
  recipientName: z.string().trim().min(2).max(160).optional(),
  photoId: z.uuid().optional(),
  exceptionReason: z.string().trim().min(5).max(500).optional(),
};
export const statusBody = fence
  .extend({
    deliveryStatus: z.enum(deliveryStages),
    notes: z.string().trim().max(500).optional(),
    estimatedDeliveryAt: estimatedDeliveryAt.optional(),
    ...completionFields,
  })
  .strict();
export const positionBody = fence
  .extend({
    sessionId: z.uuid(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().max(100000),
    observedAt: z.iso.datetime(),
  })
  .strict();
export function positionState(
  observed: Date | string,
  received: Date | string,
  now = Date.now(),
) {
  const age = Math.max(
    now - new Date(observed).getTime(),
    now - new Date(received).getTime(),
  );
  return age > 600000 ? "UNAVAILABLE" : age > 60000 ? "STALE" : "LIVE";
}
export function deliverySla(
  dueAt: Date | string | null,
  completedAt: Date | string | null,
  delivered: boolean,
  now = Date.now(),
) {
  const due = dueAt ? new Date(dueAt).getTime() : NaN;
  const completed = completedAt ? new Date(completedAt).getTime() : NaN;
  if (!Number.isFinite(due) || (delivered && !Number.isFinite(completed)))
    return { state: "NOT_SET" as const, dueAt, minutes: null };
  const difference = (delivered ? completed : now) - due;
  return {
    state: delivered ? (difference > 0 ? "BREACHED" as const : "MET" as const)
      : (difference > 0 ? "OVERDUE" as const : "ON_TRACK" as const),
    dueAt,
    minutes: Math.ceil(Math.abs(difference) / 60000),
  };
}

export const deliveryRegions = { BICOL: [1, 3], LUZON: [2, 5], VISAYAS: [4, 7], MINDANAO: [5, 8] } as const;
export const slaColumns = `o.sla_policy_version,o.delivery_region,o.delivery_remote_days,o.prepared_at,o.dispatched_at,
 o.delivery_sla_from_at,o.delivery_sla_due_at,o.created_at,o.approved_at,o.order_status,o.origin`;

// Business dates end at 11:59:59 PM in Manila; weekends do not count.
export function businessDeadline(start: Date | string, days: number) {
  const local = new Date(new Date(start).getTime() + 8 * 3600000);
  while (days > 0) {
    local.setUTCDate(local.getUTCDate() + 1);
    if (local.getUTCDay() !== 0 && local.getUTCDay() !== 6) days--;
  }
  local.setUTCHours(23, 59, 59, 0);
  return new Date(local.getTime() - 8 * 3600000);
}
export function transitWindow(start: Date | string, region: keyof typeof deliveryRegions, remoteDays: number) {
  const [min, max] = deliveryRegions[region];
  return { fromAt: businessDeadline(start, min + remoteDays), dueAt: businessDeadline(start, max + remoteDays) };
}
export function orderSla(o: any, completedAt: Date | string | null, delivered: boolean, now = Date.now()) {
  const base = deliverySla(o.delivery_sla_due_at ?? null, completedAt, delivered, now);
  if (!o.sla_policy_version || o.origin !== 'LIVE' || ['CANCELLED', 'REJECTED'].includes(o.order_status)) return base;
  const region = o.delivery_region as keyof typeof deliveryRegions | null;
  const remoteDays = Number(o.delivery_remote_days ?? 0);
  const stage = (name: string, rule: string, start: Date | string | null, days: number, finished: Date | string | null) => ({
    name, rule, completedAt: finished,
    ...deliverySla(start ? businessDeadline(start, days) : null, finished, delivered || !!finished, now),
  });
  // Preparation overlaps the 1–2 day dispatch window after confirmation.
  const confirmation = o.approved_at ?? businessDeadline(o.created_at, 1);
  const projected = region && !delivered ? {
    fromAt: transitWindow(businessDeadline(confirmation, 1), region, remoteDays).fromAt,
    dueAt: transitWindow(businessDeadline(confirmation, 2), region, remoteDays).dueAt,
  } : null;
  return {
    ...base,
    policy: {
      region, remoteDays, completed: delivered, preparedAt: o.prepared_at, dispatchedAt: o.dispatched_at,
      fromAt: o.delivery_sla_from_at ?? projected?.fromAt ?? null,
      toAt: o.delivery_sla_due_at ?? projected?.dueAt ?? null,
      projected: !o.dispatched_at && !delivered,
      stages: [
        stage('Order processing', 'Confirm within 1 business day', o.created_at, 1, o.approved_at),
        stage('Preparation', 'Prepare within 1 business day after confirmation', o.approved_at, 1, o.prepared_at),
        stage('Dispatch', 'Hand to the courier within 1–2 business days after confirmation', o.approved_at, 2, o.dispatched_at),
        { name: 'Delivery', rule: region ? `${deliveryRegions[region][0]}–${deliveryRegions[region][1]} business days after dispatch${remoteDays ? ` + ${remoteDays} remote-area day(s)` : ''}` : 'Awaiting delivery region', completedAt, ...base },
      ],
    },
  };
}
