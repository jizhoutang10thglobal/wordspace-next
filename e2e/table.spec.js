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

// ===== U4：输入闸与选区语义 =====

const pasteInto = (selId, plain, html) => frame.locator('body').evaluate((body, [id, p, h]) => {
  const dt = new DataTransfer();
  if (p) dt.setData('text/plain', p);
  if (h) dt.setData('text/html', h);
  document.getElementById(id).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, [selId, plain || '', html || '']);

// U4-1：cell 粘贴多行 → join 成单行；内部富 clip 粘 cell → 同样压纯文本。
test('U4: cell 粘贴闸——多行压单行、富 clip 压纯文本', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c11').click();
  await page.keyboard.press('End');
  await pasteInto('c11', '甲行\n乙行\n丙行');
  await page.waitForTimeout(150);
  expect(await frame.locator('#c11').textContent()).toBe('十一格甲行 乙行 丙行'); // 单行落格
  await frame.locator('#c22').click();
  await page.keyboard.press('End');
  await pasteInto('c22', '一二三', '<div data-ws2-clip="b"><ul class="ws-todo"><li data-checked="true">一二三</li></ul></div>');
  await page.waitForTimeout(150);
  const cellState = await frame.locator('body').evaluate(() => ({
    text: document.getElementById('c22').textContent,
    blocks: document.getElementById('c22').querySelectorAll('ul,li,p,div').length,
  }));
  expect(cellState.text).toBe('廿二格一二三');
  expect(cellState.blocks).toBe(0); // 零块级结构进 cell
  const html = await serialize();
  expect(await conformOf(html)).toBe(true);
});

// U4-2：图片粘贴拒收 + 提示小签淡入（computed opacity 强断言）+ 自动消退 + 磁盘零残留。
test('U4: 图片粘贴拒收给可感知反馈', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c12').click();
  await frame.locator('body').evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'x.png', { type: 'image/png' }));
    document.getElementById('c12').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300); // 200ms 淡入完成
  const tip = await frame.locator('body').evaluate(() => {
    const t = document.querySelector('.ws-cellnope');
    return t ? { opacity: parseFloat(getComputedStyle(t).opacity), text: t.textContent } : null;
  });
  expect(tip.opacity).toBeGreaterThan(0.9); // 真淡入（不是 class 检查）
  expect(tip.text).toBe('单元格只能放文字');
  const noImg = await frame.locator('body').evaluate(() => ({ imgs: document.querySelectorAll('td img, th img, figure').length, c12: document.getElementById('c12').textContent }));
  expect(noImg.imgs).toBe(0); // 拒收成功
  expect(noImg.c12).toBe('十二');
  await page.waitForTimeout(1900); // 1.6s 后淡出
  const tip2 = await frame.locator('body').evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ws-cellnope')).opacity));
  expect(tip2).toBeLessThan(0.1);
  const html = await serialize();
  expect(html).not.toContain('ws-cellnope'); // overlay 剥净
  expect(await conformOf(html)).toBe(true);
});

// U4-3：cell 里打 '/' → 斜杠菜单不弹（KTD5）。
test('U4: cell 内斜杠菜单禁用', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c13').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/');
  await page.waitForTimeout(300);
  expect(await frame.locator('.ws-slashmenu').isVisible()).toBe(false);
  expect(await frame.locator('#c13').textContent()).toBe('十三格子/'); // 字符照常落格
});

// U4-4：同表跨格选区 → 清内容不动结构（KTD3 线性被罩集）。
test('U4: 跨格选区清内容不动结构', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c11').click();
  // 程序化设置 c11 文中 → c22 文中 的跨格选区（还原拖选终态）
  await frame.locator('body').evaluate(() => {
    const r = document.createRange();
    r.setStart(document.getElementById('c11').firstChild, 1); // 「十|一格」
    r.setEnd(document.getElementById('c22').firstChild, 2);   // 「廿二|格」
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(150);
  const hl = await frame.locator('body').evaluate(() => ({
    markedCells: document.querySelectorAll('td[data-ws2-rangesel]').length,
    tableMarked: !!document.querySelector('table[data-ws2-rangesel]'),
  }));
  expect(hl.markedCells).toBeGreaterThan(0); // 全罩格整格蓝
  expect(hl.tableMarked).toBe(false); // 不再整表蓝（同表内是 cell 级语义）
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  const after = await frame.locator('body').evaluate(() => {
    const cs = [...document.querySelectorAll('tr')].map((r) => r.children.length);
    return {
      rect: cs.every((n) => n === cs[0]), rows: document.querySelectorAll('tr').length,
      c11: document.getElementById('c11').textContent, c12: document.getElementById('c12').textContent,
      c13: document.getElementById('c13').textContent, c21: document.getElementById('c21').textContent,
      c22: document.getElementById('c22').textContent, c23: document.getElementById('c23').textContent,
      cellId: (document.querySelector('[data-ws2-cell]') || {}).id || null,
    };
  });
  expect(after.rect).toBe(true);
  expect(after.rows).toBe(3); // 结构一格不少
  expect(after.c11).toBe('十'); // 端点格裁剪
  expect(after.c12).toBe(''); // 途径格清空（线性覆盖：c12/c13/c21 全清）
  expect(after.c13).toBe('');
  expect(after.c21).toBe('');
  expect(after.c22).toBe('格'); // 端点格裁剪
  expect(after.c23).toBe('廿三'); // 选区外不动
  expect(after.cellId).toBe('c11'); // 光标回起格
  expect(await conformOf(await serialize())).toBe(true);
});

// U4-5：从 cell 拖出到段落（出向跨块）→ 整表蓝 → Backspace 整删（ED-A2 出向）。
test('U4: 出向跨块选区整表蓝整删', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c21').click();
  await frame.locator('body').evaluate(() => {
    const r = document.createRange();
    r.setStart(document.getElementById('c21').firstChild, 1);
    r.setEnd(document.getElementById('p2').firstChild, 2);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(150);
  expect(await frame.locator('body').evaluate(() => !!document.querySelector('table[data-ws2-rangesel]'))).toBe(true);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  const after = await frame.locator('body').evaluate(() => ({ tables: document.querySelectorAll('table').length, p2: document.getElementById('p2') ? document.getElementById('p2').textContent : null }));
  expect(after.tables).toBe(0); // 端点在表内 → 整删不裁剪
  expect(await conformOf(await serialize())).toBe(true);
});

// U4-6：cell 内行内格式——⌘A 选本格 → fmtbar 加粗 → 磁盘 phrasing 标记 + computed font-weight 真值。
test('U4: cell 内 fmtbar 加粗（R1 行内格式）', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c13').click();
  await page.keyboard.press('Meta+a'); // 第一档：选本格内容
  await page.waitForTimeout(200);
  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
  await frame.locator('.ws-fmtbar-btn[title="加粗"]').click();
  await page.waitForTimeout(200);
  const state = await frame.locator('body').evaluate(() => {
    const c = document.getElementById('c13');
    const b = c.querySelector('b,strong');
    return { hasB: !!b, weight: b ? getComputedStyle(b).fontWeight : null, text: c.textContent };
  });
  expect(state.hasB).toBe(true);
  expect(parseInt(state.weight, 10)).toBeGreaterThanOrEqual(600); // 视觉真值，不是查 class
  expect(state.text).toBe('十三格子');
  const html = await serialize();
  expect(await conformOf(html)).toBe(true);
  expect(html).toMatch(/<(b|strong)>十三格子<\/(b|strong)>/);
});

// U4-7：跨格复制 = 纯文本（绝不携带裸 tr/td 片段粘回产非法结构）。
test('U4: 跨格复制粘贴为纯文本', async () => {
  await launch();
  await openDoc(TABLE_DOC);
  await frame.locator('#c11').click();
  await frame.locator('body').evaluate(() => {
    const r = document.createRange();
    r.setStart(document.getElementById('c11').firstChild, 0);
    r.setEnd(document.getElementById('c12').firstChild, 2);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(120);
  // 直接调 onCopy 管线（合成 copy 事件带可写 clipboardData）
  const clip = await frame.locator('body').evaluate(() => {
    const dt = new DataTransfer();
    const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
    document.getElementById('c11').dispatchEvent(ev);
    return { html: dt.getData('text/html'), plain: dt.getData('text/plain') };
  });
  expect(clip.html).toBe(''); // 无 HTML 载荷（纯文本复制）
  expect(clip.plain.replace(/\s+/g, '')).toBe('十一格十二');
});

// ===== CR：对抗审查回归（2026-08-03 Tier2 审查抓出的 bug，修后钉死）=====

// CR-1：header-only 表（GFM md 产物，无 tbody）末格 Tab 建行 → tbody 补建 + 恰一行 TD；
// 单次 undo → 整个 tbody 消失（不留幽灵空 tbody——checkpoint 必须在补建 tbody 之前）。
test('CR: header-only 表建行 + 单 undo 无幽灵 tbody', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="p1">前文</p>'
    + '<table class="ws-table"><thead><tr><th scope="col" id="h1">仅表头甲</th><th scope="col" id="h2">仅表头乙</th></tr></thead></table></body></html>');
  await frame.locator('#h2').click();
  await page.keyboard.press('Tab'); // 末格 → 建行（必须新建 tbody，绝不给 thead 塞第二行）
  await page.waitForTimeout(150);
  const grown = await frame.locator('body').evaluate(() => ({
    tbodies: document.querySelectorAll('tbody').length,
    tbodyRows: document.querySelectorAll('tbody tr').length,
    theadRows: document.querySelectorAll('thead tr').length,
    tds: document.querySelectorAll('tbody td').length,
  }));
  expect(grown.tbodies).toBe(1);
  expect(grown.tbodyRows).toBe(1);
  expect(grown.theadRows).toBe(1);
  expect(grown.tds).toBe(2);
  expect(await conformOf(await serialize())).toBe(true);
  await menu('undo'); // 单次 undo：行和补建的 tbody 一起回滚
  await page.waitForTimeout(250);
  const back = await frame.locator('body').evaluate(() => ({
    tbodies: document.querySelectorAll('tbody').length,
    theadRows: document.querySelectorAll('thead tr').length,
  }));
  expect(back.tbodies).toBe(0); // 无幽灵空 tbody
  expect(back.theadRows).toBe(1);
  expect(await conformOf(await serialize())).toBe(true);
});

// CR-2：其余格为空的表里「格内全选」复制 → 行内载荷，绝不升级整表克隆。
test('CR: 格内全选复制不升级整表', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="p1">前文</p>'
    + '<table class="ws-table"><tbody><tr><td id="only">唯一有字的格</td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table></body></html>');
  await frame.locator('#only').click();
  await page.keyboard.press('Meta+a'); // 第一档：选本格全部文字（norm 后 == 全表文字，旧代码会误判 wholeBlock）
  await page.waitForTimeout(120);
  const clip = await frame.locator('body').evaluate(() => {
    const dt = new DataTransfer();
    document.getElementById('only').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return { html: dt.getData('text/html'), plain: dt.getData('text/plain') };
  });
  expect(clip.html).not.toContain('<table'); // 行内哨兵载荷，不是整表块级克隆
  expect(clip.plain.replace(/\s+/g, '')).toBe('唯一有字的格');
});

// CR-3：图片说明编辑中直接点表格 cell → cell 真进入编辑（caption blur 不反噬新状态）。
test('CR: 说明编辑切 cell 不被 blur 反噬', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<figure><img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="图"><figcaption id="cap">旧说明文字</figcaption></figure>'
    + '<table class="ws-table"><tbody><tr><td id="c1">目标格子</td></tr></tbody></table></body></html>');
  await frame.locator('#cap').click(); // 进说明编辑
  await page.waitForTimeout(120);
  await frame.locator('#c1').click(); // 直接切到表格 cell
  await page.waitForTimeout(150);
  const state = await frame.locator('body').evaluate(() => ({
    cellId: (document.querySelector('[data-ws2-cell]') || {}).id || null,
    cellCe: document.getElementById('c1').getAttribute('contenteditable'),
    capCe: document.getElementById('cap') ? document.getElementById('cap').getAttribute('contenteditable') : null,
  }));
  expect(state.cellId).toBe('c1'); // cell 状态活着（未被 persistCaption 的 selectBlock/exitCell 清掉）
  expect(state.cellCe).toBe('true');
  expect(state.capCe).toBe(null); // 说明编辑已干净收尾
  await page.keyboard.type('续');
  await page.waitForTimeout(120);
  expect(await frame.locator('#c1').textContent()).toContain('续'); // 打字真落格
});

// CR-4：表-only 文档 ⌘A 三档到全篇 → Backspace 整删 + 补空段可继续输入（原为 silent no-op）。
test('CR: 表-only 文档全选删除不哑', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<table class="ws-table"><tbody><tr><td id="c1">甲格文字</td><td>乙</td></tr></tbody></table></body></html>');
  await frame.locator('#c1').click();
  await page.keyboard.press('Meta+a'); // ① 本格
  await page.keyboard.press('Meta+a'); // ② 整表灰选
  await page.keyboard.press('Meta+a'); // ③ 全篇（表-only：端点锚在 table 元素层）
  await page.waitForTimeout(150);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  const after = await frame.locator('body').evaluate(() => ({
    tables: document.querySelectorAll('table').length,
    editing: !!document.querySelector('[data-ws2-editing]'),
  }));
  expect(after.tables).toBe(0); // 整删（不再 silent no-op）
  expect(after.editing).toBe(true); // 补的空段落已进编辑
  await page.keyboard.type('重新开始');
  await page.waitForTimeout(150);
  const html = await serialize();
  expect(html).toContain('重新开始');
  expect(await conformOf(html)).toBe(true);
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
