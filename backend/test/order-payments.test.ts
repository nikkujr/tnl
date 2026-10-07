import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashPayment } from '../src/features/orders/sales.js';

test('all payment methods record cumulative amounts, validate status and preserve cash change', () => {
  for (const method of ['Cash', 'Cash on delivery', 'Bank transfer', 'Card']) {
    const cash = method === 'Cash' || method === 'Cash on delivery';
    const payment = (received: number, status: string) => cashPayment(10000, method, received, status, received);
    assert.equal(payment(25, 'PARTIALLY_PAID').amountPaid, 25);
    assert.equal(payment(0, 'UNPAID').amountPaid, 0);
    assert.equal(payment(100, 'PAID').amountPaid, 100);
    for (const [amount, status] of [[0, 'PARTIALLY_PAID'], [100, 'PARTIALLY_PAID'], [1, 'UNPAID'], [99, 'PAID'], [0.001, 'PARTIALLY_PAID']] as const) {
      assert.throws(() => payment(amount, status));
    }
    if (cash) {
      assert.equal(payment(120, 'PAID').amountPaid, 100);
      assert.equal(payment(120, 'PAID').cashChange, 20);
    } else {
      assert.equal(payment(100, 'PAID').cashReceived, null);
      assert.throws(() => payment(120, 'PAID'));
    }
  }
});
