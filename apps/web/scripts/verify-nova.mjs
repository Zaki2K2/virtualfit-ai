// Optional live browser regression; requires the same isolated Playwright install as verify-slm-ui.
import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { novaIdentityResponseValid } = createRequire(import.meta.url)('@virtualfit/shared');
const { chromium } = await import(pathToFileURL(path.resolve(
  'slm-engine/runs/browser-test/node_modules/playwright/index.mjs',
)).href);
const questions = ['What is your name?', 'Who developed you?', 'What company are you from?',
  'What can you do?', 'Are you Qwen?', 'Who created your underlying language model?',
  'Are you running locally?', 'Can you help me choose clothes?',
  'Did NovaCTO create your underlying foundation model?'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const key = readFileSync('slm-engine/runtime/api-key.txt', 'utf8').trim();
try {
  for (const question of questions) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:8081/');
      await page.getByRole('button', { name: 'Enter API Key' }).click();
      await page.locator('input[type=password]').fill(key);
      await page.getByRole('button', { name: 'Save & Retry' }).click();
      await page.locator('textarea').fill(question);
      const pending = page.waitForResponse((r) => r.url().endsWith('/v1/chat/completions')
        && r.request().method() === 'POST', { timeout: 90_000 });
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const response = await pending;
      assert.equal(response.status(), 200);
      let answer = '';
      for (const line of (await response.text()).split('\n')) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]')
          answer += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content ?? '';
      }
      const valid = novaIdentityResponseValid(question, answer);
      results.push({ interface: 'native-browser', question, answer, valid });
      console.log(JSON.stringify(results.at(-1)));
      await page.getByText(answer.trim(), { exact: false }).first().waitFor();
      if (question === questions[0]) {
        await page.getByText('Nova AI', { exact: false }).first().waitFor();
        await page.screenshot({ path: 'slm-engine/runs/nova-native.png', fullPage: true });
      }
    } finally { await context.close(); }
  }
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/stylist');
  await page.getByRole('heading', { name: 'Nova AI', exact: true }).waitFor();
  await page.getByText('Powered by NovaCTO', { exact: false }).first().waitFor();
  await page.getByText('Inference verified on this computer', { exact: false }).waitFor({ timeout: 90_000 });
  for (const question of questions) {
    const reset = page.getByRole('button', { name: 'New conversation', exact: true });
    if (await reset.count()) await reset.click();
    await page.locator('#style-request').fill(question);
    const pending = page.waitForResponse((r) => r.url().endsWith('/styling/recommend')
      && r.request().method() === 'POST', { timeout: 90_000 });
    await page.getByRole('button', { name: 'Ask Nova', exact: true }).click();
    const response = await pending;
    assert.equal(response.status(), 200);
    const result = await response.json();
    assert.equal(result.modelUsed, true);
    assert.deepEqual(result.itemIds, []);
    const valid = novaIdentityResponseValid(question, result.answer);
    results.push({ interface: 'stylist-browser', question, answer: result.answer,
      source: result.source, modelUsed: result.modelUsed, valid });
    console.log(JSON.stringify(results.at(-1)));
    if (question === questions[0])
      await page.screenshot({ path: 'slm-engine/runs/nova-stylist.png', fullPage: true });
  }
  writeFileSync('slm-engine/runs/nova-identity-browser.json', JSON.stringify(results, null, 2));
  assert.ok(results.every((result) => result.valid), 'Inspect saved responses: identity regression failed');
} finally { await browser.close(); }
