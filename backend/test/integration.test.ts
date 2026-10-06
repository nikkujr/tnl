import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import jwt from "jsonwebtoken";

test(
  "isolated MySQL business, authorization, outbox, and recovery acceptance",
  { skip: process.env.TNL_INTEGRATION !== "1", timeout: 120000 },
  async (t) => {
    const schema = `tnl_test_${randomBytes(8).toString("hex")}`;
    assert.match(schema, /^tnl_test_[a-f0-9]{16}$/);
    const admin = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
    const messages: string[] = [];
    let smtpFailure = 0;
    const smtp = createServer((socket) => {
      socket.write("220 localhost test SMTP\r\n");
      let buffer = "",
        data = false,
        body = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        let index: number;
        while ((index = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (data) {
            if (line === ".") {
              messages.push(body);
              body = "";
              data = false;
              socket.write("250 queued\r\n");
            } else body += line + "\n";
            continue;
          }
          if (/^EHLO|^HELO/.test(line))
            socket.write("250-localhost\r\n250 PIPELINING\r\n");
          else if (line === "DATA") {
            data = true;
            socket.write("354 continue\r\n");
          } else if (line === "QUIT") {
            socket.end("221 bye\r\n");
          } else if (/^MAIL FROM/i.test(line) && smtpFailure) {
            socket.write(`${smtpFailure} test failure\r\n`);
          } else socket.write("250 OK\r\n");
        }
      });
    });
    let db: any, server: any;
    try {
      await admin.query(`CREATE DATABASE \`${schema}\``);
      await new Promise<void>((resolve) =>
        smtp.listen(0, "127.0.0.1", resolve),
      );
      process.env.DB_NAME = schema;
      process.env.DELIVERY_PHOTO_DIR = new URL(`../../.tmp/${schema}-photos`, import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1");
      process.env.DELIVERY_PHOTO_DIR = new URL(`../../.tmp/${schema}-photos`, import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1");
      process.env.SMTP_HOST = "127.0.0.1";
      process.env.SMTP_PORT = String((smtp.address() as any).port);
      process.env.SMTP_SECURE = "false";
      process.env.SMTP_FROM = "test@example.test";
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
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
        "INSERT INTO users(id,email,password_hash,full_name,role,commission_rate) VALUES(1,'admin@example.test','!','Admin','ADMIN',0),(2,'agent@example.test','!','Agent','AGENT',99),(3,'other@example.test','!','Other Agent','AGENT',50)",
      );
      await db.query(
        "INSERT INTO customers(id,full_name,email,phone,address,assigned_agent_id,marketing_opt_in) VALUES(1,'Existing customer','one@example.test','09171234567','Original address',2,TRUE),(2,'Other customer','two@example.test','09171234568','Other address',NULL,FALSE),(3,'Imported','import@placeholder.tnl.local','09171234569','Import address',NULL,TRUE)",
      );
      await db.query("INSERT INTO categories(id,name) VALUES(1,'General')");
      await db.query(
        "INSERT INTO products(id,category_id,name,sku,price,stock_on_hand) VALUES(1,1,'One','ONE',10,100),(2,1,'Two','TWO',20,100),(3,1,'Scarce','SCARCE',30,1)",
      );
      const { app } = await import("../src/app.js");
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = `http://127.0.0.1:${server.address().port}/api/v1`;
      const token = (id: number, role: string) =>
        jwt.sign(
          { id, role, email: `${id}@example.test`, fullName: role },
          process.env.JWT_SECRET!,
          { expiresIn: "1h" },
        );
      const a = token(1, "ADMIN"),
        agent = token(2, "AGENT"),
        other = token(3, "AGENT");
      async function call(
        path: string,
        method = "GET",
        body?: any,
        auth = a,
        expected = 200,
      ) {
        const response = await fetch(base + "/" + path, {
          method,
          headers: {
            "content-type": "application/json",
            ...(auth ? { authorization: "Bearer " + auth } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const value = await response.json();
        assert.equal(response.status, expected, JSON.stringify(value));
        return value.data;
      }
      await t.test(
        "email preview uses the sending layout without changing data or sending",
        async () => {
          const [before] = await db.query<any[]>(
            "SELECT COUNT(*) count FROM automation_runs",
          );
          const body = {
            workflow: "ORDER_UPDATES",
            subject: "Order {{trackingNumber}}",
            template: "Hello {{customerName}}, your order is {{status}}.",
          };
          const preview = await call("automations/email-preview", "POST", body);
          assert.match(preview.html, /TNL TRACK/);
          assert.match(preview.html, /Maria Santos/);
          assert.match(preview.html, /In transit/);
          assert.match(preview.html, /data-preview-href=/);
          assert(!preview.html.includes(" href="));
          assert.equal(preview.subject, "Order TNL-1042");
          assert.equal(messages.length, 0);
          const [after] = await db.query<any[]>(
            "SELECT COUNT(*) count FROM automation_runs",
          );
          assert.equal(after[0].count, before[0].count);
          await call("automations/email-preview", "POST", body, agent, 403);
          await call("automations/email-preview", "POST", body, "", 401);
          await call(
            "automations/email-preview",
            "POST",
            { ...body, workflow: "ACCOUNT_EMAIL" },
            a,
            400,
          );
        },
      );
      const packageBody = {
        name: "Fixed bundle",
        sellingPrice: 100.01,
        commissionType: "FIXED",
        commissionValue: 12.35,
        components: [
          { productId: 1, quantity: 2 },
          { productId: 2, quantity: 1 },
        ],
      };
      const p = (await call("packages", "POST", packageBody, a, 201)).id;
      const p2 = (
        await call(
          "packages",
          "POST",
          {
            ...packageBody,
            name: "Percent bundle",
            commissionType: "PERCENTAGE",
            commissionValue: 7.5,
            sellingPrice: 99.99,
          },
          a,
          201,
        )
      ).id;
      const create = (packages: any[], items: any[] = [], customerId = 1) =>
        call(
          "orders",
          "POST",
          {
            customerId,
            agentId: 2,
            deliveryAddress: "Delivery address",
            paymentMethod: "Cash on delivery",
            packages,
            items,
          },
          // Product selections are created by admins; package-only orders exercise agents.
          items.length ? a : agent,
          201,
        );
      const approve = (id: number) =>
        call(`orders/${id}/decision`, "POST", { decision: "APPROVE" });
      const pay = (id: number, status = "PAID") =>
        call(`orders/${id}/payment-status`, "PATCH", {
          paymentStatus: status,
          paymentMethod: "Cash on delivery",
          cashReceived: null,
        });
      const deliver = (id: number, status = "DELIVERED") =>
        call(
          `orders/${id}/delivery-status`,
          "PATCH",
          {
            deliveryStatus: status,
            ...(status !== "DELIVERED" ? { estimatedDeliveryAt: new Date(Date.now() + 4 * 3600000).toISOString() } : {}),
            assignmentVersion: 0,
            notes: "Internal notes",
            recipientName: "Test recipient",
            exceptionReason: "Integration test admin completion",
            latitude: 14,
            longitude: 120,
          },
          a,
        );
      const { claim, execute, scan, heartbeat } =
        await import("../src/features/automations/worker.js");
      const drain = async () => {
        for (let i = 0; i < 100; i++) {
          const r = await claim();
          if (!r) return;
          await execute(r);
        }
        throw new Error("Unexpected excessive backlog");
      };
      await t.test(
        "agents cannot create standalone or mixed product orders",
        async () => {
          const [before] = await db.query<any[]>(
            "SELECT COUNT(*) count FROM orders",
          );
          for (const packages of [[], [{ packageId: p, quantity: 1 }]]) {
            await call(
              "orders",
              "POST",
              {
                customerId: 1,
                deliveryAddress: "Delivery address",
                paymentMethod: "Bank transfer",
                items: [{ productId: 1, quantity: 1 }],
                packages,
              },
              agent,
              403,
            );
          }
          const [after] = await db.query<any[]>(
            "SELECT COUNT(*) count FROM orders",
          );
          assert.equal(after[0].count, before[0].count);
        },
      );
      await t.test(
        "mixed quantities and concurrent payment/delivery post one stock deduction and package commission",
        async () => {
          const o = await create(
            [
              { packageId: p, quantity: 2 },
              { packageId: p2, quantity: 3 },
            ],
            [{ productId: 1, quantity: 2 }],
          );
          assert.equal(o.total, 519.99);
          await call("products/2", "DELETE", {}, a, 409);
          await approve(o.id);
          let [stock] = await db.query(
            "SELECT stock_reserved FROM products WHERE id=1",
          );
          assert.equal(stock[0].stock_reserved, 12);
          await Promise.all([
            pay(o.id),
            deliver(o.id),
            pay(o.id),
            deliver(o.id),
          ]);
          const [commissions] = await db.query(
            "SELECT * FROM commissions WHERE order_id=?",
            [o.id],
          );
          assert.equal(commissions.length, 1);
          assert.equal(commissions[0].amount, 47.2);
          assert.equal(commissions[0].rate, null);
          const agentList = await call("agents");
          assert.equal(
            agentList.find((agent: any) => agent.id === 2).totalCommission,
            47.2,
          );
          const agentDetail = await call("agents/2");
          assert.equal(
            agentDetail.orders.find((order: any) => order.id === o.id)
              .commissionStatus,
            "EARNED",
          );
          const [movements] = await db.query(
            "SELECT COUNT(*) count FROM inventory_movements WHERE order_id=? AND type='DEDUCT'",
            [o.id],
          );
          assert.equal(movements[0].count, 2);
          await call(
            `orders/${o.id}/payment-status`,
            "PATCH",
            {
              paymentStatus: "UNPAID",
              paymentMethod: "Cash on delivery",
              cashReceived: null,
            },
            a,
            409,
          );
          await call(
            `orders/${o.id}/delivery-status`,
            "PATCH",
            { assignmentVersion: 0, deliveryStatus: "IN_TRANSIT" },
            a,
            409,
          );
          const publicOrder = await call(
            "tracking/" + o.trackingNumber,
            "GET",
            undefined,
            "",
          );
          assert(!JSON.stringify(publicOrder).includes("Internal notes"));
          assert(!JSON.stringify(publicOrder).includes("Delivery address"));
          assert(!("paymentStatus" in publicOrder));
        },
      );
      await t.test(
        "delivery before payment and standalone completion",
        async () => {
          const o = await create([{ packageId: p, quantity: 1 }]);
          await call(
            `orders/${o.id}`,
            "PUT",
            {
              customerId: 1,
              deliveryAddress: "Delivery address",
              paymentMethod: "Cash on delivery",
              packages: [{ packageId: p, quantity: 1 }],
              items: [{ productId: 1, quantity: 1 }],
            },
            agent,
            403,
          );
          await approve(o.id);
          await deliver(o.id);
          let [rows] = await db.query(
            "SELECT id FROM commissions WHERE order_id=?",
            [o.id],
          );
          assert.equal(rows.length, 0);
          const waiting = await call("agents/2");
          assert.equal(
            waiting.orders.find((order: any) => order.id === o.id)
              .commissionStatus,
            "AWAITING_PAYMENT",
          );
          await pay(o.id);
          [rows] = await db.query(
            "SELECT id FROM commissions WHERE order_id=?",
            [o.id],
          );
          assert.equal(rows.length, 1);
          await db.query(
            "UPDATE automation_settings SET enabled=TRUE WHERE workflow='PURCHASE_FOLLOWUP'",
          );
          const standalone = await create([], [{ productId: 1, quantity: 1 }]);
          await approve(standalone.id);
          await pay(standalone.id);
          await deliver(standalone.id);
          const [jobs] = await db.query(
            "SELECT id FROM automation_runs WHERE dedupe_key=?",
            ["purchase:" + standalone.id],
          );
          assert.equal(jobs.length, 1);
          const [cs] = await db.query(
            "SELECT id FROM commissions WHERE order_id=?",
            [standalone.id],
          );
          assert.equal(cs.length, 0);
          const agentDetail = await call("agents/2");
          assert.equal(
            agentDetail.orders.find((order: any) => order.id === standalone.id)
              .commissionStatus,
            "STANDALONE",
          );
        },
      );
      await t.test("stock contention reserves only one winner", async () => {
        const o1 = await create([], [{ productId: 3, quantity: 1 }]),
          o2 = await create([], [{ productId: 3, quantity: 1 }]);
        const results = await Promise.all(
          [o1, o2].map((o) =>
            fetch(`${base}/orders/${o.id}/decision`, {
              method: "POST",
              headers: {
                authorization: "Bearer " + a,
                "content-type": "application/json",
              },
              body: JSON.stringify({ decision: "APPROVE" }),
            }),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      });
      let customerToken = "",
        customer2 = "";
      await t.test(
        "verified linking preserves contact and excludes customers from all staff surfaces",
        async () => {
          await call(
            "customer-auth/register",
            "POST",
            {
              email: "one@example.test",
              password: "correct-password",
              fullName: "Overwrite attempt",
              phone: "09179999999",
              address: "Overwrite address",
              marketingOptIn: false,
            },
            "",
            202,
          );
          const [jobs] = await db.query(
            "SELECT payload FROM automation_runs WHERE workflow='ACCOUNT_EMAIL' ORDER BY id DESC LIMIT 1",
          );
          const raw = (
            typeof jobs[0].payload === "string"
              ? JSON.parse(jobs[0].payload)
              : jobs[0].payload
          ).text.match(/verify=([a-f0-9]{64})/)[1];
          customerToken = (
            await call("customer-auth/verify", "POST", { token: raw }, "")
          ).token;
          await call("customer-auth/verify", "POST", { token: raw }, "", 400);
          const me = await call("customer/me", "GET", undefined, customerToken);
          assert.equal(me.fullName, "Existing customer");
          assert.equal(me.address, "Original address");
          for (const endpoint of [
            "orders",
            "products",
            "customers",
            "dashboard",
            "packages",
            "requests",
            "notifications",
            "agents",
            "campaigns",
            "commissions",
            "automations",
            "imports",
          ])
            await call(endpoint, "GET", undefined, customerToken, 403);
          await db.query(
            "INSERT INTO customer_accounts(id,customer_id,password_hash) VALUES(2,2,'!')",
          );
          const { signCustomer } =
            await import("../src/features/customer-auth/session.js");
          customer2 = signCustomer({
            id: 2,
            customerId: 2,
            email: "two@example.test",
            fullName: "Other",
            role: "CUSTOMER",
            tokenVersion: 0,
          });
          await call("customer/orders/1", "GET", undefined, customer2, 404);
          await call(
            "customer/orders/1/followups",
            "POST",
            { message: "Trying to access another order" },
            customer2,
            404,
          );
          await call(
            "customer/me",
            "GET",
            undefined,
            jwt.sign(
              { id: 2, customerId: 2, role: "CUSTOMER", tokenVersion: 0 },
              process.env.JWT_SECRET!,
              { audience: "customer", expiresIn: -1 },
            ),
            401,
          );
        },
      );
      await t.test(
        "saved requests reject stale review, reserve nothing, preserve terms, convert once and route fallback",
        async () => {
          const offers = await call("catalog", "GET", undefined, "");
          const offer = offers.find(
            (o: any) => o.kind === "PACKAGE" && o.id === p,
          );
          const body = {
            items: [],
            packages: [{ packageId: p, quantity: 1 }],
            deliveryAddress: "Confirmed address",
            paymentMethod: "Cash on delivery",
            reviewedTerms: [
              { kind: "PACKAGE", id: p, revision: offer.revision },
            ],
          };
          const [before] = await db.query(
            "SELECT stock_reserved FROM products WHERE id=1",
          );
          const request = await call(
            "customer/requests",
            "POST",
            body,
            customerToken,
            201,
          );
          const [after] = await db.query(
            "SELECT stock_reserved FROM products WHERE id=1",
          );
          assert.equal(after[0].stock_reserved, before[0].stock_reserved);
          await call(`packages/${p}`, "PUT", {
            ...packageBody,
            sellingPrice: 999,
            commissionValue: 1,
          });
          await call("customer/requests", "POST", body, customerToken, 409);
          const converted = await Promise.all([
            call(`requests/${request.id}/convert`, "POST", {}, agent),
            call(`requests/${request.id}/convert`, "POST", {}, agent),
          ]);
          assert.equal(converted[0].id, converted[1].id);
          const detail = await call("orders/" + converted[0].id);
          assert.equal(detail.packages[0].sellingPrice, 100.01);
          assert.equal(detail.packages[0].commissionValue, 12.35);
          await call(`requests/${request.id}/convert`, "POST", {}, other, 404);
          const product = offers.find(
            (o: any) => o.kind === "PRODUCT" && o.id === 1,
          );
          const queued = await call(
            "customer/requests",
            "POST",
            {
              ...body,
              packages: [],
              items: [{ productId: 1, quantity: 1 }],
              reviewedTerms: [
                { kind: "PRODUCT", id: 1, revision: product.revision },
              ],
            },
            customer2,
            201,
          );
          await call(`requests/${queued.id}/convert`, "POST", {}, other, 404);
          await call(`requests/${queued.id}/assignment`, "PATCH", {
            agentId: 2,
          });
          await call(`requests/${queued.id}/convert`, "POST", {}, agent);
          const officeRequest = await call("customer/requests", "POST", {
            ...body, packages: [], items: [{ productId: 1, quantity: 1 }],
            reviewedTerms: [{ kind: "PRODUCT", id: 1, revision: product.revision }],
          }, customer2, 201);
          await call(`requests/${officeRequest.id}/convert`, "POST", {}, agent, 404);
          const office = await call(`requests/${officeRequest.id}/convert`, "POST", {}, a);
          assert.equal((await call(`orders/${office.id}`)).agentId, null);
          assert.equal((await call(`customer/orders/${office.id}`, "GET", undefined, customer2)).agentName, null);
          const notifications = await call(
            "notifications",
            "GET",
            undefined,
            agent,
          );
          assert(notifications.some((n: any) => n.type === "REQUEST"));
          await call("notifications/read", "POST", {}, agent);
          assert(
            (await call("notifications", "GET", undefined, agent)).every(
              (n: any) => n.readAt,
            ),
          );
          const f = await call(
            `customer/orders/${converted[0].id}/followups`,
            "POST",
            { message: "Please update me" },
            customerToken,
            201,
          );
          const f2 = await call(
            `customer/orders/${converted[0].id}/followups`,
            "POST",
            { message: "Again" },
            customerToken,
            201,
          );
          assert.equal(f.id, f2.id);
          await call(
            `requests/followups/${f.id}/reply`,
            "POST",
            { reply: "We are processing your order." },
            other,
            404,
          );
          await call(
            `requests/followups/${f.id}/reply`,
            "POST",
            { reply: "We are processing your order." },
            agent,
          );
          const owned = await call(
            `customer/orders/${converted[0].id}`,
            "GET",
            undefined,
            customerToken,
          );
          assert.equal(
            owned.followups[0].reply,
            "We are processing your order.",
          );
        },
      );
      await t.test(
        "reminder resolves before execution, low stock rearms, campaign executes once and rechecks unsubscribe",
        async () => {
          await db.query(
            "UPDATE automation_settings SET enabled=TRUE WHERE workflow IN ('PENDING_APPROVAL','LOW_STOCK','SCHEDULED_CAMPAIGN')",
          );
          const o = await create([], [{ productId: 1, quantity: 1 }]);
          await db.query(
            "UPDATE orders SET created_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 25 HOUR) WHERE id=?",
            [o.id],
          );
          await scan();
          await scan();
          await approve(o.id);
          await drain();
          const [reminders] = await db.query(
            "SELECT state FROM automation_runs WHERE workflow='PENDING_APPROVAL' AND JSON_EXTRACT(payload,'$.orderId')=?",
            [o.id],
          );
          assert.equal(reminders.length, 1);
          assert.equal(reminders[0].state, "SKIPPED");
          await db.query(
            "UPDATE products SET low_stock_threshold=stock_on_hand-stock_reserved WHERE id=2",
          );
          await scan();
          await db.query(
            "UPDATE products SET stock_on_hand=stock_on_hand+20 WHERE id=2",
          );
          await scan();
          await db.query(
            "UPDATE products SET low_stock_threshold=stock_on_hand-stock_reserved WHERE id=2",
          );
          await scan();
          const [episodes] = await db.query(
            "SELECT generation FROM automation_episodes WHERE workflow='LOW_STOCK' AND entity_id=2",
          );
          assert.equal(episodes[0].generation, 2);
          await drain();
          const [stockRuns] = await db.query(
            "SELECT state FROM automation_runs WHERE workflow='LOW_STOCK' AND JSON_EXTRACT(payload,'$.productId')=2 ORDER BY id",
          );
          assert.deepEqual(
            stockRuns.map((r: any) => r.state),
            ["SKIPPED", "SUCCEEDED"],
          );
          const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
          }).format(new Date());
          const tomorrow = new Date(
            new Date(today + "T12:00:00Z").getTime() + 86400000,
          )
            .toISOString()
            .slice(0, 10);
          const campaign = await call(
            "campaigns",
            "POST",
            {
              name: "One send",
              content: "Offer",
              startDate: today,
              endDate: tomorrow,
              audienceType: "ALL",
              status: "DRAFT",
            },
            a,
            201,
          );
          const recipients = await call(`campaigns/${campaign.id}/recipients`);
          assert.equal(recipients.length, 1);
          const sent = await call(
            `campaigns/${campaign.id}/send`,
            "POST",
            {},
            a,
            202,
          );
          const again = await call(
            `campaigns/${campaign.id}/send`,
            "POST",
            {},
            a,
            202,
          );
          assert.equal(sent.id, again.id);
          await call(
            "customer/preferences",
            "PATCH",
            { marketingOptIn: false },
            customerToken,
          );
          await drain();
          const results = await call(`campaigns/${campaign.id}/results`);
          assert.equal(results.length, 1);
          assert.equal(results[0].state, "SKIPPED");
          await call(
            "customer/preferences",
            "PATCH",
            { marketingOptIn: true },
            customerToken,
          );
          const scheduled = await call(
            "campaigns",
            "POST",
            {
              name: "Scheduled once",
              content: "Scheduled offer",
              startDate: today,
              endDate: tomorrow,
              status: "SCHEDULED",
              scheduledAt: new Date(Date.now() - 60000).toISOString(),
              audienceType: "SELECTED",
              customerIds: [1],
            },
            a,
            201,
          );
          await scan();
          await scan();
          await drain();
          const delivered = await call(`campaigns/${scheduled.id}/results`);
          assert.equal(delivered.length, 1);
          assert.equal(delivered[0].state, "ACCEPTED");
          assert(messages.length > 0);
          const lastEmail = messages.at(-1)!;
          assert.match(lastEmail, /multipart\/alternative/);
          assert.match(lastEmail, /text\/plain/);
          assert.match(lastEmail, /text\/html/);
          assert.match(lastEmail, /TNL TRACK/);
        },
      );
      await t.test(
        "expired leases recover safely; uncertain sends need explicit acknowledgment",
        async () => {
          await drain();
          const [retryRun] = await db.query(
            "INSERT INTO automation_runs(workflow,dedupe_key,payload,available_at) VALUES('ACCOUNT_EMAIL','bounded-retry',?,UTC_TIMESTAMP())",
            [
              JSON.stringify({
                kind: "EMAIL",
                to: "one@example.test",
                subject: "Retry",
                text: "Retry",
              }),
            ],
          );
          const messageCount = messages.length;
          smtpFailure = 451;
          try {
            for (let attempt = 1; attempt <= 5; attempt++) {
              await db.query(
                "UPDATE automation_runs SET available_at=UTC_TIMESTAMP() WHERE id=?",
                [retryRun.insertId],
              );
              await drain();
              const [retryRows] = await db.query(
                "SELECT state,attempts,available_at>UTC_TIMESTAMP() retryDueLater FROM automation_runs WHERE id=?",
                [retryRun.insertId],
              );
              assert.equal(retryRows[0].attempts, attempt);
              assert.equal(
                retryRows[0].state,
                attempt < 5 ? "PENDING" : "FAILED",
              );
              assert.equal(retryRows[0].retryDueLater, 1);
            }
            assert.equal(messages.length, messageCount);
          } finally {
            smtpFailure = 0;
          }
          await db.query(
            "INSERT INTO automation_runs(workflow,dedupe_key,payload,state,lease_owner,lease_until,send_started_at,available_at) VALUES('ACCOUNT_EMAIL','uncertain',?, 'PROCESSING','dead',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),UTC_TIMESTAMP(),UTC_TIMESTAMP()),('ACCOUNT_EMAIL','safe',?,'PROCESSING','dead',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),NULL,UTC_TIMESTAMP())",
            [
              JSON.stringify({
                kind: "EMAIL",
                to: "one@example.test",
                text: "Test",
                subject: "Test",
              }),
              JSON.stringify({
                kind: "EMAIL",
                to: "one@example.test",
                text: "Safe",
                subject: "Safe",
              }),
            ],
          );
          await drain();
          const [runs] = await db.query(
            "SELECT id,state FROM automation_runs WHERE dedupe_key IN ('uncertain','safe') ORDER BY dedupe_key",
          );
          assert.equal(runs[0].state, "ACCEPTED");
          assert.equal(runs[1].state, "UNKNOWN");
          await call(
            `automations/runs/${runs[1].id}/retry`,
            "POST",
            {},
            a,
            409,
          );
          await call(`automations/runs/${runs[1].id}/retry`, "POST", {
            acknowledgeDuplicateRisk: true,
          });
          const [auditRows] = await db.query(
            "SELECT actor_id,payload FROM domain_events WHERE type='automation.retry_requested' AND aggregate_id=?",
            [runs[1].id],
          );
          assert.equal(auditRows.length, 1);
          assert.equal(auditRows[0].actor_id, 1);
          const retryAudit =
            typeof auditRows[0].payload === "string"
              ? JSON.parse(auditRows[0].payload)
              : auditRows[0].payload;
          assert.equal(retryAudit.previousState, "UNKNOWN");
          assert.equal(retryAudit.acknowledgeDuplicateRisk, true);
          assert.equal(retryAudit.previousError, "Worker lease expired");
          assert.equal(typeof retryAudit.previousAttempts, "number");
          await drain();
          await heartbeat();
          const health = await call("automations");
          assert(health.workers.length);
        },
      );
      await t.test(
        "delivered unpaid reminders fire once and stage progress resolves stalled reminders",
        async () => {
          await db.query(
            "UPDATE automation_settings SET enabled=TRUE WHERE workflow IN ('OUTSTANDING_PAYMENT','STALLED_DELIVERY')",
          );
          const o = await create([], [{ productId: 1, quantity: 1 }]);
          await approve(o.id);
          await deliver(o.id);
          await db.query(
            "UPDATE orders SET approved_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 73 HOUR) WHERE id=?",
            [o.id],
          );
          await scan();
          await scan();
          await drain();
          let [rows] = await db.query(
            "SELECT state FROM automation_runs WHERE workflow='OUTSTANDING_PAYMENT' AND JSON_EXTRACT(payload,'$.orderId')=?",
            [o.id],
          );
          assert.equal(rows.length, 1);
          assert.equal(rows[0].state, "SUCCEEDED");
          await pay(o.id);
          await scan();
          [rows] = await db.query(
            "SELECT id FROM automation_runs WHERE workflow='OUTSTANDING_PAYMENT' AND JSON_EXTRACT(payload,'$.orderId')=?",
            [o.id],
          );
          assert.equal(rows.length, 1);
          const stalled = await create([], [{ productId: 1, quantity: 1 }]);
          await approve(stalled.id);
          await db.query(
            "UPDATE orders SET delivery_changed_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 49 HOUR) WHERE id=?",
            [stalled.id],
          );
          await scan();
          await deliver(stalled.id, "IN_TRANSIT");
          await drain();
          const [jobs] = await db.query(
            "SELECT state FROM automation_runs WHERE workflow='STALLED_DELIVERY' AND JSON_EXTRACT(payload,'$.orderId')=?",
            [stalled.id],
          );
          assert.equal(jobs.length, 1);
          assert.equal(jobs[0].state, "SKIPPED");
        },
      );
      await t.test(
        "account invitations require chosen passwords and expired links are rejected",
        async () => {
          await call(
            "customers",
            "POST",
            {
              fullName: "Invite contact",
              email: "invite@example.test",
              phone: "09171234560",
              address: "Invitation address",
              assignedAgentId: 2,
            },
            a,
            201,
          );
          const [contacts] = await db.query(
            "SELECT id FROM customers WHERE email='invite@example.test'",
          );
          await call(
            "customer-auth/invite",
            "POST",
            { customerId: contacts[0].id },
            agent,
            202,
          );
          const [jobs] = await db.query(
            "SELECT payload FROM automation_runs WHERE workflow='ACCOUNT_EMAIL' ORDER BY id DESC LIMIT 1",
          );
          const payload =
              typeof jobs[0].payload === "string"
                ? JSON.parse(jobs[0].payload)
                : jobs[0].payload,
            raw = payload.text.match(/verify=([a-f0-9]{64})/)[1];
          await call("customer-auth/verify", "POST", { token: raw }, "", 400);
          const account = await call(
            "customer-auth/verify",
            "POST",
            { token: raw, password: "invite-password" },
            "",
          );
          assert.equal(account.user.customerId, contacts[0].id);
          await call(
            "customer-auth/register",
            "POST",
            {
              email: "expired@example.test",
              password: "correct-password",
              fullName: "Expired",
              phone: "09171234561",
              address: "Expired address",
            },
            "",
            202,
          );
          const [expired] = await db.query(
            "SELECT payload FROM automation_runs WHERE workflow='ACCOUNT_EMAIL' ORDER BY id DESC LIMIT 1",
          );
          const ep =
            typeof expired[0].payload === "string"
              ? JSON.parse(expired[0].payload)
              : expired[0].payload;
          const eraw = ep.text.match(/verify=([a-f0-9]{64})/)[1];
          await db.query(
            "UPDATE customer_auth_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE email='expired@example.test'",
          );
          await call("customer-auth/verify", "POST", { token: eraw }, "", 400);
        },
      );
      await t.test(
        "a pre-completion payment reversal rearms the unpaid reminder and skips the previous episode",
        async () => {
          const o = await create([], [{ productId: 1, quantity: 1 }]);
          await approve(o.id);
          await db.query(
            "UPDATE orders SET approved_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 73 HOUR) WHERE id=?",
            [o.id],
          );
          await scan();
          await pay(o.id);
          await pay(o.id, "UNPAID");
          await scan();
          await drain();
          const [rows] = await db.query(
            "SELECT state FROM automation_runs WHERE workflow='OUTSTANDING_PAYMENT' AND JSON_EXTRACT(payload,'$.orderId')=? ORDER BY id",
            [o.id],
          );
          assert.deepEqual(
            rows.map((r: any) => r.state),
            ["SKIPPED", "SUCCEEDED"],
          );
        },
      );
      await t.test(
        "queue claiming cannot process a recipient twice and historical sales remain untouched",
        async () => {
          await drain();
          await db.query(
            "INSERT INTO automation_runs(workflow,dedupe_key,payload,available_at) VALUES('ACCOUNT_EMAIL','concurrent-claim',?,UTC_TIMESTAMP())",
            [
              JSON.stringify({
                kind: "EMAIL",
                to: "one@example.test",
                subject: "Once",
                text: "One message",
              }),
            ],
          );
          const claimed = await Promise.all([claim(), claim()]);
          assert.equal(claimed.filter(Boolean).length, 1);
          await execute(claimed.find(Boolean));
          await db.query(
            "INSERT INTO orders(tracking_number,customer_id,agent_id,delivery_address,payment_method,payment_status,order_status,delivery_status) VALUES('LEGACY-REVIEW',1,2,'Historical address','Cash on delivery','PAID','COMPLETED','DELIVERED')",
          );
          const [legacy] = await db.query(
            "SELECT id FROM orders WHERE tracking_number='LEGACY-REVIEW'",
          );
          await pay(legacy[0].id);
          await scan();
          const [commissions] = await db.query(
            "SELECT id FROM commissions WHERE order_id=?",
            [legacy[0].id],
          );
          assert.equal(commissions.length, 0);
          const [jobs] = await db.query(
            "SELECT id FROM automation_runs WHERE JSON_EXTRACT(payload,'$.orderId')=?",
            [legacy[0].id],
          );
          assert.equal(jobs.length, 0);
          assert(
            (await call("automations/legacy-review")).some(
              (r: any) => r.id === legacy[0].id,
            ),
          );
        },
      );
      await t.test(
        "recommendations handle empty results and authentication reset revokes sessions",
        async () => {
          assert.equal(
            (
              await call(
                "catalog/recommendations?categoryId=1&budget=1",
                "GET",
                undefined,
                "",
              )
            ).length,
            0,
          );
          const recommendations = await call(
            "catalog/recommendations?categoryId=1&budget=1000",
            "GET",
            undefined,
            "",
          );
          assert(recommendations.length <= 5);
          assert(
            recommendations.every(
              (o: any, i: number) =>
                i === 0 || o.price >= recommendations[i - 1].price,
            ),
          );
          await call(
            "customer-auth/forgot-password",
            "POST",
            { email: "one@example.test" },
            "",
            202,
          );
          const [jobs] = await db.query(
            "SELECT payload FROM automation_runs WHERE workflow='ACCOUNT_EMAIL' ORDER BY id DESC LIMIT 1",
          );
          const payload =
            typeof jobs[0].payload === "string"
              ? JSON.parse(jobs[0].payload)
              : jobs[0].payload;
          const raw = payload.text.match(/reset=([a-f0-9]{64})/)[1];
          await call(
            "customer-auth/reset-password",
            "POST",
            { token: raw, password: "new-correct-password" },
            "",
          );
          await call("customer/me", "GET", undefined, customerToken, 401);
        },
      );
    } finally {
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => smtp.close(() => resolve()));
      if (db) await db.end();
      assert.match(schema, /^tnl_test_[a-f0-9]{16}$/);
      await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await admin.end();
    }
  },
);
