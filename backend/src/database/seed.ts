import bcrypt from "bcryptjs";
import { db } from "./connection.js";

const passwordHash = await bcrypt.hash("TnlDemo123!", 12);

await db.execute(
  `INSERT INTO users(email,password_hash,full_name,role,commission_rate)
   VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),active=TRUE`,
  ["admin@tnl.local", passwordHash, "Nico Alvarez", "ADMIN", 0]
);
await db.execute(
  `INSERT INTO users(email,password_hash,full_name,role,commission_rate)
   VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),active=TRUE`,
  ["agent@tnl.local", passwordHash, "Jamie Co", "AGENT", 5]
);

const [[admin], [agent]] = await Promise.all([
  db.query<any[]>("SELECT id FROM users WHERE email='admin@tnl.local'"),
  db.query<any[]>("SELECT id FROM users WHERE email='agent@tnl.local'")
]);

await db.execute(
  "INSERT INTO categories(name,description) VALUES(?,?) ON DUPLICATE KEY UPDATE description=VALUES(description)",
  ["Furniture", "Furniture and home interior products"]
);
const [categories] = await db.query<any[]>("SELECT id FROM categories WHERE name='Furniture'");
const categoryId = categories[0].id;

for (const product of [
  ["Arc Floor Lamp", "LGT-042", 12840, 24, 8, 12],
  ["Oak Side Table", "TBL-016", 7250, 12, 5, 8],
  ["Linen Lounge Chair", "CHR-028", 18900, 7, 8, 12],
  ["Modular Shelf", "SHF-011", 9500, 3, 6, 10]
] as const) {
  await db.execute(
    `INSERT INTO products(category_id,name,sku,price,stock_on_hand,low_stock_threshold,reorder_level)
     VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),price=VALUES(price)`,
    [categoryId, ...product]
  );
}

await db.execute(
  `INSERT INTO customers(full_name,email,phone,address,assigned_agent_id)
   VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE assigned_agent_id=VALUES(assigned_agent_id)`,
  ["Mara Santos", "mara@northmail.co", "+63 917 555 0112", "128 Maginhawa Street, Quezon City", agent[0].id]
);

console.log(`Seed complete. Admin user id: ${admin[0].id}; agent user id: ${agent[0].id}`);
console.log("Demo password: TnlDemo123!");
await db.end();
