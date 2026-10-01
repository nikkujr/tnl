import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { transaction } from "../../shared/transaction.js";
import { packageCatalog } from "./catalog.js";
const router = Router();
router.use(authenticate, authorize("ADMIN", "AGENT"));
router.get("/", async (req, res, next) => {
  try {
    res.json({
      data: await packageCatalog(
        req.user!.role === "AGENT" || req.query.activeOnly === "true",
      ),
    });
  } catch (e) {
    next(e);
  }
});
const money = z
  .number()
  .min(0)
  .max(9999999999)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.0001,
    "Use at most two decimals",
  );
const body = z
  .object({
    name: z.string().trim().min(2).max(180),
    description: z.string().max(10000).default(""),
    sellingPrice: money.refine((n) => n > 0, "Price must be positive"),
    commissionType: z.enum(["FIXED", "PERCENTAGE"]),
    commissionValue: money,
    active: z.boolean().default(true),
    components: z
      .array(
        z
          .object({
            productId: z.number().int().positive(),
            quantity: z.number().int().positive().max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine(
    (v) => v.commissionType !== "PERCENTAGE" || v.commissionValue <= 100,
    "Percentage must be at most 100",
  )
  .refine(
    (v) =>
      new Set(v.components.map((i) => i.productId)).size ===
      v.components.length,
    "Each component must appear once",
  );
const validation = validate(
  z.object({ body, params: z.any(), query: z.any() }),
);
async function save(id: number | null, input: z.infer<typeof body>) {
  return transaction(async (c) => {
    if (id) {
      const [rows] = await c.query<any[]>(
        "SELECT id FROM packages WHERE id=? FOR UPDATE",
        [id],
      );
      if (!rows.length) throw new HttpError(404, "Package not found");
    }
    for (const i of input.components) {
      const [rows] = await c.query<any[]>(
        "SELECT id FROM products WHERE id=? AND active=TRUE",
        [i.productId],
      );
      if (!rows.length)
        throw new HttpError(400, "Package components must be active products");
    }
    if (id)
      await c.execute(
        "UPDATE packages SET name=?,description=?,selling_price=?,commission_type=?,commission_value=?,active=? WHERE id=?",
        [
          input.name,
          input.description,
          input.sellingPrice,
          input.commissionType,
          input.commissionValue,
          input.active,
          id,
        ],
      );
    else {
      const [r] = await c.execute<any>(
        "INSERT INTO packages(name,description,selling_price,commission_type,commission_value,active) VALUES(?,?,?,?,?,?)",
        [
          input.name,
          input.description,
          input.sellingPrice,
          input.commissionType,
          input.commissionValue,
          input.active,
        ],
      );
      id = Number(r.insertId);
    }
    await c.execute("DELETE FROM package_items WHERE package_id=?", [id]);
    for (const i of input.components)
      await c.execute(
        "INSERT INTO package_items(package_id,product_id,quantity) VALUES(?,?,?)",
        [id, i.productId, i.quantity],
      );
    return { id };
  });
}
router.post("/", authorize("ADMIN"), validation, async (req, res, next) => {
  try {
    res.status(201).json({ data: await save(null, req.body) });
  } catch (e: any) {
    next(
      e.code === "ER_DUP_ENTRY"
        ? new HttpError(409, "Package name already exists")
        : e,
    );
  }
});
router.put("/:id", authorize("ADMIN"), validation, async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json({ data: await save(id, req.body) });
  } catch (e: any) {
    next(
      e.code === "ER_DUP_ENTRY"
        ? new HttpError(409, "Package name already exists")
        : e,
    );
  }
});
router.delete("/:id", authorize("ADMIN"), async (req, res, next) => {
  try {
    const [r] = await db.execute<any>(
      "UPDATE packages SET active=FALSE WHERE id=?",
      [Number(req.params.id)],
    );
    if (!r.affectedRows) throw new HttpError(404, "Package not found");
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
export default router;
