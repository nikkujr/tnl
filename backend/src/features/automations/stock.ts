import type { PoolConnection } from "mysql2/promise";
import { enqueue, event } from "./events.js";
/** Called while product rows are locked, with the inventory mutation's transaction. */
export async function stockEpisode(
  c: PoolConnection,
  productId: number,
  actorId: number | null = null,
) {
  const [settings] = await c.query<any[]>(
    "SELECT enabled FROM automation_settings WHERE workflow='LOW_STOCK'",
  );
  if (!settings[0]?.enabled) return;
  const [products] = await c.query<any[]>(
    "SELECT id,name,active,stock_on_hand-stock_reserved available,low_stock_threshold FROM products WHERE id=?",
    [productId],
  );
  const p = products[0];
  if (!p) return;
  await c.execute(
    "INSERT IGNORE INTO automation_episodes(workflow,entity_id) VALUES('LOW_STOCK',?)",
    [productId],
  );
  const [episodes] = await c.query<any[]>(
    "SELECT active,generation FROM automation_episodes WHERE workflow='LOW_STOCK' AND entity_id=? FOR UPDATE",
    [productId],
  );
  const low = p.active && p.available <= p.low_stock_threshold,
    e = episodes[0];
  if (low && !e.active) {
    const generation = e.generation + 1;
    await c.execute(
      "UPDATE automation_episodes SET active=TRUE,generation=? WHERE workflow='LOW_STOCK' AND entity_id=?",
      [generation, productId],
    );
    const id = await event(
      c,
      "stock.low",
      "PRODUCT",
      productId,
      { available: p.available, threshold: p.low_stock_threshold, generation },
      actorId,
    );
    await enqueue(
      c,
      "LOW_STOCK",
      `stock:${productId}:${generation}`,
      {
        kind: "STAFF",
        productId,
        generation,
        title: "Low available stock",
        message: `${p.name}: ${p.available} available`,
        link: "/inventory",
      },
      new Date(),
      id,
    );
  } else if (!low && e.active) {
    await c.execute(
      "UPDATE automation_episodes SET active=FALSE WHERE workflow='LOW_STOCK' AND entity_id=?",
      [productId],
    );
    await event(
      c,
      "stock.recovered",
      "PRODUCT",
      productId,
      { available: p.available },
      actorId,
    );
  }
}
