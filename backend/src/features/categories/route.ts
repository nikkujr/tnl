import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";

const router = Router();
router.use(authenticate, authorize("ADMIN"));

router.get("/", async (req, res, next) => {
  try {
    const search = `%${String(req.query.search ?? "")}%`;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT c.id,c.name,c.description,COUNT(p.id) productCount
       FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.active=TRUE
       WHERE c.name LIKE ? OR COALESCE(c.description,'') LIKE ?
       GROUP BY c.id ORDER BY c.name LIMIT ? OFFSET ?`,
      [search, search, limit, offset]
    );
    const [counts] = await db.query<any[]>(
      "SELECT COUNT(*) total FROM categories WHERE name LIKE ? OR COALESCE(description,'') LIKE ?",
      [search, search]
    );
    res.json({ data: rows, meta: { page, limit, total: counts[0].total } });
  } catch (error) { next(error); }
});

const categoryBody = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(500).nullable().optional() });
const bodySchema = z.object({ body: categoryBody, query: z.any(), params: z.any() });
router.post("/", validate(bodySchema), async (req, res, next) => {
  try {
    const [result] = await db.execute<any>("INSERT INTO categories(name,description) VALUES(?,?)", [req.body.name, req.body.description ?? null]);
    res.status(201).json({ data: { id: result.insertId, ...req.body, productCount: 0 } });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") return next(new HttpError(409, "Category name already exists"));
    next(error);
  }
});

const paramsSchema = z.object({ body: categoryBody, query: z.any(), params: z.object({ id: z.coerce.number().int().positive() }) });
router.put("/:id", validate(paramsSchema), async (req, res, next) => {
  try {
    const [result] = await db.execute<any>("UPDATE categories SET name=?,description=? WHERE id=?", [req.body.name, req.body.description ?? null, Number(req.params.id)]);
    if (!result.affectedRows) throw new HttpError(404, "Category not found");
    res.json({ data: { id: Number(req.params.id), ...req.body } });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") return next(new HttpError(409, "Category name already exists"));
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    const id = Number(req.params.id);
    await connection.beginTransaction();
    const [active] = await connection.query<any[]>("SELECT COUNT(*) productCount FROM products WHERE category_id=? AND active=TRUE", [id]);
    if (active[0].productCount > 0) throw new HttpError(409, "Reassign or delete associated products before deleting this category");
    const [blocked] = await connection.query<any[]>(
      `SELECT COUNT(*) productCount FROM products p WHERE p.category_id=? AND p.active=FALSE
       AND (EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id=p.id) OR EXISTS (SELECT 1 FROM inventory_movements im WHERE im.product_id=p.id))`,
      [id]
    );
    if (blocked[0].productCount > 0) throw new HttpError(409, "This category has archived products with order or inventory history and cannot be deleted");
    await connection.execute("DELETE FROM products WHERE category_id=? AND active=FALSE", [id]);
    const [result] = await connection.execute<any>("DELETE FROM categories WHERE id=?", [id]);
    if (!result.affectedRows) throw new HttpError(404, "Category not found");
    await connection.commit();
    res.status(204).send();
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

export default router;
