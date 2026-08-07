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

// Step 2（Colin 2026-07-23，方案 B 第 2 步）：「转为」只作用于选中的行 —— 选中单个 li 转 text/toggle，
// 只把那一行抽出去，前后剩余项仍是原列表。选中整列表（whole）维持既有整块转换。
const topBlocks2 = () => frame.locator('body').evaluate((b) =>
  [...b.children].filter((c) => c.nodeType === 1 && c.tagName !== 'STYLE' && !(c.hasAttribute && c.hasAttribute('data-ws2-ui')))
    .map((c) => c.tagName + ':' + (c.textContent || '').replace(/\s+/g, '')));
async function convertLine(liSel, key) {
  await frame.locator(liSel).click();
  await frame.locator(liSel).selectText(); // 只选这一行的文字（触发格式条 + selectedListLines 认这行）
  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await page.waitForTimeout(120);
  await frame.locator('.ws-fmtbar-menu-item[data-key="' + key + '"]').click();
  await page.waitForTimeout(180);
}
const L3 = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>' + TODO_HEAD + '</head><body><ul id="lst" class="ws-todo"><li id="a">甲</li><li id="b">乙</li><li id="c">丙</li></ul></body></html>';

test('Step2：todo 中间一行转文本 → 只抽这行成 p、前后仍各是 todo 列表', async () => {
  await launch();
  await openDoc(L3);
  await convertLine('#b', 'text');
  expect(await topBlocks2(), '劈成 [todo甲][p乙][todo丙]').toEqual(['UL:甲', 'P:乙', 'UL:丙']);
  expect(await frame.locator('ul.ws-todo').count(), '前后两个 todo 列表').toBe(2);
  expect(await frame.locator('p').count(), '只抽出一个正文段').toBe(1);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('Step2：todo 中间一行转 toggle → 只这行成 details、前后仍 todo', async () => {
  await launch();
  await openDoc(L3);
  await convertLine('#b', 'toggle');
  expect(await frame.locator('details').count()).toBe(1);
  expect(await frame.locator('details > summary').first().textContent()).toBe('乙');
  expect(await frame.locator('ul.ws-todo').count(), '前后两个 todo').toBe(2);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('Step2：首行转文本 → [p][todo 剩余]（无前列表）', async () => {
  await launch();
  await openDoc(L3);
  await convertLine('#a', 'text');
  expect(await topBlocks2()).toEqual(['P:甲', 'UL:乙丙']);
  expect(await frame.locator('ul.ws-todo').count()).toBe(1);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('Step2：末行转文本 → [todo 剩余][p]（无后列表）', async () => {
  await launch();
  await openDoc(L3);
  await convertLine('#c', 'text');
  expect(await topBlocks2()).toEqual(['UL:甲乙', 'P:丙']);
  expect(await frame.locator('ul.ws-todo').count()).toBe(1);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('Step2 回归：选中整列表转文本 → 仍整块转（单个 p，不劈）', async () => {
  await launch();
  await openDoc(L3);
  await convertTo('#lst', 'text'); // selectText 整个 ul = 全选 → 整块
  expect(await frame.locator('ul').count(), '整列表转掉').toBe(0);
  expect(await frame.locator('p').count(), '整块 → 单个 p').toBe(1);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('Step2 对抗审查：三击整行（末端贴下一行最前沿）转文本 → 只抽这一行、不多卷下一行', async () => {
  await launch();
  await openDoc(L3);
  await frame.locator('#b').click({ clickCount: 3 }); // 三击选中「乙」整行——浏览器把 range 末端停在丙这行最前沿(丙零字符)
  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await page.waitForTimeout(120);
  await frame.locator('.ws-fmtbar-menu-item[data-key="text"]').click();
  await page.waitForTimeout(180);
  expect(await topBlocks2(), '只抽乙,丙不被卷进来').toEqual(['UL:甲', 'P:乙', 'UL:丙']);
  expect(await conformOf10(await serialize10())).toBe(true);
});

test('Step2 对抗审查 LOW：选中行「转为」它已是的类型（todo→todo）→ 空操作，不劈成三张列表', async () => {
  await launch();
  await openDoc(L3);
  await convertLine('#b', 'todo'); // 乙已是 todo，再转 todo
  expect(await frame.locator('ul.ws-todo').count(), '仍是单张列表，不裂成三张').toBe(1);
  expect(await frame.locator('ul.ws-todo > li').count(), '三项都还在').toBe(3);
  expect(await conformOf10(await serialize10())).toBe(true);
});

// ── 多行「转为」（Wendi 2026-08-05 那批调研扫到的）────────────────────────────────────
// 病灶：选中多行点「转为正文」，四行被**糊成一个段落**（实测「第1条第2条第3条第4条」），行边界
// 彻底丢失。根因：turnIntoLines 把选中段整体交给 turnInto，flattenListToPhrasing 一把拍平。
// Notion 是 4 行变 4 段。修法 = 每行套一个单行临时列表再走既有的单行转换（最大化复用、语义同源）。
const selAcross = (a, b) => page.evaluate((q) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const A = d.querySelector(q.a), B = d.querySelector(q.b);
  const r = d.createRange(); r.setStart(A.firstChild || A, 0);
  const last = B.lastChild || B;
  r.setEnd(last, last.nodeType === 3 ? last.nodeValue.length : last.childNodes.length);
  const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  d.dispatchEvent(new Event('selectionchange'));
}, { a, b });
// 气泡「转为」菜单项常在视口外 → 用事件派发驱动（点击会被可见性挡）
const turnTo = (label) => page.evaluate((lb) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const fb = d.querySelector('.ws-fmtbar'); if (!fb) return 'no-fmtbar';
  const t = [...fb.querySelectorAll('button')].find((x) => /转为/.test(x.textContent || ''));
  if (!t) return 'no-turn';
  t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const menu = fb.querySelector('.ws-fmtbar-menu'); if (!menu) return 'no-menu';
  menu.style.display = 'block';
  const it = [...menu.querySelectorAll('.ws-fmtbar-menu-item')].find((x) => (x.textContent || '').trim() === lb);
  if (!it) return 'no-item';
  it.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return 'ok';
}, label);
const blocksOf = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].filter((e) => !e.hasAttribute('data-ws2-ui'))
    .map((e) => e.tagName + (e.id ? '#' + e.id : '') + '「' + (e.textContent || '').replace(/\s+/g, '') + '」');
});
const conformNow = () => page.evaluate(() => WS2SchemaRegistry.classify(
  new DOMParser().parseFromString(WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument), 'text/html')).conform);
const FIVE = '<p id="pre">前段</p><ul id="L" class="ws-todo">'
  + [1, 2, 3, 4, 5].map((i) => `<li id="r${i}">第${i}条</li>`).join('') + '</ul><p id="post">后段</p>';

test('MT-1 选 4 行转正文 → 4 个段落，各自保住自己的 id（修前：糊成一段）', async () => {
  await launch();
  await openDoc(FIVE);
  await frame.locator('#r1').click(); await page.waitForTimeout(200);
  await selAcross('#r1', '#r4'); await page.waitForTimeout(300);
  expect(await turnTo('正文')).toBe('ok');
  await page.waitForTimeout(600);
  expect(await blocksOf()).toEqual([
    'P#pre「前段」', 'P#r1「第1条」', 'P#r2「第2条」', 'P#r3「第3条」', 'P#r4「第4条」',
    'UL「第5条」', 'P#post「后段」',
  ]);
  expect(await conformNow()).toBe(true);
});

test('MT-2 选 3 行转标题 → 3 个 H2（不止正文）', async () => {
  await launch();
  await openDoc(FIVE);
  await frame.locator('#r2').click(); await page.waitForTimeout(200);
  await selAcross('#r2', '#r4'); await page.waitForTimeout(300);
  expect(await turnTo('标题 2')).toBe('ok');
  await page.waitForTimeout(600);
  expect(await blocksOf()).toEqual([
    'P#pre「前段」', 'UL「第1条」', 'H2#r2「第2条」', 'H2#r3「第3条」', 'H2#r4「第4条」',
    'UL「第5条」', 'P#post「后段」',
  ]);
  expect(await conformNow()).toBe(true);
});

test('MT-3 多行带子列表：子树跟着**各自那一行**走，不全堆到最后一个', async () => {
  await launch();
  await openDoc('<p id="pre">前</p><ul id="L"><li id="r1">一<ul><li>子甲</li></ul></li><li id="r2">二<ul><li>子乙</li></ul></li><li id="r3">三</li></ul><p id="post">后</p>');
  await frame.locator('#r1').click(); await page.waitForTimeout(200);
  await selAcross('#r1', '#r2'); await page.waitForTimeout(300);
  expect(await turnTo('正文')).toBe('ok');
  await page.waitForTimeout(600);
  // 修前会把两棵子树都接到唯一那个产物之后 → 子甲/子乙 挤在一起、跟不上各自的行。
  // S1（2026-08-08）：「子乙」子树表与剩余「三」同类相邻 → coalesce 并成一张（终态确实相邻，就该合）。
  expect(await blocksOf()).toEqual([
    'P#pre「前」', 'P#r1「一」', 'UL「子甲」', 'P#r2「二」', 'UL「子乙三」', 'P#post「后」',
  ]);
  expect(await conformNow()).toBe(true);
});

// MT-5/MT-6（Colin 2026-08-05 实机抓到）：MT-1..4 全在「选区落在一张 <ul> 里」的前提下测的——
// 一旦几行已经变成独立的顶层块（比如刚被转成正文），editingEl / selectedEl 就都是空，
// 「转为」点了毫无反应，那几段永远只能是正文。跨块入口 turnIntoMany 补的就是这一段。
test('MT-5 选中三个独立段落转标题 → 三个 H2（修前：点「转为」零反应）', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙</p><p id="c">丙</p><p id="tail">尾</p>');
  await frame.locator('#a').click(); await page.waitForTimeout(200);
  await selAcross('#a', '#c'); await page.waitForTimeout(300);
  expect(await turnTo('标题 2')).toBe('ok');
  await page.waitForTimeout(600);
  expect(await blocksOf()).toEqual(['H2#a「甲」', 'H2#b「乙」', 'H2#c「丙」', 'P#tail「尾」']);
  expect(await conformNow()).toBe(true);
});

test('MT-6 多段转待办 → 并成**一张**列表，并吞掉紧跟其后的既有待办（磁盘正本是一张）', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙</p><ul id="T" class="ws-todo"><li id="d">丁</li></ul>');
  await frame.locator('#a').click(); await page.waitForTimeout(200);
  await selAcross('#a', '#b'); await page.waitForTimeout(300);
  expect(await turnTo('待办列表')).toBe('ok');
  await page.waitForTimeout(600);
  // 逐块 retag 天然会产 3 张并排的 <ul>；coalesceLists 把它们并回一张
  expect(await blocksOf()).toEqual(['UL#a「甲乙丁」']);
  const lis = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#a > li')].map((e) => (e.id || '-') + ':' + e.textContent.trim());
  });
  expect(lis, '被吞掉的 <ul> 的 id 要迁到它第一项上，锚点不许静默断链').toEqual(['-:甲', 'b:乙', 'd:丁']);
  expect(await conformNow()).toBe(true);
});

// MT-7/MT-8（Colin 2026-08-05 实机抓到）：往返转换后整块留一层蓝底、点哪儿都不消。
// 病灶：retagElement 原样复制全部属性 → 跨块拖选的 data-ws2-rangesel 跟着进了产物，
// 而记账数组 rangeSelEls 里存的还是被摘走的旧元素，于是活着的那个谁也清不掉。
// 两道门分守两层：MT-7 守「别造出来」，MT-8 守「造出来了也能清掉」（后者才是真正的兜底）。
test('MT-7 转过去再转回来：不留一层没人认领的蓝底', async () => {
  await launch();
  await openDoc('<p id="pre">前段</p><ul id="L" class="ws-todo">'
    + '<li id="d1">第一条</li><li id="d2">第二条</li><li id="d3">第三条</li><li id="d4">第四条</li>'
    + '</ul><p id="post">后段</p>');
  await frame.locator('#d1').click(); await page.waitForTimeout(200);
  await selAcross('#d1', '#d3'); await page.waitForTimeout(300);
  expect(await turnTo('正文')).toBe('ok');           // 三行 → 三段（单块路径）
  await page.waitForTimeout(600);
  await frame.locator('#d1').click(); await page.waitForTimeout(200);
  await selAcross('#d1', '#d3'); await page.waitForTimeout(300); // 跨块拖选 → 三段各挂上蓝底标记
  expect(await turnTo('编号列表')).toBe('ok');        // 再转回去（跨块路径 turnIntoMany）
  await page.waitForTimeout(600);
  const stuck = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('[data-ws2-rangesel]')].map((e) => e.tagName + (e.id ? '#' + e.id : ''));
  });
  expect(stuck, '转换产物身上不许挂着跨块选中的蓝底标记').toEqual([]);
  expect(await conformNow()).toBe(true);
});

test('MT-8 兜底：不在记账数组里的蓝底标记，一次选区变化就得被清掉', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙</p>');
  // 直接往元素上盖标记，模拟「标记是被 retag / clone 带进来的、记账数组根本不知道它」。
  // 只清数组的实现在这里必然清不掉——这正是往返转换蓝底卡死的本体。
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    d.getElementById('a').setAttribute('data-ws2-rangesel', '');
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const b = d.getElementById('b');
    const r = d.createRange(); r.setStart(b.firstChild, 0); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
    d.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(300);
  const left = await page.evaluate(() => document.getElementById('doc-frame').contentDocument
    .querySelectorAll('[data-ws2-rangesel]').length);
  expect(left, '清除必须扫 DOM，不能只认那个记账数组').toBe(0);
});

test('MT-4 负向：单行路径一字未变（E1/E2 那批门压在上面）', async () => {
  await launch();
  await openDoc(FIVE);
  await frame.locator('#r2').click(); await page.waitForTimeout(200);
  await selAcross('#r2', '#r2'); await page.waitForTimeout(300);
  expect(await turnTo('正文')).toBe('ok');
  await page.waitForTimeout(600);
  expect(await blocksOf()).toEqual([
    'P#pre「前段」', 'UL「第1条」', 'P#L「第2条」', 'UL「第3条第4条第5条」', 'P#post「后段」',
  ]);
  expect(await conformNow()).toBe(true);
});
