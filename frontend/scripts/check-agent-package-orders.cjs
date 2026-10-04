// Requires Playwright and Chrome; run against ng serve (LAYOUT_URL can override the URL).
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.LAYOUT_URL || 'http://localhost:4200';
const pack = { id: 1, name: 'Office essentials', description: 'Everyday desk supplies', sellingPrice: 1000, commissionType: 'FIXED', commissionValue: 100, active: true, available: 10, components: [{ productId: 1, productName: 'Notebook', quantity: 2 }] };
const product = { id: 1, name: 'Notebook', sku: 'NOTE-1', category: 'Office', price: 250, stockOnHand: 100, stockReserved: 0 };
const percentagePack = { ...pack, id: 3, name: 'Percentage bundle', sellingPrice: 33.33, commissionType: 'PERCENTAGE', commissionValue: 5 };
const roundingPack = { ...pack, id: 4, name: 'Rounding bundle', sellingPrice: 0.05, commissionType: 'PERCENTAGE', commissionValue: 10 };

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    for (const [role, width] of [['AGENT', 1440], ['AGENT', 390], ['AGENT', 320], ['ADMIN', 1440], ['ADMIN', 390]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let submitted, updated, converted;
      await page.addInitScript((role) => {
        sessionStorage.setItem('tnl_access_token', 'order-layout-fixture');
        sessionStorage.setItem('tnl_user', JSON.stringify({ id: role === 'ADMIN' ? 1 : 2, email: 'staff@example.test', fullName: 'Jamie Co', role }));
      }, role);
      await page.route('**/api/v1/**', async (route) => {
        const request = route.request();
        const endpoint = new URL(request.url()).pathname.split('/api/v1/')[1];
        let data = [];
        if (endpoint === 'dashboard') data = { notifications: [], monthlyRevenue: [], totalOrders: 0, pendingOrders: 0, completedOrders: 0, revenue: 0, totalCustomers: 1, totalProducts: 1, lowStockProducts: 0 };
        if (endpoint === 'customers') data = [{ id: 1, fullName: 'Sam Rivera', email: 'customer@example.test', phone: '09123456789', address: '123 Example Street', assignedAgentId: 2 }];
        if (endpoint === 'products') data = [product];
        if (endpoint === 'agents') data = [{ id: 2, fullName: 'Jamie Co', email: 'staff@example.test', active: true }];
        if (endpoint === 'packages') data = [pack, { ...pack, id: 2, name: 'Sold out package', available: 0, components: [{ productId: 2, productName: 'Pen', quantity: 1 }] }, percentagePack, roundingPack];
        if (endpoint === 'orders/1') {
          if (request.method() === 'PUT') updated = request.postDataJSON();
          data = { id: 1, trackingNumber: 'TNL-OFFICE', customerId: 1, agentId: null, agentName: null, items: [], packages: [{ packageId: 1, name: pack.name, quantity: 1, components: pack.components, sellingPrice: 1000 }], total: 1000, origin: 'LIVE', orderStatus: 'PENDING', deliveryStatus: null, paymentStatus: 'UNPAID', paymentMethod: 'Bank transfer', deliveryAddress: '123 Example Street', history: [], deliveryEvents: [] };
        }
        if (endpoint === 'requests') data = [{ id: 1, status: 'SUBMITTED', customerName: 'Office customer', agent_id: null, agentName: null, snapshot: { items: [], packages: [{ ...pack, packageId: 1, quantity: 1 }] }, delivery_address: '123 Example Street' }];
        if (endpoint === 'requests/1/convert') { converted = true; data = { id: 1 }; }
        if (endpoint === 'orders' && request.method() === 'POST') {
          submitted = request.postDataJSON();
          return route.fulfill({ status: 201, json: { data: { id: 1 } } });
        }
        return route.fulfill({ json: { data, meta: { total: Array.isArray(data) ? data.length : 0 } } });
      });
      await page.goto(`${base}/orders/new`);
      await page.locator('.order-layout').waitFor();
      if (role === 'AGENT') {
        const expectCommission = async (amount) => {
          await page.waitForFunction((amount) => document.querySelector('.commission-amount')?.textContent.trim() === `₱${amount}`, amount, { timeout: 15000 }).catch(async (error) => {
            console.error('Expected commission', amount, 'Actual:', await page.locator('.commission-amount').allTextContents());
            throw error;
          });
        };
        await expectCommission('0.00');
        assert.equal(await page.getByRole('button', { name: 'Add item', exact: true }).count(), 0, 'Agent can open standalone product picker');
        await page.getByRole('button', { name: 'Add package', exact: true }).click();
        const picker = page.getByRole('dialog', { name: 'Add a package' });
        await picker.waitFor();
        assert.equal(await picker.getByRole('button', { name: /Sold out package/ }).isDisabled(), true);
        await picker.getByLabel('Search packages').fill('Notebook');
        await picker.getByRole('button', { name: /Office essentials/ }).waitFor();
        assert.equal(await picker.getByRole('button', { name: /Sold out package/ }).count(), 0);
        await picker.getByLabel('Quantity', { exact: true }).fill('2');
        if (process.env.LAYOUT_SCREENSHOT_DIR && width !== 320) {
          await picker.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, `agent-package-picker-${width}.png`) });
        }
        await picker.getByRole('button', { name: 'Add to order' }).click();
        await picker.waitFor({ state: 'hidden' });
        const quantity = page.getByLabel('Quantity for Office essentials', { exact: true });
        await expectCommission('200.00');
        await quantity.fill('3');
        await expectCommission('300.00');
        await page.waitForFunction(() => document.querySelector('.grand-total').textContent.includes('3,000'));
        await page.getByRole('button', { name: 'Add package', exact: true }).click();
        await picker.getByLabel('Quantity', { exact: true }).fill('11');
        await picker.getByRole('button', { name: 'Add to order' }).click();
        await picker.getByRole('alert').waitFor();
        await picker.getByLabel('Quantity', { exact: true }).fill('1');
        await picker.getByRole('button', { name: 'Add to order' }).click();
        await picker.waitFor({ state: 'hidden' });
        assert.equal(await quantity.inputValue(), '4', 'Repeated package additions do not merge quantities');
        await expectCommission('400.00');
        for (const [bundle, firstAmount, nextQuantity, nextAmount] of [
          [percentagePack, '405.00', '2', '403.33'],
          [roundingPack, '400.02', '1', '400.01'],
        ]) {
          await page.getByRole('button', { name: 'Add package', exact: true }).click();
          await picker.getByRole('button', { name: new RegExp(bundle.name) }).click();
          await picker.getByLabel('Quantity', { exact: true }).fill('3');
          await picker.getByRole('button', { name: 'Add to order' }).click();
          await picker.waitFor({ state: 'hidden' });
          await expectCommission(firstAmount);
          await page.getByLabel(`Quantity for ${bundle.name}`, { exact: true }).fill(nextQuantity);
          await expectCommission(nextAmount);
          await page.locator('.item-row').filter({ has: page.getByText(bundle.name, { exact: true }) }).getByRole('button', { name: 'Remove', exact: true }).click();
          await expectCommission('400.00');
        }
        if (process.env.LAYOUT_SCREENSHOT_DIR && width === 1440) {
          await page.locator('.order-page').screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, 'agent-package-order.png') });
        }
      } else {
        assert.equal(await page.locator('.commission-estimate').count(), 0, 'Admin sees commission as their own earnings');
        await page.locator('.lookup-field').last().click();
        const agentPicker = page.getByRole('dialog', { name: 'Assign an agent' });
        await agentPicker.getByRole('button', { name: /Jamie Co/ }).click();
        await agentPicker.getByRole('button', { name: 'Confirm selection' }).click();
        await page.locator('.lookup-field').filter({ hasText: 'Jamie Co' }).click();
        await agentPicker.getByRole('button', { name: /Office order — no agent/ }).click();
        await agentPicker.getByRole('button', { name: 'Confirm selection' }).click();
        await agentPicker.waitFor({ state: 'hidden' });
        assert.match(await page.locator('.lookup-field').last().textContent(), /Office order.*no agent/);
        await page.getByRole('button', { name: 'Add item', exact: true }).click();
        const picker = page.getByRole('dialog', { name: 'Add an order item' });
        await picker.waitFor();
        await picker.getByRole('button', { name: /Notebook/ }).click();
        await picker.getByRole('button', { name: 'Add to order' }).click();
        await picker.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Add package', exact: true }).click();
      }
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= dimensions.width, 'Order page overflows horizontally');
      await page.getByRole('button', { name: 'Create order', exact: true }).click();
      await page.waitForURL('**/orders');
      assert.ok(submitted);
      assert.deepEqual(submitted.items, role === 'AGENT' ? [] : [{ productId: 1, quantity: 1 }]);
      assert.deepEqual(submitted.packages, [{ packageId: 1, quantity: role === 'AGENT' ? 4 : 1 }]);
      if (role === 'AGENT') assert.equal('agentId' in submitted, false, 'Agent sends a client-assigned owner');
      else assert.equal(submitted.agentId, null, 'Office order retains a credited agent');
      if (role === 'ADMIN') {
        await page.goto(`${base}/orders?edit=1`);
        const editor = page.getByRole('dialog', { name: 'Edit pending order' });
        await editor.waitFor();
        assert.match(await editor.locator('select[name="agent"] option:checked').textContent(), /Office.*no agent/, 'Office order is silently assigned to the first agent');
        await editor.getByRole('button', { name: 'Save changes' }).click();
        await editor.waitFor({ state: 'hidden' });
        assert.equal(updated.agentId, null, 'Office edit requires an agent');
        await page.goto(`${base}/requests`);
        await page.getByRole('button', { name: 'Convert to pending order' }).click();
        await page.waitForURL('**/orders/1');
        assert.equal(converted, true, 'Unassigned customer request cannot convert');
      }
      console.log(`PASS: ${role} order creation at ${width}px`);
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
