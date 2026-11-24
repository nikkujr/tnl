import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { packageCatalog } from "../packages/catalog.js";
import { termsRevision } from "./terms.js";
import { config } from "../../config.js";
import { HttpError } from "../../shared/http.js";
import { rateLimit } from "../../shared/rate-limit.js";
import { searchAddresses } from "../delivery/geocoding.js";
const router = Router();

const addressQuery = z.object({ query: z.string().trim().min(3).max(200) }).strict();
router.post("/address-search", rateLimit(30, 60000), async (req, res) => {
  const input = addressQuery.safeParse(req.body);
  if (!input.success) throw new HttpError(400, "Enter 3 to 200 characters to search for an address.");
  res.json({ data: await searchAddresses(input.data.query, config.GEOAPIFY_API_KEY) });
});
async function offers() {
  const [products] = await db.query<any[]>(
    "SELECT p.id,p.name,p.sku,p.price,p.description,p.category_id categoryId,c.name category,p.stock_on_hand-p.stock_reserved available FROM products p JOIN categories c ON c.id=p.category_id WHERE p.active=TRUE ORDER BY p.name,p.id",
  );
  return [
    ...products.map((p) => ({
      ...p,
      revision: termsRevision("PRODUCT", p.id, p.name, p.price),
      kind: "PRODUCT",
      available: p.available > 0,
    })),
    ...(await packageCatalog(true)).map(
      ({ commissionType, commissionValue, ...p }) => ({
        ...p,
        revision: termsRevision(
          "PACKAGE",
          p.id,
          p.name,
          p.sellingPrice,
          p.components,
          commissionType,
          commissionValue,
        ),
        kind: "PACKAGE",
        price: p.sellingPrice,
        available: p.available > 0,
      }),
    ),
  ];
}
router.get("/", async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").toLowerCase();
    res.json({
      data: (await offers()).filter((o) =>
        `${o.name} ${o.description ?? ""}`.toLowerCase().includes(search),
      ),
    });
  } catch (e) {
    next(e);
  }
});
router.get("/categories", async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      "SELECT id,name FROM categories ORDER BY name,id",
    );
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});
router.get("/recommendations", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        categoryId: z.coerce.number().int().positive().optional(),
        budget: z.coerce.number().positive().max(9999999999),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({
          error: {
            message: "Enter a positive maximum budget and valid category",
          },
        });
      return;
    }
    const { categoryId, budget } = parsed.data;
    const results = (await offers())
      .filter(
        (o) =>
          o.available &&
          Number(o.price) <= budget &&
          (!categoryId ||
            (o.kind === "PRODUCT"
              ? o.categoryId === categoryId
              : o.components.some((i: any) => i.categoryId === categoryId))),
      )
      .sort(
        (a, b) =>
          a.price - b.price || a.id - b.id || a.kind.localeCompare(b.kind),
      )
      .slice(0, 5);
    res.json({ data: results });
  } catch (e) {
    next(e);
  }
});
export default router;
