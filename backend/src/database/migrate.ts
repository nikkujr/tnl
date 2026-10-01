import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db } from "./connection.js";
import { upgrade } from "./upgrade.js";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
const sql = await readFile(schemaPath, "utf8");
const statements = sql
  .split(/;\s*(?:\r?\n|$)/)
  .map((item) => item.trim())
  .filter(Boolean);

for (const statement of statements) await db.query(statement);

const [phoneColumns] = await db.query<any[]>(
  `SELECT COUNT(*) columnCount
   FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'users'
     AND column_name = 'phone'`,
);

if (Number(phoneColumns[0]?.columnCount ?? 0) === 0) {
  await db.query(
    "ALTER TABLE users ADD COLUMN phone VARCHAR(40) NULL AFTER email",
  );
  console.log("Added users.phone column.");
}

for (const column of [
  {
    name: "cash_received",
    definition: "DECIMAL(12,2) NULL AFTER payment_status",
  },
  { name: "cash_change", definition: "DECIMAL(12,2) NULL AFTER cash_received" },
]) {
  const [columns] = await db.query<any[]>(
    `SELECT COUNT(*) columnCount FROM information_schema.columns
     WHERE table_schema=DATABASE() AND table_name='orders' AND column_name=?`,
    [column.name],
  );
  if (Number(columns[0]?.columnCount ?? 0) === 0) {
    await db.query(
      `ALTER TABLE orders ADD COLUMN ${column.name} ${column.definition}`,
    );
    console.log(`Added orders.${column.name} column.`);
  }
}

const [legacyOrderColumns] = await db.query<any[]>(
  `SELECT column_name columnName, is_nullable isNullable
   FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'orders'
     AND column_name IN ('product_id','quantity','unit_price')`,
);
for (const column of legacyOrderColumns) {
  if (column.isNullable === "NO") {
    const definitions: Record<string, string> = {
      product_id: "BIGINT UNSIGNED NULL",
      quantity: "INT UNSIGNED NULL",
      unit_price: "DECIMAL(12,2) NULL",
    };
    await db.query(
      `ALTER TABLE orders MODIFY COLUMN ${column.columnName} ${definitions[column.columnName]}`,
    );
  }
}

await db.query(
  `INSERT INTO order_items(order_id,product_id,quantity,unit_price,product_name,sku)
   SELECT o.id,o.product_id,o.quantity,o.unit_price,p.name,p.sku
   FROM orders o JOIN products p ON p.id=o.product_id
   LEFT JOIN order_items oi ON oi.order_id=o.id
   WHERE o.product_id IS NOT NULL AND oi.id IS NULL`,
);

for (const column of [
  {
    name: "origin",
    definition:
      "ENUM('LIVE','IMPORTED') NOT NULL DEFAULT 'LIVE' AFTER delivery_status",
  },
  { name: "import_batch_id", definition: "BIGINT UNSIGNED NULL AFTER origin" },
]) {
  const [columns] = await db.query<any[]>(
    `SELECT COUNT(*) columnCount FROM information_schema.columns
     WHERE table_schema=DATABASE() AND table_name='orders' AND column_name=?`,
    [column.name],
  );
  if (Number(columns[0]?.columnCount ?? 0) === 0) {
    await db.query(
      `ALTER TABLE orders ADD COLUMN ${column.name} ${column.definition}`,
    );
    console.log(`Added orders.${column.name} column.`);
  }
}

await db.query(
  `INSERT INTO categories(name,description) VALUES('Uncategorized','Products created automatically from historical data imports')
   ON DUPLICATE KEY UPDATE name=VALUES(name)`,
);

await db.query(
  `INSERT INTO users(email,password_hash,full_name,role,commission_rate,active)
   VALUES('historical-import@tnl.local','!','Store (Historical Import)','ADMIN',0,FALSE)
   ON DUPLICATE KEY UPDATE full_name=VALUES(full_name)`,
);

await upgrade();
console.log(
  `Applied ${statements.length} schema statements and package/customer/automation upgrades.`,
);
await db.end();
