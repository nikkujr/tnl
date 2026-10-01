// Fixture API checks for agent dashboard and admin agent details.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.LAYOUT_URL || 'http://localhost:4200';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [role, width, theme] of [['AGENT', 1440, 'light'], ['AGENT', 390, 'light'], ['AGENT', 320, 'dark'], ['ADMIN', 1440, 'light'], ['ADMIN', 390, 'dark']]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let failOnce = true;
      await page.addInitScript(({ role, theme }) => {
        sessionStorage.setItem('tnl_access_token', 'rewards-fixture');
        sessionStorage.setItem('tnl_user', JSON.stringify({ id: role === 'ADMIN' ? 1 : 2, fullName: 'Jamie Co', email: 'staff@example.test', role }));
        localStorage.setItem('tnl_theme', theme);
      }, { role, theme });
      await page.route('**/api/v1/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const endpoint = url.pathname.split('/api/v1/')[1];
        assert.equal(request.method(), 'GET', 'Viewing rewards causes a write');
        let data = [];
        if (endpoint === 'dashboard') data = { totalOrders: 0, pendingOrders: 0, completedOrders: 0, openOrders: 0, revenue: 0, activeDeliveries: 0, totalCustomers: 0, totalProducts: 0, lowStockProducts: 0, monthlyRevenue: [], notifications: [] };
        if (endpoint === 'agents/2') data = { id: 2, fullName: 'Jamie Co', email: 'staff@example.test', phone: '09123456789', active: true, createdAt: '2026-01-01T00:00:00Z', closedDeals: 0, totalCommission: 10000, commissions: [], customers: [], orders: [] };
        if (endpoint.startsWith('performance/agents/')) {
          assert.equal(endpoint, 'performance/agents/2/rewards');
          const period = url.searchParams.get('month');
          if (period === '2000-04' && failOnce) {
            failOnce = false;
            return route.fulfill({ status: 503, json: { error: { message: 'Rewards temporarily unavailable.' } } });
          }
          const empty = period === '2000-01', eligible = period === '2000-02', noIncentive = period === '2000-03';
          data = {
            period, timeZone: 'Asia/Manila', sales: empty ? 0 : 120000,
            target: empty ? null : { salesTarget: 100000, incentiveAmount: noIncentive ? 0 : 3500, progress: 120, status: eligible ? 'ELIGIBLE' : noIncentive ? 'NONE' : 'APPROVED' },
            totals: { incentives: empty || eligible || noIncentive ? 0 : 3500, bonuses: empty || eligible || noIncentive ? 0 : 1500 },
            rewards: empty || eligible || noIncentive ? [] : [
              { id: 2, kind: 'BONUS', amount: 1500, reason: 'Excellent customer service', approvedBy: 'Nico Alvarez', createdAt: '2026-10-02T02:00:00Z' },
              { id: 1, kind: 'INCENTIVE', amount: 3500, reason: 'Monthly sales target reached', approvedBy: 'Nico Alvarez', createdAt: '2026-10-01T01:00:00Z' },
            ],
          };
        }
        return route.fulfill({ json: { data, meta: { total: Array.isArray(data) ? data.length : 0 } } });
      });
      await page.goto(`${base}/${role === 'AGENT' ? 'dashboard' : 'agents/2'}`);
      const panel = page.locator('app-agent-rewards');
      await panel.getByText('Incentive approved', { exact: true }).waitFor();
      assert.equal(await panel.locator('.reward-totals strong').nth(0).textContent(), '₱3,500.00');
      assert.equal(await panel.locator('.reward-totals strong').nth(1).textContent(), '₱1,500.00');
      assert.equal(await panel.getByRole('progressbar').getAttribute('aria-valuenow'), '100');
      await panel.getByText('Excellent customer service', { exact: true }).waitFor();
      assert.equal(await panel.getByRole('link', { name: 'Manage rewards' }).count(), role === 'ADMIN' ? 1 : 0);
      if (process.env.LAYOUT_SCREENSHOT_DIR) await panel.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, `agent-rewards-${role}-${width}.png`) });
      const month = panel.getByLabel('Reward month');
      await month.fill('2000-01');
      await panel.getByText('No sales incentive target has been set for this month.').waitFor();
      await panel.getByText('No approved incentives or bonuses for this month.').waitFor();
      assert.equal(await panel.locator('.reward-totals strong').first().textContent(), '₱0.00');
      await month.fill('2000-02');
      await panel.getByText('Target reached · awaiting approval', { exact: true }).waitFor();
      assert.equal(await panel.locator('.reward-totals strong').first().textContent(), '₱0.00', 'Unapproved incentive is counted as approved');
      await month.fill('2000-03');
      await panel.getByText('No incentive set', { exact: true }).waitFor();
      assert.equal(await panel.getByText(/for a .* incentive/).count(), 0);
      await month.fill('2000-04');
      await panel.getByRole('alert').waitFor();
      await panel.getByRole('button', { name: 'Retry' }).click();
      await panel.getByText('Incentive approved', { exact: true }).waitFor();
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
      assert.ok(dimensions.width <= dimensions.viewport, 'Page overflows horizontally');
      assert.deepEqual(errors, []);
      console.log(`PASS: ${role} rewards at ${width}px (${theme}), history, pending/empty states and retry`);
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
