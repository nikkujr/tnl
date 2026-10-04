import { resolve, join, isAbsolute } from "node:path";
import { config } from "../../config.js";
if (config.NODE_ENV === "production" && !isAbsolute(config.DELIVERY_PHOTO_DIR))
  throw new Error(
    "Production DELIVERY_PHOTO_DIR must name an absolute private persistent volume",
  );
export const photoDirectory = resolve(config.DELIVERY_PHOTO_DIR);
export function photoPath(key: string) {
  if (!/^[a-f0-9-]{36}\.jpg$/.test(key))
    throw new Error("Invalid private photo storage key");
  return join(photoDirectory, key);
}
