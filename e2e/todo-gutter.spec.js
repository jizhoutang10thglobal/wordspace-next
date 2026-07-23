// 点勾选框 gutter 只切 data-checked，绝不进编辑态/放光标（check-1）。
// 病根：mousedown 勾选分支 preventDefault 拦不住后续 click；onClick 无 gutter 守卫 → 穿透后 enterEdit(UL)
// 置 contenteditable + focus、光标吸附行首，后续按键直接改条目文字。修法：gutter 判定抽 helper，onClick 也守。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2gutter-'));
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
// 点某 li 的勾选框 gutter（li 内容左缘左侧 ~10px，落在 ul padding 区，clientX < li.left+4 命中）。
async function clickGutter(liSel) {
  const box = await frame.locator(liSel).boundingBox();
  await page.mouse.click(box.x - 10, box.y + box.height / 2);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('冷启动点勾选框：只勾选、不进编辑、后续按键不改文字（check-1）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="li1">买牛奶</li><li id="li2">遛狗</li></ul>');
  await clickGutter('#li1');
  await expect.poll(() => frame.locator('#li1').getAttribute('data-checked'), { message: '点一次勾选框 → 勾选一次' }).toBe('true');
  const st = await frame.locator('body').evaluate(() => ({ active: document.activeElement && document.activeElement.tagName, ce: document.querySelector('ul.ws-todo').getAttribute('contenteditable') }));
  expect(st.active === 'UL', '点勾选框不该让 UL 获焦（进编辑态）').toBe(false);
  expect(st.ce, 'UL 不该被置 contenteditable').toBeFalsy();
  await page.keyboard.type('z'); // 冷点若误进编辑，这个 z 会插进条目
  await page.waitForTimeout(80);
  expect(await frame.locator('#li1').textContent(), '点勾选框后按键绝不改条目文字').toBe('买牛奶');
  expect(await conformOf(await serialize())).toBe(true);
});

test('每次点击恰好翻转一次（click 层不重复 toggle）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="li1">买牛奶</li></ul>');
  await clickGutter('#li1');
  await expect.poll(() => frame.locator('#li1').getAttribute('data-checked')).toBe('true');
  await clickGutter('#li1');
  await expect.poll(() => frame.locator('#li1').getAttribute('data-checked'), { message: '取消勾选删属性、不写 "false"（U26/visual-5）' }).toBe(null);
});

test('回归：编辑该项文字时点勾选框 → 勾选翻转、光标留原位、继续打字落原处', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="li1">买牛奶</li></ul>');
  await frame.locator('#li1').click();
  await page.keyboard.press('End');
  await clickGutter('#li1');
  await expect.poll(() => frame.locator('#li1').getAttribute('data-checked')).toBe('true');
  await page.keyboard.type('X');
  await expect.poll(() => frame.locator('#li1').textContent(), { message: '光标应留在末尾，X 落在末尾' }).toBe('买牛奶X');
  expect(await conformOf(await serialize())).toBe(true);
});

test('U26：勾选→取消 → serialize 无 data-checked 属性（不写 "false"，visual-5）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="li1">买牛奶</li></ul>');
  await clickGutter('#li1');
  await expect.poll(() => frame.locator('#li1').getAttribute('data-checked')).toBe('true');
  await clickGutter('#li1'); // 取消
  await expect.poll(() => frame.locator('#li1').getAttribute('data-checked')).toBe(null);
  const html = await serialize();
  const liChecked = await page.evaluate((h) => new DOMParser().parseFromString(h, 'text/html').querySelectorAll('li[data-checked]').length, html);
  expect(liChecked, '存盘字节里 li 不留 data-checked 脏属性').toBe(0); // 注意别用 /data-checked/ 正则——注入的 ws-todo CSS 选择器文本本身含该串
  expect(await conformOf(html)).toBe(true);
});

test('U26：老文档含 data-checked="false" → 渲染未勾、点一下勾上、再点属性彻底消失', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="li1" data-checked="false">遗留项</li></ul>');
  // 渲染为未勾选（CSS 只认 true）
  await clickGutter('#li1');
  await expect.poll(() => frame.locator('#li1').getAttribute('data-checked')).toBe('true');
  await clickGutter('#li1');
  await expect.poll(() => frame.locator('#li1').getAttribute('data-checked'), { message: '再点 → 属性彻底消失（清洗存量脏字节）' }).toBe(null);
  expect(await frame.locator('li[data-checked]').count(), 'li 上不留任何 data-checked').toBe(0);
});
