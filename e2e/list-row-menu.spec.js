// U3 手柄菜单行级作用域（粒度对齐 C，plan 2026-08-03-002）：
// 行锚手柄开的菜单作用于该行（转为/在下方插入/复制/删除/颜色）；Esc 灰选入口仍是块作用域。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2rowmenu-'));
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
const bodyOrder = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].map((el) => el.tagName + (el.id ? '#' + el.id : ''));
});
const rowTexts = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const l = d.querySelector(s);
  return l ? [...l.children].filter((x) => x.tagName === 'LI').map((li) => (li.firstChild ? (li.firstChild.textContent || '').trim() : '')) : null;
}, sel);
// 行锚开菜单：悬停行 → 点手柄
async function openRowMenu(rowSel) {
  await frame.locator(rowSel).hover();
  await page.waitForTimeout(150);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
}
const clickItem = async (label) => { await frame.locator('.ws-blockmenu-item', { hasText: label }).first().click(); await page.waitForTimeout(250); };

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('作用域可见：行锚菜单高亮那一行、不圈整张列表', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await openRowMenu('#r2');
  const marked = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.querySelectorAll('[data-ws2-selected]');
    return [...s].map((el) => el.tagName + (el.id ? '#' + el.id : ''));
  });
  expect(marked.join(','), '只高亮目标行').toBe('LI#r2');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('[data-ws2-selected]').length);
  expect(after, '菜单关闭后行高亮清除').toBe(0);
  expect((await serialize()).includes('data-ws2-selected'), '交互态不入盘').toBe(false);
});

test('转为正文：只抽出该行，前后剩余项仍是原列表', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li><li id="r3">三</li></ul>');
  await openRowMenu('#r2');
  await clickItem('转为正文');
  // 只断结构与文字，不断 id：抽行产物继承原 ul 的 id 是 #346 turnIntoLines 的既有行为（retagElement
  // 保属性），非 U3 引入——本单元不动它（真要改是独立议题，见 spec 欠账）。
  const order = (await bodyOrder()).map((s) => s.split('#')[0]);
  expect(order.join(','), '劈成 前列表/段落/后列表 三块').toBe('UL,P,UL');
  const mid = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.body.children[1].textContent.trim());
  expect(mid).toBe('二');
  expect((await rowTexts('body > ul:first-child')).join(''), '前段列表剩一').toBe('一');
  expect((await rowTexts('body > ul:last-child')).join(''), '后段列表剩三').toBe('三');
  expect(await conformOf(await serialize())).toBe(true);
});

// 对拍 F12（无序列表维度实测）：Notion 把该行转成 text 后，它的**子块原样保留**；我们原来
// 把整棵子树拍进产物文字里 = 子项作为条目彻底消失（丢内容）。修后子树接在产物之后、降为顶层列表。
test('带嵌套子项的行「转为正文」：子项不被吞、以列表形式留在产物之后', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">一级 A</li><li id="b">一级 B<ul id="S"><li id="b1">二级 B1</li><li id="b2">二级 B2</li></ul></li><li id="c">一级 C</li></ul>');
  // ⚠ 带嵌套子树的行，几何中心落在**子列表**上 → 必须瞄准父行自己那一行文字（否则悬停解析到嵌套行）
  await frame.locator('#b').hover({ position: { x: 20, y: 8 } });
  await page.waitForTimeout(150);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  await clickItem('转为正文');
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.children].map((el) => ({ tag: el.tagName, text: el.textContent.trim() }));
  });
  expect(st.map((k) => k.tag).join(','), '前列表 / 段落 / 子树列表 / 后列表').toBe('UL,P,UL,UL');
  expect(st[1].text, '产物只含该行自己的文字、不含子项').toBe('一级 B');
  expect(st[2].text.replace(/\s+/g, ''), '子项原样保留为独立列表').toBe('二级B1二级B2');
  expect(st[3].text, '后段列表不受影响').toBe('一级 C');
  const gone = await page.evaluate(() => !!document.getElementById('doc-frame').contentDocument.getElementById('b1'));
  expect(gone, '子项 li 节点仍在（不是被拍成文字）').toBe(true);
  expect(await conformOf(await serialize())).toBe(true);
});

// 对拍 N8（编号列表维度实测）：Notion 只重排**分割点之后**的号，之前的号一个不动。
// 我们原来前段丢 start（上方的号跟着变）+ start 泄漏到产物 <p start="2">（垃圾属性）。
test('ol[start] 中间行转为正文：前段保 start、产物不带 start、后段从 1 重启', async () => {
  await launch();
  await openDoc('<ol id="L" start="2"><li id="r1">甲</li><li id="r2">乙</li><li id="r3">丙</li></ol>');
  await openRowMenu('#r2');
  await clickItem('转为正文');
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.children].map((el) => ({ tag: el.tagName, start: el.getAttribute('start'), text: el.textContent.trim() }));
  });
  expect(st.map((k) => k.tag).join(','), '劈成 前列表/段落/后列表').toBe('OL,P,OL');
  expect(st[0].start, '前段保留原 start（分割点之前的号不该变）').toBe('2');
  expect(st[1].start, '产物段落不带 start 垃圾属性').toBeNull();
  expect(st[2].start, '后段不带 start = 从 1 重启（对齐 Notion）').toBeNull();
  expect(await conformOf(await serialize())).toBe(true);
});

test('在下方插入：插的是同列表新行（不是列表后的段落）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await openRowMenu('#r1');
  await clickItem('在下方插入');
  expect((await bodyOrder()).join(','), '仍只有这一个列表块').toBe('UL#L');
  const texts = await rowTexts('#L');
  expect(texts.length, '多出一行').toBe(3);
  expect(texts[1], '新行在第一行之下、且为空').toBe('');
  await page.keyboard.type('新行内容');
  await expect.poll(async () => (await rowTexts('#L'))[1], { message: '光标落在新行、打字进该行' }).toBe('新行内容');
  expect(await conformOf(await serialize())).toBe(true);
});

test('复制：复制该行（不是整张列表）且剥 id', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1" data-checked="true">已勾行</li><li id="r2">二</li></ul>');
  await openRowMenu('#r1');
  await clickItem('复制');
  expect((await bodyOrder()).join(','), '不新增列表块').toBe('UL#L');
  const texts = await rowTexts('#L');
  expect(texts.join('|'), '副本紧随其后').toBe('已勾行|已勾行|二');
  const ids = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#L > li')].map((li) => li.id || '');
  });
  expect(ids[1], '副本剥掉 id（防锚点重复）').toBe('');
  expect(await conformOf(await serialize())).toBe(true);
});

test('删除：只删该行 + undo 一步还原', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li><li id="r3">三</li></ul>');
  await openRowMenu('#r2');
  await clickItem('删除');
  expect((await rowTexts('#L')).join(''), '只少了第二行').toBe('一三');
  await menu('undo');
  await expect.poll(async () => (await rowTexts('#L')).join(''), { message: 'undo 一步还原被删行' }).toBe('一二三');
});

test('删掉最后一行：列表 de-list 成空段落、无空列表残留', async () => {
  await launch();
  await openDoc('<p id="pre">前</p><ul class="ws-todo" id="L"><li id="r1">独苗</li></ul>');
  await openRowMenu('#r1');
  await clickItem('删除');
  const order = await bodyOrder();
  expect(order.join(','), '列表换成段落').toBe('P#pre,P');
  const emptyLists = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('ul,ol').length);
  expect(emptyLists, '无空列表残留').toBe(0);
  await page.keyboard.type('接着写');
  await expect.poll(async () => (await page.evaluate(() => document.getElementById('doc-frame').contentDocument.body.lastElementChild.textContent.trim())), { message: '光标落在新段落' }).toBe('接着写');
  expect(await conformOf(await serialize())).toBe(true);
});

test('删掉嵌套唯一子行：嵌套列表移除、宿主行保留', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">父项<ul class="ws-todo" id="S"><li id="n1">嵌套甲</li></ul></li><li id="r2">二</li></ul>');
  await openRowMenu('#n1');
  await clickItem('删除');
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { sub: d.querySelectorAll('#L ul').length, host: d.getElementById('r1').textContent.trim(), rows: d.querySelectorAll('#L > li').length };
  });
  expect(st.sub, '掏空的嵌套列表移除').toBe(0);
  expect(st.host, '宿主行文字保留').toBe('父项');
  expect(st.rows, '顶层仍两行').toBe(2);
  expect(await conformOf(await serialize())).toBe(true);
});

test('颜色作用于该行（不给整列表上色）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await openRowMenu('#r2');
  await frame.locator('.ws-blockmenu-swatch').nth(1).click();
  await page.waitForTimeout(250);
  const cls = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { row: d.getElementById('r2').className, list: d.getElementById('L').className, other: d.getElementById('r1').className };
  });
  expect(cls.row.includes('ws-color-'), '目标行带颜色 class').toBe(true);
  expect(cls.list.includes('ws-color-'), '整列表不上色').toBe(false);
  expect(cls.other.includes('ws-color-'), '同列表其他行不上色').toBe(false);
  expect(await conformOf(await serialize())).toBe(true);
});

test('Esc 灰选入口维持块作用域：删除删掉整张列表', async () => {
  await launch();
  await openDoc('<p id="pre">前</p><ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li></ul><p id="post">后</p>');
  await frame.locator('#r2').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const marked = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('[data-ws2-selected]')].map((el) => el.tagName + (el.id ? '#' + el.id : '')).join(',');
  });
  expect(marked, '灰选的是整张列表').toBe('UL#L');
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  await clickItem('删除');
  expect((await bodyOrder()).join(','), '整块删除').toBe('P#pre,P#post');
  expect(await conformOf(await serialize())).toBe(true);
});
