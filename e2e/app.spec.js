const { test, expect } = require('@playwright/test');
const path = require('path');

test('app window shows built-in document content', async () => {
  const { _electron: electron } = require('@playwright/test');
  const app = await electron.launch({
    args: ['--no-sandbox', path.join(__dirname, '../src/main.js')],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  const container = window.locator('#doc-container');
  await expect(container).toContainText('Wordspace');

  await app.close();
});
