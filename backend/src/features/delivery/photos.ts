import {
  mkdir,
  writeFile,
  unlink,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { config } from "../../config.js";
import { db } from "../../database/connection.js";
import { transaction } from "../../shared/transaction.js";
import { HttpError } from "../../shared/http.js";
import type { SessionUser } from "../../shared/auth.js";
import { lockOrder, requireAttempt } from "./service.js";
import type { PoolConnection } from "mysql2/promise";
import { photoDirectory, photoPath as filePath } from "./storage.js";
export { photoDirectory } from "./storage.js";
export async function normalizePhoto(input: Buffer) {
  if (input.length > 10 * 1024 * 1024)
    throw new HttpError(413, "Photo must be at most 10 MiB");
  try {
    const image = sharp(input, { limitInputPixels: 40000000 });
    const meta = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) !== 1
    )
      throw new Error("Unsupported image");
    return await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    throw new HttpError(
      400,
      "Choose a valid JPEG, PNG or WebP photo of at most 40 megapixels",
    );
  }
}
export async function stagePhoto(
  order: number,
  user: SessionUser,
  body: any,
  input: Buffer,
) {
  // Deny unrelated orders before decoding their upload; recheck the fence after decoding.
  await transaction(async (c) => {
    const o = await lockOrder(c, order, user, body.assignmentVersion);
    if (user.role === "DELIVERY")
      await requireAttempt(c, o, user, body.attemptId);
  });
  const bytes = await normalizePhoto(input),
    id = randomUUID(),
    key = `${id}.jpg`;
  try {
    await mkdir(photoDirectory, { recursive: true });
    await writeFile(filePath(key), bytes, { flag: "wx" });
  } catch {
    throw new HttpError(
      503,
      "Proof photo storage is unavailable. Restore storage and retry the upload.",
    );
  }
  try {
    return await transaction(async (c) => {
      const o = await lockOrder(c, order, user, body.assignmentVersion);
      if (o.order_status !== "APPROVED" || o.delivery_status === "DELIVERED")
        throw new HttpError(409, "This order cannot accept delivery proof");
      if (user.role === "DELIVERY")
        await requireAttempt(c, o, user, body.attemptId);
      await c.execute(
        "INSERT INTO delivery_photos(id,order_id,uploader_id,assignment_version,storage_key,expires_at,byte_size) VALUES(?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR),?)",
        [id, order, user.id, body.assignmentVersion, key, bytes.length],
      );
      return { id };
    });
  } catch (e) {
    await unlink(filePath(key)).catch(() => {});
    throw e;
  }
}
export async function readProof(
  order: number,
  c: typeof db | PoolConnection = db,
) {
  const [rows] = await c.query<any[]>(
    "SELECT p.* FROM delivery_completions d JOIN delivery_photos p ON p.id=d.photo_id WHERE d.order_id=?",
    [order],
  );
  const p = rows[0];
  if (!p) throw new HttpError(404, "No proof photo was recorded");
  if (p.state !== "COMMITTED" || new Date(p.expires_at).getTime() <= Date.now())
    throw new HttpError(410, "Proof photo expired");
  try {
    return await readFile(filePath(p.storage_key));
  } catch {
    throw new HttpError(
      503,
      "Proof photo storage is unavailable. Contact admin.",
    );
  }
}
export async function cleanupPhotos() {
  const c = await db.getConnection();
  const lock =
    "delivery-photos:" +
    createHash("sha256").update(config.DB_NAME).digest("hex").slice(0, 32);
  try {
    const [locks] = await c.query<any[]>("SELECT GET_LOCK(?,0) acquired", [
      lock,
    ]);
    if (!Number(locks[0]?.acquired)) return;
    const [rows] = await c.query<any[]>(
      "SELECT id,storage_key FROM delivery_photos WHERE state<>'PURGED' AND expires_at<=UTC_TIMESTAMP() ORDER BY expires_at LIMIT 100",
    );
    for (const p of rows) {
      // Completion can extend a staged photo's expiry after the candidate scan.
      // Lock and recheck before deleting its file, using the same row lock as completion.
      await c.beginTransaction();
      try {
        const [expired] = await c.query<any[]>(
          "SELECT storage_key FROM delivery_photos WHERE id=? AND state<>'PURGED' AND expires_at<=UTC_TIMESTAMP() FOR UPDATE",
          [p.id],
        );
        if (expired.length) {
          await unlink(filePath(expired[0].storage_key)).catch((e: any) => {
            if (e.code !== "ENOENT") throw e;
          });
          await c.execute(
            "UPDATE delivery_photos SET state='PURGED' WHERE id=?",
            [p.id],
          );
        }
        await c.commit();
      } catch (e) {
        await c.rollback();
        throw e;
      }
    }
    const entries = await readdir(photoDirectory, {
      withFileTypes: true,
    }).catch((e: any) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.jpg$/.test(entry.name)) continue;
      const age = Date.now() - (await stat(filePath(entry.name))).mtimeMs;
      if (age < 86400000) continue;
      const [known] = await c.query<any[]>(
        "SELECT id FROM delivery_photos WHERE storage_key=?",
        [entry.name],
      );
      if (!known.length) await unlink(filePath(entry.name));
    }
  } finally {
    await c.query("SELECT RELEASE_LOCK(?)", [lock]).catch(() => {});
    c.release();
  }
}
