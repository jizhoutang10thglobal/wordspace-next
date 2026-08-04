// 块末 Delete 前向合并撞上列表全 no-op，与 Backspace 侧（bug3 #319）不对称（select-3）。
// 病根：Delete 分支两处显式排除列表 + 原生跨不出独立块边界。修法：镜像 Backspace 三场景
// （末项尾并下一块 / 段末吞列表首项 / 空 li 并下一项）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2delfwd-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title><style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('末项尾 Delete 吞下一段落：内容并入末项、光标在接合点（select-3 a）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>甲</li><li id="last">丙</li></ul><p id="p9">尾段</p>');
  await frame.locator('#last').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('#p9').count(), { message: '下一段落应被吞掉' }).toBe(0);
  expect(await frame.locator('#last').textContent(), '内容并入末项').toBe('丙尾段');
  await page.keyboard.type('x'); // 光标应在接合点（丙 与 尾段 之间）
  await expect.poll(() => frame.locator('#last').textContent(), { message: '光标在接合点，x 落中间' }).toBe('丙x尾段');
  expect(await conformOf(await serialize())).toBe(true);
});

test('段末 Delete 吞列表首项：首项并入段落、列表剩余保留、光标在接合点（select-3 b）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="lst" class="ws-todo"><li>甲</li><li data-checked="true">乙</li><li>丙</li></ul>');
  await frame.locator('#p0').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('#p0').textContent(), { message: '首项行内内容并入段落' }).toBe('前段甲');
  expect(await frame.locator('#lst > li').count(), '列表剩 2 项').toBe(2);
  await page.keyboard.type('x');
  await expect.poll(() => frame.locator('#p0').textContent(), { message: '光标在接合点' }).toBe('前段x甲');
  expect(await conformOf(await serialize())).toBe(true);
});

test('空 li Delete：下一项并上来（select-3 c）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="e"><br></li><li>乙</li></ul>');
  await frame.locator('#e').click();
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('#lst > li').count(), { message: '空项吞下一项 → 剩 1 项' }).toBe(1);
  expect(await frame.locator('#lst > li').first().textContent()).toBe('乙');
  expect(await conformOf(await serialize())).toBe(true);
});

test('末项尾 Delete 遇不可并块（图片）：安全 no-op、不崩', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="last">丙</li></ul><figure id="fig"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></figure>');
  await frame.locator('#last').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(120);
  expect(await frame.locator('#lst > li').count(), '不可并 → 列表不变').toBe(1);
  expect(await frame.locator('#fig').count(), '图片块保留').toBe(1);
  expect(await conformOf(await serialize())).toBe(true);
});

test('空段落 Delete 吞列表首项：不留前导空行 br（对抗审查 P2）', async () => {
  await launch();
  await openDoc('<p id="p0"><br></p><ul id="lst" class="ws-todo"><li>甲</li><li>乙</li></ul>');
  await frame.locator('#p0').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('#p0').textContent(), { message: '首项并入空段落' }).toBe('甲');
  const firstNode = await frame.locator('#p0').evaluate((p) => p.firstChild ? p.firstChild.nodeName : null);
  expect(firstNode, '段落首节点不该是 br（无前导空行）').not.toBe('BR');
  expect(await conformOf(await serialize())).toBe(true);
});

test('空末项 Delete 吞下一段落：不留前导空行 br（对抗审查 P2）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>甲</li><li id="last"><br></li></ul><p id="p9">尾段</p>');
  await frame.locator('#last').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('#last').textContent(), { message: '下一段并入空末项' }).toBe('尾段');
  const firstNode = await frame.locator('#last').evaluate((l) => l.firstChild ? l.firstChild.nodeName : null);
  expect(firstNode, '末项首节点不该是 br（无前导空行）').not.toBe('BR');
  expect(await conformOf(await serialize())).toBe(true);
});

test('空项 Delete 吞已勾下一项：采纳其勾选态（对抗审查 P3——删空行不清邻项勾选）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="e"><br></li><li data-checked="true">乙</li></ul>');
  await frame.locator('#e').click();
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('#lst > li').count()).toBe(1);
  const merged = await frame.locator('#lst > li').first().evaluate((l) => ({ text: l.textContent.trim(), checked: l.getAttribute('data-checked') }));
  expect(merged.text).toBe('乙');
  expect(merged.checked, '合并后保留下一项的勾选态').toBe('true');
  expect(await conformOf(await serialize())).toBe(true);
});

// E1（2026-08-04）预期迁移：语义从「一次退格即合并」改成 Notion 的两步剥离。
// **为什么新预期才是对的**：Notion 对拍实证（探针 E1-a/E1-c/E1-d）第一次按键只剥格式、原地变文本、
// 不合并，第二次才并入上一块。Colin 拍板「Notion 怎么做我们怎么做」。
// **#319 守住了什么**：Wendi 报的是「行首退格**什么都不发生**」——本用例守的是「有反应且最终能上移」。
// 所以这里**没有把断言删弱**：终态断言 `#p0 === '上甲'` 原样保留，只是在它前面**补上**第一步的中间态
// 断言（行必须已变成非列表的文本块、且此时**尚未**合并）。少了任一条都不算过。
test('回归：首项行首 Backspace —— ① 剥成文本块不合并 ② 再退才并入上一段落（#319 守住「有反应」）', async () => {
  await launch();
  await openDoc('<p id="p0">上</p><ul id="lst" class="ws-todo"><li id="f">甲</li></ul>');
  await frame.locator('#f').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  // ① 中间态：整张单项列表退成段落（marker/勾选框消失），内容原位，**没有**并进上一块
  // 注意查 `ul#lst` 不是 `#lst`：retagElement 保留 id，剥离后是 <p id="lst">，只查 #lst 会误判成「列表还在」
  await expect.poll(() => frame.locator('ul#lst').count(), { message: '① 列表已被剥掉（唯一项 → 整块 de-list）' }).toBe(0);
  expect(await frame.locator('#p0').textContent(), '① 此时绝不能已经合并（Notion 第一次不合并）').toBe('上');
  const mid = await frame.locator('body').evaluate((b) => [...b.children].map((c) => c.tagName + ':' + c.textContent.trim()).join('|'));
  expect(mid, '① 剥离产物是紧跟其后的独立文本块').toBe('P:上|P:甲');
  expect(await conformOf(await serialize()), '① 中间态也必须是合规字节（会被自动保存写盘）').toBe(true);
  // ② 再退一次 → 回到 #319 当初要的终态
  await page.keyboard.press('Backspace');
  await expect.poll(() => frame.locator('#p0').textContent(), { message: '② #319 终态：并入上一块' }).toBe('上甲');
  expect(await conformOf(await serialize())).toBe(true);
});
