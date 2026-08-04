// E1/E2 行首退格「逐层剥离」门（2026-08-04，Colin 拍板「Notion 怎么做我们怎么做」）
// Notion 对拍实证（fixture「对拍fixture-E1补测-v2」，每条都用哨兵字符自证过光标落点）：
//   顶层列表行 ① 剥掉列表格式、原地变文本块、列表在此劈开、**不合并**；② 才并入上一块
//   空行 / 唯一行 / 已勾选待办  → 同一条规则（勾选态随格式一并丢弃）
//   嵌套行 ① 是「嵌套的文本块」→ 我们文法表达不了，压成 Notion 的 ②（并入前兄弟 / 宿主行文字）= 现有行为
//   标题块 → **不剥格式，直接合并**（与列表/toggle 不同，别一起改）
//   折叠块标题 ① toggle→文本块（体内块跟着）；我们 <p> 不能有子 → 一步到位提升为其后的兄弟
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, docPath;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2peel-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>${body}</body></html>`;
  docPath = path.join(tmpDir, 'doc-' + Date.now() + '.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(450);
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conform = async () => page.evaluate((x) => { const d = new DOMParser().parseFromString(x, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, await serialize());
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
// 形态串：顶层块的标签 + 文字（含标签自身属性无关），足以判「劈开 / 位置 / 合并」三件事
const shape = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].map((el) => el.tagName + '[' + (el.textContent || '').trim().replace(/\s+/g, '') + ']').join(' ');
});
// 光标落到某行行首：点进该行再 Home（走真实导航路径，不用程序化 range——那会绕过 enterEdit）
async function caretAtRowStart(sel) {
  await frame.locator(sel).click();
  await page.keyboard.press('Home');
  await page.waitForTimeout(140);
}
const BS = async () => { await page.keyboard.press('Backspace'); await page.waitForTimeout(260); };

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('E1-1 顶层圆点【中间】行：① 原地剥成文本、列表劈成两段、不合并；② 才并入上一块末项文字', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L"><li id="a">甲</li><li id="b">乙</li><li id="c">丙</li></ul>');
  await caretAtRowStart('#b');
  await BS();
  expect(await shape(), '① 劈成「前段 / 甲 / 段落乙 / 丙」，乙原地不动').toBe('P[前段] UL[甲] P[乙] UL[丙]');
  expect(await conform(), '① 中间态合规（会被自动保存写盘）').toBe(true);
  await BS();
  expect(await shape(), '② 并入上一块的【末项文字】，不是多出一个列表项').toBe('P[前段] UL[甲乙] UL[丙]');
  expect(await conform()).toBe(true);
});

test('E1-2 顶层【首】行：① 剥离后前面没有列表残段；② 并入上一段落', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L"><li id="a">甲</li><li id="b">乙</li></ul>');
  await caretAtRowStart('#a');
  await BS();
  expect(await shape(), '① 首行剥出成段落、剩余行留在原列表').toBe('P[前段] P[甲] UL[乙]');
  await BS();
  expect(await shape(), '② 并入上一段落').toBe('P[前段甲] UL[乙]');
  expect(await conform()).toBe(true);
});

test('E1-3 编号列表：剥离【中间】行后，前段序号不变（保 start），后段从 1 重排', async () => {
  await launch();
  await openDoc('<ol id="L" start="5"><li id="a">五</li><li id="b">六</li><li id="c">七</li></ol>');
  await caretAtRowStart('#b');
  await BS();
  const ols = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.querySelectorAll(':scope > ol')].map((o) => ({ start: o.getAttribute('start'), txt: o.textContent.trim() }));
  });
  expect(ols.length, '劈成两张 ol').toBe(2);
  expect(ols[0].start, '前段必须继承 start=5（分割点之前的序号一个都不该变）').toBe('5');
  expect(ols[1].start, '后段不带 start = 从 1 重排').toBeNull();
  expect(await shape()).toBe('OL[五] P[六] OL[七]');
  // 反哑门：产物段落不许把 start 属性带走（曾把 start 搬到 <p> 上写进磁盘 = 垃圾属性）
  expect(await serialize(), '产物段落不得携带 start 属性').not.toMatch(/<p[^>]*\sstart=/);
  expect(await conform()).toBe(true);
});

test('E1-4 已勾选待办行剥离：变成普通段落、勾选态随格式一并丢弃（Notion 同款）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L" class="ws-todo"><li data-checked="true" id="a">已勾</li><li data-checked="false" id="b">未勾</li></ul>');
  await caretAtRowStart('#a');
  await BS();
  expect(await shape()).toBe('P[前段] P[已勾] UL[未勾]');
  const html = await serialize();
  expect(html, '产物段落不得残留 data-checked').not.toMatch(/<p[^>]*data-checked/);
  expect(html, '剩下那项的勾选态不受影响').toMatch(/data-checked="false"/);
  expect(await conform()).toBe(true);
});

test('E1-5 顶层【空】行剥离：变空段落、绝不留 <ul></ul> ghost、光标不丢（Wendi bug4 护栏）', async () => {
  await launch();
  // 空项带 <br>：编辑器自己造的空行就是这个形态；写成 <li></li> 高度为 0、Playwright 判定不可见点不到
  await openDoc('<ul id="L" class="ws-todo"><li id="a">甲</li><li id="b"><br></li><li id="c">丙</li></ul>');
  await frame.locator('#b').click();
  await page.waitForTimeout(140);
  await BS();
  expect(await shape()).toBe('UL[甲] P[] UL[丙]');
  expect(await serialize(), '绝不留无 li 的空列表').not.toMatch(/<ul[^>]*>\s*<\/ul>/);
  const ed = await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; const e = d.querySelector('[contenteditable="true"]'); return e ? e.tagName : null; });
  expect(ed, '光标落在剥出来的段落里').toBe('P');
  expect(await conform()).toBe(true);
});

test('E1-6 唯一行列表：一次剥离即整块 de-list 成段落', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L"><li id="a">独苗</li></ul>');
  await caretAtRowStart('#a');
  await BS();
  expect(await shape()).toBe('P[前段] P[独苗]');
  expect(await serialize()).not.toMatch(/<ul/);
  expect(await conform()).toBe(true);
});

test('E1-7 带子项的顶层行剥离：子项一个都不能丢（降级成顶层列表接在产物后）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">甲</li><li id="b">乙<ul><li>乙1</li><li>乙2</li></ul></li><li id="c">丙</li></ul>');
  // 带子树的行：几何中心落在【子列表】上，click() 默认点中心会把光标丢进子项 → 必须瞄父行那条文字行
  await frame.locator('#b').click({ position: { x: 20, y: 8 } });
  await page.keyboard.press('Home');
  await page.waitForTimeout(140);
  await BS();
  expect(await shape(), '子项作为条目仍存在，不是被拍成文字塞进段落').toBe('UL[甲] P[乙] UL[乙1乙2] UL[丙]');
  // 反哑门：必须是两个真 <li> 节点，不是文字里恰好含「乙1乙2」
  const subCount = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.querySelectorAll(':scope > ul')].map((u) => u.querySelectorAll(':scope > li').length);
  });
  expect(subCount, '三张顶层 ul 的直接 li 数：甲=1 / 子树=2 / 丙=1').toEqual([1, 2, 1]);
  expect(await conform()).toBe(true);
});

test('E1-8 嵌套行【不走剥离】：一次退格直接并入前兄弟（= Notion 的第②步，文法所限压成一步）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">父<ul><li id="n1">子甲</li><li id="n2">子乙</li><li id="n3">子丙</li></ul></li></ul>');
  await caretAtRowStart('#n2');
  await BS();
  const nested = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#L > li > ul > li')].map((li) => li.textContent.trim());
  });
  expect(nested, '子乙并入子甲，子丙原地不动、仍在父下').toEqual(['子甲子乙', '子丙']);
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.body.children.length), '顶层块数不变（绝不把嵌套行抽成顶层块）').toBe(1);
  expect(await conform()).toBe(true);
});

test('E1-9 标题块行首退格：直接合并、**不剥格式**（与列表/toggle 分道，别一起改）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><h2 id="h">标题</h2>');
  await caretAtRowStart('#h');
  await BS();
  expect(await shape(), '一次按键就并入上一块（没有「先变成 P[标题]」这个中间态）').toBe('P[前段标题]');
  expect(await conform()).toBe(true);
});

test('E1-10 连按不出死键：剥离 → 删空段落 → 光标回列表末项 → 还能继续剥（今日引入的回归）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L" class="ws-todo"><li id="a"></li><li id="b">乙</li></ul>');
  await frame.locator('#b').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(140);
  const seq = [];
  for (let i = 0; i < 5; i++) { await BS(); seq.push(await shape()); }
  expect(seq, '五次退格必须步步有变化，绝不出现「连按纹丝不动」的死键').toEqual([
    'P[前段] UL[]',        // 删掉「乙」
    'P[前段] UL[] P[]',    // 空行剥成空段落
    'P[前段] UL[]',        // 空段落被删，光标回到列表末项【内】（这一步曾把光标停在 <ul> 层 → 后续全哑）
    'P[前段] P[]',         // 末项也是空的顶层行 → 整块 de-list
    'P[前段]',             // 空段落并入前段
  ]);
  expect(await conform()).toBe(true);
});

test('E1-11 剥离可一步 undo 还原（不留中间态）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">甲</li><li id="b">乙</li><li id="c">丙</li></ul>');
  await caretAtRowStart('#b');
  await BS();
  expect(await shape()).toBe('UL[甲] P[乙] UL[丙]');
  await menu('undo');
  await page.waitForTimeout(420);
  expect(await shape(), 'undo 一步回到原列表').toBe('UL[甲乙丙]');
  expect(await conform()).toBe(true);
});

test('E2-1 折叠块标题行首退格：① 降级成段落、体内块提升为其后兄弟（不再是零反馈死胡同）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><details open id="D"><summary id="S">标题</summary><p id="b1">体一</p><p id="b2">体二</p></details>');
  await frame.locator('#S').click();
  await page.keyboard.press('Home');
  await page.waitForTimeout(140);
  await BS();
  expect(await shape(), '① toggle 消失，标题成段落，体内两块按序提到其后').toBe('P[前段] P[标题] P[体一] P[体二]');
  expect(await serialize(), '磁盘不再有 details').not.toMatch(/<details/);
  expect(await conform()).toBe(true);
  await BS();
  expect(await shape(), '② 再退一次并入上一块').toBe('P[前段标题] P[体一] P[体二]');
  expect(await conform()).toBe(true);
});

test('E2-2 折叠【态】下按也降级（内容不会因为收着就丢）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><details id="D"><summary id="S">标题</summary><p id="b1">藏起来的正文</p></details>');
  await frame.locator('#S').click();
  await page.keyboard.press('Home');
  await page.waitForTimeout(140);
  await BS();
  expect(await shape()).toBe('P[前段] P[标题] P[藏起来的正文]');
  expect(await conform()).toBe(true);
});

test('E2-3 空折叠块标题退格：解包成空段落、光标落得进去（逃生路径不回归）', async () => {
  await launch();
  await openDoc('<details open id="D"><summary id="S"></summary><p id="b1"></p></details>');
  await frame.locator('#S').click();
  await page.waitForTimeout(140);
  await BS();
  expect(await serialize(), '不再有 details').not.toMatch(/<details/);
  const ed = await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; const e = d.querySelector('[contenteditable="true"]'); return e ? e.tagName : null; });
  expect(ed, '光标落进解包出来的段落（空产物必须带 <br> 才装得住 selection）').toBe('P');
  await page.keyboard.type('还能打字');
  await expect.poll(async () => await shape()).toContain('还能打字');
  expect(await conform()).toBe(true);
});
