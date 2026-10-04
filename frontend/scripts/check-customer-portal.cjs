// Requires Playwright and Chrome. Run against `ng serve`, using NODE_PATH for a shared runtime.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.LAYOUT_URL || 'http://localhost:4200';
const customer = { id: 2, email: 'customer@example.test', fullName: 'Sam Rivera', role: 'CUSTOMER' };
const offers = [
  { id: 1, kind: 'PACKAGE', revision: '1', name: 'Workday essentials', description: 'A useful set of everyday office accessories.', price: 1200, available: true, components: [{ productId: 3, productName: 'Desk organizer', quantity: 1 }] },
  { id: 2, kind: 'PRODUCT', revision: '1', name: 'Everyday notebook', description: 'Make room for your next good idea.', price: 180, available: true },
  { id: 3, kind: 'PRODUCT', revision: '1', name: 'Desk organizer', description: 'Keep the little things in their place.', price: 420, available: false },
  { id: 4, kind: 'PACKAGE', revision: '1', name: 'Sold out bundle', price: 500, available: false },
  ...Array.from({ length: 6 }, (_, i) => ({ id: 10 + i, kind: 'PRODUCT', revision: '1', name: `Available product ${i + 1}`, price: 100, available: true })),
];

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  const posted = [];
  let emptyCatalog = false;
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.split('/api/v1/')[1];
      const body = request.method() === 'POST' ? request.postDataJSON() : undefined;
      if (body) posted.push({ endpoint, body });
      let data = [];
      if (endpoint === 'catalog') { const search = new URL(request.url()).searchParams.get('search') || ''; data = emptyCatalog ? [] : offers.filter((o) => (o.name + ' ' + (o.description || '')).toLowerCase().includes(search.toLowerCase())); }
      if (endpoint === 'customer/me') data = { address: '123 Example Street', marketingOptIn: false };
      if (endpoint === 'customer-auth/login') {
        if (body.email === 'invalid@example.test') {
          return route.fulfill({ status: 401, json: { error: { message: 'Invalid email or password' } } });
        }
        data = { token: 'portal-layout-fixture', user: customer };
      }
      if (endpoint.startsWith('customer-auth/') && endpoint !== 'customer-auth/login') data = { message: 'Check your email for the next step.' };
      if (endpoint === 'customer/requests' && body) data = { id: 1 };
      return route.fulfill({ json: { data } });
    });
    async function fits(label) {
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= dimensions.width, `${label} overflows horizontally`);
    }
    async function screenshot(name) {
      if (process.env.LAYOUT_SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, `portal-${name}.png`), fullPage: true });
      }
    }
    for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 900 }, { width: 390, height: 900 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${base}/portal`);
      await page.locator('.offer-card').first().waitFor();
      await fits('Sign in');
      const card = await page.locator('.auth-card').boundingBox();
      assert.ok(card.width <= 441, 'Sign-in card stretches across page');
      const email = await page.getByLabel('Email', { exact: true }).boundingBox();
      const password = await page.getByLabel('Password', { exact: true }).boundingBox();
      assert.ok(password.y > email.y + email.height, 'Sign-in fields are not stacked');
      if (viewport.width === 1440 || viewport.width === 390) await screenshot(`signin-${viewport.width}`);

      await page.getByLabel('Email', { exact: true }).fill('invalid@example.test');
      await page.getByLabel('Password', { exact: true }).fill('TestPassword123!');
      await page.locator('.auth-submit').click();
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByRole('alert').innerText(), 'Invalid email or password');
      assert.equal(await page.locator('.auth-card [role="alert"]').count(), 1, 'Auth error appears outside card');
      await fits('Sign-in error');
      if (viewport.width === 1440) await screenshot('signin-error');

      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await page.getByRole('alert').waitFor({ state: 'hidden' });
      assert.equal(await page.getByRole('alert').count(), 0, 'Switching mode retains stale error');
      await page.getByLabel('Email', { exact: true }).fill(customer.email);
      await page.getByLabel('Password', { exact: true }).fill('TestPassword123!');
      await page.getByLabel('Full name').fill(customer.fullName);
      await page.getByLabel('PH mobile number').fill('09123456789');
      await page.getByLabel('Address', { exact: true }).fill('123 Example Street');
      await fits('Registration');
      if (viewport.width === 390) await screenshot('register-mobile');
      await page.locator('.auth-submit').click();
      await page.locator('.auth-card .notice').waitFor();
      assert.ok(posted.some((entry) => entry.endpoint === 'customer-auth/register' && entry.body.fullName === customer.fullName));

      await page.locator('.auth-switch').getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('button', { name: 'Forgot password?' }).click();
      await page.getByRole('heading', { name: 'Forgot your password?', exact: true }).waitFor();
      assert.equal(await page.locator('input[type="password"]').count(), 0);
      await fits('Password recovery');
      await page.locator('.auth-submit').click();
      await page.locator('.auth-card .notice').waitFor();
      assert.ok(posted.some((entry) => entry.endpoint === 'customer-auth/forgot-password'));
      console.log(`PASS: Sign-in, error, registration and recovery at ${viewport.width}px`);
    }

    await page.goto(`${base}/portal?verify=fixture-verification`);
    await page.locator('.auth-submit').click();
    await page.locator('.auth-card .notice').waitFor();
    assert.deepEqual(posted.find((entry) => entry.endpoint === 'customer-auth/verify').body, { token: 'fixture-verification' });
    await page.goto(`${base}/portal?reset=fixture-reset`);
    await page.getByLabel('Password', { exact: true }).fill('NewPassword123!');
    await page.locator('.auth-submit').click();
    await page.locator('.auth-card .notice').waitFor();
    assert.deepEqual(posted.find((entry) => entry.endpoint === 'customer-auth/reset-password').body, { token: 'fixture-reset', password: 'NewPassword123!' });

    await page.getByLabel('Email', { exact: true }).fill(customer.email);
    await page.getByLabel('Password', { exact: true }).fill('TestPassword123!');
    await page.locator('.auth-submit').click();
    await page.locator('.customer-navigation').waitFor();
    assert.equal(await page.locator('.auth-card').count(), 0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByLabel('Offer type', { exact: true }).selectOption('ALL');
      await page.getByText('Showing 1–6 of 8 offers', { exact: false }).waitFor();
      assert.equal(await page.locator('.offer-card').filter({ hasText: 'Desk organizer' }).getByRole('heading', { name: 'Desk organizer', exact: true }).count(), 0);
      assert.equal(await page.locator('.offer-card').filter({ hasText: 'Sold out bundle' }).count(), 0);
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByText('Showing 7–8 of 8 offers', { exact: false }).waitFor();
      await page.getByLabel('Offer type', { exact: true }).selectOption('PRODUCT');
      await page.getByText('Showing 1–6 of 7 offers', { exact: false }).waitFor();
      assert.equal(await page.locator('.offer-card .tag').filter({ hasText: 'Package' }).count(), 0);
      await page.getByLabel('Offer type', { exact: true }).selectOption('PACKAGE');
      await page.getByText('Showing 1–1 of 1 offers', { exact: false }).waitFor();
      assert.equal(await page.locator('.offer-card').count(), 1);
      assert.equal(await page.locator('.catalog-pagination').count(), 0);
      await page.getByLabel('Search products and packages', { exact: true }).fill('notebook');
      await page.locator('.catalog-search').getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByRole('heading', { name: 'No offers found' }).waitFor();
      await page.getByLabel('Offer type', { exact: true }).selectOption('PRODUCT');
      await page.getByRole('heading', { name: 'Everyday notebook', exact: true }).waitFor();
      await page.getByLabel('Search products and packages', { exact: true }).fill('');
      await page.locator('.catalog-search').getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByText('Showing 1–6 of 7 offers', { exact: false }).waitFor();
      await page.getByLabel('Offer type', { exact: true }).selectOption('ALL');
      await page.getByText('Showing 1–6 of 8 offers', { exact: false }).waitFor();
      await fits('Customer catalog');
      if (width !== 320) await screenshot(`catalog-${width}`);
    }
    await page.locator('.offer-card').first().getByRole('button', { name: 'Add to request' }).click();
    await page.getByRole('heading', { name: 'Review your order request' }).waitFor();
    await fits('Order request');
    await page.getByRole('button', { name: 'Confirm and submit request' }).click();
    await page.getByText('Request submitted.', { exact: false }).waitFor();
    const submitted = posted.find((entry) => entry.endpoint === 'customer/requests');
    assert.deepEqual(submitted.body.packages, [{ packageId: 1, quantity: 1 }]);
    assert.deepEqual(submitted.body.reviewedTerms, [{ kind: 'PACKAGE', id: 1, revision: '1' }]);
    await page.getByRole('button', { name: 'My orders', exact: true }).click();
    await page.getByText('No orders recorded yet.').waitFor();
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    await fits('Customer preferences');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.locator('.auth-card').waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('tnl_access_token')), null);
    await page.evaluate(() => localStorage.setItem('tnl_theme', 'dark'));
    await page.setViewportSize({ width: 1440, height: 900 });
    emptyCatalog = true;
    await page.reload();
    await page.getByRole('heading', { name: 'No offers found' }).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await fits('Dark theme and empty catalog');
    await screenshot('dark-empty');
    console.log('PASS: Verification, reset, customer navigation, request submission and sign-out.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
