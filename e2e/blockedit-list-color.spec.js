// 回归门（Wendi bug「列表/待办项没法改文字颜色和背景颜色」）：
// 在 <li> 里用键盘选行（Home→Shift+End）/ 三击选行，浏览器会把选区尾端落到**下一个 <li>** 的 offset 0
// （selection.toString() 尾部那个 '\n' 就是块边界）。旧的 wrapInlineStyle / wrapMark 跨块守卫死判
// startBlock(li0)!==endBlock(li1) → 直接拒绝 → 上色/高亮静默无反应（加粗走 execCommand 不受影响，
// 所以现象是「能改粗细却改不了颜色」）。修法 = format.js clampRangeToBlock：尾端只是溢到相邻块的幽灵
// 边界（中间零可见文字/媒体）时夹回起块末尾再上色；真选进了别块的内容才拒绝（保真红线不破，见 fidelity 用例）。
// 有牙实证：修复前本门 T1/T2 的 span/mark count 为 0（li 纹丝不动），修复后 >0。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');

let app, page, frame, tmpDir;

const TODO = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="wordspace-schema" content="1"><title>List</title></head><body>
<h1>List</h1><ul class="ws-todo"><li data-checked="false">我没有办法更改颜色</li><li data-checked="true"><br></li><li data-checked="false"></li></ul></body></html>`;
const PLAINLIST = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="wordspace-schema" content="1"><title>t</title></head><body>
<h1>标题</h1><ul><li>第一项文字内容</li><li>第二项</li></ul></body></html>`;
const TWOITEMS = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="wordspace-schema" content="1"><title>t</title></head><body>
<h1>标题</h1><ul><li id="a">第一项有内容</li><li id="b">第二项也有内容</li></ul></body></html>`;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2color-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}
test.afterEach(async () => {
  try { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())); } catch (e) {}
  if (app) await app.close().catch(() => {});
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});
async function openDoc(html) {
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, fp) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp), p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(450);
  return p;
}
const saveToDisk = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));

// 忠实复现用户手势：点进 <li> → Home → Shift+End（选中该行，尾端溢到下一 li 边界）
async function keyboardSelectLine(liSelector) {
  await frame.locator(liSelector).first().click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.waitForTimeout(150);
  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
}

test('待办项键盘选行 → 文字色 → span 真上色 + 存盘保留', async () => {
  await launch();
  await openDoc(TODO);
  await expect(page.locator('#ws-degrade-notice')).toBeHidden(); // schema=1 走块编辑
  await keyboardSelectLine('ul.ws-todo li');
  await frame.locator('.ws-fmtbar [title="文字色"]').click();
  await frame.locator('.ws-fmtbar-swatches:visible .ws-fmtbar-swatch').nth(1).click(); // 第二色 #d93025
  await page.waitForTimeout(150);
  const span = frame.locator('ul.ws-todo li').first().locator('span[style*="color"]');
  await expect(span, '待办项文字色没生效（列表 Shift+End 幽灵边界被误判跨块）').toHaveCount(1);
  expect(await span.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(217, 48, 37)');
  // 存盘保留（inline 随文件走）
  await saveToDisk();
  await page.waitForTimeout(300);
  const disk = await fs.readFile(path.join(tmpDir, 'doc.html'), 'utf8');
  expect(disk).toMatch(/<li data-checked="false"><span style="color[^"]*">我没有办法更改颜色<\/span><\/li>/);
});

test('待办项键盘选行 → 高亮（背景色）→ <mark>', async () => {
  await launch();
  await openDoc(TODO);
  await keyboardSelectLine('ul.ws-todo li');
  await frame.locator('.ws-fmtbar [title="高亮"]').click();
  await frame.locator('.ws-fmtbar-swatches:visible .ws-fmtbar-swatch').first().click();
  await page.waitForTimeout(150);
  await expect(frame.locator('ul.ws-todo li').first().locator('mark'), '待办项高亮没生效').toHaveCount(1);
});

test('普通无序列表项幽灵边界选区 → 文字色（不止待办）', async () => {
  await launch();
  await openDoc(PLAINLIST);
  await frame.locator('ul li').first().click();
  await page.waitForTimeout(120);
  // 确定性设「起点 li0 文字 offset0 → 终点 li1 offset0」的幽灵边界选区（= 待办 Shift+End 天然产生的形状；
  // 普通列表里 Playwright 的 Shift+End 会过度选到 li1 真实文字，那是真跨块另说，这里定向验幽灵边界路径）。
  await frame.locator('body').evaluate(() => {
    const d = document, li0 = d.querySelector('ul li'), li1 = li0.nextElementSibling;
    const r = d.createRange(); r.setStart(li0.firstChild, 0); r.setEnd(li1, 0);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
    d.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(150);
  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
  await frame.locator('.ws-fmtbar [title="文字色"]').click();
  await frame.locator('.ws-fmtbar-swatches:visible .ws-fmtbar-swatch').nth(1).click();
  await page.waitForTimeout(150);
  await expect(frame.locator('ul li').first().locator('span[style*="color"]'), '普通列表项文字色没生效').toHaveCount(1);
});

test('fidelity：真跨两个有内容的 li 选区 → 文字色仍被拒（保真红线未削弱）', async () => {
  await launch();
  await openDoc(TWOITEMS);
  await frame.locator('#a').click();
  await page.waitForTimeout(120);
  // 程序化设「起点 a 文字中段 → 终点 b 文字中段」的真跨块选区（两块都含被选文字）
  await frame.locator('body').evaluate(() => {
    const d = document, a = d.getElementById('a'), b = d.getElementById('b');
    const r = d.createRange(); r.setStart(a.firstChild, 2); r.setEnd(b.firstChild, 2);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
    d.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(150);
  await frame.locator('.ws-fmtbar [title="文字色"]').click();
  await frame.locator('.ws-fmtbar-swatches:visible .ws-fmtbar-swatch').nth(1).click();
  await page.waitForTimeout(150);
  // 【断言迁移，2026-08-05 —— Wendi「大批量选中 to do list，无法统一修改颜色」】
  // 这条门原来断「真跨块上色被**拒绝**、span 数为 0」。那在当时是对的：唯一的备选是让一个 <span>
  // 跨块，而那是保真红线（span 吞块级元素 = 非法嵌套 + 重复 id，写回磁盘就是损坏文档）。
  // 现在多了第三条路：**按块切成子段、逐块各一个 span**——用户要的批量上色做到了，而且没有任何
  // 一个 span 越过块边界。所以门守的不变式没变、只是「拒绝」不再是满足它的唯一方式。
  // 终态断言换成直接钉那条红线本身（比原来强：原来只是「什么都没发生」的间接证据）。
  await expect(frame.locator('#a span[style*="color"]'), '起块自己那段该上色').toHaveCount(1);
  await expect(frame.locator('#b span[style*="color"]'), '尾块自己那段也该上色').toHaveCount(1);
  const swallowed = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    // ⚠ 必须排除 [data-ws2-ui] 浮层：气泡的 .ws-fmtbar-holder 本身就是 <span>、里面装着
    // <div class="ws-fmtbar-swatches">，不排除的话这条断言会咬到编辑器自己的 chrome（实测误报 2）。
    return [...d.querySelectorAll('span ul, span ol, span li, span p, span table, span div')]
      .filter((e) => !e.closest('[data-ws2-ui]')).length;
  });
  expect(swallowed, '保真红线：任何一个 span 都不许含块级元素').toBe(0);
  // 文字一个不少、一个不多（原来这两条就在，保留）
  await expect(frame.locator('#a')).toHaveText('第一项有内容');
  await expect(frame.locator('#b')).toHaveText('第二项也有内容');
});

// ── 多选批量上色（Wendi 2026-08-05）────────────────────────────────────────────────
// 病灶：wrapInlineStyle / wrapMark 按 LI/P 粒度判跨块并拒绝 → 一旦选中多行，点颜色**静默无反应**。
// 而同一个气泡里的加粗早就能跨多行（execText 按块切段逐块执行）——是能力缺口，不是设计取舍。
// 修法：颜色/高亮改走同一套切段骨架，wrapInlineStyle 每次只见单块，红线一寸没退。
const FIVE = '<p id="pre">前段</p><ul id="L" class="ws-todo">'
  + [1, 2, 3, 4, 5].map((i) => `<li id="r${i}">待办第 ${i} 条</li>`).join('') + '</ul><p id="post">后段</p>';
const selectAcross = (a, b) => page.evaluate((q) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const A = d.querySelector(q.a), B = d.querySelector(q.b);
  const r = d.createRange(); r.setStart(A.firstChild || A, 0);
  const last = B.lastChild || B;
  r.setEnd(last, last.nodeType === 3 ? last.nodeValue.length : last.childNodes.length);
  const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  d.dispatchEvent(new Event('selectionchange'));
}, { a, b });
// 直接驱动气泡里的色板（格子常在视口外，点击会被可见性挡住 → 用事件派发）
const pickSwatch = (kind) => page.evaluate((k) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const fb = d.querySelector('.ws-fmtbar'); if (!fb) return 'no-fmtbar';
  const pops = [...fb.querySelectorAll('.ws-fmtbar-swatches')];
  const pop = pops[k === 'hilite' ? 1 : 0]; if (!pop) return 'no-pop';
  pop.style.display = 'flex';
  const sws = [...pop.querySelectorAll('button.ws-fmtbar-swatch')];
  if (sws.length < 3) return 'too-few';
  sws[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return 'ok';
}, kind);
const inlineShape = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return {
    色span: d.querySelectorAll('span[style*="color"]').length,
    高亮: d.querySelectorAll('mark').length,
    // 排除编辑器自己的浮层（.ws-fmtbar-holder 是 <span> 且内含 <div>，会误报——实测踩过）
    span吞块: [...d.querySelectorAll('span ul, span ol, span li, span p, span table, span div')]
      .filter((e) => !e.closest('[data-ws2-ui]')).length,
    合规: WS2SchemaRegistry.classify(new DOMParser().parseFromString(WS2Serialize.serializeDocument(d), 'text/html')).conform,
  };
});

test('MS-1 同一张列表内选 4 行 → 每行各自上色（修前：零反应）', async () => {
  await launch();
  await openDoc(FIVE);
  await frame.locator('#r1').click(); await page.waitForTimeout(200);
  await selectAcross('#r1', '#r4'); await page.waitForTimeout(300);
  expect(await pickSwatch('color')).toBe('ok');
  await page.waitForTimeout(400);
  const s = await inlineShape();
  expect(s.色span, '选了 4 行就该有 4 段上色').toBe(4);
  expect(s.span吞块).toBe(0);
  expect(s.合规).toBe(true);
});

test('MS-2 真跨块（段落 + 5 行列表 + 段落）→ 7 个块各自上色', async () => {
  await launch();
  await openDoc(FIVE);
  await frame.locator('#pre').click(); await page.waitForTimeout(200);
  await selectAcross('#pre', '#post'); await page.waitForTimeout(300);
  expect(await pickSwatch('color')).toBe('ok');
  await page.waitForTimeout(500);
  const s = await inlineShape();
  expect(s.色span, '前段 + 5 行 + 后段 = 7 段').toBe(7);
  expect(s.span吞块).toBe(0);
  expect(s.合规).toBe(true);
});

test('MS-3 多选高亮同款（不止文字色）', async () => {
  await launch();
  await openDoc(FIVE);
  await frame.locator('#r1').click(); await page.waitForTimeout(200);
  await selectAcross('#r1', '#r3'); await page.waitForTimeout(300);
  expect(await pickSwatch('hilite')).toBe('ok');
  await page.waitForTimeout(400);
  const s = await inlineShape();
  expect(s.高亮).toBe(3);
  expect(s.span吞块).toBe(0);
  expect(s.合规).toBe(true);
});

test('MS-4 保真红线：选区里有带子列表的行，span 绝不能吞掉那个 <ul>', async () => {
  await launch();
  await openDoc('<p id="pre">前</p><ul id="L"><li id="r1">一<ul><li id="n1">子甲</li><li id="n2">子乙</li></ul></li><li id="r2">二</li></ul><p id="post">后</p>');
  await frame.locator('#pre').click(); await page.waitForTimeout(200);
  await selectAcross('#pre', '#post'); await page.waitForTimeout(300);
  expect(await pickSwatch('color')).toBe('ok');
  await page.waitForTimeout(500);
  const s = await inlineShape();
  // 宿主行「一」自己那段、两个子项、前后两段 —— 各自一个 span，一个都不许圈住嵌套 <ul>
  expect(s.色span).toBe(6);
  expect(s.span吞块, '这条就是红线本身：任何 span 含块级元素都算改坏文档').toBe(0);
  expect(s.合规).toBe(true);
});
