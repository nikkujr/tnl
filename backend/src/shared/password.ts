import { z } from "zod";

// bcrypt uses only the first 72 bytes, including multi-byte characters.
export const newPassword = z
  .string()
  .min(8)
  .max(72)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must fit within 72 UTF-8 bytes",
  );
