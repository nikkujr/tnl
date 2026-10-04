// Requires Playwright and Chrome. All business APIs use fixtures; no live writes.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.LAYOUT_URL || 'http://127.0.0.1:4200';
const path = require('node:path');
const fs = require('node:fs');
const output = process.env.LAYOUT_OUTPUT || path.resolve(__dirname, '../../.tmp');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      timezoneId: 'Asia/Manila',
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      sessionStorage.setItem('tnl_access_token', 'fixture-token');
      sessionStorage.setItem(
        'tnl_user',
        JSON.stringify({
          id: 1,
          role: 'ADMIN',
          fullName: 'Demo admin',
          email: 'admin@example.test',
        }),
      );
    });
    const agents = [
      {
        id: 2,
        fullName: 'Jamie Co',
        sales: 120000,
        deals: 24,
        salesTarget: 100000,
        incentiveAmount: 2500,
        targetId: 1,
        progress: 120,
        incentiveStatus: 'ELIGIBLE',
      },
      {
        id: 3,
        fullName: 'Alex Rivera',
        sales: 82000,
        deals: 16,
        salesTarget: 100000,
        incentiveAmount: 2500,
        targetId: 2,
        progress: 82,
        incentiveStatus: 'IN_PROGRESS',
      },
      {
        id: 4,
        fullName: 'Sam Santos',
        sales: 56000,
        deals: 12,
        salesTarget: null,
        incentiveAmount: null,
        targetId: null,
        progress: null,
        incentiveStatus: 'NONE',
      },
    ].map((agent, i) => ({
      active: true,
      pipeline: 4,
      pending: 1,
      commission: agent.sales * 0.1,
      incentives: 0,
      bonuses: 0,
      rank: i + 1,
      ...agent,
    }));
    let rewards = [],
      targetCalls = 0,
      bonusCalls = 0,
      month = '2026-10',
      failBonus = true,
      submittedKeys = [];
    function report(period) {
      const empty = period === '2026-09';
      return {
        period,
        timeZone: 'Asia/Manila',
        agents: empty ? [] : agents,
        rewards: empty ? [] : rewards,
        totals: {
          sales: empty ? 0 : 258000,
          deals: empty ? 0 : 52,
          commission: empty ? 0 : 25800,
          incentives: agents[0].incentives,
          bonuses: agents[0].bonuses,
          targetsMet: 1,
          targetsSet: agents.filter((a) => a.targetId).length,
        },
        trend: Array.from({ length: 31 }, (_, i) => ({
          day: `${period}-${String(i + 1).padStart(2, '0')}`,
          sales: empty ? 0 : [0, 12000, 24000, 18000, 6000][i % 5],
          deals: 3,
        })),
      };
    }
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        endpoint = url.pathname.split('/api/v1/')[1];
      let data = [],
        status = 200;
      if (endpoint === 'dashboard')
        data = {
          notifications: [],
          monthlyRevenue: [],
          totalOrders: 0,
          pendingOrders: 0,
          completedOrders: 0,
          revenue: 0,
          totalCustomers: 0,
          totalProducts: 0,
          lowStockProducts: 0,
        };
      if (endpoint === 'agents') data = agents;
      if (endpoint === 'performance') {
        month = url.searchParams.get('month');
        data = report(month);
      }
      if (endpoint.startsWith('performance/targets/')) {
        targetCalls++;
        const agent = agents.find((a) => a.id === Number(endpoint.split('/')[2]));
        const body = req.postDataJSON();
        Object.assign(agent, {
          targetId: 3,
          salesTarget: body.salesTarget,
          incentiveAmount: body.incentiveAmount,
          progress: (agent.sales / body.salesTarget) * 100,
          incentiveStatus: 'IN_PROGRESS',
        });
        data = { saved: true };
      }
      if (endpoint === 'performance/incentives/1/approve') {
        agents[0].incentiveStatus = 'APPROVED';
        agents[0].incentives = 2500;
        rewards.push({
          id: 1,
          agentId: 2,
          agentName: 'Jamie Co',
          kind: 'INCENTIVE',
          amount: 2500,
          reason: 'Monthly sales target reached',
          approvedBy: 'Demo admin',
          createdAt: '2026-10-02T01:00:00Z',
        });
        data = { id: 1 };
        status = 201;
      }
      if (endpoint === 'performance/bonuses') {
        bonusCalls++;
        const body = req.postDataJSON();
        submittedKeys.push(body.idempotencyKey);
        if (failBonus) {
          failBonus = false;
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { message: 'Temporary failure. Retry the same submission.' },
            }),
          });
          return;
        }
        assert.equal(body.amount, 1500);
        assert.equal(body.reason, 'Excellent customer service');
        agents[0].bonuses = 1500;
        rewards.push({
          id: 2,
          agentId: 2,
          agentName: 'Jamie Co',
          kind: 'BONUS',
          amount: 1500,
          reason: body.reason,
          approvedBy: 'Demo admin',
          createdAt: '2026-10-02T02:00:00Z',
        });
        data = { id: 2 };
        status = 201;
      }
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ data }),
      });
    });
    await page.goto(base + '/dashboard');
    await page.getByRole('button', { name: 'Performance', exact: true }).click();
    await page.getByRole('heading', { name: 'Agent performance', exact: true, level: 2 }).waitFor();
    await page.getByRole('heading', { name: 'Top selling agents' }).waitFor();
    assert((await page.locator('.ranking-line').count()) === 3);
    await page.locator('.daily-details summary').click();
    assert.equal(await page.locator('.daily-table>div').count(), 31);
    assert.equal(
      await page.locator('.daily-table>div').first().locator('span').first().innerText(),
      'Oct 1',
    );
    await page.locator('.daily-details summary').click();
    await page.evaluate(() => {
      window.print = () => {
        window.fixturePrinted = true;
      };
    });
    await page.getByRole('button', { name: 'Print / Save PDF', exact: true }).click();
    assert(await page.evaluate(() => window.fixturePrinted));
    assert(await page.locator('.daily-details').evaluate((e) => e.open));
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.topbar').isVisible(), false);
    assert.equal(await page.locator('.report-actions').isVisible(), false);
    assert.equal(
      await page.locator('.daily-table').evaluate((e) => getComputedStyle(e).maxHeight),
      'none',
    );
    await page.pdf({
      path: path.join(output, 'performance-overview-print.pdf'),
      preferCSSPageSize: true,
      printBackground: true,
    });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('.daily-details').evaluate((e) => e.open), false);
    await page.emulateMedia({ media: 'screen' });
    await page.screenshot({
      path: path.join(output, 'performance-desktop.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Targets & incentives', exact: true }).click();
    const sam = page.locator('.target-card').filter({ hasText: 'Sam Santos' });
    await sam.getByRole('button', { name: 'Set target', exact: true }).click();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('name') === 'salesTarget',
    );
    await page.getByLabel('Sales target (₱)', { exact: true }).fill('80000');
    await page.getByLabel('Incentive for reaching target (₱)', { exact: false }).fill('2000');
    await page.getByRole('button', { name: 'Save monthly target', exact: true }).click();
    await page.getByText('Monthly target saved.', { exact: true }).waitFor();
    assert.equal(targetCalls, 1);
    await page
      .locator('.target-card')
      .filter({ hasText: 'Jamie Co' })
      .getByRole('button', { name: 'Approve ₱2,500.00 incentive', exact: true })
      .click();
    await page.getByText('Incentive approved and recorded.', { exact: true }).waitFor();
    assert(
      await page
        .locator('.target-card')
        .filter({ hasText: 'Jamie Co' })
        .getByRole('button', { name: 'Edit target', exact: true })
        .isDisabled(),
    );
    await page.screenshot({
      path: path.join(output, 'performance-targets.png'),
      animations: 'disabled',
    });
    await sam.getByRole('button', { name: 'Edit target', exact: true }).click();
    await page.locator('.editor').waitFor();
    await page.getByRole('button', { name: 'Print / Save PDF', exact: true }).click();
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.editor').isVisible(), false);
    assert.equal(await sam.locator('.target-actions').isVisible(), false);
    await page.pdf({
      path: path.join(output, 'performance-targets-print.pdf'),
      preferCSSPageSize: true,
      printBackground: true,
    });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Bonuses & history', exact: true }).click();
    await page.getByRole('button', { name: 'Add bonus', exact: true }).click();
    await page.getByLabel('Bonus amount (₱)', { exact: true }).fill('1500');
    await page.getByLabel('Reason', { exact: true }).fill('Excellent customer service');
    await page.getByRole('button', { name: 'Approve and record bonus', exact: true }).click();
    await page
      .getByText('Temporary failure. Retry the same submission.', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: 'Approve and record bonus', exact: true }).click();
    await page.getByText('Bonus approved and recorded.', { exact: true }).waitFor();
    assert.equal(bonusCalls, 2);
    assert.equal(new Set(submittedKeys).size, 1);
    await page.getByText('Excellent customer service', { exact: true }).waitFor();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const csvFile = await downloadEvent;
    assert.equal(csvFile.suggestedFilename(), 'tnl-performance-2026-10.csv');
    const csv = fs.readFileSync(await csvFile.path(), 'utf8');
    assert(csv.startsWith('\uFEFF"period","timeZone","currency","loadedAt","section"'));
    for (const section of [
      'Performance summary',
      'Agents and targets',
      'Daily completed sales',
      'Approved rewards (not payouts)',
    ])
      assert(csv.includes('"' + section + '"'), section);
    assert.equal((csv.match(/"Agents and targets"/g) || []).length, 3);
    assert(csv.includes('"Excellent customer service"'));
    assert(csv.includes('"258000"'));
    await page.getByRole('button', { name: 'Print / Save PDF', exact: true }).click();
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: path.join(output, 'performance-rewards-print.pdf'),
      preferCSSPageSize: true,
      printBackground: true,
    });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });
    await page.screenshot({
      path: path.join(output, 'performance-rewards.png'),
      animations: 'disabled',
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const name of ['Overview', 'Targets & incentives', 'Bonuses & history']) {
        await page
          .getByRole('group', { name: 'Performance views' })
          .getByRole('button', { name, exact: true })
          .click();
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${name}: overflow at ${width}px`,
        );
        if (width === 390 && name === 'Overview')
          await page.screenshot({
            path: path.join(output, 'performance-mobile.png'),
            animations: 'disabled',
            fullPage: true,
          });
      }
    }
    await page.getByLabel('Reporting month', { exact: true }).fill('2026-09');
    await page.getByText('No approved rewards this month.', { exact: false }).waitFor();
    await page
      .getByRole('group', { name: 'Performance views' })
      .getByRole('button', { name: 'Overview', exact: true })
      .click();
    await page.getByText('No completed sales this month.', { exact: false }).waitFor();
    assert.equal(month, '2026-09');
    assert.deepEqual(errors, []);
    console.log(
      'PASS: admin navigation, monthly CSV export, printable overview/rewards, targets, incentive approval, bonus retry key/history, empty month, 390/320px layouts; no browser errors. Fixture API only.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
