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

// ===== U10/create-3：多项 todo↔文本转换往返不塌缩（按 <br> 拆行） =====
const serialize10 = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf10 = (h) => page.evaluate((x) => { const d = new DOMParser().parseFromString(x, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, h);
const TODO_HEAD = '<style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style>';
async function convertTo(sel, key) {
  await frame.locator(sel).click();
  await frame.locator(sel).selectText();
  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await page.waitForTimeout(120);
  await frame.locator('.ws-fmtbar-menu-item[data-key="' + key + '"]').click();
  await page.waitForTimeout(150);
}

test('U10：3 项 todo 转文本再转回 → 3 项不塌成 1、勾选态不保留（create-3）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>' + TODO_HEAD + '</head><body><ul id="lst" class="ws-todo"><li>甲</li><li data-checked="true">乙</li><li>丙</li></ul></body></html>');
  await convertTo('#lst', 'text'); // todo → 文本（甲<br>乙<br>丙）
  await expect.poll(() => frame.locator('p').count(), { message: '转文本成单个 p' }).toBe(1);
  await convertTo('p', 'todo'); // 文本 → todo（转回）
  const lis = await frame.locator('ul.ws-todo > li').evaluateAll((els) => els.map((l) => ({ text: l.textContent.trim(), checked: l.getAttribute('data-checked') })));
  expect(lis.map((l) => l.text), '往返后仍 3 项、逐项对应').toEqual(['甲', '乙', '丙']);
  expect(lis.every((l) => l.checked === null), '往返后全部未勾（勾选态不保留，Colin 拍板）').toBe(true);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('U10：含行内加粗的项往返 → 加粗保留在对应行', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>' + TODO_HEAD + '</head><body><ul id="lst" class="ws-todo"><li><b>粗</b>甲</li><li>乙</li></ul></body></html>');
  await convertTo('#lst', 'text');
  await expect.poll(() => frame.locator('p').count()).toBe(1);
  await convertTo('p', 'todo');
  await expect.poll(() => frame.locator('ul.ws-todo > li').count(), { message: '2 项' }).toBe(2);
  const firstHasBold = await frame.locator('ul.ws-todo > li').first().evaluate((l) => !!l.querySelector('b'));
  expect(firstHasBold, '第一项仍含加粗').toBe(true);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('U10：单项 todo 往返 → 仍单项（不误拆）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>' + TODO_HEAD + '</head><body><ul id="lst" class="ws-todo"><li>只有一项</li></ul></body></html>');
  await convertTo('#lst', 'text');
  await expect.poll(() => frame.locator('p').count()).toBe(1);
  await convertTo('p', 'todo');
  await expect.poll(() => frame.locator('ul.ws-todo > li').count(), { message: '单项往返仍单项' }).toBe(1);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('U10：手写 <p>a<br><br>b</p> 转 todo → 2 项、无悬空空 li', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>' + TODO_HEAD + '</head><body><p id="p1">a<br><br>b</p></body></html>');
  await convertTo('#p1', 'todo');
  const lis = await frame.locator('ul.ws-todo > li').evaluateAll((els) => els.map((l) => l.textContent.trim()));
  expect(lis, '空行跳过 → 2 项').toEqual(['a', 'b']);
  const emptyLi = await frame.locator('ul.ws-todo > li').evaluateAll((ls) => ls.filter((l) => !l.textContent.trim()).length);
  expect(emptyLi, '无悬空空 li').toBe(0);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('U10 对抗审查：空行内元素夹在 <br> 间转 todo → 无零高死块 li', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>' + TODO_HEAD + '</head><body><p id="p1">甲<br><b></b><br>乙</p></body></html>');
  await convertTo('#p1', 'todo');
  await expect.poll(() => frame.locator('ul.ws-todo > li').count(), { message: '3 段（含空 <b> 段）→ 3 li' }).toBe(3);
  const heights = await frame.locator('ul.ws-todo > li').evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().height));
  expect(Math.min(...heights), '含空行内元素的 li 也不许零高（padLi 补 br）').toBeGreaterThan(0);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('U16：todo 转文本不残留 ws-todo class、用户自定义 class 保留（create-5）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>' + TODO_HEAD + '</head><body><ul id="lst" class="ws-todo custom-x"><li>项</li></ul></body></html>');
  await convertTo('#lst', 'text');
  const cls = await frame.locator('p').first().getAttribute('class');
  expect(cls || '', 'ws-todo 剥掉').not.toContain('ws-todo');
  expect(cls || '', '用户自定义 class 保留').toContain('custom-x');
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('U17：todo 转 toggle 保 id + 首项进 summary、其余项各成正文 p（create-6）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>' + TODO_HEAD + '</head><body><ul id="anchor1" class="ws-todo"><li>甲</li><li>乙</li><li>丙</li></ul></body></html>');
  await convertTo('#anchor1', 'toggle');
  await expect.poll(() => frame.locator('details').count()).toBe(1);
  const det = await frame.locator('details').first().evaluate((d) => ({ id: d.id, summary: d.querySelector('summary').textContent.trim(), bodyPs: [...d.querySelectorAll(':scope > p')].map((p) => p.textContent.trim()) }));
  expect(det.id, 'toggle 保留源 id（锚点不断）').toBe('anchor1');
  expect(det.summary, '首项进 summary').toBe('甲');
  expect(det.bodyPs, '其余项各成正文 p').toEqual(['乙', '丙']);
  expect(await conformOf10(await serialize10())).toBe(true);
});

// 对抗审查（structural reviewer）：首项行内内容为空（只含嵌套子列表 / 空 li）时，summary 会是空的、
// 无 <br> 兜底 → toggle 标题不可见。conform 仍 true，CI 抓不到。
test('U17 对抗审查：首项行内为空（仅嵌套子列表）转 toggle → summary 补 <br> 不空、内容不丢', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>' + TODO_HEAD + '</head><body><ul id="anchor1" class="ws-todo"><li><ul class="ws-todo"><li>child</li></ul></li><li>乙</li></ul></body></html>');
  await convertTo('#anchor1', 'toggle');
  await expect.poll(() => frame.locator('details').count()).toBe(1);
  const info = await frame.locator('details').first().evaluate((d) => ({
    summaryKids: d.querySelector('summary').childNodes.length,
    bodyText: [...d.querySelectorAll(':scope > p')].map((p) => p.textContent.trim()),
  }));
  expect(info.summaryKids, '空首项的 summary 必须补 <br>、不留空标题').toBeGreaterThan(0);
  expect(info.bodyText.join(','), '子列表/后继项内容不丢').toContain('child');
  expect(info.bodyText.join(','), '后继项内容不丢').toContain('乙');
  expect(await conformOf10(await serialize10())).toBe(true);
});
