// All APIs are mocked; no database writes. Run against ng serve with shared NODE_PATH.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.LAYOUT_URL || 'http://127.0.0.1:4200';
const output = process.env.LAYOUT_SCREENSHOT_DIR;
const now = '2026-10-06T09:00:00Z';
const track = { state: 'STOPPED', serverTime: now, destination: null, position: null, employeeName: null };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    if (output) fs.mkdirSync(output, { recursive: true });
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        sessionStorage.setItem('tnl_access_token', 'fixture');
        sessionStorage.setItem('tnl_user', JSON.stringify({ id: 1, role: 'CUSTOMER', fullName: 'Mara Santos', email: 'mara@example.test' }));
      });
      const orders = [1, 2].map(id => ({ id, trackingNumber: `TNL-REVIEW-${id}`, orderStatus: id === 1 ? 'COMPLETED' : 'APPROVED', deliveryStatus: id === 1 ? 'DELIVERED' : 'PREPARING', paymentStatus: id === 1 ? 'PAID' : 'UNPAID', deliveryAddress: 'Demo address', createdAt: now, agentName: 'Jamie Co', total: 28995, items: [], packages: [], deliveryEvents: [], followups: [], canReview: id === 1, review: null }));
      let failOnce = true, posts = 0;
      await page.route('**/api/v1/**', async route => {
        const endpoint = new URL(route.request().url()).pathname.split('/api/v1/')[1];
        let data = [];
        if (endpoint === 'customer/me') data = { address: 'Demo address', marketingOptIn: false };
        if (endpoint === 'customer/orders') data = orders;
        if (/customer\/orders\/[12]$/.test(endpoint)) data = orders[Number(endpoint.split('/').at(-1)) - 1];
        if (/customer\/orders\/[12]\/delivery$/.test(endpoint)) data = { history: [], issues: [], items: [], packages: [], completion: null, tracking: track };
        if (endpoint.endsWith('/tracking')) data = track;
        if (endpoint.endsWith('/review')) {
          posts++;
          if (failOnce) { failOnce = false; return route.fulfill({ status: 503, json: { error: { message: 'Please retry your review.' } } }); }
          const body = route.request().postDataJSON();
          assert.deepEqual(body, { rating: 4, review: '=Test <script>alert("unsafe")</script> Helpful agent.' });
          data = { ...body, createdAt: now, reused: false };
          orders[0].review = data;
          orders[0].canReview = false;
        }
        return route.fulfill({ json: { data } });
      });
      await page.goto(`${base}/portal`);
      await page.getByRole('button', { name: 'My orders', exact: true }).click();
      await page.getByRole('button', { name: 'Details and follow-up' }).last().click();
      await page.locator('.order-review').getByText('You can leave a review after your order is delivered and fully paid.').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Submit review', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Details and follow-up' }).first().click();
      const submit = page.getByRole('button', { name: 'Submit review', exact: true });
      await submit.waitFor();
      assert(await submit.isDisabled());
      await page.getByRole('radio', { name: '4 out of 5', exact: false }).check();
      await page.getByLabel('Review', { exact: true }).fill('=Test <script>alert("unsafe")</script> Helpful agent.');
      await submit.click();
      await page.locator('.order-review [role="alert"]').waitFor();
      assert.equal(await page.getByLabel('Review', { exact: true }).inputValue(), '=Test <script>alert("unsafe")</script> Helpful agent.');
      if (output) await page.screenshot({ path: path.join(output, `review-form-${width}.png`), animations: 'disabled', fullPage: true });
      await submit.click();
      await page.locator('.order-review [role="status"]').waitFor();
      assert.equal(await submit.count(), 0);
      assert.equal(await page.locator('.order-review .review-comment').textContent(), '=Test <script>alert("unsafe")</script> Helpful agent.');
      assert.equal(await page.locator('.order-review script').count(), 0);
      await page.getByRole('button', { name: 'Details and follow-up' }).first().click();
      await page.locator('.review-score').waitFor();
      assert.equal(posts, 2);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, timezoneId: 'Asia/Manila' });
    const adminErrors = [];
    page.on('pageerror', e => adminErrors.push(e.message));
    await page.addInitScript(() => {
      sessionStorage.setItem('tnl_access_token', 'fixture');
      sessionStorage.setItem('tnl_user', JSON.stringify({ id: 1, role: 'ADMIN', fullName: 'Admin', email: 'admin@example.test' }));
    });
    const reviews = [
      { orderId: 1, trackingNumber: 'TNL-REVIEW-1', customerName: 'Mara Santos', agentId: 2, agentName: 'Jamie Co', rating: 4, review: '=Test <script>alert("unsafe")</script> Helpful agent.', createdAt: now },
      { orderId: 2, trackingNumber: 'TNL-REVIEW-2', customerName: 'Luis Ramos', agentId: null, agentName: null, rating: 3, review: 'The office could provide clearer updates.', createdAt: now },
    ];
    await page.route('**/api/v1/**', route => route.fulfill({ json: { data: new URL(route.request().url()).pathname.endsWith('/performance') ? {
      period: '2026-10', timeZone: 'Asia/Manila', reviews, rewards: [], trend: [], totals: { sales: 0, deals: 0, commission: 0, incentives: 0, bonuses: 0, targetsMet: 0, targetsSet: 0 },
      agents: [{ id: 2, fullName: 'Jamie Co', active: true, sales: 0, deals: 0, commission: 0, pipeline: 0, pending: 0, rank: 1, targetId: null, reviewCount: 1, averageRating: 4 }],
    } : new URL(route.request().url()).pathname.endsWith('/dashboard') ? { notifications: [], monthlyRevenue: [] } : [] } }));
    await page.goto(`${base}/performance`);
    await page.getByRole('heading', { name: 'Team leaderboard' }).waitFor();
    assert.match(await page.locator('tbody').innerText(), /4\.0 \/ 5/);
    await page.getByRole('button', { name: 'Customer feedback', exact: true }).click();
    await page.locator('.feedback-card').first().waitFor();
    assert.equal(await page.locator('.feedback-card').count(), 2);
    assert.deepEqual(adminErrors, []);
    await page.getByLabel('Agent', { exact: true }).selectOption('2');
    assert.equal(await page.locator('.feedback-card').count(), 1);
    await page.getByLabel('Agent', { exact: true }).selectOption('office');
    assert.match(await page.locator('.feedback-card').innerText(), /Office — no agent/);
    await page.getByLabel('Agent', { exact: true }).selectOption('all');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (output) await page.screenshot({ path: path.join(output, `admin-feedback-${width}.png`), animations: 'disabled', fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 950 });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const file = await download;
    const csv = fs.readFileSync(await file.path(), 'utf8');
    assert.match(csv, /Customer feedback/);
    assert.match(csv, /"\t=Test/);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.feedback-filter').isVisible(), false);
    assert.equal(await page.locator('.feedback-card').count(), 2);
    console.log('PASS: Customer review eligibility, validation, retry, persistence, escaping; admin averages, filtering, CSV and print at desktop/mobile widths.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
