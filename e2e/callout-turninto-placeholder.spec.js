// PR-2（Notion parity 第三批）：C3 转为入口 / C4 当前类型高亮 / C14 空框占位。
// Notion 对照（对拍实测）：Turn into 面板含 Callout 项；当前类型挂 checkmark（callout 里开 → Callout 项、
// 段落里开 → Text 项）；空 callout 编辑态显示与普通空段落**同一句**占位文案。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  if (!tmpDir) tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2c34-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
}
const HEAD = '<style id="ws-callout-style" data-ws-schema-css="callout">.ws-callout{background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px}</style>';
async function openDoc(body) {
  const tag = 'run' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title>${HEAD}</head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc' + seq + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(300);
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);
// 打开气泡「转为」菜单：选中块内文字 → 气泡出现 → 点「转为」
async function openTurnMenuOn(sel) {
  await frame.locator(sel).click();
  await page.waitForTimeout(150);
  await frame.locator(sel).selectText();
  await page.waitForTimeout(250);
  await frame.locator('.ws-fmtbar-btn', { hasText: '转为' }).click();
  await expect(frame.locator('.ws-fmtbar-menu')).toBeVisible();
}
const menuState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelectorAll('.ws-fmtbar-menu-item')].map((it) => it.dataset.key + (it.classList.contains('ws-fmtbar-menu-item--on') ? ':on' : ''));
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('C3a 气泡「转为」有提示项：段落一键变 callout，合规入盘', async () => {
  await launch();
  await openDoc('<p id="a">这段要变成提示框</p><p id="z">别的</p>');
  await openTurnMenuOn('#a');
  const keys = (await menuState()).map((k) => k.split(':')[0]);
  expect(keys).toContain('callout');
  await frame.locator('.ws-fmtbar-menu-item[data-key="callout"]').click();
  await page.waitForTimeout(300);
  const shape = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const c = d.querySelector('div.ws-callout');
    return { count: d.querySelectorAll('div.ws-callout').length, text: c ? c.textContent : null, hasStyle: !!d.getElementById('ws-callout-style') };
  });
  expect(shape.count).toBe(1);
  expect(shape.text).toBe('这段要变成提示框');
  expect(shape.hasStyle).toBe(true); // 入盘样式在（ensureCalloutStyle 通道）
  expect(await conformOf(await serialize())).toBe(true);
});

test('C3b 块菜单「转为提示」同款入口', async () => {
  await launch();
  await openDoc('<p id="a">块菜单转</p>');
  await frame.locator('#a').hover();
  await page.waitForTimeout(200);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  await frame.locator('.ws-blockmenu-item', { hasText: '转为提示' }).click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('div.ws-callout').length)).toBe(1);
  expect(await conformOf(await serialize())).toBe(true);
});

test('C4 当前类型高亮：callout 里开「转为」→ 提示项亮；段落对照组 → 正文项亮', async () => {
  await launch();
  await openDoc('<div class="ws-callout" id="C">框里文字</div><p id="a">普通段落</p>');
  await openTurnMenuOn('#C');
  expect(await menuState()).toContain('callout:on'); // 修前：DIV 返回 null → 全无高亮（对拍 C4 实测）
  expect((await menuState()).filter((k) => k.endsWith(':on'))).toEqual(['callout:on']); // 有且只有一项
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await openTurnMenuOn('#a');
  expect((await menuState()).filter((k) => k.endsWith(':on'))).toEqual(['text:on']); // 对照组
});

test('C4b 往返：callout 转回正文，多段拍平不丢字、不产非法结构', async () => {
  await launch();
  // ⚠ fixture 必须有兄弟块：单一顶层 div 会被 pickBlockRoot 的包裹启发式当成画布根（此时框内 <p> 才是「顶层块」）
  await openDoc('<div class="ws-callout" id="C"><p>甲</p><p>乙</p></div><p id="z">别的</p>');
  await openTurnMenuOn('#C');
  await frame.locator('.ws-fmtbar-menu-item[data-key="text"]').click();
  await page.waitForTimeout(300);
  const html = await serialize();
  expect(await conformOf(html)).toBe(true);
  // 别对全文断 not.toContain('ws-callout')——head 里随文件走的 <style id="ws-callout-style"> 恒含这个词。
  const bodyEls = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('body .ws-callout').length);
  expect(bodyEls).toBe(0);
  expect(html.replace(/\s+/g, '')).toContain('甲<br>乙'); // 多段容器→文本的既有拍平语义
});

test('C14 空框占位：编辑态显示与空段落同一句文案，打字即消失，绝不入盘', async () => {
  await launch();
  await openDoc('<div class="ws-callout" id="C"><br></div><p id="z">别的</p>');
  await frame.locator('#C').click();
  await page.waitForTimeout(250);
  const ph = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const c = d.querySelector('#C');
    const cs = getComputedStyle(c, '::before');
    return { content: cs.content, hasEmptyAttr: c.hasAttribute('data-ws2-empty'), editing: c.hasAttribute('data-ws2-editing') };
  });
  expect(ph.editing).toBe(true);   // 前置：真进了编辑态
  expect(ph.hasEmptyAttr).toBe(true);
  expect(ph.content).not.toBe('none');
  // 与空段落同一句文案（Notion 两处同文案 → 我们复用同一词条；从字典读，不写死文案）
  const expected = await page.evaluate(() => window.WS2I18n && WS2I18n.t ? WS2I18n.t('editor.emptyBlockPlaceholder') : null);
  if (expected) expect(ph.content).toBe('"' + expected + '"');
  // 打字后占位消失
  await page.keyboard.type('有字了');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const c = d.querySelector('#C');
    return { content: getComputedStyle(c, '::before').content, hasEmptyAttr: c.hasAttribute('data-ws2-empty') };
  });
  expect(after.hasEmptyAttr).toBe(false);
  expect(after.content).toBe('none');
  // 空态标记绝不入盘
  const html = await serialize();
  expect(html).not.toContain('data-ws2-empty');
  expect(await conformOf(html)).toBe(true);
});
