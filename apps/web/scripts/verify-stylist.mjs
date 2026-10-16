import assert from 'node:assert/strict';
import console from 'node:console';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Optional local verification dependency, deliberately outside the app lockfile.
// npm install --prefix slm-engine/runs/browser-test --no-save --package-lock=false playwright
const { chromium } = await import(
  pathToFileURL(path.resolve('slm-engine/runs/browser-test/node_modules/playwright/index.mjs')).href
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const requests = [];
const recommendations = [];
page.on('request', (request) =>
  requests.push({ url: request.url(), method: request.method(), body: request.postData() }),
);
try {
  await page.goto('http://localhost:3000/stylist');
  await page
    .getByText('Inference verified on this computer', { exact: false })
    .waitFor({ timeout: 90_000 });
  assert.equal(await page.locator('#styling-model').inputValue(), 'base');
  assert.equal(await page.locator('#styling-model option[value="custom"]').isDisabled(), true);
  const scenarios = [
    ['From my wardrobe, find a blue office shirt, avoid pants and dresses.', ['shirt-oxford-blue']],
    ['Make it casual', ['shirt-oxford-blue']],
    ['Which category does a denim jacket belong to?', []],
  ];
  for (const [message, ids] of scenarios) {
    await page.locator('#style-request').fill(message);
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/styling/recommend') && r.request().method() === 'POST',
      { timeout: 90_000 },
    );
    await page.getByRole('button', { name: 'Ask local Qwen' }).click();
    const actual = await response;
    assert.equal(actual.status(), 200);
    const result = await actual.json();
    recommendations.push(result);
    assert.equal(result.modelUsed, true);
    assert.equal(result.simulated, false);
    assert.deepEqual(result.itemIds, ids);
    assert.ok(['model', 'deterministic-fallback'].includes(result.source));
    if (ids.length) {
      await page.locator('a[href="/try-on?garment=shirt-oxford-blue"]').waitFor();
      await page.screenshot({
        path: path.resolve('slm-engine/runs/stylist-browser-ready.png'),
        fullPage: true,
      });
    }
  }
  console.log(
    JSON.stringify({
      sources: recommendations.map((r) => r.source),
      answers: recommendations.map((r) => r.answer),
    }),
  );
  assert.ok(
    recommendations.some((r) => r.source === 'model'),
    'Require a real generated response that passes validation',
  );
  assert.equal(
    requests.filter((r) => /:808[12]\//.test(r.url)).length,
    0,
    'Browser must use the Express proxy',
  );
  assert.ok(requests.some((r) => r.body?.includes('history') && r.body.includes('Make it casual')));
  await page.getByRole('button', { name: 'New conversation' }).click();
  assert.equal(await page.locator('#style-request').inputValue(), '');
  // Exercise unavailable presentation independently of the running service.
  await page.route('**/api/v1/styling/status', (route) =>
    route.fulfill({
      json: {
        available: false,
        local: true,
        model: 'virtualfit-style-base',
        reason: 'Local Qwen is unavailable. Start npm run dev:ai.',
        models: [
          {
            id: 'base',
            model: 'virtualfit-style-base',
            available: false,
            reason: 'Local Qwen is unavailable. Start npm run dev:ai.',
          },
          {
            id: 'custom',
            model: 'virtualfit-fashion-custom',
            available: false,
            reason: 'No trained checkpoint',
          },
        ],
      },
    }),
  );
  await page.reload();
  await page
    .getByText('Local Qwen is unavailable. Start npm run dev:ai.', { exact: true })
    .waitFor();
  assert.equal(await page.getByRole('button', { name: 'Ask local Qwen' }).isDisabled(), true);
  const output = path.resolve('slm-engine/runs');
  mkdirSync(output, { recursive: true });
  await page.screenshot({
    path: path.join(output, 'stylist-browser-unavailable.png'),
    fullPage: true,
  });
  let visionDisclosure = false;
  const health = await (await page.request.get('http://localhost:3000/api/v1/health')).json();
  if (
    health.ai.options.find((option) => option.id === health.ai.defaultOption)?.externalProcessing
  ) {
    await page.goto('http://localhost:3000/try-on');
    await page.getByText('Send my photo to an external AI service', { exact: false }).waitFor();
    visionDisclosure = true;
  }
  writeFileSync(
    path.join(output, 'stylist-browser-check.json'),
    JSON.stringify(
      {
        recommendations,
        browserLanguageRequests: requests.filter((r) => r.url.includes('/styling/')),
        localProxyOnly: true,
        customDisabled: true,
        studioLink: true,
        unavailableUi: true,
        visionDisclosure,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      browser: 'Chrome headless via Playwright',
      requests: recommendations.length,
      sources: recommendations.map((r) => r.source),
      localProxyOnly: true,
      customDisabled: true,
      studioLink: true,
      unavailableUi: true,
      visionDisclosure,
    }),
  );
} finally {
  await browser.close();
}
