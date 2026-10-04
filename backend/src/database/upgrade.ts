import { readFile } from "node:fs/promises";
import { db } from "./connection.js";

export async function upgrade() {
  const [agentColumn] = await db.query<any[]>("SELECT IS_NULLABLE nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='orders' AND column_name='agent_id'");
  if (agentColumn[0]?.nullable === "NO") await db.query("ALTER TABLE orders MODIFY agent_id BIGINT UNSIGNED NULL");
  // Existing records are deliberately legacy; new sales explicitly opt into PACKAGE.
  const columns: Record<string, Record<string, string>> = {
    users: { token_version: "INT UNSIGNED NOT NULL DEFAULT 0" },
    orders: {
      delivery_employee_id: "BIGINT UNSIGNED NULL",
      delivery_assignment_version: "INT UNSIGNED NOT NULL DEFAULT 0",
      destination_latitude: "DECIMAL(10,7) NULL",
      destination_longitude: "DECIMAL(10,7) NULL",
      sales_version: "ENUM('LEGACY','PACKAGE') NOT NULL DEFAULT 'LEGACY'",
      approved_at: "DATETIME NULL",
      delivery_changed_at: "DATETIME NULL",
      sale_completed_at: "DATETIME NULL",
    },
    customers: {
      marketing_opt_in: "BOOLEAN NOT NULL DEFAULT FALSE",
      marketing_opted_at: "DATETIME NULL",
      unsubscribe_token: "CHAR(64) NULL",
    },
    commissions: {
      breakdown: "JSON NULL",
      source: "ENUM('LEGACY','PACKAGE') NOT NULL DEFAULT 'LEGACY'",
    },
    campaigns: {
      audience_type: "ENUM('ALL','SELECTED') NOT NULL DEFAULT 'ALL'",
      customer_ids: "JSON NULL",
      scheduled_at: "DATETIME NULL",
    },
  };
  for (const [table, definitions] of Object.entries(columns)) {
    for (const [column, definition] of Object.entries(definitions)) {
      const [rows] = await db.query<any[]>(
        "SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",
        [table, column],
      );
      if (!rows.length)
        await db.query(
          `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
        );
    }
  }
  const [roleColumns] = await db.query<any[]>("SELECT COLUMN_TYPE type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' AND column_name='role'");
  if (!String(roleColumns[0]?.type).includes("DELIVERY")) await db.query("ALTER TABLE users MODIFY role ENUM('ADMIN','AGENT','DELIVERY') NOT NULL");
  const [deliveryKeys] = await db.query<any[]>("SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='orders' AND constraint_name='fk_order_delivery_employee'");
  if (!deliveryKeys.length) await db.query("ALTER TABLE orders ADD CONSTRAINT fk_order_delivery_employee FOREIGN KEY(delivery_employee_id) REFERENCES users(id)");
  const deliverySql = await readFile(new URL("./delivery-schema.sql", import.meta.url), "utf8");
  for (const statement of deliverySql.split(/;\s*(?:\r?\n|$)/).map(s=>s.trim()).filter(Boolean)) await db.query(statement);
  const [sessionExpiry] = await db.query<any[]>("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='delivery_location_sessions' AND column_name='expires_at'");
  if (!sessionExpiry.length) await db.query("ALTER TABLE delivery_location_sessions ADD expires_at DATETIME NULL");
  await db.query("ALTER TABLE commissions MODIFY rate DECIMAL(5,2) NULL");
  const performanceSql = await readFile(
    new URL("./performance-schema.sql", import.meta.url),
    "utf8",
  );
  for (const statement of performanceSql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean))
    await db.query(statement);
  const sql = await readFile(
    new URL("./automation-schema.sql", import.meta.url),
    "utf8",
  );
  for (const statement of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean))
    await db.query(statement);
  const defaults: Record<string, object> = {
    ORDER_UPDATES: {
      subject: "Order {{trackingNumber}} update",
      template: "Your order {{trackingNumber}} is {{status}}.",
    },
    PENDING_APPROVAL: { hours: 24 },
    OUTSTANDING_PAYMENT: { hours: 72 },
    STALLED_DELIVERY: { hours: 48 },
    LOW_STOCK: {},
    SCHEDULED_CAMPAIGN: {},
    WELCOME: {
      subject: "Welcome to TNL Track",
      template:
        "Welcome, {{customerName}}. Browse our products and packages or ask your field agent for help.",
    },
    PURCHASE_FOLLOWUP: {
      delayDays: 3,
      subject: "Your TNL order {{trackingNumber}}",
      template:
        "Thank you for your purchase, {{customerName}}. Sign in to TNL Track if you need help with order {{trackingNumber}}.",
    },
  };
  for (const [workflow, config] of Object.entries(defaults))
    await db.execute(
      "INSERT IGNORE INTO automation_settings(workflow,config) VALUES(?,?)",
      [workflow, JSON.stringify(config)],
    );
}
