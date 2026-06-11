// S6 手写 e2e：VA 词汇够不到的编辑验收——纯文本粘贴、跨启动持久化、Reset、源码视图衔接。
// 打字/撤销的可见验收在 specs/f40-basic-editing.va.json（VA，人锁），这里不重复。
const { test, expect } = require('@playwright/test');
const path = require('path');
const { launchApp, settle } = require('./helpers');

// 对抗验收门不容忍概率性放过：retries 设 0。
test.describe.configure({ retries: 0 });

const MAIN = path.join(__dirname, '../src/main.js');

async function readyWindow(app) {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.locator('#doc-container h1, #doc-container p').first().waitFor({ state: 'visible' });
  return window;
}

test('纯文本粘贴：带 text/html 的剪贴板只进纯文本，去样式、保换行', async () => {
  const { app } = await launchApp(MAIN);
  try {
    const window = await readyWindow(app);
    await window.locator('#doc-container p').first().click();
    // 合成一份「富文本剪贴板」：text/html 是粗体，text/plain 是带 \r\n 的两行
    await window.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'PLAIN-PASTE\r\nSECOND-LINE');
      dt.setData('text/html', '<b>RICH-PASTE</b>');
      document.getElementById('doc-container').dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      );
    });
    await settle(window);

    const text = await window.evaluate(() => document.getElementById('doc-container').textContent);
    expect(text).toContain('PLAIN-PASTE');
    expect(text).toContain('SECOND-LINE');
    // 富文本路径必须没走：文档里不得出现 RICH-PASTE 内容或新 <b> 节点
    expect(text).not.toContain('RICH-PASTE');
    const html = await window.evaluate(() => document.getElementById('doc-container').innerHTML);
    expect(html).not.toContain('RICH-PASTE');
    // 换行真保留：textContent 看不见 <br>/块级换行，要用 innerText（按渲染结果含 \n）
    const visualText = await window.evaluate(() => document.getElementById('doc-container').innerText);
    expect(visualText, '两行被压成同一行 = \\r\\n 没规范化或换行丢了').toMatch(/PLAIN-PASTE\s*\n\s*SECOND-LINE/);
  } finally {
    await app.close();
  }
});

test('持久化：编辑 → 重开（同一 userData）→ 编辑还在、脏标记在', async () => {
  const first = await launchApp(MAIN);
  const dir = first.userData;
  try {
    const window = await readyWindow(first.app);
    await window.locator('#doc-container p').first().click();
    await window.keyboard.type('PERSIST-PROBE');
    // 等存档真落 localStorage（input 事件同步写，这里防极端时序）
    await window.waitForFunction(() => (localStorage.getItem('wordspace.doc.html') || '').includes('PERSIST-PROBE'));
  } finally {
    await first.app.close();
  }

  const second = await launchApp(MAIN, dir);
  try {
    const window = await readyWindow(second.app);
    await expect(window.locator('#doc-container')).toContainText('PERSIST-PROBE');
    await expect(window.locator('#edit-indicator')).toContainText('Edited');
  } finally {
    await second.app.close();
  }
});

test('Reset：回内置原文、脏标记消失、存档清空', async () => {
  const { app } = await launchApp(MAIN);
  try {
    const window = await readyWindow(app);
    await window.locator('#doc-container p').first().click();
    await window.keyboard.type('RESET-PROBE');
    await expect(window.locator('#edit-indicator')).toContainText('Edited');

    await window.locator('#reset-doc').click();
    await settle(window);

    const text = await window.evaluate(() => document.getElementById('doc-container').textContent);
    expect(text).toContain('Welcome to Wordspace');
    expect(text).not.toContain('RESET-PROBE');
    const indicator = await window.evaluate(() => document.getElementById('edit-indicator').textContent);
    expect(indicator).toBe('');
    const saved = await window.evaluate(() => localStorage.getItem('wordspace.doc.html'));
    expect(saved).toBeNull();
  } finally {
    await app.close();
  }
});

test('源码衔接：编辑后源码视图显编辑后的 HTML 且只读，切回渲染继续可编辑', async () => {
  const { app } = await launchApp(MAIN);
  try {
    const window = await readyWindow(app);
    await window.locator('#doc-container p').first().click();
    await window.keyboard.type('SOURCE-PROBE');

    await window.locator('#view-toggle').click();
    await settle(window);
    const sourceText = await window.evaluate(() => document.getElementById('doc-container').textContent);
    // 源码视图是「编辑后」文档的实时 HTML：含编辑进去的文本，也含标签字面
    expect(sourceText).toContain('SOURCE-PROBE');
    expect(sourceText).toContain('<h1');
    // 只读：源码态 contenteditable 必须关
    const editableInSource = await window.evaluate(() => document.getElementById('doc-container').isContentEditable);
    expect(editableInSource).toBe(false);

    await window.locator('#view-toggle').click();
    await settle(window);
    // 切回渲染：编辑不丢、恢复可编辑、标签字面不再露出
    const rendered = await window.evaluate(() => document.getElementById('doc-container').textContent);
    expect(rendered).toContain('SOURCE-PROBE');
    expect(rendered).not.toContain('<h1');
    const editableBack = await window.evaluate(() => document.getElementById('doc-container').isContentEditable);
    expect(editableBack).toBe(true);
  } finally {
    await app.close();
  }
});
