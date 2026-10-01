import { z } from "zod";
const quantity = z.number().int().positive().max(10000);
export const selection = z
  .object({
    items: z
      .array(
        z.object({ productId: z.number().int().positive(), quantity }).strict(),
      )
      .max(50)
      .default([]),
    packages: z
      .array(
        z.object({ packageId: z.number().int().positive(), quantity }).strict(),
      )
      .max(50)
      .default([]),
  })
  .refine(
    (v) => v.items.length + v.packages.length > 0,
    "Select at least one product or package",
  )
  .refine(
    (v) =>
      new Set(v.items.map((i) => i.productId)).size === v.items.length &&
      new Set(v.packages.map((p) => p.packageId)).size === v.packages.length,
    "Each selection must appear once",
  );
export const paymentMethod = z.enum([
  "Cash",
  "Cash on delivery",
  "Bank transfer",
  "Card",
]);
export const orderBody = selection.safeExtend({
  customerId: z.number().int().positive(),
  agentId: z.number().int().positive().optional(),
  deliveryAddress: z.string().trim().min(5).max(500),
  paymentMethod,
  cashReceived: z.number().min(0).max(9999999999).nullable().optional(),
});
export const idParams = z.object({ id: z.coerce.number().int().positive() });
