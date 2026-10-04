// Node 24+, ng serve, and Playwright on NODE_PATH. Renders the actual backend
// template with fixtures; no messages are sent or workflow settings changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { renderWorkflowEmail } = require('../../backend/src/shared/email-template.ts');
const base = process.env.LAYOUT_URL || 'http://localhost:4200';
const settings = [
  { workflow: 'ORDER_UPDATES', enabled: false, config: { subject: 'Order {{trackingNumber}} update', template: 'Hi {{customerName}},\n\nYour order {{trackingNumber}} is {{status}}.\nWe will keep you updated.' } },
  { workflow: 'WELCOME', enabled: false, config: { subject: 'Welcome to TNL Track', template: 'Welcome, {{customerName}}.\n\nBrowse our products and packages or ask your field agent for help.' } },
  { workflow: 'PURCHASE_FOLLOWUP', enabled: false, config: { delayDays: 3, subject: 'Thank you for your purchase', template: 'Thank you, {{customerName}}.\n\nSign in if you need help with order {{trackingNumber}}.' } },
];
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      if (window !== window.top) return;
      sessionStorage.setItem('tnl_access_token', 'email-layout-fixture');
      sessionStorage.setItem('tnl_user', JSON.stringify({ id: 1, email: 'fixture@example.test', fullName: 'Email Admin', role: 'ADMIN' }));
    });
    let previewFailure = false;
    let writes = 0;
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      let data = [];
      if (url.pathname.endsWith('/dashboard')) data = { totalOrders: 0, pendingOrders: 0, completedOrders: 0, openOrders: 0, revenue: 0, activeDeliveries: 0, totalCustomers: 0, totalProducts: 0, lowStockProducts: 0, monthlyRevenue: [], notifications: [] };
      if (url.pathname.endsWith('/automations')) data = { settings, workers: [], backlog: [] };
      if (url.pathname.endsWith('/email-preview')) {
        if (previewFailure) return route.fulfill({ status: 500, json: { error: { message: 'Preview fixture failure' } } });
        const input = route.request().postDataJSON();
        data = renderWorkflowEmail({ config: input, vars: { customerName: 'Maria Santos', trackingNumber: input.workflow === 'WELCOME' ? undefined : 'TNL-1042', status: 'IN_TRANSIT' }, ...(input.workflow === 'ORDER_UPDATES' ? {} : { unsubscribe: 'https://example.test/portal?unsubscribe=sample' }) }, input.workflow, 'https://example.test');
        data.html = data.html.replace(/ href=/g, ' data-preview-href=');
      } else if (route.request().method() !== 'GET') writes++;
      return route.fulfill({ json: { data } });
    });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${base}/automations`);
      await page.getByRole('button', { name: 'Settings for Order update emails', exact: true }).click();
      const frame = page.frameLocator('app-email-preview iframe');
      await frame.getByRole('heading', { name: 'Order TNL-1042 update', exact: true }).waitFor();
      assert.equal(await frame.getByText('TNL TRACK', { exact: true }).count(), 1);
      assert.equal(await frame.locator('a[href]').count(), 0, 'Preview links must be inert');
      assert.match(await frame.locator('body').innerText(), /In transit/);
      assert.equal(await page.locator('app-email-preview iframe').getAttribute('sandbox'), '');
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(dimensions.width <= dimensions.viewport, `Page overflow at ${viewport.width}`);
      const emailDimensions = await frame.locator('body').evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(emailDimensions.width <= emailDimensions.viewport, `Email overflow at ${viewport.width}`);
      await page.getByRole('textbox', { name: 'Email message', exact: true }).fill('Hello {{customerName}},\n\nA styled update & helpful next steps.');
      await frame.getByText('A styled update & helpful next steps.', { exact: true }).waitFor();
      await page.getByRole('textbox', { name: 'Email subject', exact: true }).fill('New subject {{trackingNumber}}');
      await frame.getByRole('heading', { name: 'New subject TNL-1042', exact: true }).waitFor();
      if (process.env.LAYOUT_SCREENSHOT_DIR && viewport.width !== 320) {
        fs.mkdirSync(process.env.LAYOUT_SCREENSHOT_DIR, { recursive: true });
        await page.locator('.email-preview').screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, `email-preview-${viewport.width}.png`), animations: 'disabled' });
      }
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Settings for Welcome email', exact: true }).click();
      await frame.getByRole('heading', { name: 'Welcome to TNL Track', exact: true }).waitFor();
      assert.match(await frame.locator('body').innerText(), /Unsubscribe/);
    }
    await page.getByRole('button', { name: 'Theme settings' }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    previewFailure = true;
    await page.getByRole('button', { name: 'Settings for Purchase follow-up', exact: true }).click();
    await page.getByRole('button', { name: 'Retry preview', exact: true }).waitFor();
    previewFailure = false;
    await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
    await page.frameLocator('app-email-preview iframe').getByRole('heading', { name: 'Thank you for your purchase', exact: true }).waitFor();
    assert.equal(writes, 0, 'Preview changed workflow settings or sent a message');
    assert.deepEqual(errors, []);
    // Inspect standalone emails as well, at realistic client widths.
    for (const workflow of ['WELCOME', 'ACCOUNT_EMAIL', 'CAMPAIGN_SEND', 'FOLLOWUP_REPLY']) {
      const sample = renderWorkflowEmail({ subject: workflow === 'ACCOUNT_EMAIL' ? 'Activate your TNL Track account' : 'A message from TNL Track', text: workflow === 'ACCOUNT_EMAIL' ? 'Open https://example.test/portal?verify=sample-token\nThis link expires in 30 minutes. If you did not request it, ignore this email.' : 'Hello Maria,\n\nYour field agent is here to help. We look forward to seeing you again.', ...(workflow === 'CAMPAIGN_SEND' ? { content: '<h2>Discover our new packages</h2><p><strong>Find your next favorite.</strong></p>', unsubscribe: 'https://example.test/portal?unsubscribe=sample' } : {}) }, workflow, 'https://example.test');
      for (const width of [680, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.setContent(sample.html);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.LAYOUT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, `${workflow.toLowerCase()}-${width}.png`), fullPage: true });
      }
    }
    console.log('PASS: Shared email design, live preview edits, inert links, mobile layouts, dark theme, retry, and no sending/settings writes.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
