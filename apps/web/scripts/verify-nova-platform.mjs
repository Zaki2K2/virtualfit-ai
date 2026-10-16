// Live local Qwen + real MongoDB + isolated Chrome. No media model success is assumed.
import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import sharp from 'sharp';

const { chromium } = await import(
  pathToFileURL(path.resolve('slm-engine/runs/browser-test/node_modules/playwright/index.mjs')).href
);
const out = path.resolve('slm-engine/runs');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const requests = [];
page.on('request', (r) => requests.push(r.url()));
const root = 'http://localhost:3000/api/v1/nova';
const report = {};
try {
  await page.goto('http://localhost:3000/nova');
  await page.getByRole('button', { name: 'Local model ready' }).waitFor({ timeout: 90_000 });
  assert.equal(await page.title(), 'Nova AI');
  await page.screenshot({ path: path.join(out, 'nova-platform-desktop.png'), fullPage: true });
  const status = await (await page.request.get(root + '/status')).json();
  assert.equal(status.persistence, 'mongodb');
  assert.equal(status.language.available, true);
  report.status = status;
  await page.getByRole('textbox', { name: 'Message Nova' }).fill('What is your name?');
  const streamPromise = page.waitForResponse(
    (r) => r.url().endsWith('/nova/chat/stream') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const stream = await streamPromise;
  const events = await stream.text();
  assert.equal(stream.status(), 200);
  assert.ok((events.match(/event: delta/g) ?? []).length > 3);
  assert.ok(events.includes('event: done'));
  await page.getByRole('button', { name: 'Regenerate', exact: true }).waitFor();
  const id = new URL(page.url()).searchParams.get('chat');
  assert.ok(id);
  let detail = await (await page.request.get(root + `/conversations/${id}`)).json();
  assert.ok(detail.messages[1].content.includes('Nova'));
  assert.equal(detail.messages[1].metadata.source, 'model');
  report.realReply = detail.messages[1].content;
  await page.reload();
  await page.getByRole('button', { name: 'Regenerate', exact: true }).waitFor();
  assert.ok((await page.locator('.nova-thread').innerText()).includes(report.realReply));
  report.refreshRecovery = true;
  page.once('dialog', (dialog) => dialog.accept('Live Nova verification'));
  await page.getByRole('button', { name: 'Rename What is your name?' }).click();
  await page.getByRole('button', { name: 'Rename Live Nova verification' }).waitFor();
  report.rename = true;
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await page.getByRole('button', { name: 'Stop generation' }).waitFor();
  await page.getByRole('button', { name: 'Regenerate', exact: true }).waitFor();
  detail = await (await page.request.get(root + `/conversations/${id}`)).json();
  assert.equal(detail.messages.filter((m) => m.role === 'user').length, 1);
  report.regeneration = true;
  await page.getByRole('button', { name: 'Memory & privacy' }).click();
  const dialog = page.getByRole('dialog', { name: 'Memory and privacy' });
  await dialog.getByRole('checkbox').check();
  await dialog
    .getByLabel('A preference you want Nova to remember')
    .fill('I prefer black formal outfits.');
  await dialog.getByRole('button', { name: 'Approve & save memory' }).click();
  await dialog.getByRole('button', { name: 'Delete memory' }).waitFor();
  assert.equal((await (await page.request.get(root + '/memory')).json()).length, 1);
  await page.getByRole('button', { name: 'Close memory' }).click();
  await page
    .getByRole('textbox', { name: 'Message Nova' })
    .fill('What approved preferences have I shared?');
  const remembered = page.waitForResponse(
    (r) => r.url().endsWith('/nova/chat/stream') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await (await remembered).text();
  detail = await (await page.request.get(root + `/conversations/${id}`)).json();
  assert.ok(detail.messages.at(-1).metadata.memoryUsed > 0);
  report.memoryReply = detail.messages.at(-1).content;
  report.memoryRetrieved = true;
  await page.getByRole('button', { name: 'Memory & privacy' }).click();
  await dialog.getByRole('button', { name: 'Delete memory' }).click();
  await page.waitForFunction(
    async (url) => (await (await globalThis.fetch(url)).json()).length === 0,
    root + '/memory',
  );
  report.memoryDeleted = true;
  await page.getByRole('button', { name: 'Close memory' }).click();
  const fixture = await sharp({
    create: { width: 128, height: 128, channels: 3, background: '#2563eb' },
  })
    .png()
    .toBuffer();
  const invalid = await page.request.post(root + '/attachments', {
    multipart: {
      image: { name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
    },
  });
  assert.equal(invalid.status(), 400);
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith('/nova/attachments') && r.request().method() === 'POST',
  );
  await page
    .getByLabel('Upload image', { exact: true })
    .setInputFiles({ name: 'synthetic-blue-fixture.png', mimeType: 'image/png', buffer: fixture });
  const attachment = await (await uploaded).json();
  assert.ok(attachment.id);
  await page.getByAltText('Upload preview').waitFor();
  report.uploadValidated = true;
  if (!status.vision.configured) {
    await page.getByRole('textbox', { name: 'Message Nova' }).fill('Describe this image.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Vision inference is unavailable' }).waitFor();
    report.visionUnavailableCorrectly = true;
  }
  const other = await browser.newContext();
  try {
    assert.equal((await other.request.get(root + `/conversations/${id}`)).status(), 404);
    assert.equal((await other.request.get('http://localhost:3000' + attachment.url)).status(), 404);
    assert.deepEqual(await (await other.request.get(root + '/memory')).json(), []);
    report.guestIsolation = true;
  } finally {
    await other.close();
  }
  await page.getByRole('button', { name: 'Remove attachment' }).click();
  await page.getByRole('combobox', { name: 'Nova mode' }).selectOption('image');
  if (!status.images.configured) {
    await page
      .getByRole('textbox', { name: 'Message Nova' })
      .fill('Generate an image of a black formal suit.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Image generation is not configured' })
      .waitFor();
    report.imageGenerationUnavailableCorrectly = true;
    assert.deepEqual(await (await page.request.get(root + '/generations')).json(), []);
  }
  await page.getByRole('combobox', { name: 'Nova mode' }).selectOption('chat');
  await page.getByRole('button', { name: /^New conversation/ }).click();
  await page
    .getByRole('textbox', { name: 'Message Nova' })
    .fill('Explain how JavaScript promises work with several examples.');
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/nova/chat/stream') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await pending;
  await page.getByRole('button', { name: 'Stop generation' }).click();
  const stoppedId = new URL(page.url()).searchParams.get('chat');
  await page.waitForFunction(
    async (url) => {
      const d = await (await globalThis.fetch(url)).json();
      return d.messages?.some((m) => m.status === 'cancelled');
    },
    root + `/conversations/${stoppedId}`,
  );
  report.stopGeneration = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.getByRole('button', { name: 'Close sidebar' }).click();
  assert.equal(await page.locator('.nova-app').getAttribute('data-theme'), 'light');
  assert.equal(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: path.join(out, 'nova-platform-mobile.png'), fullPage: true });
  report.mobileAndThemes = true;
  assert.equal(
    requests.some((url) => url.includes(':8081')),
    false,
  );
  report.expressProxyOnly = true;
  assert.equal(
    requests.some((url) => !url.startsWith('http://localhost:3000') && !url.startsWith('data:')),
    false,
  );
  report.actualMediaInference = false;
  writeFileSync(path.join(out, 'nova-platform-live.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  // Only this fresh verification guest's synthetic fixtures are removed.
  await page.request.delete(root + '/data').catch(() => undefined);
  await context.close();
  await browser.close();
}
