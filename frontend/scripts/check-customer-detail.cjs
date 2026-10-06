// Requires Playwright/Chrome; all business APIs are mocked and no database writes occur.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.LAYOUT_URL || 'http://127.0.0.1:4200';
const output = process.env.LAYOUT_SCREENSHOT_DIR;
const now = '2026-10-06T09:00:00Z';
const comment = 'Helpful agent. <script>alert("unsafe")</script>';
const customer = { id: 1, fullName: 'Mara Santos', email: 'mara@example.test', phone: '09171234567', address: 'Demo address, Quezon City', assignedAgentId: 2, assignedAgentName: 'Jamie Co', portalAccountActive: true, portalAccountExists: true, marketingOptIn: true, createdAt: now, portalVerifiedAt: now };
const orders = Array.from({ length: 21 }, (_, i) => ({ id: i + 1, trackingNumber: `TNL-REVIEW-${i + 1}`, orderStatus: 'COMPLETED', deliveryStatus: 'DELIVERED', paymentStatus: 'PAID', paymentMethod: 'Bank transfer', total: 28995, deliveryAddress: customer.address, agentName: 'Jamie Co', createdAt: now }));
const records = {
  orders,
  requests: ['SUBMITTED', 'CONVERTED', 'DECLINED'].map((status, i) => ({ id: i + 1, status, selections: [{ name: 'Student laptop package', quantity: 1 }], total: 28995, agentName: 'Jamie Co', deliveryAddress: customer.address, paymentMethod: 'Bank transfer', orderId: status === 'CONVERTED' ? 1 : null, trackingNumber: 'TNL-REVIEW-1', declineReason: status === 'DECLINED' ? 'Requested item is unavailable.' : null, createdAt: now })),
  reviews: [{ id: 1, orderId: 1, trackingNumber: 'TNL-REVIEW-1', rating: 4, review: comment, agentName: 'Jamie Co', createdAt: now }],
  followups: [{ id: 1, orderId: 1, trackingNumber: 'TNL-REVIEW-1', message: 'Please confirm the delivery time.', reply: 'Your delivery is scheduled tomorrow.', repliedBy: 'Jamie Co', repliedAt: now, createdAt: now }, { id: 2, orderId: 2, trackingNumber: 'TNL-REVIEW-2', message: 'Please send an update.', reply: null, createdAt: now }],
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    if (output) fs.mkdirSync(output, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      sessionStorage.setItem('tnl_access_token', 'fixture');
      sessionStorage.setItem('tnl_user', JSON.stringify({ id: 1, role: 'ADMIN', fullName: 'Admin', email: 'admin@example.test' }));
    });
    let failRequests = true;
    await page.route('**/api/v1/**', route => {
      const url = new URL(route.request().url()), endpoint = url.pathname.split('/api/v1/')[1];
      let data = [], meta;
      if (endpoint === 'dashboard') data = { notifications: [], monthlyRevenue: [] };
      if (endpoint === 'customers') { data = [customer]; meta = { total: 1 }; }
      if (endpoint === 'customers/1') {
        const view = url.searchParams.get('view') || 'orders';
        if (view === 'requests' && failRequests) { failRequests = false; return route.fulfill({ status: 503, json: { error: { message: 'Temporary customer history failure.' } } }); }
        const offset = (Number(url.searchParams.get('page') || 1) - 1) * 20;
        data = { customer, summary: { orderCount: 21, completedOrders: 21, completedSpend: 608895, requestCount: 3, reviewCount: 1, averageRating: 4, followupCount: 2 }, records: records[view].slice(offset, offset + 20) };
        meta = { total: records[view].length };
      }
      if (endpoint === 'orders/1') data = { ...orders[0], customerId: 1, customerName: customer.fullName, customerEmail: customer.email, customerPhone: customer.phone, origin: 'LIVE', updatedAt: now, agentId: 2, agentEmail: 'jamie@example.test', items: [], packages: [], history: [], deliveryEvents: [], commission: null, review: records.reviews[0] };
      if (endpoint === 'orders/1/delivery') data = { id: 1, assignmentVersion: 1, items: [], packages: [], history: [], issues: [], completion: null, tracking: { state: 'STOPPED', serverTime: now, destination: null, position: null, employeeName: null } };
      if (endpoint.endsWith('/tracking')) data = { state: 'STOPPED', serverTime: now, destination: null, position: null, employeeName: null };
      return route.fulfill({ json: { data, meta } });
    });
    await page.goto(`${base}/customers`);
    await page.getByRole('link', { name: 'View Mara Santos', exact: true }).click();
    await page.getByRole('heading', { name: 'Contact information', exact: true }).waitFor();
    assert.match(await page.locator('.contact-panel').innerText(), /Active and verified/);
    assert.equal(await page.locator('.history-card').count(), 20);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('Page 2 · 21 records').waitFor();
    assert.equal(await page.locator('.history-card').count(), 1);
    await page.getByRole('button', { name: 'Requests 3', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByText('Requested item is unavailable.', { exact: false }).waitFor();
    assert.equal(await page.locator('.history-card').count(), 3);
    await page.getByRole('button', { name: 'Follow-ups 2', exact: true }).click();
    await page.getByText('Awaiting reply', { exact: true }).waitFor();
    await page.getByText('Your delivery is scheduled tomorrow.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reviews 1', exact: true }).click();
    await page.locator('.history-card .review-score').waitFor();
    assert.equal(await page.locator('.history-card .comment').textContent(), comment);
    assert.equal(await page.locator('.history-card script').count(), 0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      if (output) await page.screenshot({ path: path.join(output, `customer-detail-${width}.png`), fullPage: true, animations: 'disabled' });
    }
    await page.getByRole('link', { name: 'TNL-REVIEW-1', exact: true }).click();
    await page.locator('.customer-review .review-body').waitFor();
    assert.equal(await page.locator('.customer-review .review-comment').textContent(), comment);
    assert.match(await page.locator('.customer-review').innerText(), /Credited to Jamie Co/);
    assert.equal(await page.locator('.customer-review script').count(), 0);
    if (output) await page.screenshot({ path: path.join(output, 'order-detail-review-320.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('link', { name: 'Mara Santos', exact: true }).click();
    await page.getByRole('heading', { name: 'Contact information', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Orders 21', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: Admin customer View, contact info, history tabs, pagination, retry, escaped reviews and order/customer links at desktop/mobile widths.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
