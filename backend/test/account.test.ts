import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

test(
  "self-service accounts enforce ownership and revoke old sessions",
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
    const original = "Original-pass-123!";
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
      const hash = await bcrypt.hash(original, 12);
      await db.execute(
        "INSERT INTO users(id,email,password_hash,full_name,role,phone) VALUES(1,'admin@example.test',?,'Admin','ADMIN',NULL),(2,'agent@example.test',?,'Agent','AGENT','09171234567'),(3,'other@example.test',?,'Other agent','AGENT','09171234568')",
        [hash, hash, hash],
      );
      await db.query(
        "INSERT INTO customers(id,full_name,email,phone,address,assigned_agent_id,marketing_opt_in) VALUES(11,'Customer','customer@example.test','09171234567','Original address',2,TRUE),(12,'Other customer','other-customer@example.test','09171234568','Other address',3,FALSE)",
      );
      await db.execute(
        "INSERT INTO customer_accounts(id,customer_id,password_hash) VALUES(41,11,?),(42,12,?)",
        [hash, hash],
      );
      await db.query(
        "INSERT INTO orders(id,tracking_number,customer_id,agent_id,delivery_address,payment_method,sales_version) VALUES(1,'TNL-ACCOUNT-TEST',11,2,'Saved order address','Cash','PACKAGE')",
      );
      const rawReset = randomBytes(32).toString("hex");
      await db.execute(
        "INSERT INTO customer_auth_tokens(token_hash,purpose,email,payload,expires_at) VALUES(?,'RESET','customer@example.test',?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))",
        [
          createHash("sha256").update(rawReset).digest("hex"),
          JSON.stringify({ accountId: 41 }),
        ],
      );
      const { app } = await import("../src/app.js");
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = `http://127.0.0.1:${server.address().port}/api/v1`;
      const staff = (id: number, role: string, version?: number) =>
        jwt.sign(
          {
            id,
            role,
            ...(version !== undefined ? { tokenVersion: version } : {}),
          },
          process.env.JWT_SECRET!,
          { expiresIn: "1h" },
        );
      const customer = (id: number, customerId: number) =>
        jwt.sign(
          { id, customerId, role: "CUSTOMER", tokenVersion: 0 },
          process.env.JWT_SECRET!,
          { audience: "customer", expiresIn: "1h" },
        );
      async function call(
        path: string,
        method = "GET",
        body: any = undefined,
        token = "",
        status = 200,
      ) {
        const r = await fetch(base + path, {
          method,
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const value = await r.json();
        assert.equal(r.status, status, JSON.stringify(value));
        return value.data;
      }
      await t.test(
        "anonymous, forged, inactive, and wrong-role tokens cannot edit accounts",
        async () => {
          await call("/account", "GET", undefined, "", 401);
          await call("/account", "GET", undefined, "malformed-token", 401);
          const forged = jwt.sign({ id: 1, role: "ADMIN" }, "wrong-secret", {
            expiresIn: "1h",
          });
          await call("/account", "GET", undefined, forged, 401);
          await call("/account", "GET", undefined, staff(1, "CUSTOMER"), 401);
          await db.query("UPDATE users SET active=FALSE WHERE id=3");
          await call("/account", "GET", undefined, staff(3, "AGENT"), 401);
          await db.query("UPDATE users SET active=TRUE WHERE id=3");
        },
      );
      for (const identity of [
        {
          role: "ADMIN",
          id: 1,
          token: staff(1, "ADMIN"),
          email: "admin@example.test",
        },
        {
          role: "AGENT",
          id: 2,
          token: staff(2, "AGENT"),
          email: "agent@example.test",
        },
        {
          role: "CUSTOMER",
          id: 41,
          token: customer(41, 11),
          email: "customer@example.test",
        },
      ]) {
        await t.test(
          `${identity.role} updates only permitted own profile fields and changes password`,
          async () => {
            const read = await call(
              "/account?customerId=12&userId=3",
              "GET",
              undefined,
              identity.token,
            );
            assert.equal(read.id, identity.id);
            assert.equal(read.email, identity.email);
            assert(!("passwordHash" in read));
            assert(!("tokenVersion" in read));
            const profile = {
              fullName: `${identity.role} Updated`,
              phone: "+639171234569",
              ...(identity.role === "CUSTOMER"
                ? { address: "Updated customer address" }
                : {}),
            };
            for (const field of [
              "id",
              "customerId",
              "role",
              "email",
              "assignedAgentId",
              "marketingOptIn",
              "commissionRate",
            ]) {
              await call(
                "/account/profile",
                "PATCH",
                {
                  ...profile,
                  [field]: field === "email" ? "taken@example.test" : 3,
                },
                identity.token,
                400,
              );
            }
            await call(
              "/account/profile",
              "PATCH",
              { ...profile, phone: "invalid" },
              identity.token,
              400,
            );
            if (identity.role !== "ADMIN")
              await call(
                "/account/profile",
                "PATCH",
                { ...profile, phone: null },
                identity.token,
                400,
              );
            if (identity.role !== "CUSTOMER")
              await call(
                "/account/profile",
                "PATCH",
                { ...profile, address: "Wrong staff address" },
                identity.token,
                400,
              );
            const changed = await call(
              "/account/profile",
              "PATCH",
              profile,
              identity.token,
            );
            assert.equal(changed.user.role, identity.role);
            assert.equal(changed.user.id, identity.id);
            assert.equal(changed.profile.phone, "09171234569");
            assert.equal(changed.profile.email, identity.email);
            assert.equal(
              (await call("/account", "GET", undefined, changed.token))
                .fullName,
              profile.fullName,
            );
            if (identity.role === "CUSTOMER") {
              const [contacts] = await db.query(
                "SELECT assigned_agent_id,marketing_opt_in FROM customers WHERE id=11",
              );
              assert.equal(contacts[0].assigned_agent_id, 2);
              assert.equal(contacts[0].marketing_opt_in, 1);
              const [orders] = await db.query(
                "SELECT delivery_address FROM orders WHERE id=1",
              );
              assert.equal(orders[0].delivery_address, "Saved order address");
              const [other] = await db.query(
                "SELECT full_name,address FROM customers WHERE id=12",
              );
              assert.equal(other[0].full_name, "Other customer");
              assert.equal(other[0].address, "Other address");
              await call("/agents", "GET", undefined, changed.token, 403);
            }
            await call(
              "/account/password",
              "PATCH",
              {
                currentPassword: "incorrect",
                newPassword: "New-valid-password!",
              },
              changed.token,
              400,
            );
            await call(
              "/account/password",
              "PATCH",
              { currentPassword: original, newPassword: original },
              changed.token,
              400,
            );
            await call(
              "/account/password",
              "PATCH",
              { currentPassword: original, newPassword: "😀".repeat(20) },
              changed.token,
              400,
            );
            const newPassword = `${identity.role}-new-password!`;
            const updated = await call(
              "/account/password",
              "PATCH",
              { currentPassword: original, newPassword },
              changed.token,
            );
            assert.equal(updated.user.tokenVersion, 1);
            assert.equal(
              (await call("/account", "GET", undefined, updated.token)).id,
              identity.id,
            );
            await call("/account", "GET", undefined, identity.token, 401);
            await call("/account", "GET", undefined, changed.token, 401);
            await call(
              identity.role === "CUSTOMER" ? "/customer/orders" : "/dashboard",
              "GET",
              undefined,
              identity.token,
              401,
            );
            const login =
              identity.role === "CUSTOMER"
                ? "/customer-auth/login"
                : "/auth/login";
            await call(
              login,
              "POST",
              { email: identity.email, password: original },
              "",
              401,
            );
            const fresh = await call(login, "POST", {
              email: identity.email,
              password: newPassword,
            });
            assert.equal(fresh.user.fullName, profile.fullName);
            assert.equal(fresh.user.tokenVersion, 1);
            if (identity.role === "CUSTOMER")
              await call(
                "/customer-auth/reset-password",
                "POST",
                { token: rawReset, password: "Another-password!" },
                "",
                400,
              );
          },
        );
      }
      await t.test(
        "concurrent password changes cannot both succeed using the old session",
        async () => {
          const credential = staff(3, "AGENT");
          const responses = await Promise.all(
            ["Concurrent-one!", "Concurrent-two!"].map((newPassword) =>
              fetch(base + "/account/password", {
                method: "PATCH",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${credential}`,
                },
                body: JSON.stringify({
                  currentPassword: original,
                  newPassword,
                }),
              }),
            ),
          );
          assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
          const [rows] = await db.query(
            "SELECT token_version FROM users WHERE id=3",
          );
          assert.equal(rows[0].token_version, 1);
        },
      );
      await t.test(
        "admin password replacement also revokes the agent's current session",
        async () => {
          const adminLogin = await call("/auth/login", "POST", {
            email: "admin@example.test",
            password: "ADMIN-new-password!",
          });
          const agentLogin = await call("/auth/login", "POST", {
            email: "agent@example.test",
            password: "AGENT-new-password!",
          });
          await call(
            "/agents/2",
            "PUT",
            {
              fullName: "Agent Updated",
              email: "agent@example.test",
              phone: "09171234569",
              password: "Admin-replaced-password!",
              commissionRate: 0,
            },
            adminLogin.token,
          );
          await call("/account", "GET", undefined, agentLogin.token, 401);
          const fresh = await call("/auth/login", "POST", {
            email: "agent@example.test",
            password: "Admin-replaced-password!",
          });
          assert.equal(fresh.user.tokenVersion, 2);
        },
      );
      await t.test(
        "admin resets agent and customer passwords without changing profiles or bypassing verification",
        async () => {
          const adminLogin = await call("/auth/login", "POST", {
            email: "admin@example.test",
            password: "ADMIN-new-password!",
          });
          const agentLogin = await call("/auth/login", "POST", {
            email: "agent@example.test",
            password: "Admin-replaced-password!",
          });
          const customerLogin = await call("/customer-auth/login", "POST", {
            email: "customer@example.test",
            password: "CUSTOMER-new-password!",
          });
          for (const path of [
            "/agents/2/reset-password",
            "/customers/11/reset-password",
          ]) {
            await call(
              path,
              "POST",
              { newPassword: "Reset-by-admin!" },
              "",
              401,
            );
            await call(
              path,
              "POST",
              { newPassword: "Reset-by-admin!" },
              agentLogin.token,
              403,
            );
            await call(
              path,
              "POST",
              { newPassword: "Reset-by-admin!" },
              customerLogin.token,
              403,
            );
            for (const body of [
              { newPassword: "short" },
              { newPassword: "😀".repeat(20) },
              { newPassword: "a".repeat(73) },
              {
                newPassword: "Reset-by-admin!",
                email: "override@example.test",
              },
            ])
              await call(path, "POST", body, adminLogin.token, 400);
          }
          await call(
            "/agents/1/reset-password",
            "POST",
            { newPassword: "Reset-by-admin!" },
            adminLogin.token,
            404,
          );
          await call(
            "/agents/999/reset-password",
            "POST",
            { newPassword: "Reset-by-admin!" },
            adminLogin.token,
            404,
          );
          await call(
            "/customers/999/reset-password",
            "POST",
            { newPassword: "Reset-by-admin!" },
            adminLogin.token,
            404,
          );
          await db.query("UPDATE users SET active=FALSE WHERE id=3");
          await call(
            "/agents/3/reset-password",
            "POST",
            { newPassword: "Reset-by-admin!" },
            adminLogin.token,
            409,
          );
          await db.query("UPDATE users SET active=TRUE WHERE id=3");
          await db.query(
            "INSERT INTO customers(id,full_name,email,phone,address) VALUES(13,'Contact only','contact@example.test','09171234567','Contact address')",
          );
          await call(
            "/customers/13/reset-password",
            "POST",
            { newPassword: "Reset-by-admin!" },
            adminLogin.token,
            409,
          );
          await db.query(
            "UPDATE customer_accounts SET verified_at=UTC_TIMESTAMP(),active=FALSE WHERE id=42",
          );
          await call(
            "/customers/12/reset-password",
            "POST",
            { newPassword: "Reset-by-admin!" },
            adminLogin.token,
            409,
          );
          const list = await call(
            "/customers",
            "GET",
            undefined,
            adminLogin.token,
          );
          assert.equal(
            Boolean(list.find((c: any) => c.id === 11).portalAccountActive),
            true,
          );
          assert.equal(
            Boolean(list.find((c: any) => c.id === 13).portalAccountActive),
            false,
          );
          const [before] = await db.query(
            "SELECT * FROM customers WHERE id=11",
          );
          const resetLink = randomBytes(32).toString("hex");
          await db.execute(
            "INSERT INTO customer_auth_tokens(token_hash,purpose,email,payload,expires_at) VALUES(?,'RESET','customer@example.test',?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))",
            [
              createHash("sha256").update(resetLink).digest("hex"),
              JSON.stringify({ accountId: 41 }),
            ],
          );
          for (const target of [
            {
              path: "/agents/2/reset-password",
              login: "/auth/login",
              email: "agent@example.test",
              oldPassword: "Admin-replaced-password!",
              token: agentLogin.token,
              version: 3,
            },
            {
              path: "/customers/11/reset-password",
              login: "/customer-auth/login",
              email: "customer@example.test",
              oldPassword: "CUSTOMER-new-password!",
              token: customerLogin.token,
              version: 2,
            },
          ]) {
            await call(
              target.path,
              "POST",
              { newPassword: target.oldPassword },
              adminLogin.token,
              400,
            );
            const result = await call(
              target.path,
              "POST",
              { newPassword: "Reset-by-admin!" },
              adminLogin.token,
            );
            assert.deepEqual(Object.keys(result).sort(), ["id", "reset"]);
            await call("/account", "GET", undefined, target.token, 401);
            await call(
              target.login,
              "POST",
              { email: target.email, password: target.oldPassword },
              "",
              401,
            );
            const fresh = await call(target.login, "POST", {
              email: target.email,
              password: "Reset-by-admin!",
            });
            assert.equal(fresh.user.tokenVersion, target.version);
            await call("/account", "GET", undefined, fresh.token);
          }
          await call(
            "/customer-auth/reset-password",
            "POST",
            { token: resetLink, password: "Expired-link-password!" },
            "",
            400,
          );
          const [after] = await db.query("SELECT * FROM customers WHERE id=11");
          assert.deepEqual(after, before);
          const [audits] = await db.query(
            "SELECT actor_id,payload FROM domain_events WHERE type='account.password_reset'",
          );
          assert.equal(audits.length, 2);
          for (const audit of audits) {
            assert.equal(audit.actor_id, 1);
            assert(!JSON.stringify(audit.payload).includes("Reset-by-admin"));
          }
          await call("/account", "GET", undefined, adminLogin.token);
        },
      );
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
