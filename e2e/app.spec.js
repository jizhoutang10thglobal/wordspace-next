const { test, expect } = require('@playwright/test');
const path = require('path');

test('app window shows built-in document content', async () => {
  const { _electron: electron } = require('@playwright/test');
  const app = await electron.launch({
    args: ['--no-sandbox', path.join(__dirname, '../src/main.js')],
  });
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    const container = window.locator('#doc-container');
    await expect(container).toContainText('Wordspace');
  } finally {
    await app.close();
  }
});

test('theme toggle changes shell class but preserves doc colour', async () => {
  const { _electron: electron } = require('@playwright/test');
  const app = await electron.launch({
    args: ['--no-sandbox', path.join(__dirname, '../src/main.js')],
  });
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Wait for IPC content to be injected before capturing colours
    await window.locator('#doc-container h1, #doc-container p').first().waitFor({ state: 'visible' });

    // Capture baseline state
    const classBeforeToggle = await window.evaluate(() => document.body.className);
    const docColourBefore = await window.evaluate(() => {
      const el = document.querySelector('#doc-container h1') ||
                  document.querySelector('#doc-container p');
      return window.getComputedStyle(el).color;
    });

    // Click the toggle once (light → dark)
    await window.locator('#theme-toggle').click();

    const classAfterToggle = await window.evaluate(() => document.body.className);
    const docColourAfter = await window.evaluate(() => {
      const el = document.querySelector('#doc-container h1') ||
                  document.querySelector('#doc-container p');
      return window.getComputedStyle(el).color;
    });

    // Shell class must have changed to dark-theme
    expect(classAfterToggle).toContain('dark-theme');
    expect(classAfterToggle).not.toContain('light-theme');
    expect(classAfterToggle).not.toBe(classBeforeToggle);

    // Document computed colour must be unchanged
    expect(docColourAfter).toBe(docColourBefore);

    // Click again (dark → light) — body class returns to light-theme
    await window.locator('#theme-toggle').click();
    const classAfterSecondToggle = await window.evaluate(() => document.body.className);
    expect(classAfterSecondToggle).toContain('light-theme');
  } finally {
    await app.close();
  }
});
