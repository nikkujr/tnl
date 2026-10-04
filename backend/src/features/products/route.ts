import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { stockEpisode } from "../automations/stock.js";
import { transaction } from "../../shared/transaction.js";
import { HttpError, validate } from "../../shared/http.js";

const router = Router();
router.use(authenticate, authorize("ADMIN", "AGENT"));

router.get("/", async (req, res, next) => {
  try {
    const search = `%${String(req.query.search ?? "")}%`;
    const categoryId = Number(req.query.categoryId ?? 0);
    const minPrice = Number(req.query.minPrice ?? 0);
    const maxPrice = Number(req.query.maxPrice ?? Number.MAX_SAFE_INTEGER);
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const offset = (page - 1) * limit;
    const categoryFilter = categoryId > 0 ? " AND p.category_id=?" : "";
    const args: unknown[] = [search, search, search, minPrice, maxPrice];
    if (categoryId > 0) args.push(categoryId);
    const [rows] = await db.query(
      `SELECT p.id,p.category_id categoryId,p.name,p.sku,p.price,p.description,p.stock_on_hand stockOnHand,
       p.stock_reserved stockReserved,p.low_stock_threshold lowStockThreshold,p.reorder_level reorderLevel,
       c.name category FROM products p JOIN categories c ON c.id=p.category_id
       WHERE p.active=TRUE AND (p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ?) AND p.price BETWEEN ? AND ?${categoryFilter}
       ORDER BY p.name LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );
    const [counts] = await db.query<any[]>(
      `SELECT COUNT(*) total FROM products p JOIN categories c ON c.id=p.category_id
       WHERE p.active=TRUE AND (p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ?) AND p.price BETWEEN ? AND ?${categoryFilter}`,
      args,
    );
    res.json({ data: rows, meta: { page, limit, total: counts[0].total } });
  } catch (error) {
    next(error);
  }
});

const productBody = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().trim().min(2).max(180),
  sku: z.string().trim().min(2).max(60),
  price: z
    .number()
    .positive()
    .max(9999999999)
    .refine(
      (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.0001,
      "Use at most two decimals",
    ),
  description: z.string().trim().max(5000).nullable().optional(),
});
const productSchema = z.object({
  body: productBody,
  query: z.any(),
  params: z.any(),
});

router.post(
  "/",
  authorize("ADMIN"),
  validate(productSchema),
  async (req, res, next) => {
    try {
      const [result] = await db.execute<any>(
        "INSERT INTO products(category_id,name,sku,price,description) VALUES(?,?,?,?,?)",
        [
          req.body.categoryId,
          req.body.name,
          req.body.sku,
          req.body.price,
          req.body.description ?? null,
        ],
      );
      res
        .status(201)
        .json({
          data: {
            id: result.insertId,
            ...req.body,
            stockOnHand: 0,
            stockReserved: 0,
          },
        });
    } catch (error: any) {
      if (error?.code === "ER_DUP_ENTRY")
        return next(new HttpError(409, "Product SKU already exists"));
      next(error);
    }
  },
);

const updateSchema = z.object({
  body: productBody,
  query: z.any(),
  params: z.object({ id: z.coerce.number().int().positive() }),
});
router.put(
  "/:id",
  authorize("ADMIN"),
  validate(updateSchema),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const [result] = await db.execute<any>(
        "UPDATE products SET category_id=?,name=?,sku=?,price=?,description=? WHERE id=? AND active=TRUE",
        [
          req.body.categoryId,
          req.body.name,
          req.body.sku,
          req.body.price,
          req.body.description ?? null,
          id,
        ],
      );
      if (!result.affectedRows) throw new HttpError(404, "Product not found");
      res.json({ data: { id, ...req.body } });
    } catch (error: any) {
      if (error?.code === "ER_DUP_ENTRY")
        return next(new HttpError(409, "Product SKU already exists"));
      next(error);
    }
  },
);

router.delete("/:id", authorize("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [orders] = await db.query<any[]>(
      `SELECT COUNT(DISTINCT o.id) pendingCount FROM orders o
       WHERE o.order_status IN ('PENDING','APPROVED') AND (EXISTS(SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.product_id=?) OR EXISTS(SELECT 1 FROM order_packages op WHERE op.order_id=o.id AND JSON_CONTAINS(JSON_EXTRACT(op.components,'$[*].productId'),CAST(? AS JSON))))`,
      [id, id],
    );
    if (orders[0].pendingCount > 0)
      throw new HttpError(409, "Product has pending or approved orders");
    const [result] = await db.execute<any>(
      "UPDATE products SET active=FALSE WHERE id=? AND active=TRUE",
      [id],
    );
    if (!result.affectedRows) throw new HttpError(404, "Product not found");
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

const adjustmentSchema = z.object({
  body: z.object({
    quantity: z.number().int().positive(),
    type: z.enum(["ADD", "DEDUCT"]),
    note: z.string().max(500).optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.coerce.number().int().positive() }),
});
router.post(
  "/:id/inventory-adjustments",
  authorize("ADMIN"),
  validate(adjustmentSchema),
  async (req, res, next) => {
    const connection = await db.getConnection();
    try {
      const id = Number(req.params.id);
      await connection.beginTransaction();
      const [rows] = await connection.query<any[]>(
        "SELECT stock_on_hand,stock_reserved FROM products WHERE id=? FOR UPDATE",
        [id],
      );
      const current = rows[0]?.stock_on_hand;
      const nextStock =
        req.body.type === "ADD"
          ? current + req.body.quantity
          : current - req.body.quantity;
      if (current === undefined) throw new HttpError(404, "Product not found");
      if (nextStock < rows[0].stock_reserved)
        throw new HttpError(
          409,
          "Adjustment would reduce stock below the reserved quantity",
        );
      await connection.execute(
        "UPDATE products SET stock_on_hand=? WHERE id=?",
        [nextStock, id],
      );
      await connection.execute(
        "INSERT INTO inventory_movements(product_id,actor_id,type,quantity,note) VALUES(?,?,?,?,?)",
        [
          id,
          req.user!.id,
          req.body.type,
          req.body.quantity,
          req.body.note ?? null,
        ],
      );
      await stockEpisode(connection, id, req.user!.id);
      await connection.commit();
      res.json({ data: { productId: id, stockOnHand: nextStock } });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  },
);

const settingsSchema = z.object({
  body: z.object({
    lowStockThreshold: z.number().int().positive(),
    reorderLevel: z.number().int().positive(),
  }),
  query: z.any(),
  params: z.object({ id: z.coerce.number().int().positive() }),
});
router.put(
  "/:id/inventory-settings",
  authorize("ADMIN"),
  validate(settingsSchema),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          "SELECT id FROM products WHERE id=? AND active=TRUE FOR UPDATE",
          [id],
        );
        if (!rows.length) throw new HttpError(404, "Product not found");
        await c.execute(
          "UPDATE products SET low_stock_threshold=?,reorder_level=? WHERE id=?",
          [req.body.lowStockThreshold, req.body.reorderLevel, id],
        );
        await stockEpisode(c, id, req.user!.id);
      });
      res.json({ data: { productId: id, ...req.body } });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
