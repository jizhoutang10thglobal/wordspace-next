// Callout 维度对拍探针（align-notion 阶段一）——**只记录、不断言**，取证不是门。
// 读数写 JSON 到 PROBE_OUT，截图写 SHOTS_DIR；红圈标注一律画在**外层窗口**（注进 iframe
// 会让编辑器把 .ws-grip 藏掉 = 假证据）。骨架抄 e2e/probe-b2.spec.js（不改那个文件）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2b2shots-callout');
const OUT = process.env.PROBE_OUT || path.join(SHOTS, 'readings.json');
const CLIP = { x: 150, y: 20, width: 1050, height: 640 };
let app, page, frame, tmpDir;
const readings = [];

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2co-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
}

// 每份 fixture 带唯一哨兵 id 并校验可见——open-file IPC 约 1/8 概率静默不生效
async function openDoc(body, sentinelId, settle) {
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>probe</title></head><body>' + body + '</body></html>';
  const p = path.join(tmpDir, 'doc-' + sentinelId + '-' + Date.now() + '.html');
  await fs.writeFile(p, html, 'utf8');
  frame = page.frameLocator('#doc-frame');
  // open-file IPC 约 1/8 概率静默不生效 → 重发（哨兵 id 校验是唯一判据）
  let ok = false;
  for (let i = 0; i < 4 && !ok; i++) {
    await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
    ok = await frame.locator('#' + sentinelId).waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    if (!ok) await page.waitForTimeout(600);
  }
  await expect(frame.locator('#' + sentinelId)).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(settle == null ? 1200 : settle); // 躲开开文档后的自动保存 reload 竞态
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
  return {
    x: box.x + r.x + (o.dx != null ? o.dx : r.w / 2),
    y: box.y + r.y + (o.dy != null ? o.dy : r.h / 2),
    inner: r,
  };
}

// ⚠ 标注必须走 CSSOM 逐条 setProperty（CSP style-src 无 unsafe-inline，整条 style 属性会被拦 = 哑标注）
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
  if (diag.w !== 18 || diag.h !== 18) throw new Error('哑标注：红圈几何 ' + JSON.stringify(diag));
}
const unmark = () => page.evaluate(() => { const m = document.getElementById('__probe_cursor'); if (m) m.remove(); });

async function shot(name, pt) {
  if (pt) await markOuter(pt);
  await page.waitForTimeout(200);
  await fs.mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), clip: CLIP });
  if (pt) await unmark();
}

async function hoverAt(pt) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(80);
  await page.mouse.move(pt.x, pt.y, { steps: 8 });
  await page.waitForTimeout(280);
}

const gripState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const g = d.querySelector('.ws-grip');
  if (!g) return { present: false };
  const st = d.defaultView.getComputedStyle(g);
  const b = g.getBoundingClientRect();
  return {
    present: true, display: st.display,
    visible: st.display !== 'none' && b.width > 0,
    x: Math.round(b.x), y: Math.round(b.y), h: Math.round(b.height),
    cy: Math.round(b.y + b.height / 2),
  };
});

const rectOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), cy: Math.round(b.y + b.height / 2) };
}, sel);

// 块菜单项文本（叶子节点）
const blockMenuItems = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const m = d.querySelector('.ws-blockmenu');
  if (!m || m.style.display === 'none') return null;
  return [...m.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.trim())
    .map((n) => n.textContent.trim());
});

// 气泡「转为」面板项 + 是否被标为「当前类型」
const turnMenuItems = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const m = d.querySelector('.ws-fmtbar-menu');
  if (!m || m.style.display === 'none') return null;
  return [...m.querySelectorAll('.ws-fmtbar-menu-item')].map((n) => ({
    text: n.textContent.trim(), key: n.dataset.key,
    on: n.classList.contains('ws-fmtbar-menu-item--on'),
  }));
});

const slashItems = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const m = d.querySelector('.ws-slashmenu');
  if (!m || m.style.display === 'none') return null;
  return [...m.querySelectorAll('.ws-slashmenu-item')].map((n) => n.textContent.trim());
});

// 文档结构快照
const docSnap = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const body = d.body;
  const kids = [...body.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui') && c.tagName !== 'STYLE');
  return {
    calloutCount: d.querySelectorAll('.ws-callout').length,
    calloutInnerP: [...d.querySelectorAll('.ws-callout')].map((c) => c.querySelectorAll(':scope > p').length),
    calloutTexts: [...d.querySelectorAll('.ws-callout')].map((c) => (c.textContent || '').replace(/\s+/g, '')),
    order: kids.map((c) => c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') + (c.className ? '.' + String(c.className).trim().replace(/\s+/g, '.') : '')),
    bodyText: (body.innerText || body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
  };
});

// 点击 iframe 内元素（真鼠标）
async function clickEl(sel, opts) {
  const pt = await toOuter(sel, opts);
  if (!pt) throw new Error('元素不存在: ' + sel);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  return pt;
}
// 点手柄（真鼠标）
async function clickGrip() {
  const g = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.querySelector('.ws-grip');
    if (!el) return null;
    const st = d.defaultView.getComputedStyle(el);
    if (st.display === 'none') return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  if (!g) return null;
  const box = await page.locator('#doc-frame').boundingBox();
  const pt = { x: box.x + g.x, y: box.y + g.y };
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(350);
  return pt;
}
// 按文本点菜单项（真鼠标）
async function clickByText(containerSel, text) {
  const box = await page.locator('#doc-frame').boundingBox();
  const p = await page.evaluate(({ c, t }) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const m = d.querySelector(c); if (!m) return null;
    // 菜单项结构是 <button><svg/><span>文案</span></button>：按「文本命中的最深节点」找，再用它的 rect
    const cands = [...m.querySelectorAll('*')].filter((n) => n.textContent.trim() === t);
    const hit = cands[cands.length - 1];
    if (!hit) return null;
    const b = hit.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, { c: containerSel, t: text });
  if (!p) return null;
  const pt = { x: box.x + p.x, y: box.y + p.y };
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(400);
  return pt;
}

// 光标 / 选区（DOM Range；Meta+Arrow 那套定位不可信）
const setCaret = (sel, offset) => page.evaluate(({ s, o }) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  const tn = (function first(n) { for (const c of n.childNodes) { if (c.nodeType === 3) return c; const r = first(c); if (r) return r; } return null; })(el);
  const r = d.createRange();
  if (tn) { r.setStart(tn, Math.min(o, tn.length)); } else { r.setStart(el, 0); }
  r.collapse(true);
  const g = d.getSelection(); g.removeAllRanges(); g.addRange(r);
  return { text: tn ? tn.data : null, offset: o };
}, { s: sel, o: offset });

const setCaretEnd = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  const r = d.createRange(); r.selectNodeContents(el); r.collapse(false);
  const g = d.getSelection(); g.removeAllRanges(); g.addRange(r);
  return true;
}, sel);

const selectAll = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  const r = d.createRange(); r.selectNodeContents(el);
  const g = d.getSelection(); g.removeAllRanges(); g.addRange(r);
  return (g.toString() || '').slice(0, 40);
}, sel);

const selectAcross = (s1, o1, s2, o2) => page.evaluate(({ a, ao, b, bo }) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const ea = d.querySelector(a), eb = d.querySelector(b);
  if (!ea || !eb) return null;
  const firstText = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) return c; const r = firstText(c); if (r) return r; } return null; };
  const ta = firstText(ea), tb = firstText(eb);
  const r = d.createRange();
  r.setStart(ta, Math.min(ao, ta.length));
  r.setEnd(tb, bo < 0 ? tb.length : Math.min(bo, tb.length));
  const g = d.getSelection(); g.removeAllRanges(); g.addRange(r);
  return (g.toString() || '').replace(/\s+/g, ' ').slice(0, 60);
}, { a: s1, ao: o1, b: s2, bo: o2 });

const rangeSelInfo = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const els = [...d.querySelectorAll('[data-ws2-rangesel]')];
  return {
    count: els.length,
    els: els.map((e) => ({
      tag: e.tagName, id: e.id || null, cls: e.className || null,
      bg: d.defaultView.getComputedStyle(e).backgroundColor,
      text: (e.textContent || '').replace(/\s+/g, '').slice(0, 12),
    })),
  };
});

const selectedInfo = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const e = d.querySelector('[data-ws2-selected]');
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return {
    tag: e.tagName, id: e.id || null, cls: e.className || null,
    h: Math.round(b.height), y: Math.round(b.y),
    outline: d.defaultView.getComputedStyle(e).outlineColor + ' / ' + d.defaultView.getComputedStyle(e).boxShadow.slice(0, 40),
    text: (e.textContent || '').replace(/\s+/g, '').slice(0, 14),
  };
});

const pseudoBefore = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  const cs = d.defaultView.getComputedStyle(el, '::before');
  return { content: cs.content, html: el.innerHTML.slice(0, 60), empty: el.childNodes.length === 0, editing: el.hasAttribute('data-ws2-editing') };
}, sel);

// 合成 DragEvent（绝不用真鼠标：HTML5 原生 DnD 会让 mouse.down+move 进 drag loop 卡死 Electron）
const dragStartFromGrip = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const g = d.querySelector('.ws-grip');
  if (!g) return { ok: false, why: 'no grip' };
  const b = g.getBoundingClientRect();
  const dt = new (d.defaultView.DataTransfer)();
  const ev = new (d.defaultView.DragEvent)('dragstart', { bubbles: true, cancelable: true, composed: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2, dataTransfer: dt });
  g.dispatchEvent(ev);
  return { ok: true, gripRect: { x: Math.round(b.x), y: Math.round(b.y) } };
});
const dragOverOn = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const t = d.querySelector(s); if (!t) return { ok: false };
  const b = t.getBoundingClientRect();
  const dt = new (d.defaultView.DataTransfer)();
  t.dispatchEvent(new (d.defaultView.DragEvent)('dragover', { bubbles: true, cancelable: true, composed: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2, dataTransfer: dt }));
  const marked = d.querySelector('[data-ws2-drop]');
  return { ok: true, dropMarker: marked ? { tag: marked.tagName, id: marked.id || null, cls: marked.className || null, side: marked.getAttribute('data-ws2-drop') } : null };
}, sel);
const dropOn = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const t = d.querySelector(s); if (!t) return { ok: false };
  const b = t.getBoundingClientRect();
  const dt = new (d.defaultView.DataTransfer)();
  t.dispatchEvent(new (d.defaultView.DragEvent)('drop', { bubbles: true, cancelable: true, composed: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2, dataTransfer: dt }));
  const g = d.querySelector('.ws-grip');
  if (g) g.dispatchEvent(new (d.defaultView.DragEvent)('dragend', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
  return { ok: true };
}, sel);

const parentOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  const p = el.parentElement;
  return { parentTag: p && p.tagName, parentId: (p && p.id) || null, parentCls: (p && p.className) || null, inCallout: !!(el.closest && el.closest('.ws-callout')) };
}, sel);

function record(factId, data) { readings.push({ factId, ...data }); }

// ---- fixtures（每份带唯一哨兵 id）----
const F3 = (sid) => '<p id="' + sid + '">哨兵段落</p>'
  + '<div class="ws-callout" id="co"><p id="cp1">甲段文字</p><p id="cp2">乙段文字</p><p id="cp3">丙段文字</p></div>'
  + '<p id="tail">尾部段落</p>';
const F1 = (sid) => '<p id="' + sid + '">哨兵段落</p>'
  + '<div class="ws-callout" id="co">甲乙</div>'
  + '<p id="tail">尾部段落</p>';

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

// ===== C1：3 段 callout 上逐段悬停，手柄纵向位置有几个 =====
test('C1 手柄纵向位置', async () => {
  await launch();
  await openDoc(F3('s1'), 's1');
  const per = [];
  for (const id of ['cp1', 'cp2', 'cp3']) {
    const pt = await toOuter('#' + id, { dx: 20, dy: 8 });
    await hoverAt(pt);
    const g = await gripState();
    per.push({ hovered: id, grip: g, p: await rectOf('#' + id) });
    await shot('C1-hover-' + id + '.png', pt);
  }
  const ys = per.filter((x) => x.grip.visible).map((x) => x.grip.y);
  record('C1', {
    callout: await rectOf('#co'), per,
    手柄纵向位置去重: [...new Set(ys)], 去重后个数: new Set(ys).size,
    shots: ['C1-hover-cp1.png', 'C1-hover-cp2.png', 'C1-hover-cp3.png'],
  });
});

// ===== C2：悬停第 2 段开菜单 →「删除」删掉谁 =====
test('C2 菜单删除作用域', async () => {
  await launch();
  await openDoc(F3('s2'), 's2');
  const before = await docSnap();
  const pt = await toOuter('#cp2', { dx: 20, dy: 8 });
  await hoverAt(pt);
  const g = await gripState();
  const gp = await clickGrip();
  const items = await blockMenuItems();
  if (gp) await shot('C2-menu.png', gp);
  const delPt = await clickByText('.ws-blockmenu', '删除');
  await page.waitForTimeout(400);
  const after = await docSnap();
  await shot('C2-after-delete.png', delPt || undefined);
  record('C2', { before, 手柄: g, 菜单项: items, 点了删除: !!delPt, after, shots: ['C2-menu.png', 'C2-after-delete.png'] });
});

// ===== C3：普通段落的两个「转为」入口里有没有 callout =====
test('C3 转为面板是否含 callout 入口', async () => {
  await launch();
  await openDoc('<p id="s3">哨兵段落</p><p id="plain">这是一段普通文字</p>', 's3');
  // ① 气泡「转为」
  await clickEl('#plain', { dx: 30, dy: 8 });
  await selectAll('#plain');
  await page.waitForTimeout(350);
  const turnBtnPt = await toOuter('button.ws-fmtbar-btn.ws-fmtbar-text');
  let bubbleItems = null;
  if (turnBtnPt) {
    await page.mouse.click(turnBtnPt.x, turnBtnPt.y);
    await page.waitForTimeout(400);
    bubbleItems = await turnMenuItems();
    await shot('C3-bubble-turnmenu.png', turnBtnPt);
  }
  // ② 块菜单
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const pt = await toOuter('#plain', { dx: 20, dy: 8 });
  await hoverAt(pt);
  const gp = await clickGrip();
  const menu = await blockMenuItems();
  if (gp) await shot('C3-blockmenu.png', gp);
  record('C3', {
    气泡转为项: bubbleItems, 气泡里有提示: !!(bubbleItems || []).some((x) => x.text === '提示' || x.key === 'callout'),
    块菜单项: menu, 块菜单里有提示: !!(menu || []).some((t) => t.indexOf('提示') >= 0),
    shots: ['C3-bubble-turnmenu.png', 'C3-blockmenu.png'],
  });
});

// ===== C4：转为面板里有没有「当前类型」高亮（对照组 blockquote）=====
test('C4 当前类型高亮', async () => {
  await launch();
  await openDoc('<p id="s4">哨兵段落</p><div class="ws-callout" id="co">提示文字内容</div><blockquote id="q">引用文字内容</blockquote>', 's4');
  const openTurn = async () => {
    const b = await toOuter('button.ws-fmtbar-btn.ws-fmtbar-text');
    if (!b) return { items: null, pt: null };
    await page.mouse.click(b.x, b.y);
    await page.waitForTimeout(400);
    return { items: await turnMenuItems(), pt: b };
  };
  // 主组：callout
  await clickEl('#co', { dx: 30, dy: 12 });
  await selectAll('#co');
  await page.waitForTimeout(350);
  const a = await openTurn();
  if (a.pt) await shot('C4-callout-turnmenu.png', a.pt);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  // 对照组：blockquote（证明探针能读到高亮）
  await clickEl('#q', { dx: 30, dy: 8 });
  await selectAll('#q');
  await page.waitForTimeout(350);
  const b = await openTurn();
  if (b.pt) await shot('C4-quote-turnmenu.png', b.pt);
  record('C4', {
    callout组: { items: a.items, on: (a.items || []).filter((x) => x.on), onCount: (a.items || []).filter((x) => x.on).length },
    对照组blockquote: { on: (b.items || []).filter((x) => x.on), onCount: (b.items || []).filter((x) => x.on).length },
    shots: ['C4-callout-turnmenu.png', 'C4-quote-turnmenu.png'],
  });
});

// ===== C5：光标在第 2 段时「在下方插入」落在框内还是框外 =====
test('C5 在下方插入落点', async () => {
  await launch();
  await openDoc(F3('s5'), 's5');
  const before = await docSnap();
  await clickEl('#cp2', { dx: 30, dy: 8 });
  const gp = await clickGrip();
  const items = await blockMenuItems();
  if (gp) await shot('C5-menu.png', gp);
  const ip = await clickByText('.ws-blockmenu', '在下方插入');
  await page.waitForTimeout(300);
  await page.keyboard.type('X插入');
  await page.waitForTimeout(400);
  const where = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const all = [...d.body.querySelectorAll('*')].filter((n) => n.children.length === 0 && (n.textContent || '').indexOf('X插入') >= 0);
    const el = all[all.length - 1];
    if (!el) return null;
    const host = el.closest('.ws-callout');
    return { tag: el.tagName, id: el.id || null, inCallout: !!host, parentTag: el.parentElement && el.parentElement.tagName, parentCls: (el.parentElement && el.parentElement.className) || null };
  });
  const after = await docSnap();
  await shot('C5-after-insert.png', ip || undefined);
  record('C5', { before, 菜单项: items, 新块: where, after, shots: ['C5-menu.png', 'C5-after-insert.png'] });
});

// ===== C6：文字末尾 Enter =====
test('C6 末尾 Enter', async () => {
  await launch();
  await openDoc(F1('s6'), 's6');
  const b6 = await docSnap();
  const h6 = await rectOf('#co');
  await clickEl('#co', { dx: 30, dy: 12 });
  await setCaretEnd('#co');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await page.keyboard.type('X续写');
  await page.waitForTimeout(400);
  const w6 = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const all = [...d.body.querySelectorAll('*')].filter((n) => n.children.length === 0 && (n.textContent || '').indexOf('X续写') >= 0);
    const el = all[all.length - 1];
    if (!el) return null;
    return { tag: el.tagName, inCallout: !!el.closest('.ws-callout'), parentTag: el.parentElement && el.parentElement.tagName, parentCls: (el.parentElement && el.parentElement.className) || null };
  });
  const a6 = await docSnap();
  record('C6', { before: b6, calloutHeightBefore: h6, X落点: w6, after: a6, calloutHeightAfter: await rectOf('#co'), shots: ['C6-after-enter-end.png'] });
  await shot('C6-after-enter-end.png');
});

// ===== C7：文字中间 Enter =====
test('C7 中间 Enter', async () => {
  await launch();
  await openDoc(F1('s7'), 's7');
  const b7 = await docSnap();
  await clickEl('#co', { dx: 30, dy: 12 });
  const caret = await setCaret('#co', 1);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const a7 = await docSnap();
  await shot('C7-after-enter-middle.png');
  record('C7', { before: b7, caret, after: a7, shots: ['C7-after-enter-middle.png'] });
});

// ===== C8①：单段 callout 首行行首 Backspace =====
test('C8a 单段 Backspace', async () => {
  await launch();
  await openDoc('<p id="s8a">哨兵段落</p><p id="up">上块文字</p><div class="ws-callout" id="co">甲</div>', 's8a');
  const b1 = await docSnap();
  await clickEl('#co', { dx: 30, dy: 12 });
  const c1 = await setCaret('#co', 0);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(450);
  const a1 = await docSnap();
  const up1 = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const e = d.querySelector('#up'); return e ? (e.textContent || '').replace(/\s+/g, '') : null;
  });
  await shot('C8-single-after-backspace.png');
  record('C8-单段', { before: b1, caret: c1, after: a1, 上块文本: up1, shots: ['C8-single-after-backspace.png'] });
});

// ===== C8②：多段 callout 首行行首 Backspace =====
test('C8b 多段 Backspace', async () => {
  await launch();
  await openDoc('<p id="s8b">哨兵段落</p><p id="up">上块文字</p><div class="ws-callout" id="co"><p id="cp1">甲</p><p id="cp2">乙</p></div>', 's8b');
  const b2 = await docSnap();
  await clickEl('#cp1', { dx: 20, dy: 8 });
  const c2 = await setCaret('#cp1', 0);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(450);
  const a2 = await docSnap();
  const up2 = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const e = d.querySelector('#up'); return e ? (e.textContent || '').replace(/\s+/g, '') : null;
  });
  await shot('C8-multi-after-backspace.png');
  record('C8-多段', { before: b2, caret: c2, after: a2, 上块文本: up2, shots: ['C8-multi-after-backspace.png'] });
});

// ===== C9：第 2 段按 Esc，选中的是谁 =====
test('C9 Esc 选中粒度', async () => {
  await launch();
  await openDoc(F3('s9'), 's9');
  const pt = await clickEl('#cp2', { dx: 30, dy: 8 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const sel = await selectedInfo();
  const rCo = await rectOf('#co');
  const rP2 = await rectOf('#cp2');
  await shot('C9-esc-selected.png', pt);
  record('C9', {
    选中元素: sel, callout几何: rCo, 第二段几何: rP2,
    高度比_选中除以段: sel && rP2 ? +(sel.h / rP2.h).toFixed(2) : null,
    shots: ['C9-esc-selected.png'],
  });
});

// ===== C10：框内跨段选区有没有块级高亮（带跨顶层块对照组）=====
test('C10 框内跨段选区高亮', async () => {
  await launch();
  await openDoc(F3('s10'), 's10');
  // 主组 A：第 1 段中部 → 第 2 段末（statement 原描述）
  const s1 = await selectAcross('#cp1', 2, '#cp2', -1);
  await page.waitForTimeout(400);
  const mainA = await rangeSelInfo();
  await shot('C10-inside-callout.png');
  // 主组 B：第 1 段**行首** → 第 2 段末（两段都被完整罩住，排除「没全罩才不标」的解释）
  const s1b = await selectAcross('#cp1', 0, '#cp2', -1);
  await page.waitForTimeout(400);
  const mainB = await rangeSelInfo();
  await shot('C10-inside-callout-full.png');
  // 对照组：哨兵段**行首** → 第 2 段末（跨顶层块，哨兵段被完整罩住 → 该标 1 个）
  const s2 = await selectAcross('#s10', 0, '#cp2', -1);
  await page.waitForTimeout(400);
  const ctrl = await rangeSelInfo();
  await shot('C10-control-crossblock.png');
  record('C10', {
    主组A_框内跨段部分罩: { 选中文本: s1, ...mainA },
    主组B_框内跨段全罩: { 选中文本: s1b, ...mainB },
    对照组_跨顶层块全罩: { 选中文本: s2, ...ctrl },
    shots: ['C10-inside-callout.png', 'C10-inside-callout-full.png', 'C10-control-crossblock.png'],
  });
});

const FD = (sid) => '<p id="' + sid + '">哨兵段落</p><p id="m">要拖的段落</p>'
  + '<div class="ws-callout" id="co"><p id="cp1">甲段文字</p><p id="cp2">乙段文字</p><p id="cp3">丙段文字</p></div>';

// ===== C11：把上方段落拖到 callout 第 2 段上（合成 DragEvent）=====
test('C11 拖进框内', async () => {
  await launch();
  await openDoc(FD('s11'), 's11');
  const b11 = await docSnap();
  const hp = await toOuter('#m', { dx: 20, dy: 8 });
  await hoverAt(hp);
  const g11 = await gripState();
  const ds11 = await dragStartFromGrip();
  const do11 = await dragOverOn('#cp2');
  await shot('C11-dragover-marker.png', hp);
  await dropOn('#cp2');
  await page.waitForTimeout(400);
  const a11 = await docSnap();
  const p11 = await parentOf('#m');
  await shot('C11-after-drop.png');
  record('C11', { before: b11, 手柄: g11, dragstart: ds11, dragover: do11, 被拖块归属: p11, after: a11, shots: ['C11-dragover-marker.png', 'C11-after-drop.png'] });
});

// ===== C12（C11 的正对照）：拖 callout 自己的手柄到另一顶层块上 =====
test('C12 整框重排正对照', async () => {
  await launch();
  await openDoc(FD('s12'), 's12');
  const b12 = await docSnap();
  const hp2 = await toOuter('#cp1', { dx: 20, dy: 8 });
  await hoverAt(hp2);
  const g12 = await gripState();
  const ds12 = await dragStartFromGrip();
  const do12 = await dragOverOn('#m');
  await dropOn('#m');
  await page.waitForTimeout(400);
  const a12 = await docSnap();
  await shot('C12-after-drop.png');
  record('C12', { before: b12, 手柄: g12, dragstart: ds12, dragover: do12, after: a12, shots: ['C12-after-drop.png'] });
});

// ===== C13：空 callout 里走斜杠菜单选「无序列表」=====
test('C13 空框内斜杠作用域', async () => {
  await launch();
  await openDoc('<p id="s13">哨兵段落</p><div class="ws-callout" id="co"><br></div><p id="tail">尾部段落</p>', 's13');
  const before = await docSnap();
  await clickEl('#co', { dx: 30, dy: 12 });
  await page.keyboard.type('/');
  await page.waitForTimeout(500);
  const items = await slashItems();
  await shot('C13-slashmenu.png');
  const p = await clickByText('.ws-slashmenu', '无序列表');
  await page.waitForTimeout(450);
  const after = await docSnap();
  const ulInfo = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const ul = d.querySelector('body ul');
    if (!ul) return null;
    return { parentTag: ul.parentElement && ul.parentElement.tagName, parentCls: (ul.parentElement && ul.parentElement.className) || null, inCallout: !!ul.closest('.ws-callout') };
  });
  await shot('C13-after-choose-list.png', p || undefined);
  record('C13', { before, 斜杠菜单项: items, 新列表归属: ulInfo, after, shots: ['C13-slashmenu.png', 'C13-after-choose-list.png'] });
});

// ===== C14：空 callout 有没有占位提示（对照组：新建空 p）=====
test('C14 空框占位文案', async () => {
  await launch();
  await openDoc('<p id="s14">哨兵段落</p><div class="ws-callout" id="co"><br></div><p id="tail">尾部段落</p>', 's14');
  const pt = await clickEl('#co', { dx: 30, dy: 12 });
  await page.waitForTimeout(300);
  const co = await pseudoBefore('#co');
  await shot('C14-empty-callout.png', pt);
  // 对照组：在哨兵段末回车造一个空 p（进编辑态），读它的 ::before
  await clickEl('#s14', { dx: 30, dy: 8 });
  await setCaretEnd('#s14');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const ctrl = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.querySelector('p[data-ws2-editing]');
    if (!el) return null;
    const cs = d.defaultView.getComputedStyle(el, '::before');
    return { content: cs.content, empty: el.childNodes.length === 0, html: el.innerHTML.slice(0, 40) };
  });
  await shot('C14-control-empty-p.png');
  record('C14', { 空callout: co, 对照组_新建空p: ctrl, shots: ['C14-empty-callout.png', 'C14-control-empty-p.png'] });
});
