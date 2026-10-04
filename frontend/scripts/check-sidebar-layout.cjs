// Run against `ng serve`: NODE_PATH=<Playwright modules> node scripts/check-sidebar-layout.cjs
// API fixtures keep this layout check independent of the database and credentials.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem('tnl_access_token', 'layout-test');
      sessionStorage.setItem('tnl_user', JSON.stringify({
        id: 1, email: 'layout@example.test', fullName: 'Layout Admin', role: 'ADMIN',
      }));
    });
    await page.route('**/api/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const data = path.endsWith('/dashboard') ? {
        totalOrders: 0, pendingOrders: 0, completedOrders: 0, openOrders: 0,
        revenue: 0, activeDeliveries: 0, totalCustomers: 0, totalProducts: 0,
        lowStockProducts: 0, monthlyRevenue: [], notifications: [],
      } : path.endsWith('/categories') ? Array.from({ length: 5 }, (_, i) => ({
        id: i + 1, name: `Category ${i + 1}`, description: 'Layout fixture', productCount: 0,
      })) : [];
      return route.fulfill({ json: { data, meta: { total: data.length ?? 0 } } });
    });

    for (const viewport of [
      { width: 1440, height: 760 },
      { width: 1440, height: 600 },
      { width: 1440, height: 1600 },
      { width: 800, height: 600 },
      { width: 390, height: 600 },
      { width: 320, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${process.env.LAYOUT_URL || 'http://localhost:4200'}/dashboard`);
      if (viewport.width <= 680) {
        await page.getByRole('button', { name: 'Open navigation' }).click();
      }
      await page.locator('.sidebar').getByRole('button', { name: 'Categories', exact: true }).click();
      await page.waitForURL('**/categories');
      await page.locator('app-categories-page .management-row:not(.header)').first().waitFor();
      if (viewport.width <= 680) {
        await page.getByRole('button', { name: 'Open navigation' }).click();
      }
      await page.locator('.sidebar').evaluate((sidebar) => Promise.all(
        sidebar.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})),
      ));

      const bounds = await page.locator('.sidebar').evaluate((sidebar) => {
        const nav = sidebar.querySelector('nav');
        const rect = sidebar.getBoundingClientRect();
        const header = document.querySelector('.topbar').getBoundingClientRect();
        const account = document.querySelector('.account-trigger').getBoundingClientRect();
        return {
          sidebarBottom: rect.bottom, accountTop: account.top, accountBottom: account.bottom,
          headerTop: header.top, headerBottom: header.bottom,
          navBottom: nav.getBoundingClientRect().bottom, viewportHeight: innerHeight,
          pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
          navScrolls: nav.scrollHeight > nav.clientHeight,
          scrollbarWidth: getComputedStyle(nav, '::-webkit-scrollbar').width,
          scrollbarThumb: getComputedStyle(nav, '::-webkit-scrollbar-thumb').backgroundColor,
        };
      });
      console.log(`${viewport.width}x${viewport.height}`, bounds);
      assert.equal(await page.locator('.sidebar .identity').count(), 0, 'Account remains in sidebar');
      assert.ok(bounds.accountTop >= bounds.headerTop && bounds.accountBottom <= bounds.headerBottom,
        'Account control spills outside header');
      assert.ok(bounds.navBottom <= bounds.sidebarBottom + 1, 'Navigation spills outside sidebar');
      assert.ok(bounds.pageWidth <= bounds.viewportWidth + 1, 'Page overflows horizontally');
      assert.equal(bounds.scrollbarWidth, '6px', 'Sidebar uses a bulky native scrollbar');
      assert.notEqual(bounds.scrollbarThumb, 'rgba(0, 0, 0, 0)', 'Sidebar thumb has no custom color');
      if (viewport.height === 1600) assert.equal(bounds.navScrolls, false, 'Tall sidebar scrolls unnecessarily');
      if (viewport.width === 1440 && viewport.height === 600) assert.equal(bounds.navScrolls, true, 'Short sidebar cannot scroll');

      await page.locator('.sidebar nav').evaluate((nav) => { nav.scrollTop = nav.scrollHeight; });
      const agents = page.locator('.sidebar').getByRole('button', { name: 'Agents', exact: true });
      const agentBounds = await agents.boundingBox();
      assert.ok(agentBounds && agentBounds.y >= 0 && agentBounds.y + agentBounds.height <= bounds.sidebarBottom + 1,
        'Last navigation item is not reachable within sidebar');
      if (viewport.width <= 680) {
        const backdrop = page.getByRole('button', { name: 'Close navigation' });
        const backdropBounds = await backdrop.boundingBox();
        await backdrop.click({ position: { x: backdropBounds.width - 5, y: 10 } });
        await page.locator('.sidebar').evaluate((sidebar) => Promise.all(
          sidebar.getAnimations().map((animation) => animation.finished.catch(() => {})),
        ));
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const account = page.getByRole('button', { name: 'Account menu for Layout Admin' });
      const accountBounds = await account.boundingBox();
      assert.ok(accountBounds && accountBounds.y >= 0 && accountBounds.y + accountBounds.height <= viewport.height,
        'Page scrolling displaces account control');
      await account.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
      const menu = await page.locator('.account-menu').boundingBox();
      assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= viewport.width && menu.y + menu.height <= viewport.height,
        'Account menu falls outside viewport');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.account-trigger')?.getAttribute('aria-expanded') === 'false');
      assert.equal(await account.getAttribute('aria-expanded'), 'false');
      assert.equal(await account.evaluate((button) => button === document.activeElement), true, 'Escape does not restore account focus');
      await account.click();
      await page.locator('.workspace-heading').click();
      await page.waitForFunction(() => document.querySelector('.account-trigger')?.getAttribute('aria-expanded') === 'false');
      assert.equal(await account.getAttribute('aria-expanded'), 'false', 'Outside click does not dismiss account menu');
      if (process.env.LAYOUT_SCREENSHOT_DIR && (viewport.width === 1440 && viewport.height === 760 || viewport.width === 390)) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator('.sidebar nav').evaluate((nav) => { nav.scrollTop = 0; });
        await page.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOT_DIR, `workspace-${viewport.width}.png`) });
      }
    }
    await page.getByRole('button', { name: 'Theme settings' }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.getByRole('button', { name: 'Account menu for Layout Admin' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL(`${process.env.LAYOUT_URL || 'http://localhost:4200'}/`);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('tnl_access_token')), null);
    await page.locator('.account-center').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.account-center').count(), 0);
    console.log('PASS: Header account, sign-out, and sidebar scrolling work at every viewport.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
