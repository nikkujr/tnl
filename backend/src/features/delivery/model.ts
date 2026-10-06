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
