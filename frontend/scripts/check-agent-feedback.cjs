// Requires Playwright/Chrome; fixtures only, no database writes.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.LAYOUT_URL || 'http://127.0.0.1:4200';
const output = process.env.LAYOUT_SCREENSHOT_DIR;
const now = '2026-10-06T09:00:00Z';
const text = 'Helpful advice. <script>alert("unsafe")</script>';
const agents = [
  { id: 2, fullName: 'Jamie Co', email: 'jamie@example.test', active: true, reviewCount: 21, averageRating: 4 },
  { id: 3, fullName: 'Enzo Garcia', email: 'enzo@example.test', active: false, reviewCount: 0, averageRating: null },
].map(a => ({ ...a, phone: '09171234567', closedDeals: 0, totalCommission: 0, createdAt: now, customers: [], orders: [], commissions: [] }));
const reviews = Array.from({ length: 21 }, (_, i) => ({ orderId: i + 1, trackingNumber: `TNL-REVIEW-${i + 1}`, customerId: 1, customerName: 'Mara Santos', rating: [4, 5, 3][i % 3], review: text, createdAt: now }));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    if (output) fs.mkdirSync(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(theme => {
        sessionStorage.setItem('tnl_access_token', 'fixture');
        sessionStorage.setItem('tnl_user', JSON.stringify({ id: 1, role: 'ADMIN', fullName: 'Admin', email: 'admin@example.test' }));
        localStorage.setItem('tnl_theme', theme);
      }, theme);
      let failOnce = true;
      await page.route('**/api/v1/**', route => {
        const url = new URL(route.request().url()), endpoint = url.pathname.split('/api/v1/')[1];
        let data = [], meta;
        if (endpoint === 'dashboard') data = { notifications: [], monthlyRevenue: [] };
        if (endpoint === 'agents') data = agents;
        if (/^agents\/[23]$/.test(endpoint)) data = agents.find(a => a.id === Number(endpoint.split('/')[1]));
        if (/^agents\/[23]\/reviews$/.test(endpoint)) {
          if (failOnce) { failOnce = false; return route.fulfill({ status: 503, json: { error: { message: 'Temporary feedback failure.' } } }); }
          const rows = endpoint.includes('/2/') ? reviews : [];
          const offset = (Number(url.searchParams.get('page') || 1) - 1) * 20;
          data = rows.slice(offset, offset + 20);
          meta = { total: rows.length };
        }
        if (endpoint.endsWith('/rewards')) data = { period: '2026-10', timeZone: 'Asia/Manila', target: null, totals: { incentives: 0, bonuses: 0 }, rewards: [] };
        return route.fulfill({ json: { data, meta } });
      });
      await page.goto(`${base}/agents`);
      await page.locator('.agent-rating').first().waitFor();
      assert.match(await page.locator('.agent-rating').first().innerText(), /4\.0 \/ 5 · 21 reviews/);
      assert.equal(await page.locator('.agent-rating').last().innerText(), 'No reviews');
      await page.getByRole('button', { name: 'View', exact: true }).first().click();
      await page.locator('.customer-rating strong').waitFor();
      assert.equal(await page.locator('.customer-rating strong').innerText(), '4.0 / 5');
      await page.locator('.customer-feedback [role="alert"]').waitFor();
      await page.getByRole('button', { name: 'Retry feedback', exact: true }).click();
      await page.locator('.feedback-card').nth(19).waitFor();
      assert.equal(await page.locator('.feedback-card').count(), 20);
      assert.equal(await page.locator('.feedback-card .feedback-comment').first().textContent(), text);
      assert.equal(await page.locator('.feedback-card script').count(), 0);
      assert.equal(await page.locator('.feedback-card a').first().getAttribute('href'), '/customers/1');
      assert.equal(await page.locator('.feedback-card a').nth(1).getAttribute('href'), '/orders/1');
      await page.getByRole('button', { name: 'Next feedback', exact: true }).click();
      await page.getByText('Page 2 · 21 reviews', { exact: true }).waitFor();
      assert.equal(await page.locator('.feedback-card').count(), 1);
      assert(await page.getByRole('button', { name: 'Next feedback', exact: true }).isDisabled());
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px (${theme})`);
        if (output) await page.screenshot({ path: path.join(output, `agent-feedback-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
      }
      await page.getByRole('button', { name: 'Previous feedback', exact: true }).click();
      await page.locator('.feedback-card').nth(19).waitFor();
      await page.goto(`${base}/agents/3`);
      await page.getByText('No customer reviews for this agent yet.', { exact: true }).waitFor();
      assert.equal(await page.locator('.customer-rating strong').innerText(), 'No reviews');
      assert.equal(await page.locator('.feedback-card').count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: Agent averages/counts, feedback pagination, retry, empty/inactive states, safe comments and links on desktop/mobile in light/dark themes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
