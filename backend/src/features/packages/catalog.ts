import { db } from "../../database/connection.js";
export async function packageCatalog(activeOnly = false) {
  const [packs] = await db.query<any[]>(
    `SELECT id,name,description,selling_price sellingPrice,commission_type commissionType,commission_value commissionValue,active FROM packages${activeOnly ? " WHERE active=TRUE" : ""} ORDER BY name,id`,
  );
  const [items] = await db.query<any[]>(
    "SELECT pi.package_id packageId,pi.product_id productId,pi.quantity,p.name productName,p.sku,p.category_id categoryId,p.active,p.stock_on_hand-p.stock_reserved available FROM package_items pi JOIN products p ON p.id=pi.product_id ORDER BY pi.product_id",
  );
  return packs.map((p) => {
    const components = items.filter((i) => i.packageId === p.id);
    const available = components.length
      ? Math.max(
          0,
          Math.min(
            ...components.map((i) =>
              i.active ? Math.floor(i.available / i.quantity) : 0,
            ),
          ),
        )
      : 0;
    return {
      ...p,
      active: Boolean(p.active),
      available,
      components: components.map(({ active, available, packageId, ...i }) => i),
    };
  });
}
