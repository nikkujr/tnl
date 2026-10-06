import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

test("seed/reset persists report-ready data, rolls back failures and remains usable", { skip: process.env.TNL_INTEGRATION !== "1", timeout: 120000 }, async () => {
  const schema = `tnl_test_seed_${randomBytes(8).toString("hex")}`;
  assert.match(schema, /^tnl_test_seed_[a-f0-9]{16}$/);
  const admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  let db: any, server: any;
  try {
    await admin.query(`CREATE DATABASE \`${schema}\``);
    process.env.DB_NAME = schema;
    process.env.SMTP_HOST = "";
    const { buildDemoData, businessDate, demoPassword } = await import("../src/database/demo-data.js");
    const { totalCents } = await import("../src/features/orders/sales.js");
    const { packageCommission } = await import("../src/shared/money.js");
    const seed = await import("../src/database/seed.js");
    ({ db } = await import("../src/database/connection.js"));
    const { migrate } = await import("../src/database/migrate.js");
    const { getReport } = await import("../src/features/reports/query.js");
    await migrate();
    const data = buildDemoData();
    const count = async (table: string) => Number((await db.query(`SELECT COUNT(*) count FROM ${table}`))[0][0].count);
    await seed.seedDefenseData(data);
    assert.equal(await count("orders"), 360);
    const populated = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/database/seed.ts", import.meta.url))], { env: process.env, encoding: "utf8" });
    assert.equal(populated.status, 1, populated.stderr);
    assert.match(populated.stderr, /already contains/);
    assert(!populated.stdout.includes("Applied"), "refuse before migrations");
    await assert.rejects(seed.seedDefenseData(data), /already contains/);
    assert.equal(await count("orders"), 360);
    const verify = async () => {
      assert.equal(await count("products"), 60);
      assert.equal(await count("packages"), 6);
      assert.equal(await count("customers"), 60);
      assert.equal(await count("customer_accounts"), 60);
      assert.equal(await count("customer_order_requests"), 24);
      assert.equal(await count("order_reviews"), 80);
      assert.equal(await count("leads"), 24);
      assert.equal(await count("order_followups"), 16);
      assert.equal(await count("delivery_active_jobs"), 2);
      assert.equal(await count("delivery_completions"), 264);
      const [unsafeRuns] = await db.query("SELECT id FROM automation_runs WHERE state IN ('PENDING','PROCESSING')");
      assert.equal(unsafeRuns.length, 0);
      const [enabled] = await db.query("SELECT workflow FROM automation_settings WHERE enabled=TRUE");
      assert.equal(enabled.length, 0);
      const [stock] = await db.query(`SELECT p.sku,p.stock_on_hand onHand,p.stock_reserved reserved,
        SUM(CASE m.type WHEN 'ADD' THEN m.quantity WHEN 'DEDUCT' THEN -m.quantity ELSE 0 END) ledgerOnHand,
        SUM(CASE m.type WHEN 'RESERVE' THEN m.quantity WHEN 'DEDUCT' THEN -m.quantity WHEN 'RELEASE' THEN -m.quantity ELSE 0 END) ledgerReserved
        FROM products p JOIN inventory_movements m ON m.product_id=p.id GROUP BY p.id`);
      for (const p of stock) { assert.equal(p.onHand, Number(p.ledgerOnHand)); assert.equal(p.reserved, Number(p.ledgerReserved)); }
      const [invalidCommission] = await db.query(`SELECT co.id FROM commissions co JOIN orders o ON o.id=co.order_id
        WHERE o.payment_status<>'PAID' OR o.delivery_status<>'DELIVERED' OR o.agent_id IS NULL
        OR NOT EXISTS(SELECT 1 FROM order_packages op WHERE op.order_id=o.id)`);
      assert.equal(invalidCommission.length, 0);
      const [commissions] = await db.query("SELECT amount,breakdown FROM commissions");
      assert.equal(commissions.length, data.orders.filter(o => o.saleCompletedAt && o.agentId && o.sale.packages.length).length);
      for (const commission of commissions) {
        const parts = typeof commission.breakdown === "string" ? JSON.parse(commission.breakdown) : commission.breakdown;
        assert.equal(Math.round(commission.amount * 100), parts.reduce((sum: number, part: any) => sum + packageCommission({ ...part, sellingPrice: data.packages.find(p => p.name === part.name)!.sellingPrice }), 0));
      }
      const c = await db.getConnection();
      try {
        const report = await getReport(c, { period: "overall" });
        assert.equal(Number(report.totals.completedSales), 240);
        assert.equal(Math.round(report.totals.revenue * 100), data.orders.filter(o => o.saleCompletedAt).reduce((sum, o) => sum + totalCents(o.sale), 0));
        assert.equal(report.trend.length, 6);
        assert.equal(report.packages.length, 6);
        assert(report.slowProducts.some(p => p.unitsSold === 0));
        assert(report.stockAlerts.length > 0);
        const daily = await getReport(c, { period: "daily", date: businessDate(data.now) });
        assert(daily.totals.revenue > 0);
      } finally { c.release(); }
    };
    await verify();
    // A failure after deletes must restore the old records, including configuration.
    await db.query("UPDATE automation_settings SET enabled=TRUE WHERE workflow='LOW_STOCK'");
    const [oldOrder] = await db.query("SELECT id FROM orders ORDER BY id LIMIT 1");
    await db.query("CREATE TRIGGER demo_fail_insert BEFORE INSERT ON products FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Injected seed failure'");
    await assert.rejects(seed.seedDefenseData(data, true), /Injected seed failure/);
    await db.query("DROP TRIGGER demo_fail_insert");
    assert.equal(await count("orders"), 360);
    const [restored] = await db.query("SELECT id FROM orders ORDER BY id LIMIT 1");
    assert.equal(restored[0].id, oldOrder[0].id);
    assert.equal(Number((await db.query("SELECT enabled FROM automation_settings WHERE workflow='LOW_STOCK'"))[0][0].enabled), 1);
    await seed.seedDefenseData(data, true);
    await verify();
    const resetCli = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/database/seed.ts", import.meta.url)), "--reset", `--confirm=${schema}`], { env: process.env, encoding: "utf8" });
    assert.equal(resetCli.status, 0, resetCli.stderr);
    assert.match(resetCli.stdout, /orders: 360/);
    await verify();

    const { app } = await import("../src/app.js");
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1/`;
    async function call(path: string, token = "", body?: object, method = body ? "POST" : "GET", expected: number | number[] = 200) {
      const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      assert([expected].flat().includes(response.status), `${response.status}: ${JSON.stringify(value)}`);
      return value.data;
    }
    const staff = await call("auth/login", "", { email: "admin@tnl.local", password: demoPassword });
    const performance = await call(`performance?month=${data.periods.at(-1)}`, staff.token);
    assert.equal(performance.agents.length, 8);
    assert(performance.agents.some((a: any) => a.incentiveStatus === "APPROVED"));
    assert(performance.agents.some((a: any) => a.incentiveStatus === "ELIGIBLE"));
    assert(performance.agents.some((a: any) => a.sales === 0));
    const customer = await call("customer-auth/login", "", { email: "mara.santos@example.test", password: demoPassword });
    assert((await call("customer/orders", customer.token)).length > 0);
    const { signCustomer } = await import("../src/features/customer-auth/session.js");
    const tokenFor = async (customerId: number) => {
      const [rows] = await db.query("SELECT ca.id,ca.customer_id customerId,ca.token_version tokenVersion,c.full_name fullName,c.email FROM customer_accounts ca JOIN customers c ON c.id=ca.customer_id WHERE ca.customer_id=?", [customerId]);
      return signCustomer({ ...rows[0], role: "CUSTOMER" });
    };
    const [eligible] = await db.query("SELECT o.* FROM orders o LEFT JOIN order_reviews r ON r.order_id=o.id WHERE o.sale_completed_at IS NOT NULL AND o.agent_id IS NOT NULL AND r.order_id IS NULL ORDER BY o.id LIMIT 1");
    const reviewedOrder = eligible[0], reviewer = await tokenFor(reviewedOrder.customer_id);
    const feedback = { rating: 5, review: '  My agent explained the package and replied promptly.  ' };
    assert.equal((await call(`customer/orders/${reviewedOrder.id}`, reviewer)).canReview, true);
    await call(`customer/orders/${reviewedOrder.id}/review`, "", feedback, "POST", 401);
    await call(`customer/orders/${reviewedOrder.id}/review`, staff.token, feedback, "POST", 401);
    const [other] = await db.query("SELECT id FROM customers WHERE id<>? LIMIT 1", [reviewedOrder.customer_id]);
    const otherToken = await tokenFor(other[0].id);
    await call(`customer/orders/${reviewedOrder.id}/review`, otherToken, feedback, "POST", 404);
    await call(`customer/orders/${reviewedOrder.id}`, otherToken, undefined, "GET", 404);
    for (const body of [{ ...feedback, rating: 0 }, { ...feedback, rating: 6 }, { ...feedback, rating: 1.5 }, { ...feedback, rating: "5" }, { ...feedback, review: "  " }, { ...feedback, review: "x".repeat(2001) }, { ...feedback, agentId: 999 }])
      await call(`customer/orders/${reviewedOrder.id}/review`, reviewer, body, "POST", 400);
    const [unfinished] = await db.query("SELECT o.* FROM orders o WHERE o.order_status IN ('PENDING','APPROVED','CANCELLED','REJECTED') OR o.payment_status<>'PAID'");
    // Each workflow state is blocked even if the caller owns the order.
    const examples = new Map<string, any>();
    for (const o of unfinished) examples.set(`${o.order_status}-${o.payment_status}-${o.delivery_status}`, o);
    for (const o of examples.values()) {
      const token = await tokenFor(o.customer_id);
      assert.equal((await call(`customer/orders/${o.id}`, token)).canReview, false);
      await call(`customer/orders/${o.id}/review`, token, feedback, "POST", 409);
    }
    const posted = await Promise.all([call(`customer/orders/${reviewedOrder.id}/review`, reviewer, feedback, "POST", [200, 201]), call(`customer/orders/${reviewedOrder.id}/review`, reviewer, feedback, "POST", [200, 201])]);
    assert.equal(posted.filter(r => r.reused).length, 1);
    assert.equal(posted[0].createdAt, posted[1].createdAt);
    assert.equal(await count("order_reviews"), 81);
    await call(`customer/orders/${reviewedOrder.id}/review`, reviewer, { ...feedback, rating: 4 }, "POST", 409);
    const readBack = await call(`customer/orders/${reviewedOrder.id}`, reviewer);
    assert.equal(readBack.canReview, false);
    assert.equal(readBack.review.review, feedback.review.trim());
    const adminOrder = await call(`orders/${reviewedOrder.id}`, staff.token);
    assert.equal(adminOrder.review.review, feedback.review.trim());
    assert.equal(adminOrder.review.agentId, reviewedOrder.agent_id);
    const [creditedAgent] = await db.query("SELECT email FROM users WHERE id=?", [reviewedOrder.agent_id]);
    const agentLogin = await call("auth/login", "", { email: creditedAgent[0].email, password: demoPassword });
    assert.equal((await call(`orders/${reviewedOrder.id}`, agentLogin.token)).review, undefined);
    await call(`customers/${reviewedOrder.customer_id}`, agentLogin.token, undefined, "GET", 403);
    await call(`customers/${reviewedOrder.customer_id}`, reviewer, undefined, "GET", [401, 403]);
    await call(`customers/${reviewedOrder.customer_id}`, "", undefined, "GET", 401);
    await call("customers/invalid", staff.token, undefined, "GET", 400);
    await call("customers/99999999", staff.token, undefined, "GET", 404);
    for (const query of ["view=invalid", "page=0", "page=1.5", "limit=101", "limit=0"])
      await call(`customers/${reviewedOrder.customer_id}?${query}`, staff.token, undefined, "GET", 400);
    for (const [view, table, key] of [["orders", "orders", "orderCount"], ["requests", "customer_order_requests", "requestCount"], ["reviews", "order_reviews", "reviewCount"], ["followups", "order_followups", "followupCount"]]) {
      // Exercise populated histories and make sure every row belongs to this customer.
      const [owner] = await db.query(`SELECT customer_id FROM ${table} GROUP BY customer_id ORDER BY COUNT(*) DESC LIMIT 1`);
      const ownerId = owner[0].customer_id;
      const profile = await call(`customers/${ownerId}?view=${view}&limit=2`, staff.token);
      assert.equal(profile.customer.id, ownerId);
      const [rows] = await db.query(`SELECT ${view === "reviews" ? "order_id" : "id"} id FROM ${table} WHERE customer_id=?`, [ownerId]);
      assert.equal(Number(profile.summary[key!]), rows.length);
      assert.equal(profile.records.length, Math.min(2, rows.length));
      assert(profile.records.every((r: any) => rows.some((row: any) => row.id === r.id)));
      assert(!("password_hash" in profile.customer) && !("unsubscribe_token" in profile.customer));
      if (view === "requests") assert(profile.records.every((r: any) => r.selections.length > 0 && r.total > 0));
      if (rows.length > 2) {
        const second = await call(`customers/${ownerId}?view=${view}&limit=2&page=2`, staff.token);
        assert(second.records.every((r: any) => rows.some((row: any) => row.id === r.id) && !profile.records.some((first: any) => first.id === r.id)));
      }
    }
    await db.query("UPDATE customers SET assigned_agent_id=(SELECT id FROM users WHERE role='AGENT' AND id<>? LIMIT 1) WHERE id=?", [reviewedOrder.agent_id, reviewedOrder.customer_id]);
    const rated = await call(`performance?month=${data.periods.at(-1)}`, staff.token);
    assert.equal(rated.reviews.find((r: any) => r.orderId === reviewedOrder.id).agentId, reviewedOrder.agent_id);
    for (const agent of rated.agents) {
      const reviews = rated.reviews.filter((r: any) => r.agentId === agent.id);
      assert.equal(Number(agent.reviewCount), reviews.length);
      assert.equal(agent.averageRating, reviews.length ? Math.round(reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length * 100) / 100 : null);
    }
    await call("performance", reviewer, undefined, "GET", [401, 403]);
    // Feedback is grouped by submission month, independently of sale completion.
    const { monthBounds } = await import("../src/features/performance/model.js");
    const priorMonthTime = new Date(monthBounds(data.periods.at(-1)!).start.getTime() - 1000);
    await db.query("UPDATE order_reviews SET created_at=? WHERE order_id=?", [priorMonthTime, reviewedOrder.id]);
    const currentFeedback = await call(`performance?month=${data.periods.at(-1)}`, staff.token);
    assert(!currentFeedback.reviews.some((r: any) => r.orderId === reviewedOrder.id));
    const priorFeedback = await call(`performance?month=${businessDate(priorMonthTime).slice(0, 7)}`, staff.token);
    assert.equal(priorFeedback.reviews.find((r: any) => r.orderId === reviewedOrder.id).rating, 5);
    const listedAgents = await call("agents", staff.token);
    const [allReviews] = await db.query("SELECT order_id orderId,customer_id customerId,agent_id agentId,rating,created_at createdAt FROM order_reviews");
    for (const listed of listedAgents) {
      const expected = allReviews.filter((r: any) => r.agentId === listed.id);
      const average = expected.length ? Math.round(expected.reduce((sum: number, r: any) => sum + r.rating, 0) / expected.length * 100) / 100 : null;
      const detail = await call(`agents/${listed.id}`, staff.token);
      assert.equal(listed.averageRating, average);
      assert.equal(Number(listed.reviewCount), expected.length);
      assert.equal(detail.averageRating, average);
      assert.equal(Number(detail.reviewCount), expected.length);
      const reviews = await call(`agents/${listed.id}/reviews?limit=100`, staff.token);
      assert.equal(reviews.length, expected.length);
      const sorted = expected.sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime() || b.orderId - a.orderId);
      assert.deepEqual(reviews.map((r: any) => r.orderId), sorted.map((r: any) => r.orderId));
      assert(reviews.every((r: any) => expected.some((e: any) => e.orderId === r.orderId && e.customerId === r.customerId)));
      if (expected.length > 2) {
        const first = await call(`agents/${listed.id}/reviews?limit=2`, staff.token);
        const second = await call(`agents/${listed.id}/reviews?limit=2&page=2`, staff.token);
        assert.equal(first.length, 2);
        assert.deepEqual(second.map((r: any) => r.orderId), sorted.slice(2, 4).map((r: any) => r.orderId));
      }
    }
    const creditedReviews = await call(`agents/${reviewedOrder.agent_id}/reviews?limit=100`, staff.token);
    assert(creditedReviews.some((r: any) => r.orderId === reviewedOrder.id), "Reassignment or a different submission month changed agent review credit");
    for (const token of [agentLogin.token, reviewer, ""])
      await call(`agents/${reviewedOrder.agent_id}/reviews`, token, undefined, "GET", token === agentLogin.token ? 403 : [401, 403]);
    await call("agents/invalid/reviews", staff.token, undefined, "GET", 400);
    await call("agents/99999999/reviews", staff.token, undefined, "GET", 404);
    await call(`agents/${staff.user.id}/reviews`, staff.token, undefined, "GET", 404);
    for (const query of ["page=0", "page=1.5", "limit=0", "limit=101"])
      await call(`agents/${reviewedOrder.agent_id}/reviews?${query}`, staff.token, undefined, "GET", 400);
    await db.query("UPDATE users SET active=FALSE WHERE id=?", [reviewedOrder.agent_id]);
    assert.equal((await call(`agents/${reviewedOrder.agent_id}`, staff.token)).reviewCount, creditedReviews.length);
    const delivery = await call("auth/login", "", { email: "delivery1@tnl.local", password: demoPassword });
    await call(`agents/${reviewedOrder.agent_id}/reviews`, delivery.token, undefined, "GET", 403);
    const deliveries = await call("delivery/orders", delivery.token);
    assert(deliveries.some((o: any) => o.attemptId));
    // Verify an existing reserved order can complete through the real delivery service.
    const active = deliveries.find((o: any) => o.attemptId);
    await call(`orders/${active.id}/delivery-status`, staff.token, { assignmentVersion: active.assignmentVersion, deliveryStatus: "DELIVERED", recipientName: active.recipientName, exceptionReason: "Test admin confirms the demonstration recipient handover." }, "PATCH");
  } finally {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (db) await db.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
  }
});
