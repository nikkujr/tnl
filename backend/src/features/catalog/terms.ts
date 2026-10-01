import { createHash } from "node:crypto";
/** Opaque revision proves the customer reviewed the current commercial terms. */
export function termsRevision(
  kind: string,
  id: number,
  name: string,
  price: number,
  components: any[] = [],
  commissionType?: string,
  commissionValue?: number,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        kind,
        id,
        name,
        Number(price),
        components
          .map((c) => [c.productId, c.productName, c.sku, c.quantity])
          .sort((a, b) => Number(a[0]) - Number(b[0])),
        commissionType ?? null,
        commissionValue ?? null,
      ]),
    )
    .digest("hex");
}
