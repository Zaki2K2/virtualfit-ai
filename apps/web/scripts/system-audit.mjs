// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package when not local.
/* global process, console, document */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(path.join(process.env.PLAYWRIGHT_MODULE, 'index.mjs')).href
    : 'playwright'
);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.AUDIT_CHROMIUM ? { executablePath: process.env.AUDIT_CHROMIUM } : {}),
  });
  const context = await browser.newContext({ baseURL: 'http://localhost:3000' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  try {
    for (const route of [
      '/',
      '/try-on',
      '/wardrobe',
      '/favorites',
      '/history',
      '/profile',
      '/settings',
      '/stylist',
    ]) {
      const res = await page.goto(route);
      assert.equal(res.status(), 200, route);
      await page.waitForLoadState('networkidle');
      assert.ok(await page.locator('h1').count(), route);
      console.log(`PASS page ${route}`);
    }
    if (process.env.AUDIT_SLM === '1') {
      await page.goto('/stylist');
      await page.waitForLoadState('networkidle');
      await page
        .getByLabel('What would you like to wear?')
        .fill('A casual white top and khaki trousers. No dresses.');
      const responsePromise = page.waitForResponse(
        (res) => res.url().includes('/styling/recommend') && res.request().method() === 'POST',
        { timeout: 125000 },
      );
      await page.getByRole('button', { name: 'Suggest an outfit', exact: true }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      const result = await response.json();
      assert.equal(result.simulated, false);
      assert.equal(
        result.modelUsed,
        true,
        JSON.stringify({ request: response.request().postDataJSON(), result }),
      );
      assert.ok(['model', 'deterministic-fallback'].includes(result.source));
      assert.ok(result.items.length > 0);
      assert.ok(result.items.every((item) => item.category !== 'dresses'));
      await page.getByRole('region', { name: 'Styling recommendation' }).waitFor();
      await page.screenshot({
        path: path.resolve(__dirname, '../../../docs/slm-stylist-preview.png'),
        fullPage: true,
      });
      await page
        .getByRole('region', { name: 'Styling recommendation' })
        .getByRole('link', { name: 'Try on', exact: true })
        .first()
        .click();
      await page.waitForURL('**/try-on?garment=*');
      console.log(
        'PASS real CPU SLM recommendation, exclusion guard, wardrobe cards and Try-on navigation',
      );
    }
    await page.goto('/profile');
    await page.getByLabel('Display name').fill('System Audit Guest');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    await page.reload();
    await page.getByLabel('Display name').waitFor();
    await page.waitForFunction(
      () => document.querySelector('#displayName')?.value === 'System Audit Guest',
    );
    console.log('PASS profile save/reload (isolated audit guest)');

    await page.goto('/wardrobe');
    await page.getByRole('searchbox', { name: 'Search garments' }).fill('no-such-audit-garment');
    await page.getByText('No garments found', { exact: true }).waitFor();
    await page.getByRole('searchbox', { name: 'Search garments' }).fill('');
    await page.getByRole('button', { name: 'Add garment' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Audit garment');
    await page
      .locator('input[type=file]')
      .setInputFiles(path.resolve(__dirname, '../../api/assets/catalog/tee-classic-white.png'));
    await page.getByRole('button', { name: 'Save to wardrobe' }).click();
    await page.getByRole('heading', { name: 'Audit garment', exact: true }).waitFor();
    console.log('PASS wardrobe search/empty state/upload');

    await page.goto('/try-on?garment=tee-classic-white');
    await page.locator('input[name=model][value=mock]').check();
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles(path.resolve(__dirname, '../../api/assets/catalog/tee-classic-white.png'));
    await page.getByRole('button', { name: 'Generate try-on', exact: true }).click();
    await page
      .getByRole('button', { name: 'Save to favorites', exact: true })
      .waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Save to favorites', exact: true }).click();
    await page.getByRole('link', { name: 'Saved - view favorites' }).waitFor();
    const download = await page
      .getByRole('link', { name: 'Download', exact: true })
      .getAttribute('href');
    assert.equal((await context.request.get(download)).status(), 200);
    console.log('PASS explicitly selected mock workflow/result/download/favorite');
    await page.goto('/favorites');
    await page.waitForLoadState('networkidle');
    assert.ok(await page.locator('img').count());
    await page.goto('/history');
    await page.waitForLoadState('networkidle');
    assert.ok(await page.locator('img').count());
    console.log('PASS favorites and history show generated result');
    assert.deepEqual(errors, []);
    console.log('PASS no browser exceptions or HTTP 5xx');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
