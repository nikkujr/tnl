// Mock APIs only. Run against ng serve with Playwright on NODE_PATH.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.LAYOUT_URL || 'http://127.0.0.1:4200';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [], payments = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => {
      sessionStorage.setItem('tnl_access_token', 'fixture');
      if (!sessionStorage.getItem('tnl_user')) sessionStorage.setItem('tnl_user', JSON.stringify({ id: 1, role: 'CUSTOMER', fullName: 'Mara Santos' }));
    });
    const orders = Array.from({ length: 205 }, (_, i) => ({ id: i + 1, trackingNumber: `TNL-PAGE-${String(i + 1).padStart(3, '0')}`, total: 100,
      paymentStatus: i % 2 ? 'PAID' : 'UNPAID', orderStatus: 'PENDING', deliveryStatus: null, paymentMethod: 'Bank transfer', cashReceived: null, amountPaid: 0,
      createdAt: '2026-10-01T08:00:00Z', customerName: 'Mara Santos', deliveryAddress: 'Naga City', items: [], packages: [], history: [], deliveryEvents: [], followups: [] }));
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url()), endpoint = url.pathname.split('/api/v1/')[1];
      let data = [], meta;
      if (endpoint === 'customer/me') data = { address: 'Naga City' };
      if (endpoint === 'dashboard') data = { stats: {}, monthlySales: [], notifications: [] };
      if (endpoint === 'customer/orders') {
        const q = url.searchParams, limit = Number(q.get('limit') || 10);
        const filtered = orders.filter(o => o.trackingNumber.includes(q.get('search') || '') && (!q.get('paymentStatus') || o.paymentStatus === q.get('paymentStatus')));
        const current = Math.min(Number(q.get('page') || 1), Math.max(1, Math.ceil(filtered.length / limit)));
        data = filtered.slice((current - 1) * limit, current * limit); meta = { page: current, limit, total: filtered.length };
      } else if (/^customer\/orders\/\d+$/.test(endpoint)) data = orders[Number(endpoint.split('/').at(-1)) - 1];
      else if (endpoint.endsWith('/delivery')) data = { history: [], issues: [], tracking: { serverTime: '2026-10-01T08:00:00Z', destination: null, position: null, state: 'STOPPED' }, completion: null, sla: null };
      else if (endpoint === 'notifications') data = { items: [], unreadCount: 0 };
      else if (endpoint === 'orders/1/payment-status') {
        const body = route.request().postDataJSON(); payments.push(body);
        Object.assign(orders[0], body); data = body;
      } else if (endpoint === 'orders/1') data = orders[0];
      return route.fulfill({ json: { data, meta } });
    });
    await page.goto(`${base}/portal?tab=orders`);
    await page.getByText('Showing 1–10 of 205 orders', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Details and follow-up' }).count(), 10);
    await page.getByRole('button', { name: 'Last', exact: true }).click();
    await page.getByText('Showing 201–205 of 205 orders', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Details and follow-up' }).last().click();
    await page.getByRole('link', { name: '← Back to my orders' }).click();
    await page.getByText('Showing 201–205 of 205 orders', { exact: true }).waitFor();
    await page.getByLabel('Search orders', { exact: true }).fill('TNL-PAGE-205');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByText('Showing 1–1 of 1 orders', { exact: true }).waitFor();
    await page.locator('select[name="orderPaymentStatus"]').selectOption('PAID');
    await page.getByText('No orders match your filters.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByText('Showing 1–10 of 205 orders', { exact: true }).waitFor();
    await page.locator('select[name="orderLimit"]').selectOption({ label: '50' });
    await page.getByText('Showing 1–50 of 205 orders', { exact: true }).waitFor();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Order list overflows at ${width}px`);
    }
    await page.evaluate(() => sessionStorage.setItem('tnl_user', JSON.stringify({ id: 1, role: 'ADMIN', fullName: 'Administrator' })));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/orders/1`);
    for (const method of ['Bank transfer', 'Card', 'Cash on delivery', 'Cash']) {
      await page.getByRole('button', { name: 'Payment status', exact: true }).click();
      await page.locator('app-action-dialog select[data-validation-field="method"]').selectOption(method);
      assert.equal(await page.locator('app-action-dialog input[data-validation-field="cashReceived"]').inputValue(), '100');
      await page.locator('app-action-dialog input[data-validation-field="cashReceived"]').fill('25');
      await page.locator('app-action-dialog select[data-validation-field="status"]').selectOption('PARTIALLY_PAID');
      const reference = page.locator('app-action-dialog input[data-validation-field="paymentReference"]');
      const electronic = method === 'Bank transfer' || method === 'Card';
      assert.equal(await reference.count(), electronic ? 1 : 0);
      if (electronic) {
        await reference.fill('');
        const before = payments.length;
        await page.getByRole('button', { name: 'Update payment', exact: true }).click();
        assert.equal(payments.length, before, 'Missing reference must prevent submission');
        await reference.fill(`REF-${method}-123`);
      }
      await page.getByRole('button', { name: 'Update payment', exact: true }).click();
      await page.getByText('Amount paid ₱25.00 · Balance ₱75.00', { exact: true }).waitFor();
      assert.equal(payments.at(-1).amountPaid, 25);
      assert.equal(payments.at(-1).paymentMethod, method);
      assert.equal(payments.at(-1).paymentReference, electronic ? `REF-${method}-123` : null);
      if (electronic) await page.getByText(`Reference: REF-${method}-123`, {exact: true}).waitFor();
    }
    assert.deepEqual(errors, []);
    console.log('Customer search, filters, pagination, return navigation, responsive layout and all-method payment entry passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
