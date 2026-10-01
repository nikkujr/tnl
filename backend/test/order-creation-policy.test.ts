import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { z } from "zod";
import { orderBody } from "../src/features/orders/validation.js";
import { enforceAgentPackageCreation } from "../src/features/orders/creation-policy.js";
import { errorHandler, validate } from "../src/shared/http.js";

test("order creation rejects agent product selections and preserves admin selections", async (t) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 2, email: "staff@example.test", fullName: "Staff", role: req.headers["x-test-role"] === "ADMIN" ? "ADMIN" : "AGENT" };
    next();
  });
  app.post("/orders", validate(z.object({ body: orderBody, params: z.any(), query: z.any() })), enforceAgentPackageCreation, (req, res) => {
    res.status(201).json({ data: req.body });
  });
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/orders`;
  try {
    for (const scenario of [
      { role: "AGENT", items: [], packages: [{ packageId: 1, quantity: 2 }], status: 201 },
      { role: "AGENT", items: [{ productId: 1, quantity: 1 }], packages: [], status: 403 },
      { role: "AGENT", items: [{ productId: 1, quantity: 1 }], packages: [{ packageId: 1, quantity: 1 }], status: 403 },
      { role: "ADMIN", items: [{ productId: 1, quantity: 1 }], packages: [], status: 201 },
      { role: "ADMIN", items: [{ productId: 1, quantity: 1 }], packages: [{ packageId: 1, quantity: 1 }], status: 201 },
      { role: "AGENT", items: [], packages: [], status: 400 },
    ]) {
      await t.test(`${scenario.role}: ${scenario.items.length} products and ${scenario.packages.length} packages → ${scenario.status}`, async () => {
        const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-test-role": scenario.role }, body: JSON.stringify({ customerId: 1, deliveryAddress: "123 Example Street", paymentMethod: "Bank transfer", items: scenario.items, packages: scenario.packages }) });
        assert.equal(response.status, scenario.status);
        if (scenario.status === 403) assert.equal((await response.json()).error.message, "Agents can only add packages to orders.");
      });
    }
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
