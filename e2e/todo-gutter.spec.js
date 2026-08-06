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
// 勾选框与文字的横向坐标一律**从真实渲染推导**，返回相对 li 左缘的偏移。
// ⚠ U2（2026-08-06）把勾选框从 li 盒**外**（ul 的 padding 区）挪进了盒内，原来写死的
// 「li.left 减常数」坐标当场全部失配——这个 helper 就是为了不再有第二次。
const dxOf = (liSel) => frame.locator(liSel).evaluate((el) => {
  const win = el.ownerDocument.defaultView;
  const cs = win.getComputedStyle(el, '::before');
  const own = win.getComputedStyle(el);
  const bw = parseFloat(own.borderLeftWidth) || 0; // 透明左边框：::before/padding 都相对 padding 盒，而坐标要相对边框盒
  const cbL = bw + (parseFloat(cs.left) || 0);
  const cbW = parseFloat(cs.width) || 16;
  return { cbCenter: cbL + cbW / 2, textLeft: bw + (parseFloat(own.paddingLeft) || 0) };
});
async function clickGutter(liSel) {
  const box = await frame.locator(liSel).boundingBox();
  const d = await dxOf(liSel);
  await page.mouse.click(box.x + d.cbCenter, box.y + box.height / 2);
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

test('U24：勾选框正中翻转 / 文字左缘-2px不翻转 / 项间缝隙吸附最近项 / cursor:pointer（check-4）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="li1">甲甲甲</li><li id="li2">乙乙乙</li></ul>');
  const b1 = await frame.locator('#li1').boundingBox();
  const b2 = await frame.locator('#li2').boundingBox();
  const d1 = await dxOf('#li1');
  const d2 = await dxOf('#li2');
  // ① 勾选框正中 → 翻转
  await page.mouse.click(b1.x + d1.cbCenter, b1.y + b1.height / 2);
  await expect.poll(() => frame.locator('#li1').getAttribute('data-checked'), { message: '点框体正中翻转' }).toBe('true');
  // ② 文字左缘 -2px（进 li 的 padding 但在勾选带右侧之外）→ 不翻转。
  //    这条守的是「勾选带右缘与文字左缘之间留非勾选区」，U2 换几何后仍成立：带右缘 = 框体+4，
  //    与文字左缘之间仍有 6px 空档（U2 前是 li.left+2，U2 后是 li.left+29.2，语义一字未变）。
  await page.mouse.click(b2.x + d2.textLeft - 2, b2.y + b2.height / 2);
  await page.waitForTimeout(80);
  expect(await frame.locator('#li2').getAttribute('data-checked'), '点文字左缘不翻转、进编辑').toBe(null);
  // ③ 两项缝隙靠近 li2（li2 上缘之上 1px）→ 吸附翻转 li2（旧 Y 精确containment 是死区、不翻）
  await page.mouse.click(b2.x + d2.cbCenter, b2.y - 1);
  await expect.poll(() => frame.locator('#li2').getAttribute('data-checked'), { message: '缝隙点吸附最近项 li2' }).toBe('true');
  // ④ 勾选框 ::before 的 cursor:pointer
  const cur = await frame.locator('#li1').evaluate((li) => getComputedStyle(li, '::before').cursor);
  expect(cur, '勾选框命中带 cursor:pointer').toBe('pointer');
});
