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
    let destination = { latitude: 13.77, longitude: 122.98 };
    let milestone = 'PREPARING';
    let estimatedDeliveryAt = null;
    let slaDueAt = null;
    const sla = () => ({
      state: !slaDueAt ? 'NOT_SET' : completed
        ? (Date.now() > Date.parse(slaDueAt) ? 'BREACHED' : 'MET')
        : (Date.now() > Date.parse(slaDueAt) ? 'OVERDUE' : 'ON_TRACK'),
      dueAt: slaDueAt,
      minutes: slaDueAt ? Math.ceil(Math.abs(Date.now() - Date.parse(slaDueAt)) / 60000) : null,
    });
    const futureEstimate = () => new Date(Date.now() + 12 * 3600000).toISOString().slice(0, 16);
    let proofState = 'AVAILABLE',
      hasEvidence = true;
    const now = () => new Date().toISOString();
    const job = () => ({
      id: 1,
      orderStatus: completed ? 'COMPLETED' : 'APPROVED',
      trackingNumber: 'TN-DELIVERY-001',
      address: 'San Juan Avenue, Sipocot, Camarines Sur',
      recipientName: 'Sample Customer',
      recipientPhone: '09171234567',
      deliveryStatus: completed ? 'DELIVERED' : milestone,
      estimatedDeliveryAt,
      sla: sla(),
      assignmentVersion: 1,
      employeeId: 3,
      employeeName: 'Delivery Employee',
      attemptId: active ? '11111111-1111-4111-8111-111111111111' : null,
      issueCount: 0,
    });
    const tracking = () => ({
      state: shared ? (latest ? 'LIVE' : 'UNAVAILABLE') : 'STOPPED',
      serverTime: now(),
      sla: sla(),
      deliveryStatus: job().deliveryStatus,
      estimatedDeliveryAt,
      employeeName: 'Delivery Employee',
      destination,
      position: shared ? latest : null,
    });
    const detail = () => ({
      ...job(),
      items: [{ name: 'Phone', quantity: 1 }],
      packages: [
        {
          name: 'Phone package',
          quantity: 3,
          components: [{ productId: 2, productName: 'Charger', quantity: 2 }],
        },
      ],
      history: [{ status: 'PREPARING', occurredAt: now() }],
      issues: [],
      tracking: tracking(),
      completion:
        completed && hasEvidence
          ? {
              recipientName: 'Customer Receiver',
              completedAt: now(),
              employeeName: 'Delivery Employee',
              photoState: proofState,
              ...(proofState === 'EXCEPTION'
                ? { exceptionReason: 'Camera unavailable at handoff' }
                : {}),
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
      if (p === 'delivery/location-search') {
        const query = url.searchParams.get('query');
        if (query === 'offline')
          return route.fulfill({
            status: 502,
            json: {
              error: { message: 'Place search could not be reached. Try again or use the map.' },
            },
          });
        return route.fulfill({
          json: {
            data:
              query === 'no matches'
                ? []
                : [{ latitude: 14.07, longitude: 121.32, label: 'San Pablo, Laguna, Philippines' }],
          },
        });
      }
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
      if (p === 'orders/1')
        data = {
          id: 1,
          trackingNumber: job().trackingNumber,
          origin: 'LIVE',
          orderStatus: completed ? 'COMPLETED' : 'APPROVED',
          deliveryStatus: job().deliveryStatus,
          paymentStatus: 'UNPAID',
          paymentMethod: 'Cash',
          customerName: job().recipientName,
          customerEmail: 'customer@example.test',
          customerPhone: job().recipientPhone,
          agentName: 'Sales Agent',
          agentEmail: 'agent@example.test',
          deliveryAddress: job().address,
          createdAt: now(),
          updatedAt: now(),
          items: [],
          packages: [],
          deliveryEvents: [],
          history: [],
          commission: null,
          total: 100,
        };
      if (p === 'orders/1/delivery-destination') {
        const body = request.postDataJSON();
        destination =
          body.latitude === null ? null : { latitude: body.latitude, longitude: body.longitude };
      }
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
      if (p === 'tracking/TN-DELIVERY-001') data = { trackingNumber: job().trackingNumber, orderStatus: 'APPROVED', deliveryStatus: milestone, estimatedDeliveryAt, sla: sla(), events: [] };
      if (p.endsWith('/start') && !p.endsWith('/tracking/start')) {
        if (milestone === 'PREPARING') {
          estimatedDeliveryAt = new Date(request.postDataJSON().estimatedDeliveryAt).toISOString();
          assert(Date.parse(estimatedDeliveryAt) > Date.now());
          slaDueAt ||= estimatedDeliveryAt;
        }
        active = true;
        if (milestone === 'PREPARING') milestone = 'DISPATCHED';
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
      if (p === 'orders/1/delivery-status') {
        const body = request.postDataJSON();
        milestone = body.deliveryStatus;
        if (body.estimatedDeliveryAt) estimatedDeliveryAt = new Date(body.estimatedDeliveryAt).toISOString();
        if (milestone === 'DISPATCHED') slaDueAt ||= estimatedDeliveryAt;
      }
      if (p === 'orders/1/delivery-estimate') estimatedDeliveryAt = new Date(request.postDataJSON().estimatedDeliveryAt).toISOString();
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
      await page.getByText('Phone package × 3', { exact: true }).waitFor();
      await page.getByText('Charger × 6', { exact: true }).waitFor();
      assert(!(await page.locator('app-delivery-panel .items').textContent()).includes('NaN'));
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
    assert(await page.getByRole('button', { name: 'Start delivery', exact: true }).isDisabled());
    await page.getByLabel('Estimated arrival (Philippine time)', { exact: true }).fill(futureEstimate());
    await page.getByRole('button', { name: 'Start delivery', exact: true }).click();
    await page.getByRole('button', { name: 'Share live location', exact: true }).waitFor();
    await page.getByText('On track', { exact: true }).waitFor();
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
    completed = false;
    active = false;
    shared = false;
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 700 },
    ]) {
      milestone = 'PREPARING';
      slaDueAt = null;
      await page.setViewportSize(viewport);
      await page.goto(base + '/orders/1');
      const map = page.locator('app-delivery-panel .leaflet-container');
      await map.waitFor();
      await page.locator('.delivery-map-marker.destination').waitFor();
      const search = page.getByLabel('Search destination', { exact: true });
      assert.equal(
        requests.filter((p) => p === 'delivery/location-search').length,
        viewport.width === 1440 ? 0 : 3 * (viewport.width === 390 ? 1 : 2),
        'Search should only run on explicit submission',
      );
      await search.fill('no matches');
      await page.getByRole('button', { name: 'Search places', exact: true }).click();
      await page
        .getByText('No places found. Try a nearby landmark or place the pin manually.', {
          exact: true,
        })
        .waitFor();
      await search.fill('offline');
      await page.getByRole('button', { name: 'Search places', exact: true }).click();
      await page
        .getByText('Place search could not be reached. Try again or use the map.', { exact: true })
        .waitFor();
      const beforeSaves = requests.filter((p) => p === 'orders/1/delivery-destination').length;
      await search.fill('San Pablo');
      await page.getByRole('button', { name: 'Search places', exact: true }).click();
      await page
        .getByRole('button', { name: 'San Pablo, Laguna, Philippines', exact: true })
        .click();
      await page.locator('.leaflet-marker-icon[title="Unsaved destination"]').waitFor();
      assert.equal(
        await page.getByLabel('Destination latitude', { exact: true }).inputValue(),
        '14.07',
      );
      assert.equal(
        requests.filter((p) => p === 'orders/1/delivery-destination').length,
        beforeSaves,
        'Selecting a search result saves without confirmation',
      );
      const foundPin = await page
        .locator('.leaflet-marker-icon[title="Unsaved destination"]')
        .boundingBox();
      const foundMap = await map.boundingBox();
      assert(
        foundPin.x >= foundMap.x && foundPin.x + foundPin.width <= foundMap.x + foundMap.width,
        'Searched pin is outside the map',
      );
      await page.getByRole('button', { name: 'Cancel pin changes', exact: true }).click();
      const before = await page.locator('.leaflet-marker-icon').first().getAttribute('style');
      const box = await map.boundingBox();
      await map.click({ position: { x: box.width * 0.7, y: box.height * 0.6 } });
      await page.locator('.leaflet-marker-icon[title="Unsaved destination"]').waitFor();
      const after = await page.locator('.leaflet-marker-icon').first().getAttribute('style');
      assert.notEqual(
        after,
        before,
        'Chosen destination must move the visible marker before saving',
      );
      const marker = page.locator('.leaflet-marker-icon[title="Unsaved destination"]');
      const drag = await marker.boundingBox();
      await page.evaluate(() => {
        window.fixtureDraggedMarker = document.querySelector(
          '.leaflet-marker-icon[title="Unsaved destination"]',
        );
      });
      await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2);
      await page.mouse.down();
      await page.mouse.move(drag.x + 55, drag.y + 35, { steps: 5 });
      await page.clock.runFor(11000);
      assert(
        await page.evaluate(() => window.fixtureDraggedMarker.isConnected),
        'Polling must keep the marker being dragged',
      );
      await page.mouse.up();
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await marker.waitFor();
      await page.getByRole('button', { name: 'Cancel pin changes', exact: true }).click();
      await page.locator('.leaflet-marker-icon[title="Delivery destination"]').waitFor();
      await map.click({ position: { x: box.width * 0.7, y: box.height * 0.6 } });
      await marker.waitFor();
      assert(
        !requests.includes('orders/1/delivery-destination'),
        'Picking a pin must not save automatically',
      );
      assert(await page.getByRole('button', { name: 'Save destination', exact: true }).isEnabled());
      await page.evaluate(() => {
        window.fixtureMap = document.querySelector('app-delivery-panel .leaflet-container');
        window.fixtureMarker = document.querySelector('app-delivery-panel .leaflet-marker-icon');
        window.fixtureMapRemoved = false;
        window.fixtureObserver = new MutationObserver(() => {
          if (!window.fixtureMap.isConnected || !window.fixtureMarker.isConnected)
            window.fixtureMapRemoved = true;
        });
        window.fixtureObserver.observe(document.body, { childList: true, subtree: true });
      });
      const saved = page.waitForResponse((r) => r.url().endsWith('/delivery-destination'));
      await page.getByRole('button', { name: 'Save destination', exact: true }).click();
      await saved;
      await page.getByText('Destination pin saved.', { exact: true }).waitFor();
      await page.waitForFunction(() => window.fixtureMap.isConnected && !window.fixtureMapRemoved);
      assert.equal(
        await page.evaluate(() => window.fixtureMapRemoved),
        false,
        'Saving must keep the map mounted',
      );
      await page.evaluate(() => window.fixtureObserver.disconnect());
      await page.getByText('Enter destination coordinates', { exact: true }).click();
      await page.getByLabel('Destination latitude', { exact: true }).fill('91');
      assert.equal(
        await page.getByRole('button', { name: 'Save destination', exact: true }).isEnabled(),
        false,
      );
      await page.getByLabel('Destination latitude', { exact: true }).fill('13.8');
      await page.getByRole('button', { name: 'Cancel pin changes', exact: true }).click();
      assert(
        await page
          .getByRole('heading', { name: 'Dispatch & delivery status', exact: true })
          .isVisible(),
      );
      assert(await page.getByRole('button', { name: 'Mark dispatched', exact: true }).isVisible());
      await page.getByLabel('Estimated arrival (Philippine time)', { exact: true }).fill(futureEstimate());
      await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
      await page.getByText('Estimated delivery updated for the customer.', { exact: true }).waitFor();
      assert(Date.parse(estimatedDeliveryAt) > Date.now());
      await page.getByRole('button', { name: 'Mark dispatched', exact: true }).click();
      await page.getByRole('button', { name: 'Mark in transit', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Mark in transit', exact: true }).click();
      await page.getByRole('button', { name: 'Mark out for delivery', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Mark out for delivery', exact: true }).click();
      await page.getByText('Current: Out For Delivery', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Record delivery completion', exact: true }).click();
      assert(
        await page
          .getByLabel('Received by', { exact: true })
          .evaluate((e) => e === document.activeElement),
      );
      assert(
        await page.evaluate(
          () => window.fixtureMap.isConnected && window.fixtureMarker.isConnected,
        ),
        'Milestone updates must preserve the destination marker',
      );
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Order delivery controls overflow',
      );
      if (process.env.LAYOUT_SCREENSHOT_DIR)
        await page.screenshot({
          path: path.join(
            process.env.LAYOUT_SCREENSHOT_DIR,
            `order-delivery-${viewport.width}.png`,
          ),
          fullPage: true,
        });
      // Revisit with no unsaved request from the previous viewport.
      requests.splice(requests.indexOf('orders/1/delivery-destination'), 1);
    }
    await page.getByRole('button', { name: 'Clear destination pin', exact: true }).click();
    await page.getByText('Destination pin cleared.', { exact: true }).waitFor();
    await page.locator('.delivery-map-marker.destination').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Place destination pin', exact: true }).click();
    await page.locator('.leaflet-marker-icon[title="Unsaved destination"]').waitFor();
    await page.getByRole('button', { name: 'Save destination', exact: true }).click();
    await page.getByText('Destination pin saved.', { exact: true }).waitFor();
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
    completed = true;
    shared = false;
    latest = null;
    await page.goto(base + '/dispatch');
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await page.getByRole('heading', { name: 'TN-DELIVERY-001', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('link', { name: 'View proof of delivery', exact: true }).count(),
      1,
      'Completed admin deliveries need an explicit proof action',
    );
    await page.getByRole('link', { name: 'View proof of delivery', exact: true }).click();
    await page.waitForURL('**/orders/1');
    await page.getByRole('heading', { name: 'Delivery completed', exact: true }).waitFor();
    await page.locator('img[alt="Proof of delivery"]').waitFor();
    assert(
      (await page.locator('img[alt="Proof of delivery"]').getAttribute('src')).startsWith('blob:'),
    );
    assert(requests.includes('delivery/orders/1/proof-photo'));
    await page.getByRole('button', { name: 'View proof of delivery', exact: true }).click();
    assert(await page.locator('.completion-proof').evaluate((e) => e === document.activeElement));
    if (process.env.LAYOUT_SCREENSHOT_DIR)
      await page.screenshot({
        path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, 'admin-delivery-proof-320.png'),
        fullPage: true,
      });
    for (const [state, evidence, message] of [
      ['EXPIRED', true, 'Photo expired. Delivery evidence remains recorded.'],
      ['EXCEPTION', true, 'No photo was recorded; an admin exception is on file.'],
      ['AVAILABLE', false, 'No delivery evidence was recorded for this order.'],
    ]) {
      proofState = state;
      hasEvidence = evidence;
      const beforeProofReads = requests.filter((p) => p.endsWith('/proof-photo')).length;
      await page.goto(base + '/orders/1');
      await page.getByText(message, { exact: true }).waitFor();
      await page.getByRole('button', { name: 'View proof of delivery', exact: true }).click();
      assert.equal(await page.locator('img[alt="Proof of delivery"]').count(), 0);
      assert.equal(requests.filter((p) => p.endsWith('/proof-photo')).length, beforeProofReads);
      if (state === 'EXCEPTION')
        await page
          .getByText('Admin exception: Camera unavailable at handoff', { exact: true })
          .waitFor();
    }
    proofState = 'AVAILABLE';
    hasEvidence = true;
    completed = false;
    shared = true;
    await page.goto(base + '/tracking');
    await page.getByPlaceholder('Enter tracking number').fill('TN-DELIVERY-001');
    await page.getByRole('button', { name: 'Track order', exact: true }).click();
    await page.getByText('Estimated arrival:', { exact: true }).waitFor();
    assert((await page.locator('.timeline').textContent()).includes('Philippine time'));
    latest = {
      latitude: 13.765,
      longitude: 122.976,
      accuracy: 8,
      observedAt: now(),
      receivedAt: now(),
    };
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
    const arrival = page.getByLabel('Delivery estimate', { exact: true });
    const promise = page.getByLabel('Delivery SLA', { exact: true });
    const promisedDate = await promise.locator('strong').textContent();
    assert((await arrival.textContent()).includes('Philippine time'));
    assert.equal(await page.getByLabel('Estimated arrival (Philippine time)', { exact: true }).count(), 0);
    estimatedDeliveryAt = new Date(Date.now() + 7 * 3600000).toISOString();
    await page.clock.runFor(11000);
    const expectedArrival = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(estimatedDeliveryAt)).replace(' at ', ', ');
    assert((await arrival.textContent()).includes(expectedArrival), 'Customer did not receive the revised arrival estimate');
    assert.equal(await promise.locator('strong').textContent(), promisedDate, 'ETA revision moved the SLA deadline');
    if (process.env.LAYOUT_SCREENSHOT_DIR) await arrival.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, 'customer-arrival.png') });
    estimatedDeliveryAt = new Date(Date.now() - 60000).toISOString();
    await page.clock.runFor(11000);
    await page.getByText('The estimated arrival time has passed. Please contact us for an update.', { exact: true }).waitFor();
    slaDueAt = new Date(Date.now() - 90 * 60000).toISOString();
    await page.clock.runFor(11000);
    await promise.getByText('Delayed', { exact: true }).waitFor();
    if (process.env.LAYOUT_SCREENSHOT_DIR) await promise.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, 'customer-sla-overdue.png') });
    assert.equal(
      await page.getByRole('button', { name: 'Place destination pin', exact: true }).count(),
      0,
    );
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
    await promise.getByText('Delivered late', { exact: true }).waitFor();
    const proof = page.locator('img[alt="Proof of delivery"]');
    await proof.waitFor();
    await page
      .getByText('DELIVERED · Payment: UNPAID · Agent: Sales Agent', { exact: true })
      .waitFor();
    assert.match(page.url(), /\/portal\/orders\/1$/);
    assert.equal(await page.getByRole('heading', {name: 'My orders', exact: true}).count(), 0);
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
    await page.evaluate(() => {
      sessionStorage.setItem('tnl_access_token', 'admin-fixture');
      sessionStorage.setItem('tnl_user', JSON.stringify({ id: 1, role: 'ADMIN', fullName: 'Admin', email: 'admin@example.test' }));
    });
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(base + '/dispatch');
    await page.getByText('Delivered late', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Overdue', exact: true }).click();
    await page.locator('.delivery-card').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.delivery-card').count(), 0);
    await page.getByRole('button', { name: 'Delivered late', exact: true }).click();
    await page.locator('.delivery-card').waitFor();
    assert.equal(await page.locator('.delivery-card').count(), 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'SLA filters overflow on mobile');
    if (process.env.LAYOUT_SCREENSHOT_DIR) await page.locator('.delivery-card').screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, 'dispatch-sla-320.png') });
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
