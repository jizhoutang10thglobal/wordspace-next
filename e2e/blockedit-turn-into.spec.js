// Wendi 2026-07-22 视频：格式条「Turn into（转为）」菜单 ① 少了 Heading 4（斜杠菜单有 H1–H4，转为只有 H1–H3，
// 「我只有 123，它没有 4」）；② 不高亮当前块类型（「不知道我的 heading 几，它其实是 3 但我看不出来」）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises'); const path = require('path'); const os = require('os');
const ROOT = path.join(__dirname, '..'); let app, page, frame, tmpDir;
async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2ti-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}
async function openDoc(html) {
  const p = path.join(tmpDir, 'doc.html'); await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, fp) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp), p);
  frame = page.frameLocator('#doc-frame'); await expect(frame.locator('body')).toBeVisible(); await page.waitForTimeout(400); return p;
}
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

const DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
  + '<h3 id="h3">三级标题</h3><p id="p1">一段正文。</p></body></html>';

// 打开某块的「转为」菜单，返回各项 key 顺序 + 高亮的 key
async function turnMenuOf(id) {
  await frame.locator('#' + id).click();
  await frame.locator('#' + id).selectText();
  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await page.waitForTimeout(120);
  return frame.locator('body').evaluate(() => {
    const items = [...document.querySelectorAll('.ws-fmtbar-menu-item')];
    return { keys: items.map((i) => i.dataset.key), active: items.filter((i) => i.classList.contains('ws-fmtbar-menu-item--on')).map((i) => i.dataset.key) };
  });
}

test('Turn into 菜单含 Heading 4（与斜杠菜单一致）', async () => {
  await launch(); await openDoc(DOC);
  const m = await turnMenuOf('h3');
  expect(m.keys, '转为菜单应含 h4').toContain('h4');
  expect(m.keys.filter((k) => /^h[1-4]$/.test(k)), '标题应齐 h1–h4').toEqual(['h1', 'h2', 'h3', 'h4']);
});

test('Turn into 菜单高亮当前块类型：当前是 H3 → 只有 h3 项高亮', async () => {
  await launch(); await openDoc(DOC);
  const m = await turnMenuOf('h3');
  expect(m.active, '当前块是 H3，应且仅 h3 项高亮').toEqual(['h3']);
});

test('Turn into 菜单高亮当前块类型：当前是正文 → 只有 text 项高亮', async () => {
  await launch(); await openDoc(DOC);
  const m = await turnMenuOf('p1');
  expect(m.active, '当前块是正文，应且仅 text 项高亮').toEqual(['text']);
});

// 容器块（含真空段）转 todo：flattenBlocksToLines 对空 <p></p> 产空 fragment → 中间 li 空、
// 在 ws-todo list-style:none 下零高、落不住 caret、输入被吞（U1/create-1 经 containerLines 路径复活，对抗审查发现）。
test('容器块（含空段）转 todo：每个 li 都有可视高度、无零高死块（U1 补全）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>'
    + '<style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style></head><body>'
    + '<blockquote id="bq"><p>甲</p><p></p><p>乙</p></blockquote></body></html>');
  await frame.locator('#bq').click();
  await frame.locator('#bq').selectText();
  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await page.waitForTimeout(120);
  await frame.locator('.ws-fmtbar-menu-item[data-key="todo"]').click();
  await expect.poll(() => frame.locator('ul.ws-todo > li').count(), { message: '容器 3 段 → 3 个 todo li' }).toBe(3);
  const heights = await frame.locator('ul.ws-todo > li').evaluateAll((lis) => lis.map((li) => li.getBoundingClientRect().height));
  expect(Math.min(...heights), '任何 li（含空段那个）都不许零高（死块吞输入）').toBeGreaterThan(0);
});
