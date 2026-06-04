const { test, expect } = require('@playwright/test');
const path = require('path');

test('app window shows built-in document content', async () => {
  test.skip(!process.env.DISPLAY, 'No DISPLAY — skipping in headless container');

  const { _electron: electron } = require('@playwright/test');
  const app = await electron.launch({
    args: [path.join(__dirname, '../src/main.js')],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  const container = window.locator('#doc-container');
  await expect(container).toContainText('Wordspace');

  await app.close();
});

test('theme toggle switches shell class while doc color stays fixed', async () => {
  test.skip(!process.env.DISPLAY, 'No DISPLAY — skipping in headless container');

  const { _electron: electron } = require('@playwright/test');
  const app = await electron.launch({
    args: [path.join(__dirname, '../src/main.js')],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#doc-container h1');

  const initialDocColor = await window.evaluate(() =>
    getComputedStyle(document.querySelector('#doc-container h1')).color
  );

  await window.click('#theme-toggle');

  const htmlClass = await window.evaluate(() => document.documentElement.className);
  expect(htmlClass).toContain('dark');

  const afterDocColor = await window.evaluate(() =>
    getComputedStyle(document.querySelector('#doc-container h1')).color
  );
  expect(afterDocColor).toBe(initialDocColor);

  await app.close();
});
