import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cents, packageCommission } from "../src/shared/money.js";
import { deliveryTransition } from "../src/features/orders/queries.js";
import {
  emailFailure,
  executionFailure,
  recoverState,
} from "../src/features/automations/recovery.js";

test("package line rounding, fixed quantities, and input precision", () => {
  assert.equal(
    packageCommission({
      quantity: 3,
      sellingPrice: 99.99,
      commissionType: "FIXED",
      commissionValue: 12.35,
    }),
    3705,
  );
  assert.equal(
    packageCommission({
      quantity: 3,
      sellingPrice: 99.99,
      commissionType: "PERCENTAGE",
      commissionValue: 7.5,
    }),
    2250,
  );
  assert.equal(
    packageCommission({
      quantity: 1,
      sellingPrice: 0.1,
      commissionType: "PERCENTAGE",
      commissionValue: 5,
    }),
    1,
  );
  assert.equal(cents("100.01"), 10001);
  assert.throws(() => cents(0.001));
});
test("delivery only moves forward, skipping is allowed, repeated stage is a no-op", () => {
  assert.equal(deliveryTransition("PREPARING", "DELIVERED"), "CHANGE");
  assert.equal(deliveryTransition("DELIVERED", "DELIVERED"), "NOOP");
  assert.equal(deliveryTransition("DELIVERED", "IN_TRANSIT"), "INVALID");
});
test("recovery distinguishes safe retry from uncertain SMTP delivery", () => {
  assert.equal(recoverState(null), "PENDING");
  assert.equal(recoverState(new Date()), "UNKNOWN");
  assert.equal(emailFailure({ responseCode: 451 }), "RETRY");
  assert.equal(emailFailure({ responseCode: 550 }), "FAILED");
  assert.equal(
    emailFailure({ code: "ECONNRESET", command: "DATA" }),
    "UNKNOWN",
  );
  assert.equal(emailFailure({ code: "ECONNECTION", command: "CONN" }), "RETRY");
  assert.equal(executionFailure({ code: "ER_LOCK_DEADLOCK" }, false), "RETRY");
  assert.equal(executionFailure({ code: "INVALID" }, false), "FAILED");
  assert.equal(executionFailure({ code: "ECONNRESET" }, true), "UNKNOWN");
});
