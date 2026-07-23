// 嵌套子列表空项 Enter/Backspace 锚定顶层 ul（keys-3）+ Shift-Tab 反缩进不收编后继兄弟致错序（keys-5）。
// 修法：空项分支改锚 li.parentElement（真实父列表），嵌套空项 Enter→outdent、Backspace→落宿主末尾；
// Shift-Tab 出列前 absorbTrailingSiblings 收编后继兄弟为其子项（共享 helper）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2nestkey-'));
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
// 全文按文档顺序取所有 li 的 trim 文本（含嵌套）
const allLiText = () => frame.locator('#lst').evaluate((ul) => [...ul.querySelectorAll('li')].map((l) => l.childNodes[0] && l.childNodes[0].nodeType === 3 ? l.childNodes[0].textContent.trim() : (l.firstChild && l.firstChild.nodeName === 'BR' ? '' : (l.textContent || '').trim())));
const emptyNestedUls = () => frame.locator('#lst').evaluate((ul) => [...ul.querySelectorAll('ul,ol')].filter((u) => !u.querySelector('li')).length);

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('嵌套空项 Enter → outdent 成顶层项、无幽灵空 ul、光标在其内（keys-3）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="host">宿主<ul class="ws-todo"><li id="empty"><br></li></ul></li><li id="tail">尾项</li></ul>');
  await frame.locator('#empty').click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  // #empty 成为 #lst 的直接子（顶层项），在 host 与 tail 之间
  const topIds = await frame.locator('#lst > li').evaluateAll((els) => els.map((l) => l.id));
  expect(topIds, 'empty 出列成顶层项，夹在 host 与 tail 之间').toEqual(['host', 'empty', 'tail']);
  expect(await frame.locator('#host > ul').count(), 'host 的空嵌套 ul 应被移除').toBe(0);
  expect(await emptyNestedUls(), '无幽灵空 ul').toBe(0);
  await page.keyboard.type('X'); // 光标应在 empty 内
  await expect.poll(() => frame.locator('#empty').textContent()).toBe('X');
  expect(await conformOf(await serialize())).toBe(true);
});

test('嵌套空项 Backspace → 光标落宿主 li 末尾、无幽灵空 ul（keys-4 镜像）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="host">宿主<ul class="ws-todo"><li id="empty"><br></li></ul></li><li id="tail">尾项</li></ul>');
  await frame.locator('#empty').click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  expect(await frame.locator('#host > ul').count(), 'host 的空嵌套 ul 应被移除').toBe(0);
  expect(await emptyNestedUls(), '无幽灵空 ul').toBe(0);
  await page.keyboard.type('Y'); // 光标应在宿主末尾
  await expect.poll(() => frame.locator('#host').textContent()).toBe('宿主Y');
  expect(await conformOf(await serialize())).toBe(true);
});

test('嵌套两项（前非空+后空）Backspace → 并入前项', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="host">宿主<ul class="ws-todo"><li id="s1">子甲</li><li id="s2"><br></li></ul></li></ul>');
  await frame.locator('#s2').click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  expect(await frame.locator('#host > ul > li').count(), '后空项并入前项 → 嵌套剩 1 项').toBe(1);
  expect(await frame.locator('#s1').textContent()).toBe('子甲');
  expect(await conformOf(await serialize())).toBe(true);
});

test('嵌套空项后还有 2 兄弟 → Enter outdent：空项出列成顶层、兄弟留宿主嵌套、打字落入空项', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="host">宿主<ul class="ws-todo"><li id="e"><br></li><li id="s1">兄1</li><li id="s2">兄2</li></ul></li></ul>');
  await frame.locator('#e').click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  // e 出列成顶层项；兄1/兄2 留在宿主嵌套列表（不收编——空项当子列表父项 Chromium 无法在块级 ul 前打字）
  const topIds = await frame.locator('#lst > li').evaluateAll((els) => els.map((l) => l.id));
  expect(topIds, 'e 出列成顶层项（host 之后）').toEqual(['host', 'e']);
  expect(await frame.locator('#host > ul > li').evaluateAll((els) => els.map((l) => l.id)), '兄1/兄2 留在宿主嵌套列表').toEqual(['s1', 's2']);
  expect(await frame.locator('#e > ul').count(), 'e 空项不含子列表').toBe(0);
  await page.keyboard.type('X'); // 光标在 e，打字落入
  await expect.poll(() => frame.locator('#e').textContent()).toBe('X');
  expect(await conformOf(await serialize())).toBe(true);
});

test('回归：顶层空末项双回车退出列表（既有行为不回归）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="a">甲</li><li id="b"><br></li></ul>');
  await frame.locator('#b').click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Enter'); // 空末项 Enter → 退出列表
  await page.waitForTimeout(120);
  expect(await frame.locator('#lst > li').count(), '空末项被删、剩 1 项').toBe(1);
  await expect.poll(() => frame.locator('p').count(), { message: 'ul 后新建正文块' }).toBe(1);
  expect(await conformOf(await serialize())).toBe(true);
});

test('U13：Shift-Tab 反缩进中间子项 → 收编后继兄弟、顺序不乱（keys-5）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="host">宿主<ul class="ws-todo"><li id="sa">子甲</li><li id="sb">子乙</li><li id="sc">子丙</li></ul></li></ul>');
  await frame.locator('#sb').click();
  await page.keyboard.press('End');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(120);
  // sb 出列成顶层项、sc 成为 sb 的子项；文档顺序 宿主→子甲→子乙→子丙
  const topIds = await frame.locator('#lst > li').evaluateAll((els) => els.map((l) => l.id));
  expect(topIds, 'sb 出列成顶层项').toEqual(['host', 'sb']);
  expect(await frame.locator('#host > ul > li').evaluateAll((els) => els.map((l) => l.id)), 'host 子列表剩 子甲').toEqual(['sa']);
  expect(await frame.locator('#sb > ul > li').evaluateAll((els) => els.map((l) => l.id)), '子丙成为 sb 的子项（收编）').toEqual(['sc']);
  expect(await allLiText(), '文档顺序不乱').toEqual(['宿主', '子甲', '子乙', '子丙']);
  expect(await conformOf(await serialize())).toBe(true);
});

test('U13 回归：末位子项 Shift-Tab（无后继）→ 精确出列不误收编', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="host">宿主<ul class="ws-todo"><li id="sa">子甲</li><li id="sc">子丙</li></ul></li></ul>');
  await frame.locator('#sc').click();
  await page.keyboard.press('End');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(120);
  const topIds = await frame.locator('#lst > li').evaluateAll((els) => els.map((l) => l.id));
  expect(topIds).toEqual(['host', 'sc']);
  expect(await frame.locator('#sc > ul').count(), '末位子项出列不产生子列表（无后继可收编）').toBe(0);
  expect(await conformOf(await serialize())).toBe(true);
});

// 对抗审查 P2：Shift-Tab 收编给 li 追加子列表后，光标须落 li 自身文字末尾（在子列表之前），别落子列表之后。
test('Shift-Tab 收编后 → 打字落出列项文字末尾（不落子列表之后，对抗审查 P2）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="host">宿主<ul class="ws-todo"><li>子甲</li><li id="sb">子乙</li><li>子丙</li></ul></li></ul>');
  await frame.locator('#sb').click();
  await page.keyboard.press('End');
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  await page.waitForTimeout(120);
  await page.keyboard.type('X');
  const textBeforeSub = await frame.locator('#sb').evaluate((li) => { const kids = [...li.childNodes]; const ui = kids.findIndex((n) => n.nodeName === 'UL' || n.nodeName === 'OL'); return kids.slice(0, ui < 0 ? kids.length : ui).map((n) => n.textContent).join('').trim(); });
  expect(textBeforeSub, 'X 落在出列项文字末尾（子丙子列表之前）').toBe('子乙X');
  expect(await conformOf(await serialize())).toBe(true);
});

test('U19：Tab 缩进后光标保留在项中原位（不甩项末，keys-8）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="a">第一项</li><li id="b">缩进项</li></ul>');
  await frame.locator('#b').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); // 光标在「缩进|项」
  await page.keyboard.press('Tab'); // 缩进
  await page.waitForTimeout(120);
  await page.keyboard.type('X'); // 应插在原光标处（缩进X项），非项末
  await expect.poll(() => frame.locator('#b').textContent(), { message: 'Tab 后光标保留原位、X 落中间' }).toBe('缩进X项');
  expect(await conformOf(await serialize())).toBe(true);
});
