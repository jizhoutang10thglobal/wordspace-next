// 对拍探针 · 表格维度（align-notion 阶段一：**只记录、不断言**，取证不是门）。
// 事实清单见 scratchpad/recon/table.json 的 facts（T1-T14）。骨架抄自 e2e/probe-b2.spec.js（不改那个文件）。
// 读数写 PROBE_OUT，截图写 SHOTS_DIR；红圈一律走 CSSOM setProperty 画在**外层窗口**（CSP style-src 无 unsafe-inline）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2b2shots', 'table');
const OUT = process.env.PROBE_OUT || path.join(SHOTS, 'readings.json');
const CLIP = { x: 180, y: 20, width: 960, height: 700 };
let app, page, frame, tmpDir;
const readings = [];

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2b2t-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
}

// 每份 fixture 带唯一哨兵 id 并校验可见——open-file IPC 约 1/8 概率静默不生效。
async function openDoc(body, sentinelId) {
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>probe</title></head><body>'
    + body + '<p id="' + sentinelId + '">哨兵</p></body></html>';
  const p = path.join(tmpDir, 'doc-' + sentinelId + '.html');
  await fs.writeFile(p, html, 'utf8');
  // open-file IPC 约 1/8 概率静默不生效 → 重发（不重发的话后续读数全跑在旧文档上）
  for (let i = 0; i < 3; i++) {
    await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
    frame = page.frameLocator('#doc-frame');
    try {
      await expect(frame.locator('#' + sentinelId)).toBeVisible({ timeout: 4000 });
      await page.waitForTimeout(450);
      return p;
    } catch (e) {
      if (i === 2) throw e;
      await page.waitForTimeout(700);
    }
  }
  return p;
}

// iframe 内坐标 → 外层窗口坐标
async function toOuter(sel, opts) {
  const box = await page.locator('#doc-frame').boundingBox();
  const r = await page.evaluate((s) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.querySelector(s); if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel);
  if (!r) return null;
  const o = opts || {};
  return { x: box.x + r.x + (o.dx != null ? o.dx : r.w / 2), y: box.y + r.y + (o.dy != null ? o.dy : r.h / 2), inner: r };
}

// ⚠ 标注必须走 CSSOM 逐条 setProperty（CSP style-src 'self' file' 会拦整条 style 属性 = 哑标注）。
async function markOuter(pt) {
  const diag = await page.evaluate(({ x, y }) => {
    const m = document.createElement('div');
    m.id = '__probe_cursor';
    const S = {
      position: 'fixed', left: Math.round(x - 9) + 'px', top: Math.round(y - 9) + 'px',
      width: '18px', height: '18px', border: '3px solid #E5484D', 'border-radius': '50%',
      'z-index': '2147483647', 'pointer-events': 'none', 'box-shadow': '0 0 0 2px rgba(255,255,255,.85)',
      'box-sizing': 'border-box', margin: '0', padding: '0', flex: 'none',
    };
    for (const k in S) m.style.setProperty(k, S[k]);
    document.body.appendChild(m);
    const b = m.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height) };
  }, { x: pt.x, y: pt.y });
  if (diag.w !== 18 || diag.h !== 18) throw new Error('哑标注：红圈几何 ' + JSON.stringify(diag) + '，截图不能当悬停证据');
}
const unmark = () => page.evaluate(() => { const m = document.getElementById('__probe_cursor'); if (m) m.remove(); });

async function shot(name, pt) {
  if (pt) await markOuter(pt);
  await page.waitForTimeout(220);
  await fs.mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), clip: CLIP });
  if (pt) await unmark();
}

// 真鼠标悬停（先移开再移入，制造真实轨迹）
async function hoverAt(pt) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(80);
  await page.mouse.move(pt.x, pt.y, { steps: 8 });
  await page.waitForTimeout(280);
}

// 手柄全量态：数量 + 每个的几何（iframe 内坐标）
const gripState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const gs = [...d.querySelectorAll('.ws-grip')];
  return {
    count: gs.length,
    items: gs.map((g) => {
      const st = d.defaultView.getComputedStyle(g);
      const b = g.getBoundingClientRect();
      return { display: st.display, visible: st.display !== 'none' && b.width > 0,
        x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), cy: Math.round(b.y + b.height / 2) };
    }),
  };
});

// iframe 里所有 overlay（手柄/菜单/气泡/小签…）的可见态——用来查「边缘加行加列入口」是否存在
const overlayState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const out = [];
  const push = (c, where) => {
    const st = d.defaultView.getComputedStyle(c);
    const b = c.getBoundingClientRect();
    out.push({ where, cls: c.className || c.tagName, display: st.display,
      visible: st.display !== 'none' && st.visibility !== 'hidden' && b.width > 0 && b.height > 0,
      x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) });
  };
  [...d.documentElement.children].forEach((c) => { if (c.tagName !== 'HEAD' && c.tagName !== 'BODY') push(c, 'documentElement'); });
  d.body.querySelectorAll('[data-ws2-ui]').forEach((c) => push(c, 'body'));
  return out;
});

const rectOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), cy: Math.round(b.y + b.height / 2) };
}, sel);

// 块菜单结构（项 / 对齐钮 / 色板 / 顺序）
const menuState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const m = d.querySelector('.ws-blockmenu');
  if (!m) return { present: false };
  const st = d.defaultView.getComputedStyle(m);
  if (st.display === 'none') return { present: true, open: false };
  const b = m.getBoundingClientRect();
  return {
    present: true, open: true,
    items: [...m.querySelectorAll('.ws-blockmenu-item')].map((x) => x.textContent.trim()),
    aligns: [...m.querySelectorAll('.ws-blockmenu-alignbtn')].map((x) => ({ t: x.textContent.trim(), on: x.classList.contains('ws-blockmenu-alignbtn--on') })),
    swatches: m.querySelectorAll('.ws-blockmenu-swatch').length,
    rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
  };
});

// 点手柄（不做 hoverAt，避免把 hoverEl 换掉）
async function clickGrip() {
  const box = await page.locator('#doc-frame').boundingBox();
  const g = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.querySelector('.ws-grip'); if (!el) return null;
    const st = d.defaultView.getComputedStyle(el);
    if (st.display === 'none') return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  if (!g) return null;
  const pt = { x: box.x + g.x, y: box.y + g.y };
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(380);
  return pt;
}

// 表格结构真值 + 当前编辑格坐标 + 灰选态
const tableState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const t = d.querySelector('table');
  const cell = d.querySelector('[data-ws2-cell]');
  const sel = d.querySelector('[data-ws2-selected]');
  const cellPos = (() => {
    if (!cell) return null;
    const tr = cell.parentElement; const sect = tr.parentElement;
    return { id: cell.id || null, tag: cell.tagName, section: sect.tagName,
      row: [...sect.children].indexOf(tr), col: [...tr.children].indexOf(cell) };
  })();
  return {
    tables: d.querySelectorAll('table').length,
    bodyRows: t ? t.querySelectorAll('tbody tr').length : 0,
    headRows: t ? t.querySelectorAll('thead tr').length : 0,
    rect: t ? [...t.querySelectorAll('tr')].map((r) => r.children.length) : [],
    texts: t ? [...t.querySelectorAll('tr')].map((r) => [...r.children].map((c) => c.textContent)) : [],
    ghosts: d.querySelectorAll('table:empty, tbody:empty, thead:empty').length,
    cellCount: d.querySelectorAll('[data-ws2-cell]').length,
    cellPos,
    selected: sel ? { tag: sel.tagName, id: sel.id || null } : null,
    topOrder: [...d.body.children].map((e) => e.tagName + (e.id ? '#' + e.id : '')),
  };
});

// 合成 DragEvent（真鼠标驱动块拖拽会把 Electron 卡进 drag loop —— skill 铁律）
const dragStartFromGrip = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const W = d.defaultView;
  const g = d.querySelector('.ws-grip'); if (!g) return { ok: false, why: 'no grip' };
  const st = W.getComputedStyle(g); if (st.display === 'none') return { ok: false, why: 'grip hidden' };
  const dt = new W.DataTransfer(); W.__probeDT = dt;
  const b = g.getBoundingClientRect();
  g.dispatchEvent(new W.DragEvent('dragstart', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }));
  return { ok: true, types: [...dt.types] };
});
const dragEventOn = (sel, type) => page.evaluate(({ s, t }) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const W = d.defaultView;
  const el = d.querySelector(s); if (!el) return { ok: false, why: 'no target ' + s };
  const b = el.getBoundingClientRect();
  el.dispatchEvent(new W.DragEvent(t, { bubbles: true, cancelable: true, composed: true, dataTransfer: W.__probeDT, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }));
  return { ok: true, drops: [...d.querySelectorAll('[data-ws2-drop]')].map((e) => e.tagName + (e.id ? '#' + e.id : '') + ':' + e.getAttribute('data-ws2-drop')) };
}, { s: sel, t: type });

// 程序化设跨格/跨块选区（还原拖选终态；selectionchange 驱动 refreshRangeSel）
const setRange = (aSel, aOff, bSel, bOff) => page.evaluate(({ a, ao, b, bo }) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const A = d.querySelector(a); const B = d.querySelector(b);
  if (!A || !B || !A.firstChild || !B.firstChild) return { ok: false };
  const r = d.createRange();
  r.setStart(A.firstChild, ao); r.setEnd(B.firstChild, bo);
  const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  return { ok: true };
}, { a: aSel, ao: aOff, b: bSel, bo: bOff });

const rangeSelState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const marked = [...d.querySelectorAll('[data-ws2-rangesel]')];
  return {
    markedTags: marked.map((e) => e.tagName + (e.id ? '#' + e.id : '')),
    cellsMarked: d.querySelectorAll('td[data-ws2-rangesel],th[data-ws2-rangesel]').length,
    tableMarked: !!d.querySelector('table[data-ws2-rangesel]'),
    selText: String(d.getSelection()).replace(/\s+/g, ''),
  };
});

function record(factId, data) { readings.push({ factId, ...data }); }

// ---- fixture（与 Notion 侧同构：前后段落包夹 3 列表格；1 表头行 + 2 数据行 = canonical 种子形态）----
const F_TABLE =
  '<p id="p1">前文段落甲</p>'
  + '<table class="ws-table"><thead><tr id="thr"><th scope="col" id="h1">甲</th><th scope="col" id="h2">乙</th><th scope="col" id="h3">丙</th></tr></thead>'
  + '<tbody><tr id="tr1"><td id="c11">十一格</td><td id="c12">十二</td><td id="c13">十三格子</td></tr>'
  + '<tr id="tr2"><td id="c21">廿一</td><td id="c22">廿二格</td><td id="c23">廿三</td></tr></tbody></table>'
  + '<p id="p2">后文段落乙</p>';

// 只有一个数据行的变体（T9b：删掉最后一个数据行）
const F_TABLE_1ROW =
  '<p id="p1">前文段落甲</p>'
  + '<table class="ws-table"><thead><tr><th scope="col">甲</th><th scope="col">乙</th><th scope="col">丙</th></tr></thead>'
  + '<tbody><tr id="tr1"><td id="c11">十一格</td><td id="c12">十二</td><td id="c13">十三</td></tr></tbody></table>'
  + '<p id="p2">后文段落乙</p>';

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null; page = null; frame = null;
});
test.afterAll(async () => {
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(readings, null, 2), 'utf8');
});

// ============ T1：手柄数量与纵坐标是否随行变化 ============
// ============ T2：表格右缘/下缘外侧有没有「加行加列」入口 ============
test('T1/T2：手柄作用单元 + 表格边缘入口', async () => {
  await launch();
  await openDoc(F_TABLE, 's-t1');

  const geom = { table: await rectOf('table'), thr: await rectOf('#thr'), tr1: await rectOf('#tr1'), tr2: await rectOf('#tr2') };
  const hovers = [];
  for (const [label, sel] of [['表头行首格 h1', '#h1'], ['第1数据行首格 c11', '#c11'], ['第2数据行末格 c23', '#c23']]) {
    const pt = await toOuter(sel, { dx: 18, dy: 10 });
    await hoverAt(pt);
    const g = await gripState();
    hovers.push({ label, sel, hoverOuterPt: { x: Math.round(pt.x), y: Math.round(pt.y) }, cell: await rectOf(sel), grip: g });
    await shot('T1-hover-' + sel.slice(1) + '.png', pt);
  }
  record('T1', { geom, hovers });

  // T2：右缘 / 下缘 / 右下角外侧
  const box = await page.locator('#doc-frame').boundingBox();
  const rt = geom.table;
  const edges = [
    ['右缘外+8', { x: box.x + rt.x + rt.w + 8, y: box.y + rt.y + rt.h / 2 }],
    ['下缘外+8', { x: box.x + rt.x + rt.w / 2, y: box.y + rt.y + rt.h + 8 }],
    ['右下角外+8', { x: box.x + rt.x + rt.w + 8, y: box.y + rt.y + rt.h + 8 }],
  ];
  const edgeReadings = [];
  const edgeNames = ['right', 'bottom', 'corner'];
  for (let i = 0; i < edges.length; i++) {
    const [label, pt] = edges[i];
    await hoverAt(pt);
    edgeReadings.push({ label, hoverOuterPt: { x: Math.round(pt.x), y: Math.round(pt.y) }, overlays: await overlayState() });
    await shot('T2-edge-' + edgeNames[i] + '.png', pt);
  }
  record('T2', { tableRect: rt, edges: edgeReadings });
});

// ============ T3：拖拽落点指示线落在行间还是整表上下缘 ============
// ============ T4：拖动的移动单位是一行还是整张表 ============
test('T3/T4：拖拽指示线与移动单位（合成 DragEvent + 正对照）', async () => {
  await launch();
  await openDoc(F_TABLE, 's-t34');

  // 让 hoverEl = table
  const c21 = await toOuter('#c21', { dx: 18, dy: 10 });
  await hoverAt(c21);
  const start = await dragStartFromGrip();
  const seq = [];
  // 先在表内派 dragover（先读表内，避免被后续 p2 的残留标记污染）
  for (const s of ['#c11', '#tr1', '#c23', '#tr2']) seq.push({ over: s, ...(await dragEventOn(s, 'dragover')) });
  await shot('T3-dragover-intable.png', c21);
  // 正对照：同一套合成事件拖到段落上，指示线必须真出现
  const overP2 = await dragEventOn('#p2', 'dragover');
  seq.push({ over: '#p2（正对照）', ...overP2 });
  await shot('T3-dragover-p2-positive-control.png', await toOuter('#p2', { dx: 40, dy: 10 }));
  record('T3', { dragstart: start, sequence: seq, 正对照生效: !!(overP2.drops && overP2.drops.length) });

  const before = await tableState();
  const dropRes = await dragEventOn('#p2', 'drop');
  await page.waitForTimeout(300);
  const after = await tableState();
  await shot('T4-after-drop-on-p2.png', null);
  record('T4', { before: { topOrder: before.topOrder, texts: before.texts }, dropDispatched: dropRes.ok,
    after: { topOrder: after.topOrder, texts: after.texts, bodyRows: after.bodyRows } });

});

// 合成拖拽的正对照：段落→段落必须真重排，否则「表内零指示线/零变更」分不清是真行为还是哑探针
test('T3/T4 正对照：段落拖到段落（合成 DragEvent 必须真生效）', async () => {
  await launch();
  await openDoc(F_TABLE, 's-t34b');
  const p1pt = await toOuter('#p1', { dx: 40, dy: 10 });
  await hoverAt(p1pt);
  await dragStartFromGrip();
  const ctlOver = await dragEventOn('#p2', 'dragover');
  const ctlBefore = (await tableState()).topOrder;
  await dragEventOn('#p2', 'drop');
  await page.waitForTimeout(300);
  record('T4-正对照', { 说明: '段落 p1 拖到 p2 上', dragoverDrops: ctlOver.drops, before: ctlBefore, after: (await tableState()).topOrder });
});

// ============ T5：几个入口 / 菜单装哪些作用域的操作 ============
// ============ T6：菜单开着时界面上标出来的「作用对象」是什么 ============
// ============ T7：同一手柄在 cell 态 vs 灰选态点开，菜单不同 ============
test('T5/T6/T7：菜单作用域 + 作用对象可见性 + 前置状态依赖', async () => {
  await launch();
  await openDoc(F_TABLE, 's-t567');

  // (a) 先点进 #c22 再点手柄
  const c22 = await toOuter('#c22', { dx: 18, dy: 10 });
  await hoverAt(c22);
  await page.mouse.click(c22.x, c22.y);
  await page.waitForTimeout(320);
  const inCellBefore = await tableState();
  const gp = await clickGrip();
  const mA = await menuState();
  const t6 = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const sel = d.querySelector('[data-ws2-selected]');
    return {
      selectedTag: sel ? sel.tagName : null,
      selectedBoxShadow: sel ? d.defaultView.getComputedStyle(sel).boxShadow : null,
      cellsInEdit: d.querySelectorAll('[data-ws2-cell]').length,
      rowBg: [...d.querySelectorAll('table tr')].map((r) => [...r.children].map((c) => d.defaultView.getComputedStyle(c).backgroundColor)),
      rowOutline: [...d.querySelectorAll('table tr')].map((r) => d.defaultView.getComputedStyle(r).boxShadow),
    };
  });
  record('T5', { 前置: 'cell 态（先点 #c22）', activeCellBefore: inCellBefore.cellPos, menu: mA });
  record('T6', { menuOpen: mA.open, ...t6 });
  await shot('T5-menu-in-cell.png', gp);
  await shot('T6-menu-scope-visibility.png', gp);

  // 关菜单
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const afterEsc1 = await menuState();

  // (b) 灰选整表态（点进格 → Esc）再点手柄
  await hoverAt(c22);
  await page.mouse.click(c22.x, c22.y);
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const greyState = await tableState();
  const gp2 = await clickGrip();
  const mB = await menuState();
  record('T7', {
    a_cell态菜单: mA.open ? { items: mA.items, aligns: mA.aligns } : null,
    b_灰选态前置: { selected: greyState.selected, cellCount: greyState.cellCount },
    b_灰选态菜单: mB.open ? { items: mB.items, aligns: mB.aligns } : mB,
    escape关菜单后: afterEsc1,
  });
  if (gp2) await shot('T7-menu-after-esc-greyselect.png', gp2);
});

// ============ T8：「下方插行」的参照单元与插入后的焦点 ============
test('T8：下方插行的参照单元 + 插入后焦点落点', async () => {
  await launch();
  await openDoc(F_TABLE, 's-t8');
  const c22 = await toOuter('#c22', { dx: 18, dy: 10 });
  await hoverAt(c22);
  await page.mouse.click(c22.x, c22.y);
  await page.waitForTimeout(320);
  const before = await tableState();
  const gp = await clickGrip();
  const m = await menuState();
  let clicked = false;
  if (m.open && m.items.includes('下方插行')) {
    await frame.locator('.ws-blockmenu-item', { hasText: '下方插行' }).first().click();
    await page.waitForTimeout(400);
    clicked = true;
  }
  const after = await tableState();
  record('T8', { menuPt: gp, 菜单项: m.items, clicked,
    before: { bodyRows: before.bodyRows, rect: before.rect, cellPos: before.cellPos, texts: before.texts },
    after: { bodyRows: after.bodyRows, rect: after.rect, cellPos: after.cellPos, texts: after.texts } });
  await shot('T8-after-insert-row-below.png', null);
});

// ============ T9：退化态（连删列到最后一列 / 删掉最后一个数据行）============
test('T9：退化态收敛语义', async () => {
  await launch();
  await openDoc(F_TABLE, 's-t9a');
  const steps = [];
  for (let i = 0; i < 3; i++) {
    const st0 = await tableState();
    if (!st0.tables) { steps.push({ i, note: '表已消失，停止', state: st0 }); break; }
    const cellPt = await toOuter('tbody td', { dx: 14, dy: 10 });
    await hoverAt(cellPt);
    await page.mouse.click(cellPt.x, cellPt.y);
    await page.waitForTimeout(300);
    await clickGrip();
    const m = await menuState();
    if (!(m.open && m.items.includes('删除本列'))) { steps.push({ i, note: '菜单里没有删除本列', menu: m }); break; }
    await frame.locator('.ws-blockmenu-item', { hasText: '删除本列' }).first().click();
    await page.waitForTimeout(420);
    const st1 = await tableState();
    steps.push({ i, after: { tables: st1.tables, rect: st1.rect, ghosts: st1.ghosts, bodyRows: st1.bodyRows, topOrder: st1.topOrder } });
  }
  record('T9a', { 连删列: steps });
  await shot('T9a-after-delete-all-cols.png', null);

  // (b) 只有一个数据行 → 删除本行
  await openDoc(F_TABLE_1ROW, 's-t9b');
  const c11 = await toOuter('#c11', { dx: 14, dy: 10 });
  await hoverAt(c11);
  await page.mouse.click(c11.x, c11.y);
  await page.waitForTimeout(300);
  await clickGrip();
  const m2 = await menuState();
  let ok2 = false;
  if (m2.open && m2.items.includes('删除本行')) {
    await frame.locator('.ws-blockmenu-item', { hasText: '删除本行' }).first().click();
    await page.waitForTimeout(420); ok2 = true;
  }
  const st2 = await tableState();
  record('T9b', { clicked: ok2, 菜单项: m2.items, after: { tables: st2.tables, headRows: st2.headRows, bodyRows: st2.bodyRows, texts: st2.texts, ghosts: st2.ghosts, cellPos: st2.cellPos } });
  await shot('T9b-after-delete-last-datarow.png', null);
});

// ============ T10：格中间按 Enter ============
// ============ T11：最后一格按 Tab ============
test('T10/T11：Enter 与 Tab 的作用单元', async () => {
  await launch();
  await openDoc(F_TABLE, 's-t10');
  const c12 = await toOuter('#c12', { dx: 14, dy: 10 });
  await hoverAt(c12);
  await page.mouse.click(c12.x, c12.y);
  await page.waitForTimeout(300);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  const caret = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.getSelection();
    return s.rangeCount ? { node: s.anchorNode && s.anchorNode.textContent, off: s.anchorOffset, collapsed: s.isCollapsed } : null;
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const st = await tableState();
  const detail = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { c12: d.getElementById('c12') ? d.getElementById('c12').textContent : null,
      c12html: d.getElementById('c12') ? d.getElementById('c12').innerHTML : null,
      divsInCells: d.querySelectorAll('td div, th div').length,
      brsInC12: d.getElementById('c12') ? d.getElementById('c12').querySelectorAll('br').length : null };
  });
  record('T10', { caretBeforeEnter: caret, afterCellPos: st.cellPos, bodyRows: st.bodyRows, rect: st.rect, ...detail });
  await shot('T10-after-enter-mid-cell.png', null);

  // T11：末行末列 Tab
  await openDoc(F_TABLE, 's-t11');
  const c23 = await toOuter('#c23', { dx: 14, dy: 10 });
  await hoverAt(c23);
  await page.mouse.click(c23.x, c23.y);
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  const b4 = await tableState();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(320);
  const af = await tableState();
  record('T11', { before: { bodyRows: b4.bodyRows, cellPos: b4.cellPos },
    after: { bodyRows: af.bodyRows, rect: af.rect, cellPos: af.cellPos, texts: af.texts } });
  await shot('T11-after-tab-on-last-cell.png', null);
});

// ============ T12：格内连按 ⌘A 的分档序列 ============
test('T12：格内 ⌘A 分档序列', async () => {
  await launch();
  await openDoc(F_TABLE, 's-t12');
  const c12 = await toOuter('#c12', { dx: 14, dy: 10 });
  await hoverAt(c12);
  await page.mouse.click(c12.x, c12.y);
  await page.waitForTimeout(300);
  const tiers = [];
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(260);
    const r = await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      const sel = d.querySelector('[data-ws2-selected]');
      return {
        selText: String(d.getSelection()).replace(/\s+/g, ''),
        selectedTag: sel ? sel.tagName + (sel.id ? '#' + sel.id : '') : null,
        cellsInEdit: d.querySelectorAll('[data-ws2-cell]').length,
        rangeSelMarked: [...d.querySelectorAll('[data-ws2-rangesel]')].map((e) => e.tagName + (e.id ? '#' + e.id : '')),
      };
    });
    tiers.push({ 第几次: i, ...r });
    await shot('T12-tier' + i + '.png', null);
  }
  record('T12', { tiers });
});

// ============ T13：同表跨格选区是线性行主序跨度还是矩形 ============
test('T13：同表跨格选区的被罩集形状', async () => {
  await launch();
  await openDoc(F_TABLE, 's-t13');
  const c11 = await toOuter('#c11', { dx: 14, dy: 10 });
  await hoverAt(c11);
  await page.mouse.click(c11.x, c11.y);
  await page.waitForTimeout(300);

  // 正对照：选区落在单格内部 → 被标格数必须为 0（证明不是恒标）
  await setRange('#c11', 0, '#c11', 2);
  await page.waitForTimeout(220);
  const ctl = await rangeSelState();

  // 正题：c11 中 → c22 中
  await setRange('#c11', 1, '#c22', 2);
  await page.waitForTimeout(250);
  const hl = await rangeSelState();
  const cellIds = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('td[data-ws2-rangesel],th[data-ws2-rangesel]')].map((c) => c.id || c.textContent);
  });
  await shot('T13-rangesel-c11-to-c22.png', null);

  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  const after = await tableState();
  record('T13', { 正对照_单格内选区: ctl, 跨格选区: hl, 被罩格ID集: cellIds,
    删后: { bodyRows: after.bodyRows, rect: after.rect, texts: after.texts, cellPos: after.cellPos } });
  await shot('T13-after-backspace.png', null);
});

// ============ T14：一端在表内一端在表外的选区，删除单位 ============
test('T14：跨块选区端点落表内的删除单位（双向）', async () => {
  await launch();
  await openDoc(F_TABLE, 's-t14a');
  const c21 = await toOuter('#c21', { dx: 14, dy: 10 });
  await hoverAt(c21);
  await page.mouse.click(c21.x, c21.y);
  await page.waitForTimeout(300);
  await setRange('#c21', 1, '#p2', 2);
  await page.waitForTimeout(260);
  const out = await rangeSelState();
  await shot('T14-out-rangesel-c21-to-p2.png', null);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(320);
  const afterOut = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { tables: d.querySelectorAll('table').length, p2: d.getElementById('p2') ? d.getElementById('p2').textContent : null,
      topOrder: [...d.body.children].map((e) => e.tagName + (e.id ? '#' + e.id : '')) };
  });
  const conformOut = await page.evaluate(async () => {
    const doc = document.getElementById('doc-frame').contentDocument;
    const html = WS2Serialize.serializeDocument(doc);
    const p = new DOMParser().parseFromString(html, 'text/html');
    return WS2SchemaRegistry.classify(p).conform;
  }).catch((e) => 'ERR:' + e.message);
  record('T14-出向', { 选区高亮: out, 删后: afterOut, 磁盘合规: conformOut });
  await shot('T14-out-after-backspace.png', null);

  // 反向：p1 → c11
  await openDoc(F_TABLE, 's-t14b');
  const p1 = await toOuter('#p1', { dx: 30, dy: 10 });
  await hoverAt(p1);
  await page.mouse.click(p1.x, p1.y);
  await page.waitForTimeout(300);
  await setRange('#p1', 2, '#c11', 1);
  await page.waitForTimeout(260);
  const inn = await rangeSelState();
  await shot('T14-in-rangesel-p1-to-c11.png', null);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(320);
  const afterIn = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { tables: d.querySelectorAll('table').length, p1: d.getElementById('p1') ? d.getElementById('p1').textContent : null,
      topOrder: [...d.body.children].map((e) => e.tagName + (e.id ? '#' + e.id : '')) };
  });
  record('T14-入向', { 选区高亮: inn, 删后: afterIn });
  await shot('T14-in-after-backspace.png', null);
});
