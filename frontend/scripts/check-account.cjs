// Requires Playwright/Chrome and ng serve. All business APIs are fixtures.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const base = process.env.LAYOUT_URL || 'http://127.0.0.1:4200';
const output = process.env.LAYOUT_OUTPUT || path.resolve(__dirname, '../../.tmp');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const role of ['ADMIN', 'AGENT', 'CUSTOMER']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      let profile = {
        id: role === 'CUSTOMER' ? 41 : 1,
        role,
        fullName: 'Demo user',
        email: `${role.toLowerCase()}@example.test`,
        phone: '09171234567',
        address: role === 'CUSTOMER' ? 'Original address' : null,
      };
      let profileSaves = 0,
        passwordSaves = 0,
        lastPassword;
      await page.addInitScript((role) => {
        sessionStorage.setItem('tnl_access_token', 'fixture-token');
        sessionStorage.setItem(
          'tnl_user',
          JSON.stringify({
            id: role === 'CUSTOMER' ? 41 : 1,
            role,
            fullName: 'Demo user',
            email: `${role.toLowerCase()}@example.test`,
          }),
        );
      }, role);
      await page.route('**/api/v1/**', async (route) => {
        const req = route.request(),
          endpoint = new URL(req.url()).pathname.split('/api/v1/')[1];
        let data = [];
        if (endpoint === 'dashboard')
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
        if (endpoint === 'performance/agents/1/rewards')
          data = {
            period: '2026-10',
            sales: 0,
            target: null,
            totals: { incentives: 0, bonuses: 0 },
            rewards: [],
          };
        if (endpoint === 'customer/me') data = { ...profile, marketingOptIn: false };
        if (endpoint === 'account') data = profile;
        if (endpoint === 'account/profile') {
          profileSaves++;
          const body = req.postDataJSON();
          assert.deepEqual(
            Object.keys(body).sort(),
            role === 'CUSTOMER' ? ['address', 'fullName', 'phone'] : ['fullName', 'phone'],
          );
          profile = { ...profile, ...body };
          data = { profile, user: { ...profile }, token: 'profile-updated-token' };
        }
        if (endpoint === 'account/password') {
          passwordSaves++;
          lastPassword = req.postDataJSON();
          if (lastPassword.currentPassword === 'wrong-current') {
            await route.fulfill({
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({ error: { message: 'Current password is incorrect' } }),
            });
            return;
          }
          data = {
            profile,
            user: { ...profile, tokenVersion: 1 },
            token: 'password-updated-token',
          };
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data }),
        });
      });
      if (role === 'CUSTOMER') {
        await page.goto(base + '/portal');
        await page.getByRole('link', { name: 'My account', exact: true }).click();
      } else {
        await page.goto(base + '/dashboard');
        await page.getByRole('button', { name: 'Account menu for Demo user', exact: true }).click();
        await page.getByRole('button', { name: 'My account', exact: true }).click();
      }
      await page.getByRole('heading', { name: 'My account', level: 2, exact: true }).waitFor();
      const name = page.getByLabel('Full name', { exact: true });
      await name.waitFor();
      assert.equal(await name.inputValue(), 'Demo user');
      assert(
        (await page.getByLabel('Sign-in email', { exact: false }).getAttribute('readonly')) !==
          null,
      );
      if (role === 'CUSTOMER')
        await page.getByLabel('Address', { exact: false }).fill('Updated customer address');
      else assert.equal(await page.getByLabel('Address', { exact: false }).count(), 0);
      await name.fill(`${role} Updated`);
      await page.getByRole('button', { name: 'Save profile', exact: true }).click();
      await page.getByText('Your profile has been updated.', { exact: true }).waitFor();
      assert.equal(profileSaves, 1);
      assert.equal(
        await page.evaluate(() => JSON.parse(sessionStorage.getItem('tnl_user')).fullName),
        `${role} Updated`,
      );
      await page.getByLabel('Current password', { exact: true }).fill('wrong-current');
      await page.getByLabel('New password', { exact: true }).fill('New-demo-password!');
      await page.getByLabel('Confirm new password', { exact: true }).fill('Does-not-match!');
      assert(await page.getByRole('button', { name: 'Change password', exact: true }).isDisabled());
      await page.getByLabel('Confirm new password', { exact: true }).fill('New-demo-password!');
      await page.getByRole('button', { name: 'Show new password', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('input[name="newPassword"]')?.getAttribute('type') === 'text',
      );
      await page.getByRole('button', { name: 'Change password', exact: true }).click();
      await page.getByText('Current password is incorrect', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Current password', { exact: true }).inputValue(), '');
      await page.getByLabel('Current password', { exact: true }).fill('Original-demo-password!');
      await page.getByRole('button', { name: 'Change password', exact: true }).click();
      await page
        .getByText('Password changed. Other sessions have been signed out.', { exact: true })
        .waitFor();
      assert.equal(passwordSaves, 2);
      assert.equal(lastPassword.newPassword, 'New-demo-password!');
      for (const label of ['Current password', 'New password', 'Confirm new password'])
        assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), '');
      assert.equal(
        await page.evaluate(() => sessionStorage.getItem('tnl_access_token')),
        'password-updated-token',
      );
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: path.join(output, `account-${role.toLowerCase()}-desktop.png`),
        animations: 'disabled',
        fullPage: true,
      });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${role} account page overflows ${width}px`,
        );
        if (width === 390)
          await page.screenshot({
            path: path.join(output, `account-${role.toLowerCase()}-mobile.png`),
            animations: 'disabled',
            fullPage: true,
          });
      }
      if (role === 'CUSTOMER') {
        await page.getByRole('link', { name: 'Back to customer portal', exact: false }).click();
        await page
          .getByRole('heading', { name: `Welcome back, ${role} Updated.`, exact: true })
          .waitFor();
      } else {
        await page
          .getByRole('button', { name: `Account menu for ${role} Updated`, exact: true })
          .click();
        await page.getByRole('button', { name: 'My account', exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      'PASS: Admin/Agent menu and Customer portal links, owned profile fields, name/session refresh, read-only email, password mismatch and current-password errors, token replacement/password clearing, 320/390px layouts; no browser errors. No live business writes.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
