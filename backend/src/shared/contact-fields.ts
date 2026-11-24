import { z } from "zod";

export const namePartsSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  middleName: z.string().trim().max(38).default(""),
  lastName: z.string().trim().min(1).max(60),
});
export const addressPartsSchema = z.object({
  street: z.string().trim().min(1).max(180),
  barangay: z.string().trim().max(90).default(""),
  city: z.string().trim().min(1).max(90),
  province: z.string().trim().min(1).max(90),
  postalCode: z.string().trim().max(10).default(""),
});

export type NameParts = z.infer<typeof namePartsSchema>;
export type AddressParts = z.infer<typeof addressPartsSchema>;

export function formatName(parts: NameParts) {
  return [parts.firstName, parts.middleName, parts.lastName].filter(Boolean).join(" ");
}

export function formatAddress(parts: AddressParts) {
  return [parts.street, parts.barangay, parts.city, parts.province, parts.postalCode].filter(Boolean).join(", ");
}

export function storedParts(value: unknown) {
  return value == null ? null : typeof value === "string" ? value : JSON.stringify(value);
}
