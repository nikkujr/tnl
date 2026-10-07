import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  utimes,
  rm,
  rename,
  unlink,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { positionState, deliverySla } from "../src/features/delivery/model.js";
test("delivery SLA uses the saved deadline, exact completion boundary, and server time", () => {
  const due = new Date("2026-10-07T08:00:00Z"), now = due.getTime();
  assert.equal(deliverySla(null, null, false, now).state, "NOT_SET");
  assert.equal(deliverySla(due, null, true, now).state, "NOT_SET");
  assert.equal(deliverySla(due, null, false, now).state, "ON_TRACK");
  assert.equal(deliverySla(due, null, false, now + 1).state, "OVERDUE");
  assert.equal(deliverySla(due, new Date(now), true, now + 60000).state, "MET");
  assert.deepEqual(deliverySla(due, new Date(now + 90000), true, now + 3600000), { state: "BREACHED", dueAt: due, minutes: 2 });
});
test("position age uses both acquisition and receipt time", () => {
  const now = Date.now();
  assert.equal(positionState(new Date(now), new Date(now), now), "LIVE");
  assert.equal(
    positionState(new Date(now - 61000), new Date(now), now),
    "STALE",
  );
  assert.equal(
    positionState(new Date(now), new Date(now - 61000), now),
    "STALE",
  );
  assert.equal(
    positionState(new Date(now - 601000), new Date(now), now),
    "UNAVAILABLE",
  );
});
test(
  "delivery accounts, attempts, tracking, proof and stock preserve scoped transactional behavior",
  { skip: process.env.TNL_INTEGRATION !== "1", timeout: 120000 },
  async (t) => {
    const schema = `tnl_test_${randomBytes(8).toString("hex")}`,
      root = resolve("../.tmp", `${schema}-photos`);
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
      process.env.GEOAPIFY_API_KEY = "";
      process.env.DELIVERY_PHOTO_DIR = root;
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
      // Exercise an installed database's old enum as well as repeatable additive upgrades.
      await db.query(
        "ALTER TABLE orders DROP COLUMN delivery_employee_id,DROP COLUMN delivery_assignment_version,DROP COLUMN destination_latitude,DROP COLUMN destination_longitude,DROP COLUMN estimated_delivery_at,DROP COLUMN delivery_sla_due_at",
      );
      await db.query(
        "ALTER TABLE users MODIFY role ENUM('ADMIN','AGENT') NOT NULL",
      );
      await db.query("ALTER TABLE orders MODIFY agent_id BIGINT UNSIGNED NOT NULL");
      const { upgrade } = await import("../src/database/upgrade.js");
      await upgrade();
      await upgrade();
      const hash = await bcrypt.hash("Original-pass-123!", 12);
      await db.execute(
        "INSERT INTO users(id,email,password_hash,full_name,role,phone) VALUES(1,'admin@test.invalid',?,'Admin','ADMIN',NULL),(2,'agent@test.invalid',?,'Agent','AGENT','09171234567'),(3,'driver@test.invalid',?,'Driver','DELIVERY','09171234568'),(4,'other@test.invalid',?,'Other driver','DELIVERY','09171234569'),(5,'other-agent@test.invalid',?,'Other agent','AGENT','09171234560')",
        [hash, hash, hash, hash, hash],
      );
      await db.query(
        "INSERT INTO customers(id,full_name,email,phone,address) VALUES(1,'Customer','customer@test.invalid','09171234567','Saved address'),(2,'Other customer','other-customer@test.invalid','09171234568','Other address')",
      );
      await db.execute(
        "INSERT INTO customer_accounts(id,customer_id,password_hash,verified_at) VALUES(1,1,?,UTC_TIMESTAMP()),(2,2,?,UTC_TIMESTAMP())",
        [hash, hash],
      );
      await db.query("INSERT INTO categories(id,name) VALUES(1,'Phones')");
      await db.query(
        "INSERT INTO products(id,category_id,name,sku,price,stock_on_hand,stock_reserved) VALUES(1,1,'Phone','PHONE',100,100,0)",
      );
      const { app } = await import("../src/app.js");
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = `http://127.0.0.1:${server.address().port}/api/v1`;
      const token = (id: number, role: string) =>
          jwt.sign({ id, role, tokenVersion: 0 }, process.env.JWT_SECRET!, {
            expiresIn: "1h",
          }),
        a = token(1, "ADMIN"),
        agent = token(2, "AGENT"),
        driver = token(3, "DELIVERY"),
        other = token(4, "DELIVERY");
      const customer = (id: number) =>
          jwt.sign(
            { id, customerId: id, role: "CUSTOMER", tokenVersion: 0 },
            process.env.JWT_SECRET!,
            { expiresIn: "1h", audience: "customer" },
          ),
        owner = customer(1);
      const call = async (
        path: string,
        method = "GET",
        body: any = undefined,
        auth = a,
        status = 200,
      ) => {
        const r = await fetch(base + "/" + path, {
          method,
          headers: {
            authorization: "Bearer " + auth,
            ...(!(body instanceof FormData)
              ? { "content-type": "application/json" }
              : {}),
          },
          ...(body === undefined
            ? {}
            : { body: body instanceof FormData ? body : JSON.stringify(body) }),
        });
        const value = await r.json();
        assert.equal(r.status, status, JSON.stringify(value));
        return value.data;
      };
      const packageId = (
        await call(
          "packages",
          "POST",
          {
            name: "Delivery package",
            sellingPrice: 100,
            commissionType: "FIXED",
            commissionValue: 10,
            components: [{ productId: 1, quantity: 2 }],
          },
          a,
          201,
        )
      ).id;
      const futureEstimate = () => new Date(Math.floor(Date.now() / 1000) * 1000 + 4 * 3600000).toISOString();
      const create = async (withEstimate = true) => {
        const o = await call(
          "orders",
          "POST",
          {
            customerId: 1,
            agentId: 2,
            packages: [{ packageId, quantity: 1 }],
            items: [],
            deliveryAddress: "Saved address",
            paymentMethod: "Cash on delivery",
            cashReceived: null,
          },
          a,
          201,
        );
        await call(`orders/${o.id}/decision`, "POST", { decision: "APPROVE" });
        if (withEstimate) await call(`orders/${o.id}/delivery-estimate`, "PATCH", { assignmentVersion: 0, estimatedDeliveryAt: futureEstimate() });
        return o.id;
      };
      const assign = async (
        order: number,
        employeeId: number | null,
        version = 0,
      ) =>
        call(`orders/${order}/delivery-assignment`, "PATCH", {
          employeeId,
          assignmentVersion: version,
        });
      const upload = async (
        order: number,
        version: number,
        attemptId: string | undefined,
        bytes: Buffer,
        status = 201,
      ) => {
        const form = new FormData();
        form.append("assignmentVersion", String(version));
        if (attemptId) form.append("attemptId", attemptId);
        form.append(
          "photo",
          new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
          "proof.jpg",
        );
        return call(
          `delivery/orders/${order}/proof-photo`,
          "POST",
          form,
          driver,
          status,
        );
      };
      const photo = await sharp({
        create: {
          width: 2000,
          height: 800,
          channels: 3,
          background: "#abcdef",
        },
      })
        .jpeg()
        .withMetadata()
        .toBuffer();
      await t.test(
        "role login and no implicit administrator permissions",
        async () => {
          const login = await call(
            "auth/login",
            "POST",
            { email: "driver@test.invalid", password: "Original-pass-123!" },
            "",
          );
          assert.equal(login.user.role, "DELIVERY");
          for (const path of [
            "dashboard",
            "customers",
            "products",
            "commissions",
            "performance",
            "performance/agents/2/rewards",
            "orders",
            "delivery-employees",
            "delivery/dispatch",
            "delivery/location-search?query=San%20Pablo",
          ])
            await call(path, "GET", undefined, driver, 403);
          await call("delivery/location-search?query=San%20Pablo", "GET", undefined, agent, 403);
          await call("delivery/location-search?query=San%20Pablo", "GET", undefined, owner, 403);
          await call("delivery/location-search?query=ab", "GET", undefined, a, 400);
          await call("delivery/location-search?query=San%20Pablo", "GET", undefined, a, 503);
          await call("account", "GET", undefined, driver);
          await call("notifications", "GET", undefined, driver);
          await call(
            "delivery-employees",
            "POST",
            {
              fullName: "New driver",
              email: "new-driver@test.invalid",
              phone: "09171234566",
              password: "New-driver-123!",
            },
            a,
            201,
          );
        },
      );
      await t.test("dispatch requires a future estimate, preserves UTC, and exposes revisions only to scoped viewers", async () => {
        const order = await create(false);
        const path = `orders/${order}/delivery-estimate`;
        assert.equal((await call(`customer/orders/${order}/delivery`, "GET", undefined, owner)).estimatedDeliveryAt, null);
        assert.equal((await call(`customer/orders/${order}/delivery`, "GET", undefined, owner)).sla.state, "NOT_SET");
        await call(`orders/${order}/delivery-status`, "PATCH", { assignmentVersion: 0, deliveryStatus: "DISPATCHED" }, a, 400);
        await call(`orders/${order}/delivery-status`, "PATCH", { assignmentVersion: 0, deliveryStatus: "IN_TRANSIT" }, a, 400);
        await assign(order, 3);
        await call(`delivery/orders/${order}/start`, "POST", { assignmentVersion: 1 }, driver, 400);
        assert.equal((await call(`delivery/orders/${order}`, "GET", undefined, driver)).attemptId, null);
        for (const value of ["invalid", "2026-10-09T14:00", new Date(Date.now() - 1000).toISOString()])
          await call(path, "PATCH", { assignmentVersion: 1, estimatedDeliveryAt: value }, a, 400);
        const eta = futureEstimate();
        for (const auth of [agent, driver, owner]) await call(path, "PATCH", { assignmentVersion: 1, estimatedDeliveryAt: eta }, auth, 403);
        await call(path, "PATCH", { assignmentVersion: 0, estimatedDeliveryAt: eta }, a, 409);
        const offsetEta = new Date(Date.parse(eta) + 8 * 3600000).toISOString().replace("Z", "+08:00");
        const started = await call(`delivery/orders/${order}/start`, "POST", { assignmentVersion: 1, estimatedDeliveryAt: offsetEta }, driver);
        assert.equal((await call(`delivery/orders/${order}`, "GET", undefined, driver)).sla.dueAt, eta);
        assert.equal((await call(`customer/orders/${order}/delivery`, "GET", undefined, owner)).estimatedDeliveryAt, eta);
        const revised = new Date(Date.parse(eta) + 3600000).toISOString();
        await call(path, "PATCH", { assignmentVersion: 1, estimatedDeliveryAt: revised });
        assert.equal((await call(`customer/orders/${order}/delivery-tracking`, "GET", undefined, owner)).sla.dueAt, eta);
        assert.equal((await call(`customer/orders/${order}/delivery-tracking`, "GET", undefined, owner)).estimatedDeliveryAt, revised);
        assert.equal((await call("tracking/" + (await call(`orders/${order}`)).trackingNumber, "GET", undefined, "")).estimatedDeliveryAt, revised);
        await call(`customer/orders/${order}/delivery`, "GET", undefined, customer(2), 404);
        await call(`customer/orders/${order}/delivery-tracking`, "GET", undefined, customer(2), 404);
        await call(`delivery/orders/${order}/pause`, "POST", { assignmentVersion: 1, attemptId: started.attemptId }, driver);
        await assign(order, 4, 1);
        await assign(order, 3, 2);
        assert.equal((await call(`delivery/orders/${order}`, "GET", undefined, driver)).sla.dueAt, eta);
        const overdue = new Date(Math.floor(Date.now() / 1000) * 1000 - 60000);
        await db.execute("UPDATE orders SET delivery_sla_due_at=? WHERE id=?", [overdue, order]);
        await call(path, "PATCH", { assignmentVersion: 3, estimatedDeliveryAt: futureEstimate() });
        assert.equal((await call(`customer/orders/${order}/delivery-tracking`, "GET", undefined, owner)).sla.state, "OVERDUE");
        assert.equal((await call("delivery/dispatch")).find((j: any) => j.id === order).sla.state, "OVERDUE");
        await call(`orders/${order}/delivery-status`, "PATCH", { assignmentVersion: 3, deliveryStatus: "DELIVERED", recipientName: "Customer", exceptionReason: "Office handoff without a camera" });
        const sla = (await call(`customer/orders/${order}/delivery`, "GET", undefined, owner)).sla;
        assert.equal(sla.state, "BREACHED");
        assert(sla.minutes >= 1);
        assert.equal((await call("tracking/" + (await call(`orders/${order}`)).trackingNumber, "GET", undefined, "")).sla.state, "BREACHED");
        await call(path, "PATCH", { assignmentVersion: 3, estimatedDeliveryAt: futureEstimate() }, a, 409);
        const [[audit]] = await db.query("SELECT COUNT(*) count FROM order_events WHERE order_id=? AND type='DELIVERY_ESTIMATE_UPDATED'", [order]);
        assert.equal(audit.count, 3);
        const [[slaAudit]] = await db.query("SELECT COUNT(*) count FROM order_events WHERE order_id=? AND type='DELIVERY_SLA_STARTED'", [order]);
        assert.equal(slaAudit.count, 1);
      });
      const o = await create(),
        o2 = await create();
      await assign(o, 3);
      await assign(o2, 3);
      await t.test("package components are decoded before calculating delivery quantities", async () => {
        for (const auth of [a, agent, driver, owner]) {
          const path = auth === owner ? `customer/orders/${o}/delivery` : `delivery/orders/${o}`;
          const detail = await call(path, "GET", undefined, auth);
          const pack = detail.packages[0];
          assert.equal(pack.components[0].quantity * pack.quantity, 2, "Package component total must not be NaN");
          assert(Array.isArray(pack.components));
          assert.equal(pack.components[0].productName, "Phone");
        }
      });
      let attemptId: string, sessionId: string;
      await t.test(
        "one active job, idempotent start, foreign order and agent mutation denial",
        async () => {
          await call(`delivery/orders/${o}`, "GET", undefined, other, 404);
          await call(
            `delivery/orders/${o}`,
            "GET",
            undefined,
            token(5, "AGENT"),
            404,
          );
          await call(
            `orders/${o}/delivery-status`,
            "PATCH",
            { deliveryStatus: "DISPATCHED" },
            agent,
            403,
          );
          const starts = await Promise.all(
            [o, o2].map((id) =>
              fetch(base + `/delivery/orders/${id}/start`, {
                method: "POST",
                headers: {
                  authorization: "Bearer " + driver,
                  "content-type": "application/json",
                },
                body: JSON.stringify({ assignmentVersion: 1 }),
              }),
            ),
          );
          assert.deepEqual(starts.map((r) => r.status).sort(), [200, 409]);
          const active = (
            await call("delivery/orders", "GET", undefined, driver)
          ).find((j: any) => j.attemptId);
          const winner = active.id;
          if (winner !== o)
            await call(
              `delivery/orders/${winner}/pause`,
              "POST",
              { assignmentVersion: 1, attemptId: active.attemptId },
              driver,
            );
          attemptId = (
            await call(
              `delivery/orders/${o}/start`,
              "POST",
              { assignmentVersion: 1 },
              driver,
            )
          ).attemptId;
          assert.equal(
            (
              await call(
                `delivery/orders/${o}/start`,
                "POST",
                { assignmentVersion: 1 },
                driver,
              )
            ).attemptId,
            attemptId,
          );
          await call(
            `delivery/orders/${o2}/start`,
            "POST",
            { assignmentVersion: 1 },
            driver,
            409,
          );
        },
      );
      await t.test(
        "GPS sessions, old fixes, sequence ordering, ownership and immutable milestone time",
        async () => {
          const [[before]] = await db.query(
            "SELECT delivery_changed_at stamp FROM orders WHERE id=?",
            [o],
          );
          sessionId = (
            await call(
              `delivery/orders/${o}/tracking/start`,
              "POST",
              { assignmentVersion: 1, attemptId },
              driver,
            )
          ).sessionId;
          const sample = {
            assignmentVersion: 1,
            attemptId,
            sessionId,
            sequence: 1,
            latitude: 14,
            longitude: 120,
            accuracy: 8,
            observedAt: new Date().toISOString(),
          };
          await call(`delivery/orders/${o}/positions`, "POST", sample, driver);
          assert.equal(
            (
              await call(
                `customer/orders/${o}/delivery-tracking`,
                "GET",
                undefined,
                owner,
              )
            ).state,
            "LIVE",
          );
          assert.equal(
            (
              await call(
                `delivery/orders/${o}/positions`,
                "POST",
                sample,
                driver,
              )
            ).accepted,
            false,
          );
          await call(
            `delivery/orders/${o}/positions`,
            "POST",
            {
              ...sample,
              sequence: 2,
              observedAt: new Date(Date.now() - 61000).toISOString(),
            },
            driver,
          ); // older than stored: ignored
          const [[after]] = await db.query(
            "SELECT delivery_changed_at stamp FROM orders WHERE id=?",
            [o],
          );
          assert.equal(+new Date(after.stamp), +new Date(before.stamp));
          await call(
            `customer/orders/${o}/delivery-tracking`,
            "GET",
            undefined,
            customer(2),
            404,
          );
          await call(
            `delivery/orders/${o}/positions`,
            "POST",
            sample,
            other,
            404,
          );
          await db.execute(
            "UPDATE delivery_latest_positions SET observed_at=? WHERE session_id=?",
            [new Date(Date.now() - 61000), sessionId],
          );
          assert.equal(
            (
              await call(
                `customer/orders/${o}/delivery-tracking`,
                "GET",
                undefined,
                owner,
              )
            ).state,
            "STALE",
          );
          await db.execute(
            "UPDATE delivery_latest_positions SET observed_at=? WHERE session_id=?",
            [new Date(Date.now() - 660000), sessionId],
          );
          assert.equal(
            (
              await call(
                `customer/orders/${o}/delivery-tracking`,
                "GET",
                undefined,
                owner,
              )
            ).position,
            null,
          );
          const publicData = await call(
            "tracking/" + (await call(`orders/${o}`)).trackingNumber,
            "GET",
            undefined,
            "",
          );
          assert(!JSON.stringify(publicData).includes("latitude"));
        },
      );
      await t.test(
        "reassignment fences uploads, deactivation, pause and issue retry",
        async () => {
          const staged = await upload(o, 1, attemptId, photo);
          await call(
            "delivery-employees/3",
            "PUT",
            {
              fullName: "Driver",
              email: "driver@test.invalid",
              phone: "09171234568",
              active: false,
            },
            a,
            409,
          );
          await assign(o, 4, 1);
          await upload(o, 1, attemptId, photo, 404);
          await call(
            `delivery/orders/${o}/positions`,
            "POST",
            {
              assignmentVersion: 1,
              attemptId,
              sessionId,
              sequence: 3,
              latitude: 14,
              longitude: 120,
              accuracy: 8,
              observedAt: new Date().toISOString(),
            },
            driver,
            404,
          );
          assert.equal(
            (
              await call(
                `customer/orders/${o}/delivery-tracking`,
                "GET",
                undefined,
                owner,
              )
            ).position,
            null,
          );
          await assign(o, 3, 2);
          await call(
            `delivery/orders/${o}/start`,
            "POST",
            { assignmentVersion: 1 },
            driver,
            409,
          );
          attemptId = (
            await call(
              `delivery/orders/${o}/start`,
              "POST",
              { assignmentVersion: 3 },
              driver,
            )
          ).attemptId;
          await call(
            `delivery/orders/${o}/status`,
            "PATCH",
            {
              assignmentVersion: 3,
              attemptId,
              deliveryStatus: "DELIVERED",
              recipientName: "Customer",
              photoId: staged.id,
            },
            driver,
            409,
          );
          await call(
            `delivery/orders/${o}/issues`,
            "POST",
            {
              assignmentVersion: 3,
              attemptId,
              explanation: "Recipient is absent",
            },
            driver,
          );
          await call(
            `delivery/orders/${o}/start`,
            "POST",
            { assignmentVersion: 3 },
            driver,
            409,
          );
          const detail = await call(
            `delivery/orders/${o}`,
            "GET",
            undefined,
            driver,
          );
          await call(
            `orders/${o}/delivery-issues/${detail.issues[0].id}/resolve`,
            "POST",
            { resolution: "Customer confirmed a new handoff time" },
          );
          attemptId = (
            await call(
              `delivery/orders/${o}/start`,
              "POST",
              { assignmentVersion: 3 },
              driver,
            )
          ).attemptId;
        },
      );
      await t.test(
        "validated private proof, required evidence and concurrent financial completion",
        async () => {
          await upload(o, 3, attemptId, Buffer.from("<svg>bad</svg>"), 400);
          await upload(
            o,
            3,
            attemptId,
            Buffer.alloc(10 * 1024 * 1024 + 1),
            413,
          );
          const tooManyPixels = await sharp({
            create: {
              width: 8001,
              height: 5000,
              channels: 3,
              background: "#abcdef",
            },
          })
            .jpeg()
            .toBuffer();
          await upload(o, 3, attemptId, tooManyPixels, 400);
          const heldStorage = root + "-storage-held";
          await rename(root, heldStorage);
          try {
            await writeFile(root, "Storage fixture obstruction");
            await upload(o, 3, attemptId, photo, 503);
          } finally {
            await unlink(root);
            await rename(heldStorage, root);
          }
          await call(
            `delivery/orders/${o}/status`,
            "PATCH",
            {
              assignmentVersion: 3,
              attemptId,
              deliveryStatus: "DELIVERED",
              recipientName: "Customer",
            },
            driver,
            400,
          );
          const p = await upload(o, 3, attemptId, photo),
            files = await readdir(root);
          assert(files.length > 0);
          const normalized = await sharp(
            await readFile(join(root, `${p.id}.jpg`)),
          ).metadata();
          assert.equal(normalized.width, 1600);
          assert.equal(normalized.exif, undefined);
          const completion = {
            assignmentVersion: 3,
            attemptId,
            deliveryStatus: "DELIVERED",
            recipientName: "Customer",
            photoId: p.id,
          };
          await rename(join(root, `${p.id}.jpg`), join(root, `${p.id}.held`));
          await call(
            `delivery/orders/${o}/status`,
            "PATCH",
            completion,
            driver,
            503,
          );
          assert.equal(
            (await call(`delivery/orders/${o}`, "GET", undefined, driver))
              .completion,
            null,
          );
          await rename(join(root, `${p.id}.held`), join(root, `${p.id}.jpg`));
          await Promise.all([
            call(`delivery/orders/${o}/status`, "PATCH", completion, driver),
            call(`orders/${o}/payment-status`, "PATCH", {
              paymentStatus: "PAID",
              paymentMethod: "Cash on delivery",
              cashReceived: null,
            }),
          ]);
          await call(
            `delivery/orders/${o}/status`,
            "PATCH",
            completion,
            driver,
          );
          const [[movements]] = await db.query(
            "SELECT COUNT(*) count FROM inventory_movements WHERE order_id=? AND type='DEDUCT'",
            [o],
          );
          assert.equal(movements.count, 1);
          const [[commission]] = await db.query(
            "SELECT COUNT(*) count,MAX(agent_id) agentId FROM commissions WHERE order_id=?",
            [o],
          );
          assert.equal(commission.count, 1);
          assert.equal(commission.agentId, 2);
          assert.equal(
            (
              await call(
                `delivery/orders/${o}/tracking`,
                "GET",
                undefined,
                driver,
              )
            ).position,
            null,
          );
          const r = await fetch(base + `/customer/orders/${o}/proof-photo`, {
            headers: { authorization: "Bearer " + owner },
          });
          assert.equal(r.status, 200);
          assert.equal(r.headers.get("cache-control"), "no-store");
          await call(
            `customer/orders/${o}/proof-photo`,
            "GET",
            undefined,
            customer(2),
            404,
          );
        },
      );
      await t.test(
        "admin exception, resets stop GPS, expiry and orphan cleanup",
        async () => {
          await call(
            `orders/${o2}/delivery-status`,
            "PATCH",
            {
              assignmentVersion: 1,
              deliveryStatus: "DELIVERED",
              recipientName: "Recipient",
            },
            a,
            400,
          );
          attemptId = (
            await call(
              `delivery/orders/${o2}/start`,
              "POST",
              { assignmentVersion: 1 },
              driver,
            )
          ).attemptId;
          sessionId = (
            await call(
              `delivery/orders/${o2}/tracking/start`,
              "POST",
              { assignmentVersion: 1, attemptId },
              driver,
            )
          ).sessionId;
          await db.execute(
            "UPDATE delivery_location_sessions SET expires_at=? WHERE id=?",
            [new Date(Date.now() - 1000), sessionId],
          );
          await call(
            `delivery/orders/${o2}/positions`,
            "POST",
            {
              assignmentVersion: 1,
              attemptId,
              sessionId,
              sequence: 1,
              latitude: 13.765,
              longitude: 122.976,
              accuracy: 8,
              observedAt: new Date().toISOString(),
            },
            driver,
            409,
          );
          assert.equal(
            (
              await call(
                `customer/orders/${o2}/delivery-tracking`,
                "GET",
                undefined,
                owner,
              )
            ).state,
            "STOPPED",
          );
          const { expireLocationSessions } =
              await import("../src/features/delivery/service.js"),
            { transaction } = await import("../src/shared/transaction.js");
          await transaction(expireLocationSessions);
          sessionId = (
            await call(
              `delivery/orders/${o2}/tracking/start`,
              "POST",
              { assignmentVersion: 1, attemptId },
              driver,
            )
          ).sessionId;
          await call("delivery-employees/3/reset-password", "POST", {
            newPassword: "Replacement-pass-123!",
          });
          await call("delivery/orders", "GET", undefined, driver, 401);
          assert.equal(
            (
              await call(
                `customer/orders/${o2}/delivery-tracking`,
                "GET",
                undefined,
                owner,
              )
            ).state,
            "STOPPED",
          );
          await call(`orders/${o2}/delivery-status`, "PATCH", {
            assignmentVersion: 1,
            deliveryStatus: "DELIVERED",
            recipientName: "Recipient",
            exceptionReason: "Admin verified handoff after camera failure",
          });
          assert.equal(
            (
              await call(
                `customer/orders/${o2}/delivery`,
                "GET",
                undefined,
                owner,
              )
            ).completion.exceptionReason,
            undefined,
          );
          await db.query(
            "UPDATE delivery_photos SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)",
          );
          await call(
            `customer/orders/${o}/proof-photo`,
            "GET",
            undefined,
            owner,
            410,
          );
          const orphan = `${randomBytes(16)
            .toString("hex")
            .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5")}.jpg`;
          await mkdir(root, { recursive: true });
          await writeFile(join(root, orphan), photo);
          await utimes(join(root, orphan), new Date(0), new Date(0));
          const { cleanupPhotos } =
            await import("../src/features/delivery/photos.js");
          // A completion holding a photo row may retain it after cleanup's candidate scan.
          // Cleanup must recheck the expiry after acquiring that row, before unlinking.
          const retained = await db.getConnection();
          try {
            await retained.beginTransaction();
            await retained.execute(
              "UPDATE delivery_photos SET expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 90 DAY) WHERE order_id=? AND state='COMMITTED'",
              [o],
            );
            const competingCleanup = cleanupPhotos();
            await new Promise((r) => setTimeout(r, 150));
            await retained.commit();
            await competingCleanup;
          } finally {
            await retained.rollback();
            retained.release();
          }
          const retainedPhoto = await fetch(
            base + `/customer/orders/${o}/proof-photo`,
            {
              headers: { authorization: "Bearer " + owner },
            },
          );
          assert.equal(retainedPhoto.status, 200);
          await retainedPhoto.arrayBuffer();
          await db.query(
            "UPDATE delivery_photos SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)",
          );
          await cleanupPhotos();
          assert.equal((await readdir(root)).length, 0);
          assert.equal(
            (
              await call(
                `customer/orders/${o}/delivery`,
                "GET",
                undefined,
                owner,
              )
            ).completion.photoState,
            "EXPIRED",
          );
          const logoutOrder = await create();
          await assign(logoutOrder, 4);
          const logoutAttempt = (
            await call(
              `delivery/orders/${logoutOrder}/start`,
              "POST",
              { assignmentVersion: 1 },
              other,
            )
          ).attemptId;
          const logoutSession = (
            await call(
              `delivery/orders/${logoutOrder}/tracking/start`,
              "POST",
              { assignmentVersion: 1, attemptId: logoutAttempt },
              other,
            )
          ).sessionId;
          await call(
            `delivery/orders/${logoutOrder}/positions`,
            "POST",
            {
              assignmentVersion: 1,
              attemptId: logoutAttempt,
              sessionId: logoutSession,
              sequence: 1,
              latitude: 13.765,
              longitude: 122.976,
              accuracy: 8,
              observedAt: new Date().toISOString(),
            },
            other,
          );
          assert.equal(
            (
              await call(
                `customer/orders/${logoutOrder}/delivery-tracking`,
                "GET",
                undefined,
                owner,
              )
            ).state,
            "LIVE",
          );
          await call("auth/logout", "POST", {}, other);
          await call("delivery/orders", "GET", undefined, other, 401);
          const stopped = await call(
            `customer/orders/${logoutOrder}/delivery-tracking`,
            "GET",
            undefined,
            owner,
          );
          assert.equal(stopped.state, "STOPPED");
          assert.equal(stopped.position, null);
          const [[remainingPositions]] = await db.query(
            "SELECT COUNT(*) count FROM delivery_latest_positions WHERE session_id=?",
            [logoutSession],
          );
          assert.equal(remainingPositions.count, 0);
        },
      );
      await t.test("office orders complete without an agent or commission", async () => {
        const body = { customerId: 1, agentId: null, items: [], packages: [{ packageId, quantity: 1 }], deliveryAddress: "Office customer address", paymentMethod: "Cash on delivery", cashReceived: null };
        const order = await call("orders", "POST", body, a, 201);
        const { agentId: ignored, ...omitted } = body;
        const omittedOrder = await call("orders", "POST", omitted, a, 201);
        assert.equal((await call(`orders/${omittedOrder.id}`)).agentId, null);
        const selfCredited = await call("orders", "POST", body, agent, 201);
        assert.equal((await call(`orders/${selfCredited.id}`)).agentId, 2);
        await call("orders", "POST", { ...body, agentId: 1 }, a, 400);
        await call(`orders/${order.id}`, "PUT", body);
        assert.equal((await call(`orders/${order.id}`)).agentId, null);
        assert((await call("orders")).some((o: any) => o.id === order.id));
        assert((await call("customer/orders", "GET", undefined, owner)).some((o: any) => o.id === order.id));
        await call(`orders/${order.id}`, "GET", undefined, agent, 404);
        await call(`orders/${order.id}/decision`, "POST", { decision: "APPROVE" });
        const [[before]] = await db.query("SELECT stock_on_hand stock FROM products WHERE id=1");
        await call(`orders/${order.id}/delivery-status`, "PATCH", { assignmentVersion: 0, deliveryStatus: "DELIVERED", recipientName: "Office customer", exceptionReason: "Office handoff without camera" });
        await call(`orders/${order.id}/payment-status`, "PATCH", { paymentStatus: "PAID", paymentMethod: "Cash on delivery", cashReceived: null });
        await call(`orders/${order.id}/delivery-status`, "PATCH", { assignmentVersion: 0, deliveryStatus: "DELIVERED", recipientName: "Office customer", exceptionReason: "Office handoff without camera" });
        const [[after]] = await db.query("SELECT stock_on_hand stock FROM products WHERE id=1");
        assert.equal(before.stock - after.stock, 2);
        const [[completed]] = await db.query("SELECT sale_completed_at FROM orders WHERE id=?", [order.id]);
        assert(completed.sale_completed_at);
        const [[commissions]] = await db.query("SELECT COUNT(*) count FROM commissions WHERE order_id=?", [order.id]);
        assert.equal(commissions.count, 0);
      });
    } finally {
      if (server) await new Promise<void>((r) => server.close(() => r()));
      if (db) await db.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await admin.end();
      const target = resolve(root);
      assert(target.startsWith(resolve("../.tmp") + "\\"));
      await rm(target, { recursive: true, force: true });
    }
  },
);
