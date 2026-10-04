// Run against ng serve with NODE_PATH pointing to the bundled Playwright modules.
// Fixtures exercise presentation and routing; backend/test/reports.test.ts verifies SQL.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const base = process.env.LAYOUT_URL || 'http://localhost:4200';

async function main() {
  const { encodeCsv } = await import(
    pathToFileURL(path.resolve(__dirname, '../src/app/shared/report-output.ts')).href
  );
  assert.equal(
    encodeCsv([
      { name: 'Café, "bundle"\nsecond line', amount: -12.5 },
      { name: '  =SUM(1,2)', amount: 0, sku: '001' },
      { name: '\t@command', amount: null },
      { name: '＋formula', amount: 2 },
    ]),
    '\uFEFF"name","amount","sku"\r\n"Café, ""bundle""\nsecond line","-12.5",""\r\n"\t  =SUM(1,2)","0","001"\r\n"\t\t@command","",""\r\n"\t＋formula","2",""\r\n',
  );
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      if (sessionStorage.getItem('tnl_user')) return;
      sessionStorage.setItem('tnl_access_token', 'reports-test');
      sessionStorage.setItem(
        'tnl_user',
        JSON.stringify({
          id: 1,
          email: 'reports@example.test',
          fullName: 'Reports Admin',
          role: 'ADMIN',
        }),
      );
    });
    let failReport = false;
    let emptyReport = false;
    let delayDaily = false;
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      let data = [];
      if (url.pathname.endsWith('/dashboard'))
        data = {
          totalOrders: 0,
          pendingOrders: 0,
          completedOrders: 0,
          openOrders: 0,
          revenue: 0,
          activeDeliveries: 0,
          totalCustomers: 0,
          totalProducts: 0,
          lowStockProducts: 0,
          monthlyRevenue: [],
          notifications: [],
        };
      if (url.pathname.endsWith('/reports')) {
        requests.push(url.search);
        if (failReport)
          return route.fulfill({
            status: 500,
            json: { error: { message: 'Report fixture failed. Please retry.' } },
          });
        const period = url.searchParams.get('period');
        const selection =
          period === 'daily'
            ? url.searchParams.get('date')
            : period === 'monthly'
              ? url.searchParams.get('month')
              : 'All time';
        if (delayDaily && period === 'daily')
          await new Promise((resolve) => setTimeout(resolve, 500));
        const product = (id, unitsSold) => ({
          id,
          name: `Product ${id} with a descriptive name`,
          sku: `SKU-${id}`,
          unitsSold,
          stockOnHand: 100,
          stockReserved: 10,
          available: 90,
          lastSoldDate: unitsSold ? '2030-01-01' : null,
        });
        data = {
          period,
          selection,
          timeZone: 'Asia/Manila',
          totals: {
            completedSales: emptyReport ? 0 : 12,
            revenue: emptyReport ? 0 : 15400,
            averageSale: emptyReport ? 0 : 1283.33,
            buyingCustomers: emptyReport ? 0 : 7,
            historicalDateSales: emptyReport ? 0 : 2,
          },
          trend: emptyReport
            ? []
            : [
                {
                  label:
                    period === 'daily'
                      ? `${selection} 08:00`
                      : period === 'monthly'
                        ? `${selection}-01`
                        : '2030-01',
                  revenue: 15400,
                  orders: 12,
                },
              ],
          fastProducts: emptyReport
            ? []
            : Array.from({ length: 10 }, (_, i) => product(i + 1, 20 - i)),
          slowProducts: Array.from({ length: 10 }, (_, i) => product(i + 11, i < 5 ? 0 : i)),
          customers: emptyReport
            ? []
            : [{ id: 1, name: 'Sample customer', revenue: 15400, orders: 12 }],
          packages: emptyReport
            ? []
            : [{ id: 1, name: 'Sample package', unitsSold: 5, revenue: 5000 }],
          statuses: [{ status: 'PENDING', orders: 3, value: 3000 }],
          payments: [{ status: 'PARTIALLY_PAID', orders: 3, value: 3000 }],
          stock: { activeProducts: 20, lowStockProducts: 1, availableUnits: 1800 },
          stockAlerts: [product(21, 0)],
        };
      }
      return route.fulfill({ json: { data, meta: { total: data.length ?? 0 } } });
    });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 800, height: 700 },
      { width: 390, height: 844 },
      { width: 320, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${base}/reports/daily?date=2030-01-01`);
      await page.getByRole('heading', { name: 'Daily reports', exact: true, level: 2 }).waitFor();
      await page.locator('app-product-ranking').first().locator('tbody tr').last().waitFor();
      assert.equal(await page.locator('app-product-ranking tbody tr').count(), 20);
      assert.equal(
        await page.locator('.trend-column').count(),
        24,
        'Daily chart must show hours without sales',
      );
      if (viewport.width === 1440) {
        const readCount = requests.length;
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
        const file = await downloaded;
        assert.equal(file.suggestedFilename(), 'tnl-daily-2030-01-01.csv');
        const csv = fs.readFileSync(await file.path(), 'utf8');
        assert(
          csv.startsWith('\uFEFF"period","selection","timeZone","currency","loadedAt","section"'),
        );
        for (const section of [
          'Sales summary',
          'Sales trend',
          'Fast-selling products',
          'Slow-moving products',
          'Top customers',
          'Top packages',
          'Order status',
          'Payment status',
          'Current stock summary',
          'Current low stock',
        ])
          assert(csv.includes('"' + section + '"'), section);
        assert.equal((csv.match(/"Sales trend"/g) || []).length, 24);
        assert(csv.includes('"15400"'), 'CSV must preserve numeric revenue');
        assert.equal(requests.length, readCount, 'Export unexpectedly refetched the report');
        await page.evaluate(() => {
          window.print = () => {
            window.fixturePrinted = true;
          };
        });
        await page.getByRole('button', { name: 'Print / Save PDF', exact: true }).click();
        assert(await page.evaluate(() => window.fixturePrinted));
        assert(
          await page
            .locator('app-reports-page details')
            .evaluateAll((details) => details.every((d) => d.open)),
        );
        await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('.sidebar').isVisible(), false);
        assert.equal(await page.locator('.topbar').isVisible(), false);
        assert.equal(await page.locator('.report-actions').isVisible(), false);
        assert.equal(await page.locator('app-reports-page details tbody tr').count(), 24);
        assert.equal(
          await page
            .locator('app-reports-page .table-scroll')
            .first()
            .evaluate((e) => getComputedStyle(e).overflowX),
          'visible',
        );
        if (process.env.LAYOUT_SCREENSHOT_DIR)
          await page.pdf({
            path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, 'report-daily-print.pdf'),
            preferCSSPageSize: true,
            printBackground: true,
          });
        await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
        assert(
          await page
            .locator('app-reports-page details')
            .evaluateAll((details) => details.every((d) => !d.open)),
        );
        await page.emulateMedia({ media: 'screen' });
      }
      assert.equal(
        await page.locator('.sidebar [aria-current="page"]').getAttribute('aria-label'),
        'Daily reports',
      );
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      assert.ok(
        dimensions.width <= dimensions.viewport,
        `Horizontal overflow at ${viewport.width}`,
      );
      await page
        .locator('app-reports-page .tabs')
        .getByRole('link', { name: 'Monthly', exact: true })
        .click();
      await page.getByRole('heading', { name: 'Monthly reports', exact: true, level: 2 }).waitFor();
      await page.getByLabel('Report month', { exact: true }).fill('2028-02');
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.waitForURL('**/reports/monthly?month=2028-02');
      await page.waitForFunction(() => document.querySelectorAll('.trend-column').length === 29);
      if (viewport.width === 1440) {
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
        const file = await downloaded;
        assert.equal(file.suggestedFilename(), 'tnl-monthly-2028-02.csv');
        assert.equal(
          (fs.readFileSync(await file.path(), 'utf8').match(/"Sales trend"/g) || []).length,
          29,
        );
      }
      if (viewport.width <= 680)
        await page.getByRole('button', { name: 'Open navigation' }).click();
      await page
        .locator('.sidebar')
        .getByRole('button', { name: 'Overall reports', exact: true })
        .click();
      await page.getByRole('heading', { name: 'Overall reports', exact: true, level: 2 }).waitFor();
      await page.locator('.report-context').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Apply', exact: true }).count(), 0);
      if (viewport.width <= 680)
        assert.equal(
          await page.getByRole('button', { name: 'Open navigation' }).getAttribute('aria-expanded'),
          'false',
        );
      assert.match(await page.locator('.report-context').innerText(), /All time/);
      if (viewport.width === 1440) {
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
        assert.equal((await downloaded).suggestedFilename(), 'tnl-overall.csv');
      }
      if (process.env.LAYOUT_SCREENSHOT_DIR && [1440, 390].includes(viewport.width)) {
        fs.mkdirSync(process.env.LAYOUT_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, `reports-${viewport.width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await page.getByRole('button', { name: 'Theme settings' }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-theme') === 'dark',
    );
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    emptyReport = true;
    await page.goto(`${base}/reports/daily?date=2030-03-01`);
    await page.getByText('No completed product sales in this period.', { exact: true }).waitFor();
    assert.equal(
      await page.locator('app-product-ranking').last().locator('tbody tr').count(),
      10,
      'Zero-sale stock must still be reported',
    );
    const emptyDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    assert(
      fs
        .readFileSync(await (await emptyDownload).path(), 'utf8')
        .includes('"Sales summary","0","0","0","0","0"'),
    );
    failReport = true;
    await page.goto(`${base}/reports/overall`);
    await page
      .getByRole('alert')
      .getByText('Report fixture failed. Please retry.', { exact: false })
      .waitFor();
    assert(await page.getByRole('button', { name: 'Export CSV', exact: true }).isDisabled());
    assert(await page.getByRole('button', { name: 'Print / Save PDF', exact: true }).isDisabled());
    failReport = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.locator('.report-context').waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.goto(`${base}/reports/daily?date=2030-02-30`);
    await page
      .getByRole('alert')
      .getByText('Choose a valid date or month between 2000 and 2100.', { exact: false })
      .waitFor();
    emptyReport = false;
    delayDaily = true;
    await page.goto(`${base}/reports/daily?date=2030-01-01`);
    await page
      .locator('app-reports-page .tabs')
      .getByRole('link', { name: 'Overall', exact: true })
      .click();
    await page.locator('.report-context').getByText('All time', { exact: false }).waitFor();
    await page.waitForTimeout(700);
    assert.match(
      await page.locator('.report-context').innerText(),
      /All time/,
      'Late daily response overwrote overall report',
    );
    assert.ok(requests.some((query) => query.includes('month=2028-02')));
    assert.deepEqual(errors, []);
    // Agent sessions retain their existing workflows and cannot open business reports.
    await page.evaluate(() =>
      sessionStorage.setItem(
        'tnl_user',
        JSON.stringify({ id: 2, fullName: 'Agent', email: 'agent@example.test', role: 'AGENT' }),
      ),
    );
    await page.goto(`${base}/reports/overall`);
    await page.waitForURL('**/dashboard');
    assert.equal(
      await page
        .locator('.sidebar')
        .getByRole('button', { name: 'Overall reports', exact: true })
        .count(),
      0,
    );
    console.log(
      'PASS: Reports, CSV escaping/formula prefixes, all period exports, print/table restoration, responsive layouts, empty/error states, stale responses, and agent access.',
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
