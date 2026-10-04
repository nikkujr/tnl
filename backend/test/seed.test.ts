import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDemoData, businessDate, demoPassword } from "../src/database/demo-data.js";
import { requirements, totalCents } from "../src/features/orders/sales.js";
import { packageCommission } from "../src/shared/money.js";

test("defense data respects business states, stock, ownership and Manila date boundaries", () => {
  for (const date of ["2026-10-04T07:00:00Z", "2027-01-01T00:01:00Z", "2028-02-29T10:00:00Z"]) {
    const data = buildDemoData(new Date(date));
    assert.deepEqual(data, buildDemoData(new Date(date)), "stable fixtures for the same anchor");
    assert.equal(data.products.length, 60);
    assert.equal(data.packages.length, 6);
    assert.equal(data.users.filter(u => u.role === "AGENT").length, 8);
    assert.equal(data.users.filter(u => u.role === "DELIVERY").length, 2);
    assert.equal(data.customers.length, 60);
    assert.equal(data.orders.length, 360);
    assert.equal(new Set(data.orders.map(o => o.trackingNumber)).size, 360);
    assert.deepEqual([...new Set(data.orders.map(o => o.orderStatus))].sort(), ["APPROVED", "CANCELLED", "COMPLETED", "PENDING", "REJECTED"]);
    assert.equal(data.orders.filter(o => o.saleCompletedAt).length, 240);
    assert.equal(data.orders.filter(o => o.deliveryStatus === "DELIVERED" && !o.saleCompletedAt).length, 24);
    assert.equal(data.orders.filter(o => o.orderStatus === "APPROVED").length, 48);
    assert.equal(new Set(data.orders.flatMap(o => o.saleCompletedAt ? [businessDate(o.saleCompletedAt).slice(0, 7)] : [])).size, 6);
    assert(data.orders.some(o => o.saleCompletedAt && businessDate(o.saleCompletedAt) === businessDate(data.now)));
    assert(data.orders.some(o => o.sale.items.length && o.sale.packages.length));
    assert(data.orders.some(o => o.saleCompletedAt && o.agentId === null));
    for (const o of data.orders) {
      const customer = data.customers[o.customerId - 1]!;
      assert.equal(o.agentId, customer.agentId);
      assert(o.createdAt >= customer.createdAt);
      assert(o.createdAt <= o.updatedAt && o.updatedAt <= data.now);
      assert(totalCents(o.sale) > 0);
      assert.equal(Boolean(o.saleCompletedAt), o.deliveryStatus === "DELIVERED" && o.paymentStatus === "PAID");
      if (o.approvedAt) assert(o.approvedAt >= o.createdAt && o.approvedAt <= o.deliveryChangedAt!);
      for (const p of o.sale.packages) assert(packageCommission(p) > 0);
    }
    for (const p of data.packages) {
      const componentPrice = p.components.reduce((sum, part) => sum + data.products[part.productId - 1]!.price * part.quantity, 0);
      assert(p.sellingPrice <= componentPrice, `${p.name} offers a sensible bundle price`);
    }
    for (const i of data.inventory) {
      const sold = data.orders.filter(o => o.deliveryStatus === "DELIVERED").reduce((sum, o) => sum + (requirements(o.sale).find(r => r.productId === i.productId)?.quantity ?? 0), 0);
      const reserved = data.orders.filter(o => o.orderStatus === "APPROVED").reduce((sum, o) => sum + (requirements(o.sale).find(r => r.productId === i.productId)?.quantity ?? 0), 0);
      assert.equal(i.sold, sold);
      assert.equal(i.reserved, reserved);
      assert.equal(i.opening - sold, i.onHand);
      assert(i.onHand >= i.reserved);
    }
    assert(data.inventory.some(i => i.sold === 0 && i.onHand > 0));
    assert(data.products.some(p => p.available === 0));
    const targets = data.targets.filter(t => t.period === data.periods.at(-1));
    assert(targets.some(t => t.approved));
    assert(targets.some(t => !t.approved && t.incentive > 0 && t.sales >= t.salesTarget));
    assert(targets.some(t => t.sales > 0 && t.sales < t.salesTarget));
    assert(targets.some(t => t.sales === 0));
    assert.equal(targets.find(t => t.agentId === 9)!.sales, 0);
  }
});

test("seed CLI refuses unconfirmed resets and production before connecting", () => {
  const path = fileURLToPath(new URL("../src/database/seed.ts", import.meta.url));
  const env = { ...process.env, DB_HOST: "127.0.0.1", DB_PORT: "1", DB_NAME: "tnl_seed_guard", DB_USER: "unused", DB_PASSWORD: "unused", JWT_SECRET: "seed-test-secret-with-at-least-32-characters", NODE_ENV: "test" };
  for (const args of [["--reset"], ["--reset", "--confirm=wrong"], ["--unexpected"]]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", path, ...args], { env, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert(!result.stderr.includes("ECONNREFUSED"), result.stderr);
  }
  const production = spawnSync(process.execPath, ["--import", "tsx", path, "--reset", "--confirm=tnl_seed_guard"], { env: { ...env, NODE_ENV: "production" }, encoding: "utf8" });
  assert.equal(production.status, 1);
  assert.match(production.stderr, /disabled in production/);
  const preview = spawnSync(process.execPath, ["--import", "tsx", path, "--check"], { env, encoding: "utf8" });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /360 orders/);
});

