import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

test("portable worker locking and lease recovery", {
  skip: process.env.TNL_INTEGRATION !== "1", timeout: 30000,
}, async (t) => {
  const schema = `tnl_test_${randomBytes(8).toString("hex")}`;
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  });
  let db: any;
  try {
    await admin.query(`CREATE DATABASE \`${schema}\``);
    process.env.DB_NAME = schema;
    ({ db } = await import("../src/database/connection.js"));
    const sql = await readFile(new URL("../src/database/schema.sql", import.meta.url), "utf8");
    for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean))
      await db.query(statement);
    const { upgrade } = await import("../src/database/upgrade.js");
    await upgrade();
    await upgrade();
    const { claim, execute, workerId } = await import("../src/features/automations/worker.js");
    const enqueue = (key: string, payload: object = {}) => db.execute(
      "INSERT INTO automation_runs(workflow,dedupe_key,payload,available_at) VALUES('ACCOUNT_EMAIL',?,?,UTC_TIMESTAMP(6))",
      [key, JSON.stringify(payload)],
    );

    await t.test("simultaneous claims return each due job once", async () => {
      await enqueue("single", { kind: "EMAIL" });
      const single = (await Promise.all([claim(), claim()])).filter(Boolean);
      assert.equal(single.length, 1);
      assert.deepEqual(single[0].payload, { kind: "EMAIL" });
      for (let i = 0; i < 8; i++) await enqueue(`batch-${i}`);
      const batch = (await Promise.all(Array.from({ length: 10 }, () => claim()))).filter(Boolean);
      assert.equal(batch.length, 8);
      assert.equal(new Set(batch.map(run => run.id)).size, 8);
      const [rows] = await db.query("SELECT state,attempts,lease_owner,lease_until FROM automation_runs");
      assert.equal(rows.length, 9);
      for (const row of rows) {
        assert.equal(row.state, "PROCESSING");
        assert.equal(row.attempts, 1);
        assert.equal(row.lease_owner, workerId);
        assert(row.lease_until);
      }
      assert.equal(await claim(), null);
    });

    await t.test("expired leases retry unsent jobs and fence uncertain sends", async () => {
      await db.execute("DELETE FROM automation_runs");
      await enqueue("unsent");
      await enqueue("uncertain");
      await enqueue("future");
      await db.execute("UPDATE automation_runs SET state='PROCESSING',attempts=1,lease_owner='previous-worker',lease_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE dedupe_key IN ('unsent','uncertain')");
      await db.execute("UPDATE automation_runs SET send_started_at=UTC_TIMESTAMP(6) WHERE dedupe_key='uncertain'");
      await db.execute("UPDATE automation_runs SET available_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 DAY) WHERE dedupe_key='future'");
      const runs = (await Promise.all([claim(), claim()])).filter(Boolean);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].dedupe_key, "unsent");
      assert.equal(runs[0].attempts, 2);
      const [rows] = await db.query("SELECT state,lease_owner,lease_until FROM automation_runs WHERE dedupe_key='uncertain'");
      assert.equal(rows[0].state, "UNKNOWN");
      assert.equal(rows[0].lease_owner, null);
      assert.equal(rows[0].lease_until, null);
      assert.equal(await claim(), null);
    });

    await t.test("low-stock execution retains its shared lock and notification", async () => {
      await db.execute("DELETE FROM automation_runs");
      await db.execute("INSERT INTO users(id,email,password_hash,full_name,role) VALUES(1,'admin@example.test','!','Admin','ADMIN')");
      await db.execute("INSERT INTO categories(id,name) VALUES(1,'Test')");
      await db.execute("INSERT INTO products(id,category_id,name,sku,price,stock_on_hand) VALUES(1,1,'Low stock','LOW',10,1)");
      await db.execute("UPDATE automation_settings SET enabled=TRUE WHERE workflow='LOW_STOCK'");
      await db.execute("INSERT INTO automation_episodes(workflow,entity_id,active,generation) VALUES('LOW_STOCK',1,TRUE,1)");
      await db.execute("INSERT INTO automation_runs(workflow,dedupe_key,payload,available_at) VALUES('LOW_STOCK','low-stock',?,UTC_TIMESTAMP(6))", [JSON.stringify({
        kind: "STAFF", productId: 1, generation: 1, title: "Low stock", message: "One available", link: "/inventory",
      })]);
      await execute(await claim());
      const [runs] = await db.query("SELECT state,last_error FROM automation_runs WHERE dedupe_key='low-stock'");
      assert.equal(runs[0].state, "SUCCEEDED", runs[0].last_error);
      const [notifications] = await db.query("SELECT user_id FROM staff_notifications WHERE dedupe_key='low-stock'");
      assert.deepEqual(notifications.map((row: any) => row.user_id), [1]);
    });
  } finally {
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
  }
});
