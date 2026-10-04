import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DELIVERY_PHOTO_DIR: z.string().min(1).default("./private-delivery-photos"),
  DELIVERY_PHOTO_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  CORS_ORIGINS: z.string().default("http://localhost:4200"),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  JWT_SECRET: z.string().min(32),
  GEOAPIFY_API_KEY: z.string().trim().default(""),
  JWT_EXPIRES_IN: z.string().default("8h"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  PUBLIC_APP_URL: z.url().default("http://localhost:4200"),
  WORKER_POLL_MS: z.coerce.number().int().min(1000).default(5000),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error(
    "Invalid environment configuration",
    result.error.flatten().fieldErrors,
  );
  throw new Error("Invalid environment configuration");
}

export const config = {
  ...result.data,
  corsOrigins: result.data.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
