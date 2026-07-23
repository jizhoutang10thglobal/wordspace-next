// undo/redo 用 body.innerHTML 整体重写、正在编辑的块被销毁、焦点回落非可编辑 BODY → 之后立刻打字
// 无宿主被静默吞（clip-3，不限 todo）。修法：重写前记录编辑块路径、重写后按路径重进编辑（失效/非可编辑
// 则落首个可编辑块）。undo/redo 走菜单加速器（keyboard Meta+z 不触发菜单加速器 = 假 FAIL）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2undo-'));
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
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
const bodyText = () => frame.locator('body').textContent();

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('todo：undo 后立刻打字不被吞（clip-3）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="a">初始</li></ul>');
  await frame.locator('#a').click();
  await page.keyboard.press('End');
  await page.keyboard.type('AAA');
  await page.waitForTimeout(650); // 让 checkpoint 落（>500ms 防抖）
  await menu('undo');
  await page.waitForTimeout(150);
  await page.keyboard.type('xy'); // 不点击，立刻打字——修前焦点在 body、被吞
  await expect.poll(() => bodyText(), { message: 'undo 后立刻打字必须落进文档（有编辑宿主）' }).toContain('xy');
  expect(await conformOf(await serialize())).toBe(true);
});

test('todo：redo 后立刻打字不被吞', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="a">初始</li></ul>');
  await frame.locator('#a').click();
  await page.keyboard.press('End');
  await page.keyboard.type('AAA');
  await page.waitForTimeout(650);
  await menu('undo');
  await page.waitForTimeout(150);
  await menu('redo');
  await page.waitForTimeout(150);
  await page.keyboard.type('zz'); // redo 后立刻打字
  await expect.poll(() => bodyText(), { message: 'redo 后立刻打字必须落进文档' }).toContain('zz');
  expect(await conformOf(await serialize())).toBe(true);
});

test('非 todo 段落：undo 后立刻打字不被吞（全块型中招）', async () => {
  await launch();
  await openDoc('<p id="p1">段落</p>');
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('AAA');
  await page.waitForTimeout(650);
  await menu('undo');
  await page.waitForTimeout(150);
  await page.keyboard.type('xy');
  await expect.poll(() => bodyText(), { message: '非 todo 块 undo 后也要有打字宿主' }).toContain('xy');
  expect(await conformOf(await serialize())).toBe(true);
});

// 对抗审查 P2：上方结构变动 + 无 checkpoint 导航到下方块 + undo → pre-undo 下标套 post-undo 树落无关块。
// id 恢复兜住锚点块（有 id）这一常见子集：undo 后按 id 精确找回原编辑块，打字落对块。
test('锚点块：结构变动后 undo，打字落回原 id 块（非相邻错块）', async () => {
  await launch();
  await openDoc('<p id="a">AAA</p><p id="b">BBB</p><p id="c">CCC</p>');
  await frame.locator('#a').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter'); // a 后插新块（上方结构变动）
  await page.keyboard.type('X');
  await page.waitForTimeout(650); // checkpoint
  await frame.locator('#c').click(); // 无 checkpoint 导航到下方 #c
  await page.keyboard.press('End');
  await menu('undo'); // undo → 新块+X 消失，#c 下标左移
  await page.waitForTimeout(150);
  await page.keyboard.type('Z'); // 按 id 恢复应落回 #c（path-only 会落到旧下标处的无关块）
  await expect.poll(() => frame.locator('#c').textContent(), { message: 'undo 后打字应落回原 id 编辑块' }).toBe('CCCZ');
  expect(await conformOf(await serialize())).toBe(true);
});

test('fallback：undo 后原编辑块已不存在 → 打字落首个可编辑块、不被吞', async () => {
  await launch();
  await openDoc('<p id="p1">段落</p>');
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter'); // 新建第二块，editingEl = 新块
  await page.keyboard.type('新块内容');
  await page.waitForTimeout(650);
  await menu('undo'); // undo → 新块消失，原 editingEl 路径失效
  await page.waitForTimeout(150);
  await page.keyboard.type('尾'); // 路径失效 → 落首个可编辑块
  await expect.poll(() => bodyText(), { message: '编辑块被 undo 掉后，打字仍有宿主（落首个可编辑块）' }).toContain('尾');
  expect(await conformOf(await serialize())).toBe(true);
});

test('U20：打字后立刻点勾选，undo 只回退勾选、打字仍在（check-3）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="a">初</li></ul>');
  await frame.locator('#a').click();
  await page.keyboard.press('End');
  await page.keyboard.type('abc'); // 打字（进 500ms 防抖窗口）
  await page.waitForTimeout(120); // <500ms，pending 未落
  const box = await frame.locator('#a').boundingBox();
  await page.mouse.click(box.x - 10, box.y + box.height / 2); // 窗口内点勾选框
  await expect.poll(() => frame.locator('#a').getAttribute('data-checked')).toBe('true');
  await menu('undo'); // 一步 undo
  await page.waitForTimeout(150);
  expect(await frame.locator('#a').getAttribute('data-checked'), 'undo 回退勾选').not.toBe('true');
  await expect.poll(() => frame.locator('#a').textContent(), { message: '打字不被同一 undo 吞掉' }).toBe('初abc');
  expect(await conformOf(await serialize())).toBe(true);
});
