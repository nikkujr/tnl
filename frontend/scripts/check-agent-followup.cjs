// Requires Playwright and Chrome. Run against `ng serve`; NODE_PATH can point to a shared runtime.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.LAYOUT_URL || 'http://localhost:4200';
const orders = [
  { id: 1, trackingNumber: 'TNL-44FAEBE578F326E76386', deliveryStatus: 'IN_TRANSIT', paymentStatus: 'UNPAID' },
  { id: 2, trackingNumber: 'TNL-55FAEBE578F326E76387', deliveryStatus: 'PREPARING', paymentStatus: 'PAID' },
];

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  const submissions = [];
  let emptyOrders = false;
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem('tnl_access_token', 'followup-layout-fixture');
      sessionStorage.setItem('tnl_user', JSON.stringify({ id: 2, email: 'customer@example.test', fullName: 'Sam Rivera', role: 'CUSTOMER' }));
    });
    await page.route('**/api/v1/**', async (route) => {
      const endpoint = new URL(route.request().url()).pathname.split('/api/v1/')[1];
      let data = [];
      if (endpoint === 'customer/me') data = { address: '123 Example Street', marketingOptIn: false };
      if (endpoint === 'customer/orders') data = emptyOrders ? [] : orders;
      if (/^customer\/orders\/\d+$/.test(endpoint)) data = {
        ...orders.find((order) => order.id === Number(endpoint.split('/').pop())),
        deliveryEvents: [{ status: 'PREPARING', occurredAt: '2026-10-01T12:00:00Z' }],
        followups: [{ id: 1, message: 'Please provide an update on my order.', reply: null }],
      };
      if (endpoint.endsWith('/followups')) {
        submissions.push({ endpoint, body: route.request().postDataJSON() });
        data = { reused: false };
      }
      return route.fulfill({ json: { data } });
    });
    for (const [width, theme] of [[1440, 'light'], [800, 'light'], [390, 'light'], [320, 'light'], [1440, 'dark'], [390, 'dark']]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/portal`);
      await page.evaluate((theme) => localStorage.setItem('tnl_theme', theme), theme);
      await page.reload();
      await page.getByRole('button', { name: 'Ask TNL assistant' }).click();
      await page.getByRole('button', { name: 'Ask my agent for an update', exact: true }).click();
      const form = page.locator('.followup-form');
      await form.waitFor();
      const select = form.getByLabel('Which order?');
      const message = form.getByLabel('What update do you need?');
      await select.selectOption({ label: `${orders[1].trackingNumber} · PREPARING` });
      await page.locator('.order-result').getByText(`${orders[1].trackingNumber} · PREPARING`, { exact: true }).waitFor();
      await message.fill('Could you let me know when my order will arrive?');
      const selectBounds = await select.boundingBox();
      const messageBounds = await message.boundingBox();
      assert.ok(messageBounds.y > selectBounds.y + selectBounds.height, 'Message remains squeezed beside order selector');
      assert.ok(messageBounds.width >= selectBounds.width - 1, 'Message does not use available form width');
      const focus = await message.evaluate((element) => ({ outline: getComputedStyle(element).outlineStyle, shadow: getComputedStyle(element).boxShadow }));
      assert.equal(focus.outline, 'none', 'Textarea has the heavy native focus outline');
      assert.notEqual(focus.shadow, 'none', 'Textarea has no visible focus indicator');
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= dimensions.width, 'Follow-up form overflows viewport');
      if (process.env.LAYOUT_SCREENSHOT_DIR && (width === 1440 || width === 390)) {
        await page.locator('.chat-panel').screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, `agent-followup-${width}-${theme}.png`) });
      }
      await message.fill('');
      await page.waitForFunction(() => document.querySelector('.followup-submit')?.disabled === true);
      assert.equal(await form.getByRole('button', { name: 'Notify my agent' }).isDisabled(), true, 'Empty messages can be submitted');
      await message.fill('Could you let me know when my order will arrive?');
      await form.getByRole('button', { name: 'Notify my agent' }).click();
      await page.getByRole('status').filter({ hasText: 'Your agent has been notified.' }).waitFor();
      assert.deepEqual(submissions.at(-1), {
        endpoint: 'customer/orders/2/followups',
        body: { message: 'Could you let me know when my order will arrive?' },
      });
      console.log(`PASS: Follow-up layout and submission at ${width}px (${theme})`);
    }
    emptyOrders = true;
    await page.reload();
    await page.getByRole('button', { name: 'Ask TNL assistant' }).click();
    await page.getByRole('button', { name: 'Ask my agent for an update', exact: true }).click();
    await page.getByRole('heading', { name: 'No orders to follow up on yet' }).waitFor();
    assert.equal(await page.locator('.followup-form').count(), 0, 'Empty account shows unusable form');
    console.log('PASS: Empty orders show a useful empty state.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
