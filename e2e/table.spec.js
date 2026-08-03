// 表格块编辑（Schema Table v1）e2e 真门：CI 用 xvfb 真启动 Electron。
// U1：斜杠造表（canonical 种子 + 磁盘合规 + 灰选）+ 别名过滤。后续单元（cell 编辑/键盘/输入闸）逐个追加。
// 强断言纪律（S4）：查磁盘字节 reparse conform / 结构真值，绝不 class-contains 当门。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2table-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}
async function openDoc(html) {
  const docPath = path.join(tmpDir, 'doc.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
  return docPath;
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
// 校验器判磁盘字节是否合规（reparse，不信 meta 自称）
const conformOf = (html) => page.evaluate((h) => {
  const doc = new DOMParser().parseFromString(h, 'text/html');
  return WS2SchemaRegistry.classify(doc).conform;
}, html);

const SIMPLE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="p1">正文一段</p></body></html>';

// 在 #p1 后新建空块，斜杠造表（query 可指定，验别名过滤）。
async function insertTable(query) {
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible(); // 菜单经父层 setTimeout(0) 打开——先等它开，再打过滤词（否则字母落进段落）
  if (query) await page.keyboard.type(query);
  await frame.locator('.ws-slashmenu-item', { hasText: '表格' }).click();
  await page.waitForTimeout(250);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

// U1-1：slash 造表 → canonical 种子结构真值 + 空锚块被原地替换（不留空段垃圾）+ 整表灰选。
test('U1: slash 造表 → canonical 种子 + 空块原地替换 + 灰选整表', async () => {
  await launch();
  await openDoc(SIMPLE);
  await insertTable();
  const shape = await frame.locator('body').evaluate(() => {
    const t = document.querySelector('table');
    if (!t) return { ok: false };
    const theadRows = t.querySelectorAll('thead tr');
    const ths = t.querySelectorAll('thead th');
    const bodyRows = t.querySelectorAll('tbody tr');
    const cellCounts = [...t.querySelectorAll('tr')].map((r) => [...r.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').length);
    return {
      ok: true,
      cls: t.className,
      theadRows: theadRows.length,
      ths: ths.length,
      scopes: [...ths].every((th) => th.getAttribute('scope') === 'col'),
      bodyRows: bodyRows.length,
      rect: cellCounts.every((n) => n === cellCounts[0]),
      cols: cellCounts[0],
      brs: [...t.querySelectorAll('td,th')].every((c) => c.querySelector('br')),
      // R3：造出即编辑——首格（thead 首 th）带 cell 编辑态；contenteditable 挂 cell 不挂 table
      cellTag: (document.querySelector('[data-ws2-cell]') || {}).tagName || null,
      cellIsFirstTh: document.querySelector('[data-ws2-cell]') === t.querySelector('thead th'),
      tableCe: t.getAttribute('contenteditable'),
      // 空锚块原地替换：#p1 之后不残留空段落（表格紧跟 #p1）
      afterP1: document.getElementById('p1').nextElementSibling ? document.getElementById('p1').nextElementSibling.tagName : null,
    };
  });
  expect(shape.ok).toBe(true);
  expect(shape.cls).toBe('ws-table');
  expect(shape.theadRows).toBe(1);
  expect(shape.ths).toBe(3);
  expect(shape.scopes).toBe(true);
  expect(shape.bodyRows).toBe(2);
  expect(shape.rect).toBe(true);
  expect(shape.cols).toBe(3);
  expect(shape.brs).toBe(true);
  expect(shape.cellTag).toBe('TH');
  expect(shape.cellIsFirstTh).toBe(true);
  expect(shape.tableCe).toBe(null);
  expect(shape.afterP1).toBe('TABLE');
});

// U1-2：磁盘字节 reparse 合规 + 编辑器标记零残留（serialize 剥净）。
test('U1: 造表后磁盘字节 reparse conform、无编辑器标记残留', async () => {
  await launch();
  await openDoc(SIMPLE);
  await insertTable();
  const html = await serialize();
  expect(await conformOf(html)).toBe(true);
  expect(html).toContain('ws-table');
  expect(html).toContain('<thead>');
  expect(html).toContain('scope="col"');
  expect(html).not.toMatch(/data-ws2-(ce|editing|selected|rangesel|root)/);
  expect(html).not.toContain('contenteditable');
});

// U1-3：斜杠别名过滤——「/biaoge」也能搜到表格项（filterSlash 吃 kw 字段）。
test('U1: 斜杠过滤词 biaoge 能搜到表格项', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible(); // 先等菜单开（父层 setTimeout(0)），再打过滤词
  await page.keyboard.type('biaoge');
  await expect(frame.locator('.ws-slashmenu-item', { hasText: '表格' })).toBeVisible();
  // 别名命中的不是别的项：过滤结果里恰含表格
  const count = await frame.locator('.ws-slashmenu-item').count();
  expect(count).toBe(1);
});

// ===== U2：cell 编辑状态机 =====

// 造好表后光标已在首格（R3），供 U2 用例起步。
const TABLE_DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="p1">前文段落甲</p>'
  + '<table class="ws-table"><thead><tr><th scope="col">甲</th><th scope="col">乙</th><th scope="col">丙</th></tr></thead>'
  + '<tbody><tr><td id="c11">十一格</td><td id="c12">十二</td><td id="c13">十三格子</td></tr>'
  + '<tr><td id="c21">廿一</td><td id="c22">廿二格</td><td id="c23">廿三</td></tr></tbody></table>'
  + '<p id="p2">后文段落乙</p></body></html>';

// U2-1：点既有表格（AI/md 来源形态）的 cell → 进该格编辑、打字落对格；serialize 零标记残留 + conform。
test('U2: 点 cell 打字落对格 + 磁盘零残留', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c12').click();
  await page.waitForTimeout(150);
  const state = await frame.locator('body').evaluate(() => ({
    cellId: (document.querySelector('[data-ws2-cell]') || {}).id || null,
    ce: (document.getElementById('c12').getAttribute('contenteditable')),
  }));
  expect(state.cellId).toBe('c12');
  expect(state.ce).toBe('true');
  await page.keyboard.press('End');
  await page.keyboard.type('新增');
  await page.waitForTimeout(120);
  expect(await frame.locator('#c12').textContent()).toBe('十二新增');
  const html = await serialize();
  expect(await conformOf(html)).toBe(true);
  expect(html).not.toMatch(/data-ws2-(cell|ce)/);
  expect(html).not.toContain('contenteditable');
  expect(html).toContain('十二新增');
});

// U2-2：Esc 上卷 = 灰选整表（selectedEl 永不为 TD）→ Backspace 整表删（矩形不可能缺格）。
test('U2: Esc 上卷灰选整表 + Backspace 整删', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c11').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const sel1 = await frame.locator('body').evaluate(() => ({
    tag: (document.querySelector('[data-ws2-selected]') || {}).tagName || null,
    cellLeft: document.querySelectorAll('[data-ws2-cell]').length,
  }));
  expect(sel1.tag).toBe('TABLE');
  expect(sel1.cellLeft).toBe(0);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  const after = await frame.locator('body').evaluate(() => ({ tables: document.querySelectorAll('table').length }));
  expect(after.tables).toBe(0);
  expect(await conformOf(await serialize())).toBe(true);
});

// U2-3：cell 内拖选文字 → 打字替换（方案 B：摘墙后 mouseUp 同格恢复编辑保留选区）。
test('U2: cell 内拖选替换（选词替换活）', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c13').click();
  await page.waitForTimeout(120);
  // 拖选模拟走仓内惯例（真鼠标按住拖动在本 harness 会挂死，setCrossSel 范式同因）：合成 mousedown/
  // mousemove(buttons=1, >4px)/mouseup 驱动摘墙→恢复管线，选区在事件间程序化设置（还原原生拖选时序）。
  await frame.locator('body').evaluate(() => {
    const cell = document.getElementById('c13');
    const r0 = cell.getBoundingClientRect();
    const mk = (type, x, y, buttons) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: buttons, button: 0, view: window });
    cell.dispatchEvent(mk('mousedown', r0.left + 6, r0.top + 8, 1));
    const rng = document.createRange(); rng.selectNodeContents(cell.firstChild ? cell.firstChild : cell);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(rng);
    cell.dispatchEvent(mk('mousemove', r0.left + 40, r0.top + 8, 1)); // 越过 4px 阈值 → 摘墙 exitCell
    cell.dispatchEvent(mk('mouseup', r0.left + 40, r0.top + 8, 0));   // 同格选区 → 恢复 cell 编辑保留选区
  });
  await page.waitForTimeout(150);
  const midState = await frame.locator('body').evaluate(() => ({
    cellId: (document.querySelector('[data-ws2-cell]') || {}).id || null,
    selText: String(document.getSelection()),
  }));
  expect(midState.cellId).toBe('c13'); // mouseUp 恢复同格编辑
  expect(midState.selText.length).toBeGreaterThan(0); // 选区保留
  await page.keyboard.type('替');
  await page.waitForTimeout(120);
  const txt = await frame.locator('#c13').textContent();
  expect(txt).toContain('替');
  expect(txt).not.toContain('十三格子'); // 原文被替换
  expect(await conformOf(await serialize())).toBe(true);
});

// U2-4：编辑 cell 中被跨块整删（ED-A2）→ cellEl 生存不变式兜住，继续输入不炸、不进死表。
test('U2: 跨块选区罩表整删后按键不进死表', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c21').click();
  await page.waitForTimeout(120);
  // 从 #p1 文中拖到表内 cell（跨块选区端点在表内 → 整表蓝 → 整删）
  await frame.locator('body').evaluate(() => {
    const r = document.createRange();
    r.setStart(document.getElementById('p1').firstChild, 2);
    r.setEnd(document.getElementById('c11').firstChild, 1);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(150);
  const marked = await frame.locator('body').evaluate(() => (document.querySelector('table[data-ws2-rangesel]') ? true : false));
  expect(marked).toBe(true); // 整表蓝预示整删（ED-A2 入向不变）
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  const after = await frame.locator('body').evaluate(() => ({
    tables: document.querySelectorAll('table').length,
    cellLeft: document.querySelectorAll('[data-ws2-cell]').length,
  }));
  expect(after.tables).toBe(0);
  expect(after.cellLeft).toBe(0);
  await page.keyboard.type('续写');
  await page.waitForTimeout(120);
  const html = await serialize();
  expect(await conformOf(html)).toBe(true);
  expect(html).toContain('续写'); // 键入落进幸存块，没有被死表吞
});

// U2-5：灰选整表按 Enter → 进入首格（键盘可达闭环）。
test('U2: 灰选整表 Enter 进首格', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c11').click();
  await page.keyboard.press('Escape'); // 灰选整表
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const state = await frame.locator('body').evaluate(() => {
    const c = document.querySelector('[data-ws2-cell]');
    return { tag: c ? c.tagName : null, isFirstTh: c === document.querySelector('thead th'), selected: document.querySelectorAll('[data-ws2-selected]').length };
  });
  expect(state.tag).toBe('TH');
  expect(state.isFirstTh).toBe(true);
  expect(state.selected).toBe(0);
});

// ===== U3：cell 键盘契约 =====

const cellId = () => frame.locator('body').evaluate(() => (document.querySelector('[data-ws2-cell]') || {}).id || (document.querySelector('[data-ws2-cell]') || {}).tagName || null);

// U3-1：cell 中间 Enter → 不产生 <div>，光标跳下一行同列；末行 Enter → 建新行（恒落 tbody 恒产 TD）。
test('U3: Enter 跳下行同列 / 末行 Enter 建行', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c12').click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  expect(await cellId()).toBe('c22'); // 同列（col 1）下一行
  const clean = await frame.locator('body').evaluate(() => ({
    divs: document.querySelectorAll('td div, th div').length,
    c12: document.getElementById('c12').textContent,
  }));
  expect(clean.divs).toBe(0);
  expect(clean.c12).toBe('十二');
  await page.keyboard.press('Enter'); // c22 是末行 → 建新行、落同列
  await page.waitForTimeout(150);
  const grown = await frame.locator('body').evaluate(() => {
    const t = document.querySelector('table');
    const rows = [...t.querySelectorAll('tbody tr')];
    const last = rows[rows.length - 1];
    const cells = [...last.children];
    return { rows: rows.length, cells: cells.length, allTd: cells.every((c) => c.tagName === 'TD'), editingInLast: !!last.querySelector('[data-ws2-cell]') };
  });
  expect(grown.rows).toBe(3);
  expect(grown.cells).toBe(3); // 矩形保持
  expect(grown.allTd).toBe(true);
  expect(grown.editingInLast).toBe(true);
  expect(await conformOf(await serialize())).toBe(true);
});

// U3-2：Tab/Shift+Tab 移格（行内→折行）；末格 Tab 建行；新空行行首 Backspace 删行（最小逆操作闭环）。
test('U3: Tab 移格 / 末格 Tab 建行 / 空行 Backspace 删行', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c11').click();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  expect(await cellId()).toBe('c12');
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
  expect(await cellId()).toBe('c11');
  await frame.locator('#c23').click();
  await page.keyboard.press('Tab'); // 末格 → 建行
  await page.waitForTimeout(150);
  const grown = await frame.locator('body').evaluate(() => ({ rows: document.querySelectorAll('tbody tr').length }));
  expect(grown.rows).toBe(3);
  await page.keyboard.press('Backspace'); // 新空行行首 → 删该行（Colin 拍板的对称逆操作）
  await page.waitForTimeout(150);
  const shrunk = await frame.locator('body').evaluate(() => ({
    rows: document.querySelectorAll('tbody tr').length,
    rect: (() => { const cs = [...document.querySelectorAll('tr')].map((r) => r.children.length); return cs.every((n) => n === cs[0]); })(),
  }));
  expect(shrunk.rows).toBe(2);
  expect(shrunk.rect).toBe(true);
  expect(await cellId()).toBe('c23'); // 光标回上一行末格
  expect(await conformOf(await serialize())).toBe(true);
});

// U3-3：非空行行首 Backspace = no-op（不跨格并字、不删结构）。
test('U3: 非空行行首 Backspace no-op', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c21').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  const state = await frame.locator('body').evaluate(() => ({
    rows: document.querySelectorAll('tbody tr').length,
    c21: document.getElementById('c21').textContent,
    c13: document.getElementById('c13').textContent,
  }));
  expect(state.rows).toBe(2);
  expect(state.c21).toBe('廿一'); // 没被并进上一格
  expect(state.c13).toBe('十三格子');
});

// U3-4：⌘A 三档——①本格 ②整表灰选 ③全篇。
test('U3: ⌘A 三档分级', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c12').click();
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(100);
  const t1 = await frame.locator('body').evaluate(() => String(document.getSelection()).replace(/\s+/g, ''));
  expect(t1).toBe('十二'); // ① 本格
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(100);
  const t2 = await frame.locator('body').evaluate(() => ({
    sel: (document.querySelector('[data-ws2-selected]') || {}).tagName || null,
    cells: document.querySelectorAll('[data-ws2-cell]').length,
  }));
  expect(t2.sel).toBe('TABLE'); // ② 整表灰选
  expect(t2.cells).toBe(0);
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(150);
  const t3 = await frame.locator('body').evaluate(() => { const s = String(document.getSelection()).replace(/\s+/g, ''); return { hasP1: s.includes('前文段落甲'), hasP2: s.includes('后文段落乙'), hasCell: s.includes('廿二格') }; });
  expect(t3.hasP1 && t3.hasP2 && t3.hasCell).toBe(true); // ③ 全篇
});

// U3-5：方向键——↓ 同列跨行、表末行 ↓ 跳出到下一块；↑ 进 thead、再 ↑ 跳出到上一块；空格 ←→ 跨格。
test('U3: 方向键跨格与表界跳出', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c12').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  expect(await cellId()).toBe('c22');
  await page.keyboard.press('ArrowDown'); // 末行 ↓ → 跳出到 #p2
  await page.waitForTimeout(120);
  const out = await frame.locator('body').evaluate(() => ({
    editing: (document.querySelector('[data-ws2-editing]') || {}).id || null,
    cells: document.querySelectorAll('[data-ws2-cell]').length,
  }));
  expect(out.editing).toBe('p2');
  expect(out.cells).toBe(0);
  // ↑ 从 c12 进 thead 同列，再 ↑ 跳出到 #p1
  await frame.locator('#c12').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  const inHead = await frame.locator('body').evaluate(() => { const c = document.querySelector('[data-ws2-cell]'); return c ? { tag: c.tagName, text: c.textContent } : null; });
  expect(inHead.tag).toBe('TH');
  expect(inHead.text).toBe('乙'); // 同列（col 1）
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(120);
  const out2 = await frame.locator('body').evaluate(() => ({ editing: (document.querySelector('[data-ws2-editing]') || {}).id || null }));
  expect(out2.editing).toBe('p1');
});

// U3-6：KTD6 探针——打字（500ms 防抖窗口内）紧接末格 Tab 建行，undo 只回滚行、不吞字。
test('U3: 建行前置 checkpoint——undo 只回滚行不吞打字', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c23').click();
  await page.keyboard.press('End');
  await page.keyboard.type('尾字');
  await page.keyboard.press('Tab'); // 立刻建行（打字债还在防抖窗口内）
  await page.waitForTimeout(150);
  expect(await frame.locator('body').evaluate(() => document.querySelectorAll('tbody tr').length)).toBe(3);
  await menu('undo');
  await page.waitForTimeout(250);
  const after = await frame.locator('body').evaluate(() => ({
    rows: document.querySelectorAll('tbody tr').length,
    c23: document.getElementById('c23').textContent,
  }));
  expect(after.rows).toBe(2); // 行被回滚
  expect(after.c23).toBe('廿三尾字'); // 字保住（前置 checkpoint 结算了打字债）
});

// U3-7：IME 组词 guard——keyCode 229 的 Enter 不移格（合成事件直测 guard 分支）。
test('U3: 组词中 Enter 不移格（229 guard）', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c11').click();
  await page.waitForTimeout(100);
  await frame.locator('body').evaluate(() => {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: () => 229 });
    document.getElementById('c11').dispatchEvent(ev);
  });
  await page.waitForTimeout(100);
  expect(await cellId()).toBe('c11'); // 没移格
});

// U1-4：非空锚块造表 → 插到锚块下方（锚块保留），undo 一步撤掉整个造表。
test('U1: 非空块造表插下方 + undo 一步还原', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: '表格' }).click();
  await page.waitForTimeout(250);
  const order = await frame.locator('body').evaluate(() => {
    const p = document.getElementById('p1');
    return { pText: p.textContent, next: p.nextElementSibling ? p.nextElementSibling.tagName : null };
  });
  expect(order.pText).toContain('正文一段'); // 锚块文字保留（/query 已删）
  expect(order.next).toBe('TABLE');
  await menu('undo');
  await page.waitForTimeout(250);
  const after = await frame.locator('body').evaluate(() => ({ tables: document.querySelectorAll('table').length }));
  expect(after.tables).toBe(0);
});
