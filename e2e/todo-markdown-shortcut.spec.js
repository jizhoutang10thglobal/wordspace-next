// markdown「[] 」建待办后继续打字必须落进项（create-1）。
// 病根：tryMarkdown 清 marker 时 innerHTML='' 抹掉占位 <br>，turnInto 列表分支把空内容包成裸
// <li></li>；ws-todo list-style:none 让空 li 无 line box、高度 0，Blink 落不住 caret、后续输入被吞。
// 修法：turnInto 列表分支包出的空 li 补 <br>（对齐斜杠路径产物）。CI 用 xvfb 真启动 Electron。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2mdshort-'));
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
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

// 进一个干净的空编辑态正文块：seed 非空 p → 点进 → End → Enter 新建空块（editingEl = 新空 p）。
async function freshEmptyBlock() {
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
}

test('markdown「[] 」建 todo 后继续打字不丢（死块修复）', async () => {
  await launch();
  await openDoc('<p id="p1">正文</p>');
  await freshEmptyBlock();
  await page.keyboard.type('[] '); // 触发转 todo
  await expect.poll(() => frame.locator('ul.ws-todo > li').count(), { message: '「[] 」应转成 ws-todo 列表' }).toBe(1);
  await page.keyboard.type('abc'); // bug：零高死块会把这三个字吞掉
  await expect.poll(() => frame.locator('ul.ws-todo > li').first().textContent(), { message: '转换后打字必须落进待办项' }).toBe('abc');
  expect(await conformOf(await serialize())).toBe(true);
});

test('markdown「[] 」转换产物非零高、含子节点（可落 caret）', async () => {
  await launch();
  await openDoc('<p id="p1">正文</p>');
  await freshEmptyBlock();
  await page.keyboard.type('[] ');
  await expect.poll(() => frame.locator('ul.ws-todo > li').count()).toBe(1);
  const info = await frame.locator('ul.ws-todo > li').first().evaluate((li) => ({ kids: li.childNodes.length, h: li.getBoundingClientRect().height }));
  expect(info.kids, '空 li 必须至少有一个子节点（<br> 占位）').toBeGreaterThan(0);
  expect(info.h, '空 todo li 必须有可视高度（否则 Blink 落不住 caret）').toBeGreaterThan(0);
});

test('回归：markdown「- 」建普通 bullet 后打字正常（不误伤既有路径）', async () => {
  await launch();
  await openDoc('<p id="p1">正文</p>');
  await freshEmptyBlock();
  await page.keyboard.type('- ');
  await expect.poll(() => frame.locator('ul:not(.ws-todo) > li').count(), { message: '「- 」应转成普通 bullet' }).toBe(1);
  await page.keyboard.type('xyz');
  await expect.poll(() => frame.locator('ul:not(.ws-todo) > li').first().textContent()).toBe('xyz');
  expect(await conformOf(await serialize())).toBe(true);
});

test('U18：空块「[x] 」→ 勾选待办，继续打字落入（create-7）', async () => {
  await launch();
  await openDoc('<p id="p1">正文</p>');
  await freshEmptyBlock();
  await page.keyboard.type('[x] ');
  await expect.poll(() => frame.locator('ul.ws-todo > li').count()).toBe(1);
  expect(await frame.locator('ul.ws-todo > li').first().getAttribute('data-checked'), '[x] 产勾选项').toBe('true');
  await page.keyboard.type('已完成');
  await expect.poll(() => frame.locator('ul.ws-todo > li').first().textContent()).toBe('已完成');
  expect(await conformOf(await serialize())).toBe(true);
});

test('U18：块首带字打「[] 」（前缀触发）→ 转 todo 且既有文字保留', async () => {
  await launch();
  await openDoc('<p id="p1">正文</p>');
  await freshEmptyBlock();
  await page.keyboard.type('买菜'); // 先有文字
  await page.keyboard.press('Home'); // 光标回块首
  await page.keyboard.type('[] '); // 块首打 marker+空格
  await expect.poll(() => frame.locator('ul.ws-todo > li').count(), { message: '前缀触发转 todo' }).toBe(1);
  await expect.poll(() => frame.locator('ul.ws-todo > li').first().textContent()).toBe('买菜');
  expect(await conformOf(await serialize())).toBe(true);
});

test('U18 负例：段落含「- x」删掉 x 后 caret 停 marker 末 → 不转换（删除路径不误触发）', async () => {
  await launch();
  // 直接开一个字面含「- x」的段落（不经打字自动转换）——模拟粘贴/既有文本里 caret 恰停 marker 末的场景。
  // 删「x」剩「- 」是 deleteContentBackward，不是敲空格那击，绝不能触发 markdown 转换（否则退格误转列表）。
  await openDoc('<p id="p1">- x</p>');
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace'); // 删 x → 「- 」，caret 停 marker 末
  await page.waitForTimeout(120);
  expect(await frame.locator('ul').count(), '删字到 marker 末不该误转成列表').toBe(0);
  const ptxt = (await frame.locator('p').first().textContent()).replace(/\u00a0/g, ' '); // 尾随空格被 Chromium 存成 nbsp，归一后比对
  expect(ptxt).toBe('- ');
});

test('U18：非 1 起始序号「3. 」→ ol start=3、conform', async () => {
  await launch();
  await openDoc('<p id="p1">正文</p>');
  await freshEmptyBlock();
  await page.keyboard.type('3. ');
  await expect.poll(() => frame.locator('ol').count()).toBe(1);
  expect(await frame.locator('ol').first().getAttribute('start'), 'ol start=3').toBe('3');
  await page.keyboard.type('第三项');
  expect(await conformOf(await serialize())).toBe(true);
});

// 对抗审查（PR-D 两名 reviewer 独立复现）：U18 去 $ 锚点后，触发只校验「敲了空格」不校验「空格紧邻 marker」，
// 导致既有「- 文本」段落任意位置敲空格就误转 + 吞 marker；内容裹在行内元素里更会清空整块丢数据。
test('U18 对抗审查 Defect2：既有段落「- hello」末尾敲空格不误转、不吞 marker', async () => {
  await launch();
  await openDoc('<p id="p1">- hello</p>'); // 磁盘/粘贴来的合规段落，load 不转换
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' '); // 敲空格，但不是补全 marker 那一击（caret 在文本末尾、远离 marker）
  await page.waitForTimeout(120);
  expect(await frame.locator('ul,ol').count(), '非补全 marker 的空格不该转列表').toBe(0);
  const t = await frame.locator('#p1').textContent();
  expect(t.startsWith('- hello'), 'marker 不被吞').toBe(true);
});

test('U18 对抗审查 Defect2b：光标在文本中段敲空格不误转（触发点须紧邻 marker）', async () => {
  await launch();
  await openDoc('<p id="p1">- 甲乙</p>');
  await frame.locator('#p1').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); // 跨过「- 甲」
  await page.keyboard.type(' '); // 中段空格
  await page.waitForTimeout(120);
  expect(await frame.locator('ul,ol').count(), '中段空格不该转列表').toBe(0);
});

test('U18 对抗审查 Defect1：内容裹在行内元素里前缀触发不清空整块（防数据丢失）', async () => {
  await launch();
  await openDoc('<p id="p1"><b>加粗内容</b></p>');
  await frame.locator('#p1').click();
  await page.keyboard.press('Home');
  await page.keyboard.type('# '); // marker 被打进 <b> 里，firstChild 是元素节点、非文本节点
  await page.waitForTimeout(120);
  const bodyText = await frame.locator('body').textContent();
  expect(bodyText.includes('加粗内容'), '内容绝不能丢失').toBe(true);
  expect(await frame.locator('b').count(), '<b> 仍在').toBeGreaterThan(0);
  expect(await frame.locator('h1,ul,ol').count(), 'firstChild 非文本节点 → 不转换').toBe(0);
});
