// Run against ng serve with NODE_PATH pointing to the bundled Playwright modules.
const assert = require('node:assert/strict');
const { chromium, expect } = require('playwright/test');

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      sessionStorage.setItem('tnl_access_token', 'audience-test');
      sessionStorage.setItem(
        'tnl_user',
        JSON.stringify({
          id: 1,
          email: 'admin@example.test',
          fullName: 'Test Admin',
          role: 'ADMIN',
        }),
      );
    });
    const customers = Array.from({ length: 125 }, (_, i) => ({
      id: i + 1,
      fullName: `Customer ${i + 1}`,
      email: `customer${i + 1}@example.test`,
      phone: '09171234567',
      marketingOptIn: i % 2 === 0,
    }));
    let saved;
    let failCustomers = false;
    await page.route('**/api/v1/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/dashboard')) {
        return route.fulfill({
          json: {
            data: {
              totalOrders: 0,
              pendingOrders: 0,
              completedOrders: 0,
              openOrders: 0,
              revenue: 0,
              activeDeliveries: 0,
              totalCustomers: 125,
              totalProducts: 0,
              lowStockProducts: 0,
              monthlyRevenue: [],
              notifications: [],
            },
          },
        });
      }
      if (url.pathname.endsWith('/customers')) {
        if (failCustomers)
          return route.fulfill({ status: 500, json: { error: { message: 'Test load failure' } } });
        const search = url.searchParams.get('search') || '';
        const result = customers.filter((c) => `${c.fullName} ${c.email}`.includes(search));
        const current = Number(url.searchParams.get('page') || 1);
        const limit = Number(url.searchParams.get('limit') || 25);
        return route.fulfill({
          json: {
            data: result.slice((current - 1) * limit, current * limit),
            meta: { total: result.length, page: current, limit },
          },
        });
      }
      if (url.pathname.endsWith('/campaigns') && route.request().method() === 'POST') {
        saved = route.request().postDataJSON();
        return route.fulfill({ json: { data: { id: 1, ...saved } } });
      }
      return route.fulfill({ json: { data: [] } });
    });
    await page.goto(`${process.env.LAYOUT_URL || 'http://127.0.0.1:4200'}/campaigns`);
    await page.getByRole('button', { name: 'New campaign', exact: true }).click();
    await page.locator('select[name="audience"]').selectOption('SELECTED');
    const dialog = page.getByRole('dialog', { name: 'Select customers' });
    const search = dialog.getByRole('searchbox');
    await expect(dialog).toBeVisible();
    await expect(search).toBeFocused();
    await dialog.getByRole('checkbox', { name: 'Select Customer 1', exact: true }).check();
    await expect(
      dialog.getByRole('checkbox', { name: 'Select all customers on this page' }),
    ).toHaveJSProperty('indeterminate', true);
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Select Customer 26', exact: true }).check();
    await search.fill('Customer 125');
    await dialog.getByRole('checkbox', { name: 'Select Customer 125', exact: true }).check();
    await dialog.getByRole('button', { name: 'Apply selection (3)', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.audience-summary')).toContainText('3 customers selected');

    await page.getByRole('button', { name: 'Choose customers' }).click();
    await expect(
      dialog.getByRole('checkbox', { name: 'Select Customer 1', exact: true }),
    ).toBeChecked();
    await dialog.getByRole('button', { name: 'Clear selection' }).click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.audience-summary')).toContainText('3 customers selected');
    await expect(page.getByRole('button', { name: 'Choose customers' })).toBeFocused();

    await page.getByRole('button', { name: 'Choose customers' }).click();
    await dialog.getByRole('button', { name: 'Clear selection' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.audience-summary')).toContainText('3 customers selected');

    await page.getByRole('button', { name: 'Choose customers' }).click();
    await dialog.getByRole('checkbox', { name: 'Select all customers on this page' }).check();
    await expect(dialog.getByRole('button', { name: 'Apply selection (27)' })).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Select all customers on this page' }).uncheck();
    await expect(dialog.getByRole('button', { name: 'Apply selection (2)' })).toBeVisible();
    await search.fill('no matching customer');
    await expect(dialog.getByText('No customers found. Try another search.')).toBeVisible();
    failCustomers = true;
    await search.fill('Customer');
    await expect(dialog.getByRole('alert')).toContainText('Test load failure');
    failCustomers = false;
    await dialog.getByRole('button', { name: 'Retry' }).click();
    await expect(
      dialog.getByRole('checkbox', { name: 'Select Customer 1', exact: true }),
    ).toBeVisible();

    for (const viewport of [
      { width: 1440, height: 600 },
      { width: 390, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      const bounds = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const footer = element.querySelector('.picker-footer').getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          footerBottom: footer.bottom,
          width: innerWidth,
          height: innerHeight,
        };
      });
      assert.ok(bounds.left >= 0 && bounds.right <= bounds.width, 'Dialog overflows horizontally');
      assert.ok(
        bounds.bottom <= bounds.height && bounds.footerBottom <= bounds.height,
        'Dialog actions fall below the viewport',
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    if (process.env.AUDIENCE_SCREENSHOT)
      await page.screenshot({ path: process.env.AUDIENCE_SCREENSHOT });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Audience regression check');
    await page.getByLabel('Start date', { exact: true }).fill('2026-10-02');
    await page.getByLabel('End date', { exact: true }).fill('2026-10-10');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Campaign saved.')).toBeVisible();
    assert.deepEqual(
      saved.customerIds,
      [1, 26, 125],
      'Saved IDs must retain confirmed selection only',
    );
    assert.equal(saved.audienceType, 'SELECTED');
    assert.deepEqual(errors, [], 'No browser errors');
    console.log(
      'PASS: customer audience search, pagination, apply, cancel, Escape, bulk selection, retry, responsive layout and save.',
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
