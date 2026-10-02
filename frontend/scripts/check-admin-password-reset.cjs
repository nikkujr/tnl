// ng serve + Playwright/Chrome; fixture APIs only, no real credential changes.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const base = process.env.LAYOUT_URL || 'http://127.0.0.1:4205';
const output = process.env.LAYOUT_OUTPUT || path.resolve(__dirname, '../../.tmp');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['agents', 'customers']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [],
        submissions = [];
      page.on('pageerror', (e) => {
        errors.push(e.message);
        console.error(e.message);
      });
      await page.addInitScript(() => {
        sessionStorage.setItem('tnl_access_token', 'fixture-admin');
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
      await page.route('**/api/v1/**', async (route) => {
        const req = route.request(),
          endpoint = new URL(req.url()).pathname.split('/api/v1/')[1];
        let data = [],
          status = 200,
          response;
        if (endpoint === 'dashboard')
          data = {
            totalOrders: 0,
            pendingOrders: 0,
            completedOrders: 0,
            openOrders: 0,
            revenue: 0,
            activeDeliveries: 0,
            totalCustomers: 2,
            totalProducts: 0,
            lowStockProducts: 0,
            monthlyRevenue: [],
            notifications: [],
          };
        if (endpoint === 'agents')
          data = [
            {
              id: 2,
              fullName: 'Demo agent',
              email: 'agent@example.test',
              phone: '09171234567',
              active: true,
              closedDeals: 5,
              totalCommission: 200,
            },
            { id: 3, fullName: 'Inactive agent', email: 'inactive@example.test', active: false },
          ];
        if (endpoint === 'customers')
          data = [
            {
              id: 11,
              fullName: 'Demo customer',
              email: 'customer@example.test',
              phone: '09171234567',
              address: 'Demo address',
              assignedAgentName: 'Demo agent',
              portalAccountActive: true,
            },
            {
              id: 12,
              fullName: 'Contact only',
              email: 'contact@example.test',
              phone: '09171234568',
              address: 'Contact address',
              portalAccountActive: false,
            },
          ];
        if (endpoint.endsWith('/reset-password')) {
          submissions.push({ endpoint, body: req.postDataJSON() });
          if (submissions.length === 1) {
            status = 400;
            response = { error: { message: 'Choose a different new password' } };
          } else data = { id: kind === 'agents' ? 2 : 11, reset: true };
        }
        await route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(response || { data }),
        });
      });
      await page.goto(`${base}/${kind}`);
      const button = page.getByRole('button', { name: 'Reset password', exact: true });
      await button.waitFor().catch(async (e) => {
        console.error(await page.locator('body').innerText());
        throw e;
      });
      assert.equal(await button.count(), 1);
      if (kind === 'customers')
        assert.equal(await page.getByRole('button', { name: 'Invite to portal' }).count(), 1);
      await button.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(
        await page
          .getByLabel('New password', { exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await page.getByLabel('New password', { exact: true }).fill('Reset-admin-123!');
      await page.getByLabel('Confirm new password', { exact: true }).fill('Mismatch-123!');
      assert.equal(
        await dialog.getByRole('button', { name: 'Reset password', exact: true }).isDisabled(),
        true,
      );
      await page.getByLabel('Confirm new password', { exact: true }).fill('Reset-admin-123!');
      await page.getByLabel('Show passwords').check();
      await page.waitForFunction(
        () => document.querySelector('#reset-new-password').type === 'text',
      );
      await page.screenshot({
        path: path.join(output, `admin-reset-${kind}-desktop.png`),
        fullPage: true,
      });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const bounds = await dialog.boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
        await page.screenshot({
          path: path.join(output, `admin-reset-${kind}-${width}.png`),
          fullPage: true,
        });
      }
      await dialog.getByRole('button', { name: 'Reset password', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(await page.getByLabel('New password', { exact: true }).inputValue(), '');
      await page.getByLabel('New password', { exact: true }).fill('Reset-admin-456!');
      await page.getByLabel('Confirm new password', { exact: true }).fill('Reset-admin-456!');
      await dialog.getByRole('button', { name: 'Reset password', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.deepEqual(submissions[1], {
        endpoint: `${kind}/${kind === 'agents' ? 2 : 11}/reset-password`,
        body: { newPassword: 'Reset-admin-456!' },
      });
      await button.click();
      assert.equal(await page.getByLabel('New password', { exact: true }).inputValue(), '');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await button.evaluate((el) => el === document.activeElement), true);
      assert.equal(errors.length, 0, errors.join('\n'));
      await page.close();
    }
    const agent = await browser.newPage();
    await agent.addInitScript(() => {
      sessionStorage.setItem('tnl_access_token', 'fixture-agent');
      sessionStorage.setItem(
        'tnl_user',
        JSON.stringify({
          id: 2,
          role: 'AGENT',
          fullName: 'Demo agent',
          email: 'agent@example.test',
        }),
      );
    });
    await agent.route('**/api/v1/**', (route) => {
      const endpoint = new URL(route.request().url()).pathname.split('/api/v1/')[1];
      const data =
        endpoint === 'dashboard'
          ? {
              totalOrders: 0,
              pendingOrders: 0,
              completedOrders: 0,
              openOrders: 0,
              revenue: 0,
              activeDeliveries: 0,
              totalCustomers: 1,
              totalProducts: 0,
              lowStockProducts: 0,
              monthlyRevenue: [],
              notifications: [],
            }
          : endpoint === 'customers'
            ? [
                {
                  id: 11,
                  fullName: 'Demo customer',
                  email: 'customer@example.test',
                  phone: '09171234567',
                  address: 'Demo address',
                  portalAccountActive: true,
                },
              ]
            : [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data }),
      });
    });
    await agent.goto(`${base}/customers`);
    await agent.getByText('Demo customer', { exact: true }).waitFor();
    assert.equal(
      await agent.getByRole('button', { name: 'Reset password', exact: true }).count(),
      0,
    );
    await agent.close();
    console.log(
      'Admin agent/customer reset flows, mobile dialogs, errors, focus and agent restriction passed.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
