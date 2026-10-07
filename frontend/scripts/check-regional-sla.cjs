// Mocked APIs only. Run against ng serve with Playwright on NODE_PATH.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.LAYOUT_URL || 'http://127.0.0.1:4200';
const output = process.env.LAYOUT_SCREENSHOT_DIR;
const dueAt = '2026-10-15T15:59:59Z';
const fromAt = '2026-10-13T15:59:59Z';
const at = '2026-10-12T08:00:00Z';
const policy = { region: 'BICOL', remoteDays: 0, completed: false, preparedAt: at, dispatchedAt: at, fromAt, toAt: dueAt, projected: false,
  stages: ['Order processing','Preparation','Dispatch','Delivery'].map((name, i) => ({name, rule: ['Confirm within 1 business day','Prepare within 1 business day after confirmation','Hand to the courier within 1–2 business days after confirmation','1–3 business days after dispatch'][i], state: i === 3 ? 'OVERDUE' : 'MET', dueAt: i === 3 ? dueAt : at, completedAt: i === 3 ? null : at, minutes: 1})) };
const sla = { state: 'OVERDUE', dueAt, minutes: 120, policy };

(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    if (output) fs.mkdirSync(output, {recursive: true});
    const page = await browser.newPage({viewport: {width: 1440, height: 950}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      if (sessionStorage.getItem('tnl_user')) return;
      sessionStorage.setItem('tnl_access_token', 'fixture');
      sessionStorage.setItem('tnl_user', JSON.stringify({id: 1, role: 'CUSTOMER', fullName: 'Mara Santos', email: 'mara@example.test'}));
    });
    const orders = Array.from({length: 60}, (_, i) => ({id: i+1, trackingNumber: `TNL-SLA-${i+1}`, orderStatus: 'APPROVED', deliveryStatus: 'IN_TRANSIT', paymentStatus: 'UNPAID', agentId: null, deliveryAddress: 'Naga City, Camarines Sur', total: 9490, createdAt: at, items: [], packages: [], followups: [], deliveryEvents: []}));
    const tracking = {sla, deliveryStatus: 'IN_TRANSIT', estimatedDeliveryAt: dueAt, state: 'STOPPED', serverTime: '2026-10-15T18:00:00Z', employeeName: null, destination: null, position: null};
    let detailReads = 0;
    let employeeMode = false, started = false;
    await page.route('**/api/v1/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.split('/api/v1/')[1];
      let data = [];
      if (endpoint === 'customer/me') data = {address: orders[0].deliveryAddress};
      if (endpoint === 'customer/orders') return route.fulfill({json: {data: orders.slice(0, 10), meta: {page: 1, limit: 10, total: orders.length}}});
      if (endpoint === 'customer/orders/1') { detailReads++; data = orders[0]; }
      if (endpoint === 'customer/orders/999') return route.fulfill({status: 404, json: {error: {message: 'Order not found'}}});
      if (endpoint === 'customer/orders/1/delivery') data = {...orders[0], sla, tracking, history: [], issues: [], completion: null};
      if (endpoint.endsWith('/tracking')) data = tracking;
      if (endpoint === 'delivery/orders/1') data = {...orders[0], deliveryStatus: started ? 'DISPATCHED' : 'PREPARING', assignmentVersion: 1, employeeId: 3, attemptId: started ? '11111111-1111-4111-8111-111111111111' : null, sla, tracking, history: [], issues: [], completion: null};
      if (endpoint === 'delivery/orders/1/start') {
        assert(employeeMode);
        assert.deepEqual(route.request().postDataJSON(), {assignmentVersion: 1}, 'Regional dispatch must not require a manual ETA');
        started = true;
        tracking.deliveryStatus = 'DISPATCHED';
        data = {attemptId: '11111111-1111-4111-8111-111111111111'};
      }
      return route.fulfill({json: {data}});
    });
    await page.goto(`${base}/portal?tab=orders`);
    await page.getByRole('button', {name: 'Details and follow-up'}).last().waitFor();
    assert.equal(await page.getByRole('button', {name: 'Details and follow-up'}).count(), 10);
    await page.getByRole('button', {name: 'Details and follow-up'}).first().click();
    await page.getByLabel('Delivery SLA', {exact: true}).waitFor();
    assert.equal(new URL(page.url()).pathname, '/portal/orders/1');
    assert.equal(await page.getByRole('button', {name: 'Details and follow-up'}).count(), 0);
    assert.equal(await page.locator('.sla-stages li').count(), 4);
    const timeline = await page.locator('.sla-stages').innerText();
    assert.match(timeline, /1 business day after confirmation/);
    assert.match(timeline, /1–3 business days after dispatch/);
    assert.match(await page.getByLabel('Delivery SLA', {exact: true}).innerText(), /Delivery window: Oct 13 – Oct 15, 2026/);
    assert.equal(await page.getByLabel('Delivery SLA', {exact: true}).getByText('Delayed', {exact: true}).count(), 2);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({width, height: 950});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (output) await page.screenshot({path: path.join(output, `regional-sla-${width}.png`), fullPage: true});
    }
    await page.reload();
    await page.locator('.sla-stages').waitFor();
    assert.equal(detailReads, 2, 'A direct refresh must load the owned order');
    await page.getByRole('link', {name: '← Back to my orders'}).click();
    await page.getByRole('heading', {name: 'My orders', exact: true}).waitFor();
    await page.getByRole('button', {name: 'Details and follow-up'}).last().waitFor();
    assert.equal(await page.getByRole('button', {name: 'Details and follow-up'}).count(), 10);
    await page.goto(`${base}/portal/orders/999`);
    await page.getByRole('alert').getByText('Order not found', {exact: true}).waitFor();
    assert.equal(await page.locator('app-delivery-panel').count(), 0);
    employeeMode = true;
    policy.preparedAt = null;
    tracking.deliveryStatus = 'PREPARING';
    await page.evaluate(() => {
      sessionStorage.setItem('tnl_user', JSON.stringify({id: 3, role: 'DELIVERY', fullName: 'Delivery Staff', email: 'driver@example.test'}));
    });
    await page.goto(`${base}/delivery/1`);
    const start = page.getByRole('button', {name: 'Start delivery', exact: true});
    await start.waitFor();
    assert(await start.isDisabled(), 'Preparation is required before starting');
    assert.equal(await page.getByLabel('Estimated arrival (Philippine time)', {exact: true}).count(), 0);
    policy.preparedAt = at;
    await page.getByRole('button', {name: 'Refresh', exact: true}).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Start delivery' && !b.disabled));
    await start.click();
    await page.getByRole('button', {name: 'Pause delivery', exact: true}).waitFor();
    assert(started);
    assert.deepEqual(errors, []);
    console.log('PASS: Regional SLA timeline, delayed delivery, 60-order navigation, refresh/back, missing order and desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(e => {console.error(e); process.exitCode = 1;});
