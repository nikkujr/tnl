import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import {
  monthBounds,
  periodSchema,
} from "../src/features/performance/model.js";

test("monthly performance uses Manila boundaries and validates months", () => {
  const bounds = monthBounds("2030-01");
  assert.equal(bounds.start.toISOString(), "2029-12-31T16:00:00.000Z");
  assert.equal(bounds.end.toISOString(), "2030-01-31T16:00:00.000Z");
  assert.equal(monthBounds("2028-02").days, 29);
  for (const period of [
    "2030-13",
    "2030-00",
    "2030-1",
    "2030-01' OR 1=1",
    "1999-12",
  ])
    assert(!periodSchema.safeParse(period).success);
});

test(
  "performance report and reward approvals against isolated MySQL",
  { skip: process.env.TNL_INTEGRATION !== "1", timeout: 120000 },
  async (t) => {
    const schema = `tnl_test_${randomBytes(8).toString("hex")}`;
    const admin = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
    let db: any, server: any;
    try {
      await admin.query(`CREATE DATABASE \`${schema}\``);
      process.env.DB_NAME = schema;
      ({ db } = await import("../src/database/connection.js"));
      const sql = await readFile(
        new URL("../src/database/schema.sql", import.meta.url),
        "utf8",
      );
      for (const statement of sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((s) => s.trim())
        .filter(Boolean))
        await db.query(statement);
      const { upgrade } = await import("../src/database/upgrade.js");
      await upgrade();
      await upgrade();
      await db.query(
        "INSERT INTO users(id,email,password_hash,full_name,role) VALUES(1,'admin@example.test','!','Admin','ADMIN'),(2,'one@example.test','!','First agent','AGENT'),(3,'two@example.test','!','Second agent','AGENT'),(4,'zero@example.test','!','Zero agent','AGENT')",
      );
      await db.query(
        "INSERT INTO customers(id,full_name,email,phone,address) VALUES(1,'Customer','customer@example.test','09171234567','Address')",
      );
      await db.query("UPDATE users SET active=FALSE WHERE id=4");
      await db.query("INSERT INTO categories(id,name) VALUES(1,'General')");
      await db.query(
        "INSERT INTO products(id,category_id,name,sku,price,stock_on_hand) VALUES(1,1,'Product','SKU',10,100)",
      );
      const { app } = await import("../src/app.js");
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = `http://127.0.0.1:${server.address().port}/api/v1/performance`;
      const token = (id: number, role: string) =>
        jwt.sign({ id, role }, process.env.JWT_SECRET!, { expiresIn: "1h" });
      const auth = token(1, "ADMIN");
      async function call(
        path: string,
        method = "GET",
        body?: any,
        status: number | number[] = 200,
        credential = auth,
      ) {
        const response = await fetch(base + path, {
          method,
          headers: {
            "content-type": "application/json",
            ...(credential ? { authorization: `Bearer ${credential}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const value = await response.json();
        assert(
          [status].flat().includes(response.status),
          JSON.stringify(value),
        );
        return value.data;
      }
      async function order(
        agent: number,
        price: number,
        completed: string,
        payment = "PAID",
        origin = "LIVE",
        version = "PACKAGE",
      ) {
        const [result] = await db.execute(
          "INSERT INTO orders(tracking_number,customer_id,agent_id,delivery_address,payment_method,payment_status,order_status,delivery_status,origin,sales_version,sale_completed_at,created_at) VALUES(?,1,?,'Address','Cash',?,'COMPLETED','DELIVERED',?,?,?,?)",
          [
            `TNL-${randomBytes(8).toString("hex")}`,
            agent,
            payment,
            origin,
            version,
            completed,
            completed,
          ],
        );
        await db.execute(
          "INSERT INTO order_items(order_id,product_id,quantity,unit_price,product_name,sku) VALUES(?,1,1,?,'Product','SKU')",
          [result.insertId, price],
        );
        return result.insertId;
      }
      const one = await order(2, 110, "2029-12-31 16:00:00");
      await db.execute(
        "UPDATE order_items SET unit_price=10 WHERE order_id=?",
        [one],
      );
      await db.query(
        "INSERT INTO packages(id,name,description,selling_price,commission_type,commission_value) VALUES(1,'Saved package','Test',50,'FIXED',5)",
      );
      await db.execute(
        "INSERT INTO order_packages(order_id,package_id,name,quantity,selling_price,commission_type,commission_value,components) VALUES(?,1,'Saved package',2,50,'FIXED',5,'[]')",
        [one],
      );
      await order(2, 200, "2030-01-31 15:59:59");
      const two = await order(3, 250, "2030-01-15 00:00:00");
      await order(2, 9000, "2030-01-03 00:00:00", "UNPAID");
      await order(2, 9999, "2030-01-04 00:00:00", "PAID", "IMPORTED");
      await order(2, 9999, "2030-01-04 00:00:00", "PAID", "LIVE", "LEGACY");
      await order(2, 500, "2030-01-31 16:00:00");
      await order(2, 800, "2029-12-31 15:59:59");
      await db.execute(
        "INSERT INTO commissions(order_id,agent_id,rate,amount,source,created_at) VALUES(?,2,NULL,10,'PACKAGE','2030-01-01 00:00:00'),(?,3,NULL,5,'PACKAGE','2030-01-15 00:00:00')",
        [one, two],
      );

      await t.test(
        "ranking, zero agents, financial completion, and daily figures",
        async () => {
          const report = await call("?month=2030-01");
          assert.equal(report.totals.sales, 560);
          assert.equal(report.totals.deals, 3);
          assert.equal(report.totals.commission, 15);
          assert.deepEqual(
            report.agents.map((a: any) => [a.id, a.sales, a.deals]),
            [
              [2, 310, 2],
              [3, 250, 1],
              [4, 0, 0],
            ],
          );
          assert.equal(report.agents[0].pipeline, 1);
          assert.equal(report.agents[0].commission, 10);
          assert.equal(report.agents[2].active, 0);
          assert.equal(report.trend.length, 31);
          assert.equal(report.trend[0].sales, 110);
          assert.equal(report.trend[30].sales, 200);
          assert.equal((await call("?month=2030-02")).totals.sales, 500);
        },
      );
      await t.test("admin-only access and validation", async () => {
        await call("?month=2030-01", "GET", undefined, 401, "");
        for (const credential of [token(2, "AGENT"), token(1, "CUSTOMER")]) {
          await call("?month=2030-01", "GET", undefined, 403, credential);
          await call(
            "/targets/2/2030-01",
            "PUT",
            { salesTarget: 300, incentiveAmount: 25 },
            403,
            credential,
          );
          await call(
            "/bonuses",
            "POST",
            {
              agentId: 2,
              period: "2030-01",
              amount: 5,
              reason: "Good work",
              idempotencyKey: "not-allowed-reward",
            },
            403,
            credential,
          );
          await call(
            "/incentives/1/approve",
            "POST",
            { idempotencyKey: "not-allowed-incentive" },
            403,
            credential,
          );
        }
        await call("?month=2030-13", "GET", undefined, 400);
        await call(
          "/targets/2/2030-01",
          "PUT",
          { salesTarget: 0, incentiveAmount: 25 },
          400,
        );
        await call(
          "/targets/1/2030-01",
          "PUT",
          { salesTarget: 300, incentiveAmount: 25 },
          404,
        );
        await call(
          "/bonuses",
          "POST",
          {
            agentId: 2,
            period: "2030-01",
            amount: 0.001,
            reason: "Work",
            idempotencyKey: "invalid-money-value",
          },
          400,
        );
      });
      await t.test(
        "targets persist, incentives recheck eligibility, concurrent approval is once",
        async () => {
          await call("/targets/2/2030-01", "PUT", {
            salesTarget: 300,
            incentiveAmount: 25,
          });
          await call("/targets/3/2030-01", "PUT", {
            salesTarget: 300,
            incentiveAmount: 30,
          });
          const report = await call("?month=2030-01");
          const first = report.agents[0],
            second = report.agents[1];
          assert.equal(first.incentiveStatus, "ELIGIBLE");
          assert.equal(second.incentiveStatus, "IN_PROGRESS");
          assert.equal(report.totals.targetsMet, 1);
          await call(
            `/incentives/${second.targetId}/approve`,
            "POST",
            { idempotencyKey: "unreached-target-key" },
            409,
          );
          const responses = await Promise.all(
            Array.from({ length: 3 }, (_, i) =>
              call(
                `/incentives/${first.targetId}/approve`,
                "POST",
                { idempotencyKey: `incentive-submit-${i}` },
                [200, 201],
              ),
            ),
          );
          assert.equal(new Set(responses.map((r) => r.id)).size, 1);
          await call(`/incentives/${first.targetId}/approve`, "POST", {
            idempotencyKey: "incentive-submit-0",
          });
          await call(
            "/targets/2/2030-01",
            "PUT",
            { salesTarget: 300, incentiveAmount: 26 },
            409,
          );
          await call("/targets/2/2030-02", "PUT", {
            salesTarget: 600,
            incentiveAmount: 50,
          });
          const after = await call("?month=2030-01");
          assert.equal(after.totals.incentives, 25);
          assert.equal(after.agents[0].incentiveStatus, "APPROVED");
        },
      );
      await t.test(
        "bonus approvals persist reasons and reject changed replay details",
        async () => {
          const bonus = {
            agentId: 3,
            period: "2030-01",
            amount: 12.34,
            reason: "Excellent customer service",
            idempotencyKey: "bonus-approval-submit",
          };
          const first = await call("/bonuses", "POST", bonus, 201);
          const repeats = await Promise.all([
            call("/bonuses", "POST", bonus),
            call("/bonuses", "POST", bonus),
          ]);
          assert(repeats.every((r) => r.id === first.id && r.reused));
          await call("/bonuses", "POST", { ...bonus, amount: 20 }, 409);
          const report = await call("?month=2030-01");
          assert.equal(report.totals.bonuses, 12.34);
          assert.equal(report.rewards.length, 2);
          assert.equal(report.rewards[0].approvedBy, "Admin");
          assert.equal(report.rewards[0].reason, bonus.reason);
          assert.equal(report.totals.commission, 15);
          assert.equal((await call("?month=2030-02")).rewards.length, 0);
        },
      );
      await t.test("agents read only their own monthly rewards without changing approvals", async () => {
        const firstAgent = token(2, "AGENT"), secondAgent = token(3, "AGENT");
        const first = await call("/agents/2/rewards?month=2030-01", "GET", undefined, 200, firstAgent);
        assert.equal(first.sales, 310);
        assert.equal(first.target.status, "APPROVED");
        assert.equal(first.target.incentiveAmount, 25);
        assert.deepEqual(first.totals, { incentives: 25, bonuses: 0 });
        assert.equal(first.rewards.length, 1);
        assert.equal(first.rewards[0].kind, "INCENTIVE");
        const second = await call("/agents/3/rewards?month=2030-01", "GET", undefined, 200, secondAgent);
        assert.equal(second.sales, 250);
        assert.equal(second.target.status, "IN_PROGRESS");
        assert.deepEqual(second.totals, { incentives: 0, bonuses: 12.34 });
        assert.equal(second.rewards[0].reason, "Excellent customer service");
        assert.equal(second.rewards[0].approvedBy, "Admin");
        const later = await call("/agents/2/rewards?month=2030-02", "GET", undefined, 200, firstAgent);
        assert.equal(later.sales, 500);
        assert.equal(later.target.status, "IN_PROGRESS");
        assert.equal(later.rewards.length, 0);
        const empty = await call("/agents/4/rewards?month=2030-01");
        assert.equal(empty.target, null);
        assert.deepEqual(empty.totals, { incentives: 0, bonuses: 0 });
        const defaultMonth = await call("/agents/2/rewards", "GET", undefined, 200, firstAgent);
        assert.match(defaultMonth.period, /^20\d{2}-\d{2}$/);
        await call("/agents/3/rewards?month=2030-01", "GET", undefined, 403, firstAgent);
        await call("/agents/999/rewards", "GET", undefined, 404);
        await call("/agents/2/rewards?month=2030-13", "GET", undefined, 400, firstAgent);
        await call("/agents/2/rewards", "GET", undefined, 401, "");
        await call("/agents/2/rewards", "GET", undefined, 403, token(1, "CUSTOMER"));
        const [counts] = await db.query("SELECT COUNT(*) n FROM agent_rewards");
        assert.equal(counts[0].n, 2);
      });
    } finally {
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      if (db) await db.end();
      assert.match(schema, /^tnl_test_[a-f0-9]{16}$/);
      await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await admin.end();
    }
  },
);
