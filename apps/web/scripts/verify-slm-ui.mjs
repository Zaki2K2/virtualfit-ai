// Optional local live check: install Playwright in the ignored runs/browser-test directory.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import console from 'node:console';

const { chromium } = await import(pathToFileURL(path.resolve(
  'slm-engine/runs/browser-test/node_modules/playwright/index.mjs',
)).href);
const base = 'http://127.0.0.1:8081';
const key = readFileSync('slm-engine/runtime/api-key.txt', 'utf8').trim();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const health = await page.request.get(`${base}/health`);
  assert.equal(health.status(), 200);
  assert.equal((await health.json()).status, 'ok');
  for (const headers of [{}, { Authorization: 'Bearer deliberately-invalid-key' }]) {
    const denied = await page.request.post(`${base}/v1/chat/completions`, {
      headers, data: { model: 'virtualfit-style-base', messages: [{ role: 'user', content: 'Hello' }] },
    });
    assert.equal(denied.status(), 401);
  }
  const root = await page.goto(`${base}/`);
  assert.equal(root.status(), 200);
  await page.getByText('Access denied', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Enter API Key' }).click();
  await page.locator('input[type=password]').fill(key);
  await page.getByRole('button', { name: 'Save & Retry' }).click();
  const prompt = 'Say hello in one short sentence.';
  await page.locator('textarea').fill(prompt);
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/v1/chat/completions') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  assert.equal(await response.request().headerValue('authorization'), `Bearer ${key}`);
  const stream = await response.text();
  let generated = '';
  for (const line of stream.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    generated += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content ?? '';
  }
  assert.ok(generated.trim(), 'A real streamed model response is required');
  await page.getByText(generated.trim(), { exact: false }).first().waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes(key));
  await page.screenshot({ path: 'slm-engine/runs/slm-web-ui.png', fullPage: true });
  const result = { root: 200, health: 200, missingKey: 401, invalidKey: 401,
    authenticatedChat: response.status(), prompt, response: generated.trim(),
    browser: 'isolated Chrome via Playwright', officialUi: true };
  writeFileSync('slm-engine/runs/slm-web-ui-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
