// Browser fixtures verify the real Angular UI; database/security behavior is tested separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.LAYOUT_URL || 'http://127.0.0.1:4200';
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [],
      requests = [],
      accountMutations = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let active = false,
      shared = false,
      completed = false,
      uploaded = false,
      uploadFails = false,
      sessionExpired = false;
    let latest = null,
      posts = 0;
    const now = () => new Date().toISOString();
    const job = () => ({
      id: 1,
      trackingNumber: 'TN-DELIVERY-001',
      address: 'San Juan Avenue, Sipocot, Camarines Sur',
      recipientName: 'Sample Customer',
      recipientPhone: '09171234567',
      deliveryStatus: completed ? 'DELIVERED' : active ? 'DISPATCHED' : 'PREPARING',
      assignmentVersion: 1,
      employeeId: 3,
      employeeName: 'Delivery Employee',
      attemptId: active ? '11111111-1111-4111-8111-111111111111' : null,
      issueCount: 0,
    });
    const tracking = () => ({
      state: shared ? (latest ? 'LIVE' : 'UNAVAILABLE') : 'STOPPED',
      serverTime: now(),
      deliveryStatus: job().deliveryStatus,
      employeeName: 'Delivery Employee',
      destination: null,
      position: shared ? latest : null,
    });
    const detail = () => ({
      ...job(),
      items: [{ name: 'Phone', quantity: 1 }],
      packages: [
        {
          name: 'Phone package',
          quantity: 1,
          components: [{ productName: 'Charger', quantity: 1 }],
        },
      ],
      history: [{ status: 'PREPARING', occurredAt: now() }],
      issues: [],
      tracking: tracking(),
      completion: completed
        ? {
            recipientName: 'Customer Receiver',
            completedAt: now(),
            employeeName: 'Delivery Employee',
            photoState: 'AVAILABLE',
          }
        : null,
    });
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('tnl_user')) {
        sessionStorage.setItem('tnl_access_token', 'delivery-fixture');
        sessionStorage.setItem(
          'tnl_user',
          JSON.stringify({
            id: 3,
            role: 'DELIVERY',
            fullName: 'Delivery Employee',
            email: 'delivery@example.test',
          }),
        );
      }
      window.fixtureVisible = true;
      window.fixtureDenied = false;
      window.fixtureGpsCalls = 0;
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (window.fixtureVisible ? 'visible' : 'hidden'),
      });
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(success, fail) {
            window.fixtureGpsCalls++;
            setTimeout(
              () =>
                window.fixtureDenied
                  ? fail({ code: 1 })
                  : success({
                      coords: { latitude: 13.765, longitude: 122.976, accuracy: 8 },
                      timestamp: Date.now(),
                    }),
              30,
            );
          },
        },
      });
    });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6XyoAAAAASUVORK5CYII=',
      'base64',
    );
    await page.route(/https:\/\/([^/]+\.)?tile\.openstreetmap\.org\//, (route) => route.abort());
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        p = url.pathname.replace('/api/v1/', '');
      requests.push(p);
      if (p.startsWith('delivery-employees') && request.method() !== 'GET')
        accountMutations.push({ path: p, body: request.postDataJSON() });
      if (sessionExpired && p.endsWith('/tracking'))
        return route.fulfill({ status: 401, json: { error: { message: 'Session expired' } } });
      let data = [];
      if (p === 'dashboard')
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
      if (p === 'auth/login')
        data = {
          token: 'delivery-fixture',
          user: {
            id: 3,
            role: 'DELIVERY',
            fullName: 'Delivery Employee',
            email: 'delivery@example.test',
          },
        };
      if (p === 'delivery/orders' || p.startsWith('delivery/dispatch'))
        data = [{ ...job(), tracking: tracking() }];
      if (p === 'delivery/orders/1') data = detail();
      if (p === 'customer/me')
        data = {
          id: 1,
          fullName: 'Sample Customer',
          address: job().address,
          marketingOptIn: false,
        };
      if (p === 'customer/orders' || p === 'customer/orders/1') {
        const customerOrder = {
          id: 1,
          trackingNumber: job().trackingNumber,
          deliveryStatus: job().deliveryStatus,
          orderStatus: 'APPROVED',
          paymentStatus: 'UNPAID',
          agentName: 'Sales Agent',
          deliveryAddress: job().address,
          createdAt: now(),
          total: 100,
          packages: [],
          items: [],
          deliveryEvents: [],
          followups: [],
        };
        data = p === 'customer/orders' ? [customerOrder] : customerOrder;
      }
      if (p === 'customer/orders/1/delivery') {
        data = detail();
        delete data.assignmentVersion;
        delete data.attemptId;
        delete data.employeeId;
        delete data.recipientPhone;
      }
      if (p === 'customer/orders/1/delivery-tracking') data = tracking();
      if (p.endsWith('/start') && !p.endsWith('/tracking/start')) {
        active = true;
        data = { attemptId: job().attemptId };
      }
      if (p.endsWith('/tracking/start')) {
        shared = true;
        data = { sessionId: '22222222-2222-4222-8222-222222222222' };
      }
      if (p.endsWith('/tracking/stop')) {
        shared = false;
        latest = null;
      }
      if (p.endsWith('/positions')) {
        posts++;
        const b = request.postDataJSON();
        latest = {
          latitude: b.latitude,
          longitude: b.longitude,
          accuracy: b.accuracy,
          observedAt: b.observedAt,
          receivedAt: now(),
        };
        data = { accepted: true };
      }
      if (p.endsWith('/tracking')) data = tracking();
      if (p.endsWith('/pause')) {
        active = false;
        shared = false;
        latest = null;
      }
      if (p.endsWith('/proof-photo')) {
        if (request.method() === 'GET')
          return route.fulfill({ body: png, contentType: 'image/jpeg' });
        if (uploadFails)
          return route.fulfill({
            status: 503,
            json: { error: { message: 'Photo storage unavailable' } },
          });
        uploaded = true;
        data = { id: '33333333-3333-4333-8333-333333333333' };
      }
      if (p.endsWith('/status')) {
        assert(uploaded, 'Completion ran before successful upload');
        completed = true;
        active = false;
        shared = false;
        latest = null;
      }
      if (p === 'delivery-employees')
        data = [
          {
            id: 3,
            fullName: 'Delivery Employee',
            email: 'delivery@example.test',
            phone: '09171234567',
            active: true,
          },
        ];
      if (p === 'auth/logout') {
        shared = false;
        latest = null;
      }
      return route.fulfill({
        status: request.method() === 'POST' && p.endsWith('/proof-photo') ? 201 : 200,
        json: { data },
      });
    });
    await page.goto(base + '/');
    await page.waitForURL('**/delivery');
    await page.getByRole('heading', { name: 'My deliveries', exact: true, level: 2 }).waitFor();
    assert(
      !requests.some((p) =>
        /^(customers|products|orders|dashboard|performance|commissions)(\?|$)/.test(p),
      ),
      requests.join(','),
    );
    assert.equal(
      await page
        .locator('.sidebar')
        .getByRole('button', { name: 'Customers', exact: true })
        .count(),
      0,
    );
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(base + '/delivery/1');
      await page.getByRole('button', { name: 'Start delivery', exact: true }).waitFor();
      await page.locator('.leaflet-container').waitFor();
      await page
        .getByText('Map tiles unavailable. Address and delivery status remain available.', {
          exact: true,
        })
        .waitFor();
      const size = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      assert(size.width <= size.viewport, `Overflow at ${viewport.width}`);
      if (process.env.LAYOUT_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.LAYOUT_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, `delivery-${viewport.width}.png`),
          fullPage: true,
        });
      }
    }
    await page.getByRole('button', { name: 'Start delivery', exact: true }).click();
    await page.getByRole('button', { name: 'Share live location', exact: true }).waitFor();
    await page.evaluate(() => (window.fixtureDenied = true));
    await page.getByRole('button', { name: 'Share live location', exact: true }).click();
    await page
      .getByText('Location permission denied. Status updates still work.', { exact: true })
      .waitFor();
    assert.equal(completed, false);
    assert.equal(posts, 0);
    await page.evaluate(() => (window.fixtureDenied = false));
    await page.getByRole('button', { name: 'Share live location', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.location-status')?.textContent.includes('LIVE'),
    );
    assert.equal(posts, 1);
    await page.clock.install();
    await page.evaluate(() => {
      window.fixtureVisible = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const fixes = await page.evaluate(() => window.fixtureGpsCalls);
    await page.clock.fastForward(65000);
    await page.waitForFunction(() =>
      document.querySelector('.location-status')?.textContent.includes('STALE'),
    );
    assert.equal(
      await page.evaluate(() => window.fixtureGpsCalls),
      fixes,
      'Hidden page acquired GPS',
    );
    await page.evaluate(() => {
      window.fixtureVisible = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(100);
    await page.waitForFunction(() =>
      document.querySelector('.location-status')?.textContent.includes('LIVE'),
    );
    assert(posts >= 2, 'Visible page did not acquire a new fix');
    await page.getByLabel('Received by', { exact: true }).fill('Customer Receiver');
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'proof.jpg', mimeType: 'image/jpeg', buffer: png });
    await page.locator('img[alt="Selected delivery proof preview"]').waitFor();
    uploadFails = true;
    await page.getByRole('button', { name: 'Confirm delivered', exact: true }).click();
    await page.getByRole('alert').getByText('Photo storage unavailable', { exact: true }).waitFor();
    assert.equal(completed, false);
    uploadFails = false;
    await page.getByRole('button', { name: 'Confirm delivered', exact: true }).click();
    await page.getByRole('heading', { name: 'Delivery completed', exact: true }).waitFor();
    await page.locator('img[alt="Proof of delivery"]').waitFor();
    assert.equal(shared, false);
    assert.equal(latest, null);
    await page.goto(base + '/orders?edit=1');
    await page.waitForURL('**/delivery');
    assert(!requests.some((p) => /^orders\//.test(p)), 'Delivery role prefetched an edit order');
    // A new active session is cleared from the UI immediately when authentication expires.
    completed = false;
    active = true;
    uploaded = false;
    await page.goto(base + '/delivery/1');
    await page.getByRole('button', { name: 'Share live location', exact: true }).click();
    await page.clock.runFor(100);
    sessionExpired = true;
    await page.clock.runFor(11000);
    await page.waitForFunction(
      () => !document.querySelector('.location-status')?.textContent.includes('LIVE'),
    );
    const stoppedFixes = await page.evaluate(() => window.fixtureGpsCalls);
    await page.clock.runFor(11000);
    assert.equal(await page.evaluate(() => window.fixtureGpsCalls), stoppedFixes);
    sessionExpired = false;
    await page.evaluate(() => {
      sessionStorage.setItem('tnl_access_token', 'admin-fixture');
      sessionStorage.setItem(
        'tnl_user',
        JSON.stringify({ id: 1, role: 'ADMIN', fullName: 'Admin', email: 'admin@example.test' }),
      );
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/delivery-employees');
    await page.getByRole('heading', { name: 'Delivery employees', exact: true }).waitFor();
    await page.getByRole('button', { name: 'New delivery employee', exact: true }).click();
    await page.getByLabel('Full name', { exact: true }).fill('New Employee');
    await page.getByLabel('Email', { exact: true }).fill('new@example.test');
    await page.getByLabel('PH mobile number', { exact: true }).fill('09171234568');
    await page.getByLabel('Initial password', { exact: true }).fill('Initial-pass-123!');
    await page.getByRole('button', { name: 'Save employee', exact: true }).click();
    await page.getByText('Employee saved.', { exact: true }).waitFor();
    assert.equal(accountMutations.at(-1).body.fullName, 'New Employee');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Full name', { exact: true }).fill('Updated Employee');
    await page.getByRole('button', { name: 'Save employee', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Edit employee', exact: true })
      .waitFor({ state: 'hidden' });
    assert.equal(accountMutations.at(-1).path, 'delivery-employees/3');
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await page.getByLabel('New password', { exact: true }).fill('New-password-123!');
    await page.getByLabel('Confirm password', { exact: true }).fill('Mismatch-password!');
    assert.equal(
      await page.getByRole('button', { name: 'Confirm password reset', exact: true }).isEnabled(),
      false,
    );
    await page.getByLabel('Confirm password', { exact: true }).fill('New-password-123!');
    await page.getByRole('button', { name: 'Confirm password reset', exact: true }).click();
    await page
      .getByText('Password reset. Old sessions and live sharing stopped.', { exact: true })
      .waitFor();
    assert.equal(accountMutations.at(-1).path, 'delivery-employees/3/reset-password');
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Employee page overflows',
    );
    if (process.env.LAYOUT_SCREENSHOT_DIR)
      await page.screenshot({
        path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, 'employees-390.png'),
        fullPage: true,
      });
    shared = true;
    latest = {
      latitude: 13.765,
      longitude: 122.976,
      accuracy: 8,
      observedAt: now(),
      receivedAt: now(),
    };
    await page.goto(base + '/dispatch');
    await page.getByRole('heading', { name: 'Dispatch and deliveries', exact: true }).waitFor();
    await page.locator('.leaflet-container').waitFor();
    await page.getByRole('heading', { name: 'TN-DELIVERY-001', exact: true }).waitFor();
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Dispatch page overflows',
    );
    if (process.env.LAYOUT_SCREENSHOT_DIR)
      await page.screenshot({
        path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, 'dispatch-390.png'),
        fullPage: true,
      });
    const dispatchReads = () => requests.filter((p) => p.startsWith('delivery/dispatch')).length;
    const beforeVisibility = dispatchReads();
    await page.evaluate(() => {
      window.fixtureVisible = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(11000);
    assert.equal(dispatchReads(), beforeVisibility, 'Hidden dispatch continued polling');
    const resumedDispatch = page.waitForResponse((r) => r.url().includes('/delivery/dispatch'));
    await page.evaluate(() => {
      window.fixtureVisible = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await resumedDispatch;
    assert(dispatchReads() > beforeVisibility, 'Visible dispatch did not refresh immediately');
    // The owned customer portal uses its private endpoints and has no delivery actions.
    await page.evaluate(() => {
      sessionStorage.setItem('tnl_access_token', 'customer-fixture');
      sessionStorage.setItem(
        'tnl_user',
        JSON.stringify({
          id: 1,
          role: 'CUSTOMER',
          fullName: 'Sample Customer',
          email: 'customer@example.test',
        }),
      );
    });
    await page.goto(base + '/portal');
    await page.getByRole('button', { name: 'My orders', exact: true }).click();
    await page.getByRole('button', { name: 'Details and follow-up', exact: true }).click();
    await page.locator('.location-status.live').waitFor();
    await page.locator('.leaflet-container').waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Pause delivery', exact: true }).count(),
      0,
    );
    assert.equal(await page.getByLabel('Received by', { exact: true }).count(), 0);
    completed = true;
    shared = false;
    latest = null;
    await page.clock.runFor(11000);
    await page.getByRole('heading', { name: 'Delivery completed', exact: true }).waitFor();
    const proof = page.locator('img[alt="Proof of delivery"]');
    await proof.waitFor();
    await page
      .getByText('DELIVERED · Payment: UNPAID · Agent: Sales Agent', { exact: true })
      .waitFor();
    await page.getByText('DELIVERED · UNPAID ·', { exact: false }).waitFor();
    assert(
      (await proof.getAttribute('src')).startsWith('blob:'),
      'Proof must use an authenticated blob',
    );
    assert(
      await page
        .locator('.location-status')
        .textContent()
        .then((s) => s.includes('STOPPED')),
    );
    assert(requests.includes('customer/orders/1/proof-photo'));
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Customer delivery view overflows',
    );
    if (process.env.LAYOUT_SCREENSHOT_DIR)
      await page.screenshot({
        path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, 'customer-delivery-390.png'),
        fullPage: true,
      });
    assert.deepEqual(errors, []);
    console.log(
      'PASS: Delivery routing, no management prefetch (including edit links), responsive maps/fallback, denied GPS, hidden/resumed tracking, photo retry/completion, expired sessions, admin employee forms, visible dispatch refresh, and private customer location/proof.',
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
