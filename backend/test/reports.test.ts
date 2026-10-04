import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import {
  reportBounds,
  reportQuerySchema,
} from "../src/features/reports/model.js";

test("reports validate calendar dates and use exclusive Manila period boundaries", () => {
  const bounds = reportBounds({ period: "daily", date: "2028-02-29" })!;
  assert.equal(bounds.start.toISOString(), "2028-02-28T16:00:00.000Z");
  assert.equal(bounds.end.toISOString(), "2028-02-29T16:00:00.000Z");
  assert.equal(
    reportBounds({ period: "monthly", month: "2030-01" })!.end.toISOString(),
    "2030-01-31T16:00:00.000Z",
  );
  assert.equal(reportBounds({ period: "overall" }), null);
  for (const query of [
    { period: "daily", date: "2030-02-29" },
    { period: "daily", date: "2030-04-31" },
    { period: "daily", date: "2100-02-29" },
    { period: "daily", date: "2030-1-1" },
    { period: "monthly", month: "2030-13" },
    { period: "daily" },
    { period: "invalid" },
  ])
    assert.equal(reportQuerySchema.safeParse(query).success, false);
});

test(
  "reports aggregate saved sales, product rankings, and operations against isolated MySQL",
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
      await db.query(
        "INSERT INTO users(id,email,password_hash,full_name,role) VALUES(1,'admin@example.test','!','Admin','ADMIN'),(2,'agent@example.test','!','Agent','AGENT')",
      );
      await db.query(
        "INSERT INTO customers(id,full_name,email,phone,address) VALUES(1,'Customer','customer@example.test','09171234567','Address')",
      );
      await db.query("INSERT INTO categories(id,name) VALUES(1,'General')");
      for (let id = 1; id <= 14; id++)
        await db.execute(
          "INSERT INTO products(id,category_id,name,sku,price,stock_on_hand,stock_reserved,active) VALUES(?,1,?,?,10,?,?,?)",
          [
            id,
            `Product ${id}`,
            `SKU-${id}`,
            id === 1 ? 5 : id === 14 ? 0 : id * 10,
            id === 1 ? 3 : 0,
            id !== 13,
          ],
        );
      await db.query(
        "INSERT INTO packages(id,name,description,selling_price,commission_type,commission_value) VALUES(1,'Current package','Test',999,'FIXED',5)",
      );
      // Deliberately different catalog components: reporting must use the snapshot.
      await db.query(
        "INSERT INTO package_items(package_id,product_id,quantity) VALUES(1,2,99)",
      );
      async function order(
        created: string,
        completed: string | null,
        quantity = 1,
        status = "COMPLETED",
        payment = "PAID",
        delivery: string | null = "DELIVERED",
        productId = 1,
        origin = "LIVE",
      ) {
        const [result] = await db.execute(
          "INSERT INTO orders(tracking_number,customer_id,agent_id,delivery_address,payment_method,payment_status,order_status,delivery_status,origin,sale_completed_at,created_at) VALUES(?,1,2,'Address','Cash',?,?,?,?,?,?)",
          [
            `TNL-${randomBytes(8).toString("hex")}`,
            payment,
            status,
            delivery,
            origin,
            completed,
            created,
          ],
        );
        await db.execute(
          "INSERT INTO order_items(order_id,product_id,quantity,unit_price,product_name,sku) VALUES(?,?,?,10,?,?)",
          [
            result.insertId,
            productId,
            quantity,
            `Product ${productId}`,
            `SKU-${productId}`,
          ],
        );
        return result.insertId;
      }
      const first = await order(
        "2029-12-20 00:00:00",
        "2029-12-31 16:00:00",
        2,
      );
      await db.execute(
        "INSERT INTO order_packages(order_id,package_id,name,quantity,selling_price,commission_type,commission_value,components) VALUES(?,1,'Saved package',2,50,'FIXED',5,?)",
        [
          first,
          JSON.stringify([
            { productId: 1, quantity: 3 },
            { productId: 2, quantity: 1 },
          ]),
        ],
      );
      await order(
        "2030-01-01 00:00:00",
        null,
        1,
        "COMPLETED",
        "PAID",
        "DELIVERED",
        2,
        "IMPORTED",
      );
      await order(
        "2030-01-31 15:59:59",
        "2030-01-31 15:59:59",
        1,
        "COMPLETED",
        "PAID",
        "DELIVERED",
        13,
      );
      await order("2030-01-31 16:00:00", "2030-01-31 16:00:00", 4);
      await order("2029-12-31 15:59:59", "2029-12-31 15:59:59", 5);
      await order("2030-01-01 00:00:00", null, 100, "CANCELLED");
      await order("2030-01-01 00:00:00", null, 100, "REJECTED");
      await order("2030-01-01 00:00:00", null, 100, "COMPLETED", "UNPAID");
      await order(
        "2030-01-01 00:00:00",
        null,
        100,
        "APPROVED",
        "PAID",
        "PREPARING",
      );
      await order(
        "2030-01-01 00:00:00",
        null,
        100,
        "PENDING",
        "PARTIALLY_PAID",
        null,
      );
      const { app } = await import("../src/app.js");
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = `http://127.0.0.1:${server.address().port}/api/v1/reports`;
      const token = (id: number, role: string) =>
        jwt.sign({ id, role }, process.env.JWT_SECRET!, { expiresIn: "1h" });
      async function call(
        query: string,
        credential = token(1, "ADMIN"),
        status = 200,
      ) {
        const response = await fetch(base + query, {
          headers: credential ? { authorization: `Bearer ${credential}` } : {},
        });
        assert.equal(response.status, status);
        return ((await response.json()) as any).data;
      }
      await t.test(
        "completed totals, snapshot component units, zero sellers, and current stock",
        async () => {
          const report = await call("?period=monthly&month=2030-01");
          assert.equal(report.totals.completedSales, 3);
          assert.equal(report.totals.revenue, 140);
          assert.equal(report.totals.buyingCustomers, 1);
          assert.equal(report.totals.historicalDateSales, 1);
          assert.deepEqual(
            report.fastProducts.map((p: any) => [p.id, p.unitsSold]),
            [
              [1, 8],
              [2, 3],
              [13, 1],
            ],
          );
          assert.equal(report.slowProducts.length, 10);
          assert.deepEqual(
            report.slowProducts
              .slice(0, 2)
              .map((p: any) => [p.id, p.unitsSold]),
            [
              [12, 0],
              [11, 0],
            ],
          );
          assert(
            !report.slowProducts.some((p: any) => [13, 14].includes(p.id)),
          );
          assert.equal(report.customers[0].revenue, 140);
          assert.deepEqual(
            report.packages.map((p: any) => [p.unitsSold, p.revenue]),
            [[2, 100]],
          );
          assert.equal(report.stock.activeProducts, 13);
          assert.equal(report.stock.lowStockProducts, 2);
          assert.equal(
            report.stockAlerts.find((p: any) => p.id === 1).available,
            2,
          );
          assert.equal(
            report.statuses.reduce((sum: number, p: any) => sum + p.orders, 0),
            7,
          );
          assert.equal(
            report.payments.reduce((sum: number, p: any) => sum + p.orders, 0),
            5,
          );
        },
      );
      await t.test(
        "daily, monthly, overall, and empty boundaries reconcile",
        async () => {
          const daily = await call("?period=daily&date=2030-01-01");
          assert.equal(daily.totals.revenue, 130);
          assert.deepEqual(
            daily.trend.map((p: any) => p.label),
            ["2030-01-01 00:00", "2030-01-01 08:00"],
          );
          assert.equal(
            (await call("?period=monthly&month=2030-02")).totals.revenue,
            40,
          );
          const all = await call("?period=overall");
          assert.equal(all.totals.revenue, 230);
          assert.equal(
            all.trend.reduce((sum: number, row: any) => sum + row.revenue, 0),
            230,
          );
          const empty = await call("?period=daily&date=2030-03-01");
          assert.equal(empty.totals.revenue, 0);
          assert.equal(empty.fastProducts.length, 0);
          assert.equal(empty.slowProducts.length, 10);
          assert.equal(empty.stock.activeProducts, 13);
        },
      );
      await t.test(
        "rankings cap at ten and never duplicate overlapping lines",
        async () => {
          for (let id = 3; id <= 12; id++)
            await order(
              "2030-01-10 00:00:00",
              "2030-01-10 00:00:00",
              id,
              "COMPLETED",
              "PAID",
              "DELIVERED",
              id,
            );
          const report = await call("?period=monthly&month=2030-01");
          assert.equal(report.fastProducts.length, 10);
          assert.equal(
            new Set(report.fastProducts.map((p: any) => p.id)).size,
            10,
          );
          assert.deepEqual(
            report.fastProducts.slice(0, 2).map((p: any) => p.unitsSold),
            [12, 11],
          );
          assert.equal(
            report.fastProducts.find((p: any) => p.id === 1).unitsSold,
            8,
          );
        },
      );
      await t.test("admin access and invalid calendar input", async () => {
        await call("?period=overall", "", 401);
        await call("?period=overall", token(2, "AGENT"), 403);
        await call("?period=overall", token(1, "CUSTOMER"), 403);
        await call("?period=daily&date=2030-02-29", undefined, 400);
        await call("?period=monthly&month=2030-13", undefined, 400);
        await call("?period=unknown", undefined, 400);
      });
    } finally {
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      if (db) await db.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await admin.end();
    }
  },
);
