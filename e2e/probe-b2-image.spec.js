// 对拍探针 · 图片维度（I1-I14）——**只记录、不断言**，取证不是门（align-notion 阶段一）。
// 骨架抄 e2e/probe-b2.spec.js（launch/openDoc 哨兵/toOuter/markOuter 红圈/hoverAt/gripState/menuItems/rectOf/record）。
// 三条硬纪律：① 红圈走 CSSOM setProperty（CSP style-src 'self' file: 会拦整条 style 属性 = 哑标注）；
// ② 红圈画外层窗口，绝不注进 iframe（会让编辑器藏掉 .ws-grip）；③ 块拖拽一律合成 DragEvent，
// 绝不用 Playwright 真鼠标（mouse.down 后 move 进 drag loop 卡死 Electron），且必须配正对照。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2b2shots-image');
const OUT = process.env.PROBE_OUT || path.join(SHOTS, 'readings.json');
const CLIP = { x: 180, y: 20, width: 1000, height: 640 };
let app, page, frame, tmpDir;
const readings = [];

test.beforeEach(() => { test.setTimeout(120000); });

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2b2img-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
}

// 哨兵：id 相同的旧文档会让 toBeVisible 假过（open-file IPC 约 1/8 静默不生效）→ 用**唯一文本**校验
async function openDoc(body, tag) {
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>probe</title></head><body>' + body + '</body></html>';
  const p = path.join(tmpDir, 'doc-' + tag + '.html');
  await fs.writeFile(p, html, 'utf8');
  // 吸收上一份文档挂起的自动保存(1.2s)+磁盘 watcher reload——不等的话旧文档的 reload 会盖掉刚开的新文档
  // （实测：i4b 拖拽改脏后立刻开 i4c，8 秒后哨兵仍是 i4b）
  await page.waitForTimeout(2300);
  frame = page.frameLocator('#doc-frame');
  let last;
  for (let i = 0; i < 3; i++) {
    await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
    try { await expect(frame.locator('#p-before')).toContainText(tag, { timeout: 4000 }); last = null; break; }
    catch (e) { last = e; await page.waitForTimeout(600); }
  }
  if (last) throw last;
  await page.waitForTimeout(500);
  return p;
}

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

async function shot(name, pt, clip) {
  if (pt) await markOuter(pt);
  await page.waitForTimeout(200);
  await fs.mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), clip: clip || CLIP });
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
    x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
    cy: Math.round(b.y + b.height / 2),
  };
});

const menuItems = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const m = d.querySelector('.ws-blockmenu');
  if (!m || m.style.display === 'none') return null;
  return [...m.querySelectorAll('.ws-blockmenu-item')].map((n) => n.textContent.trim());
});

const rectOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), cy: Math.round(b.y + b.height / 2) };
}, sel);

// 顶层块清单（排除 data-ws2-ui 覆盖层）
const blockList = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui'))
    .map((c) => ({ tag: c.tagName, id: c.id || null, text: (c.textContent || '').trim().slice(0, 14) }));
});

// 该文档里所有覆盖层控件（含隐形的），带可见性 —— I1 的「块上控件计数」读这个
const overlays = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const all = [...d.querySelectorAll('[data-ws2-ui]')].filter((el) => el.tagName !== 'STYLE');
  const vis = all.map((el) => {
    const st = d.defaultView.getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return {
      cls: el.className || el.tagName, display: st.display, opacity: st.opacity,
      visible: st.display !== 'none' && b.width > 0 && b.height > 0 && parseFloat(st.opacity) > 0.05,
      x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
    };
  }).filter((o) => o.visible);
  return { 覆盖层节点总数: all.length, 可见控件数: vis.length, 可见控件: vis };
});

const selInfo = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelectorAll('[data-ws2-selected]')].map((el) => {
    const b = el.getBoundingClientRect(); const st = d.defaultView.getComputedStyle(el);
    return { tag: el.tagName, id: el.id || null, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), boxShadow: st.boxShadow, outline: st.outline };
  });
});

const stateTriple = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const s = d.querySelector('[data-ws2-selected]');
  const e = d.querySelector('[data-ws2-editing]');
  const a = d.activeElement;
  const sel = d.getSelection();
  let anchorIn = null;
  if (sel && sel.anchorNode) {
    const an = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    anchorIn = an ? (an.closest('figcaption') ? 'figcaption' : (an.closest('figure') ? 'figure' : (an.id || an.tagName))) : null;
  }
  return {
    selected: s ? { tag: s.tagName, id: s.id || null } : null,
    editing: e ? { tag: e.tagName, id: e.id || null } : null,
    active: { tag: a && a.tagName, id: (a && a.id) || null, ce: a && a.getAttribute && a.getAttribute('contenteditable') },
    anchorIn,
  };
});

const dropAttr = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.body.querySelector('[data-ws2-drop]');
  if (!el) return null;
  const b = el.getBoundingClientRect(); const st = d.defaultView.getComputedStyle(el);
  return { host: el.tagName + (el.id ? '#' + el.id : ''), value: el.getAttribute('data-ws2-drop'), boxShadow: st.boxShadow, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
});

// ---- 合成块拖拽（HTML5 DnD）：dragstart 打在 .ws-grip / 任意源元素上 ----
const dragStartOn = (srcSel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument; const w = d.defaultView;
  const src = s === '.ws-grip' ? d.querySelector('.ws-grip') : d.querySelector(s);
  if (!src) return { err: 'no src ' + s };
  const dt = new w.DataTransfer();
  w.__probeDT = dt;
  const r = src.getBoundingClientRect();
  const ev = new w.DragEvent('dragstart', { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: dt });
  src.dispatchEvent(ev);
  return { ok: true, src: src.tagName + (src.className ? '.' + src.className : '') };
}, srcSel);

const dragEventAt = (type, sel, frac, dy) => page.evaluate(({ type, sel, frac, dy }) => {
  const d = document.getElementById('doc-frame').contentDocument; const w = d.defaultView;
  const t = d.querySelector(sel); if (!t) return { err: 'no target' };
  const r = t.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = dy != null ? r.top + dy : r.top + r.height * frac;
  const node = d.elementFromPoint(x, y) || t;
  const dt = w.__probeDT || new w.DataTransfer();
  const ev = new w.DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt });
  node.dispatchEvent(ev);
  return { ok: true, at: { x: Math.round(x), y: Math.round(y) }, node: node.tagName + (node.id ? '#' + node.id : ''), dropEffect: dt.dropEffect };
}, { type, sel, frac, dy });

const dragEndOn = (srcSel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument; const w = d.defaultView;
  const src = s === '.ws-grip' ? d.querySelector('.ws-grip') : d.querySelector(s);
  if (!src) return null;
  src.dispatchEvent(new w.DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: w.__probeDT || new w.DataTransfer() }));
  return true;
}, srcSel);

// iframe 内坐标 → 外层窗口坐标（给红圈用）
async function outerOf(inner) {
  const box = await page.locator('#doc-frame').boundingBox();
  return { x: box.x + inner.x, y: box.y + inner.y };
}

async function clickGrip() {
  const g = await gripState();
  if (!g.visible) return null;
  const box = await page.locator('#doc-frame').boundingBox();
  const pt = { x: box.x + g.x + g.w / 2, y: box.y + g.y + g.h / 2 };
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(360);
  return pt;
}

async function pngDataUrl(w, h, label) {
  return page.evaluate(({ w, h, label }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1a73e8'); grad.addColorStop(1, '#d93025');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(Math.min(w, h) / 2.5) + 'px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, w / 2, h / 2);
    return c.toDataURL('image/png');
  }, { w, h, label });
}

function record(fact, what, data) { readings.push({ fact, what, ...data }); }

// ---- fixtures（与 Notion 侧同构：前后段落包夹目标块）----
const fBare = (src, tag) =>
  '<p id="p-before">图片前的段落·' + tag + '</p>' +
  '<img id="img1" src="' + src + '" alt="演示图">' +
  '<p id="p-after">图片后的段落</p>';
const fCap = (src, tag, capText) =>
  '<p id="p-before">图片前的段落·' + tag + '</p>' +
  '<figure id="fig1"><img id="img1" src="' + src + '" alt="演示图"><figcaption id="cap1">' + (capText || '这是图片说明') + '</figcaption></figure>' +
  '<p id="p-after">图片后的段落</p>';
const fTwo = (src, src2, tag) =>
  '<p id="p-before">图片前的段落·' + tag + '</p>' +
  '<img id="imgA" src="' + src + '" alt="A图">' +
  '<img id="imgB" src="' + src2 + '" alt="B图">' +
  '<p id="p-after">图片后的段落</p>';

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null; page = null; frame = null;
  await fs.mkdir(path.dirname(OUT), { recursive: true }).catch(() => {});
  await fs.writeFile(OUT, JSON.stringify(readings, null, 2), 'utf8').catch(() => {});
});
test.afterAll(async () => {
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(readings, null, 2), 'utf8');
});

// ============ I1：悬停控件的锚点与计数 ============
test('I1 悬停图片：控件计数 + 手柄锚点（含高图对照）', async () => {
  await launch();
  const src = await pngDataUrl(240, 160, 'A');
  await openDoc(fBare(src, 'i1a'), 'i1a');

  const pb = await toOuter('#p-before', { dx: 40 });
  await hoverAt(pb);
  record('I1', '基线：悬停前段落', { grip: await gripState(), pBefore: await rectOf('#p-before') });
  await shot('I1-baseline-hover-p.png', pb);

  const rImg = await rectOf('#img1');
  const box = await page.locator('#doc-frame').boundingBox();
  for (const [name, fy] of [['y20', 0.2], ['y80', 0.8]]) {
    const pt = { x: box.x + rImg.x + rImg.w / 2, y: box.y + rImg.y + rImg.h * fy };
    await hoverAt(pt);
    const g = await gripState();
    record('I1', '悬停图片 ' + name, {
      img: rImg, grip: g,
      dx: g.visible ? g.x - rImg.x : null,
      dy: g.visible ? g.y - rImg.y : null,
      overlays: await overlays(),
    });
    await shot('I1-hover-img-' + name + '.png', pt);
  }

  const tall = await pngDataUrl(240, 600, 'T');
  await openDoc(fBare(tall, 'i1b'), 'i1b');
  const rT = await rectOf('#img1');
  const ptT = { x: box.x + rT.x + rT.w / 2, y: box.y + rT.y + rT.h * 0.5 };
  await hoverAt(ptT);
  const gT = await gripState();
  record('I1', '悬停高图(600px)', { img: rT, grip: gT, dx: gT.visible ? gT.x - rT.x : null, dy: gT.visible ? gT.y - rT.y : null });
  await shot('I1-hover-tallimg.png', ptT, { x: 180, y: 20, width: 1000, height: 780 });
});

// ============ I2 / I3：点击的选中粒度 & 说明点击 ============
test('I2+I3 点击粒度：裸图 / 带说明的图 / 点说明', async () => {
  await launch();
  const src = await pngDataUrl(240, 160, 'A');

  await openDoc(fBare(src, 'i2a'), 'i2a');
  let pt = await toOuter('#img1');
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(320);
  record('I2', '点裸图', { selected: await selInfo(), img: await rectOf('#img1'), state: await stateTriple() });
  await shot('I2-click-bare-img.png', pt);

  await openDoc(fCap(src, 'i2b'), 'i2b');
  pt = await toOuter('#img1');
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(320);
  record('I2', '点带说明的图', {
    selected: await selInfo(), figure: await rectOf('#fig1'), img: await rectOf('#img1'), caption: await rectOf('#cap1'), state: await stateTriple(),
  });
  await shot('I2-click-img-with-caption.png', pt);

  // I3：直接点说明文字（点正中 = 文字本身；figcaption 是 text-align:center 的整列宽行）
  await openDoc(fCap(src, 'i3a'), 'i3a');
  const cap = await toOuter('#cap1');
  await page.mouse.click(cap.x, cap.y);
  await page.waitForTimeout(320);
  record('I3', '点说明文字', {
    selected: await selInfo(),
    state: await stateTriple(),
    capAttrs: await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      const c = d.querySelector('#cap1');
      return c ? { ce: c.getAttribute('contenteditable'), ws2ce: c.hasAttribute('data-ws2-ce') } : null;
    }),
  });
  await shot('I3-click-caption.png', cap);

  // 附带：点「说明行的左端空白」（离文字很远、在图片正下方）——figcaption 是整列宽的行，命中带多宽
  await page.keyboard.press('Escape'); // 先收尾说明编辑，否则换文档时旧文档反复被 reload 顶回来
  await page.waitForTimeout(600);
  await openDoc(fCap(src, 'i3b'), 'i3b');
  const capL = await toOuter('#cap1', { dx: 30 });
  await page.mouse.click(capL.x, capL.y);
  await page.waitForTimeout(320);
  record('I3', '点说明行左端空白（x=左缘+30，文字在整列居中）', {
    caption: await rectOf('#cap1'), img: await rectOf('#img1'),
    selected: await selInfo(), state: await stateTriple(),
  });
  await shot('I3-click-caption-blank-left.png', capL);
});

// ============ I4：手柄「画的和做的不是同一个块」（菜单侧） ============
test('I4 作用域错位·菜单：选中图后悬停别的块，手柄画在新块、菜单作用于谁', async () => {
  await launch();
  const src = await pngDataUrl(240, 160, 'A');
  await openDoc(fBare(src, 'i4a'), 'i4a');

  const ptImg = await toOuter('#img1');
  await page.mouse.click(ptImg.x, ptImg.y);
  await page.waitForTimeout(320);
  record('I4', '① 点图片后的选中态', { selected: await selInfo() });

  const pa = await toOuter('#p-after', { dx: 40 });
  await hoverAt(pa);
  const g = await gripState();
  const rImg = await rectOf('#img1'); const rPa = await rectOf('#p-after');
  record('I4', '② 悬停下方段落后的手柄位置', {
    grip: g, img: rImg, pAfter: rPa,
    手柄画在: g.visible ? (Math.abs(g.cy - rPa.cy) < 16 ? '下方段落旁' : (Math.abs(g.y - rImg.y) < 16 ? '图片旁' : '其他')) : '手柄未出现',
  });
  await shot('I4-grip-drawn-on-p-after.png', pa);

  const gp = await clickGrip();
  const its = await menuItems();
  record('I4', '③ 点该手柄打开的菜单', {
    items: its,
    selectedNow: await selInfo(),
    // 判据：图片块菜单有「加说明」且无「转为…」；正文块菜单反之
    菜单作用对象: its ? ((its.includes('加说明') && !its.some((i) => i.startsWith('转为'))) ? '图片（不是手柄所画的段落）' : (its.some((i) => i.startsWith('转为')) ? '段落（手柄所画的块）' : '判不出')) : '菜单没开',
  });
  if (gp) await shot('I4-menu-from-grip-on-p-after.png', gp);
});

// ============ I4：拖拽侧（含正对照） ============
test('I4 作用域错位·拖拽：正对照 + 选中图后拖手柄搬的是谁', async () => {
  await launch();
  const src = await pngDataUrl(240, 160, 'A');

  // 正对照：不点图片，直接悬停 p-after 拖手柄到 p-before 上 → 应搬 p-after
  await openDoc(fBare(src, 'i4b'), 'i4b');
  record('I4', '正对照·拖前块序', { blocks: await blockList() });
  await hoverAt(await toOuter('#p-after', { dx: 40 }));
  await dragStartOn('.ws-grip');
  await dragEventAt('dragover', '#p-before', 0.5);
  const d1 = await dropAttr();
  await dragEventAt('drop', '#p-before', 0.5);
  await dragEndOn('.ws-grip');
  await page.waitForTimeout(300);
  record('I4', '正对照·拖后块序（期望 p-after 被搬走）', { dropIndicator: d1, blocks: await blockList() });
  await shot('I4-drag-control-after.png');

  // 实验：先点图片（留常驻 selectedEl）→ 悬停 p-after → 拖手柄
  await openDoc(fBare(src, 'i4c'), 'i4c');
  const ptImg = await toOuter('#img1');
  await page.mouse.click(ptImg.x, ptImg.y);
  await page.waitForTimeout(300);
  record('I4', '实验·拖前块序', { blocks: await blockList(), selected: await selInfo() });
  await hoverAt(await toOuter('#p-after', { dx: 40 }));
  await dragStartOn('.ws-grip');
  await dragEventAt('dragover', '#p-before', 0.5);
  const d2 = await dropAttr();
  await shot('I4-drag-exp-dragover.png');
  await dragEventAt('drop', '#p-before', 0.5);
  await dragEndOn('.ws-grip');
  await page.waitForTimeout(300);
  record('I4', '实验·拖后块序（看被搬走的是图还是段落）', { dropIndicator: d2, blocks: await blockList() });
  await shot('I4-drag-exp-after.png');
});

// ============ I5：选中图 Backspace 的删除粒度 ============
test('I5 删除粒度：带说明的图 / 裸图，选中后 Backspace', async () => {
  await launch();
  const src = await pngDataUrl(240, 160, 'A');
  const fDelCap = '<h1 id="t">标题</h1><p id="p-before">图片前的段落·i5a</p>' +
    '<figure id="fig1"><img id="img1" src="' + src + '" alt="演示图"><figcaption id="cap1">这是图片说明</figcaption></figure>' +
    '<p id="p-after">图片后的段落</p>';
  await openDoc(fDelCap, 'i5a');
  record('I5', '带说明·删前', { blocks: await blockList() });
  let pt = await toOuter('#img1');
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  await shot('I5-cap-before-delete.png', pt);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  record('I5', '带说明·删后', {
    blocks: await blockList(),
    counts: await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      return { img: d.querySelectorAll('img').length, figcaption: d.querySelectorAll('figcaption').length, figure: d.querySelectorAll('figure').length };
    }),
  });
  await shot('I5-cap-after-delete.png');

  const fDelBare = '<h1 id="t">标题</h1><p id="p-before">图片前的段落·i5b</p>' +
    '<img id="img1" src="' + src + '" alt="演示图"><p id="p-after">图片后的段落</p>';
  await openDoc(fDelBare, 'i5b');
  record('I5', '裸图·删前', { blocks: await blockList() });
  pt = await toOuter('#img1');
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  record('I5', '裸图·删后', { blocks: await blockList() });
  await shot('I5-bare-after-delete.png');
});

// ============ I6：说明里退格到空、再退一次 ============
test('I6 说明编辑对块级删除 inert：删空后再退一次 + 失焦归宿', async () => {
  await launch();
  const src = await pngDataUrl(240, 160, 'A');
  await openDoc(fCap(src, 'i6a', 'abc'), 'i6a');
  const cap = await toOuter('#cap1', { dx: 20 });
  await page.mouse.click(cap.x, cap.y);
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  record('I6', '进说明编辑', { state: await stateTriple(), capText: await frame.locator('#cap1').textContent() });
  await shot('I6-caption-editing.png', cap);

  for (let i = 0; i < 4; i++) { await page.keyboard.press('Backspace'); await page.waitForTimeout(120); }
  record('I6', '连按 4 次 Backspace（说明只有 3 个字）', {
    structure: await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      const fig = d.querySelector('figure');
      return {
        img: d.querySelectorAll('img').length,
        figure: d.querySelectorAll('figure').length,
        figcaption: d.querySelectorAll('figcaption').length,
        capText: fig && fig.querySelector('figcaption') ? JSON.stringify(fig.querySelector('figcaption').textContent) : null,
        figHTML: fig ? fig.innerHTML.replace(/src="[^"]*"/, 'src="…"').slice(0, 160) : null,
      };
    }),
    blocks: await blockList(),
    state: await stateTriple(),
  });
  await shot('I6-after-4-backspace.png');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  record('I6', 'Esc 失焦后的归宿', {
    structure: await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      return { img: d.querySelectorAll('img').length, figure: d.querySelectorAll('figure').length, figcaption: d.querySelectorAll('figcaption').length };
    }),
    blocks: await blockList(), selected: await selInfo(),
  });
  await shot('I6-after-escape.png');
});

// ============ I7：菜单作用域 + 菜单项随块状态变化 ============
test('I7 菜单作用域：两张图删第二张 + 已有说明时菜单项差异', async () => {
  await launch();
  const srcA = await pngDataUrl(240, 120, 'A');
  const srcB = await pngDataUrl(240, 120, 'B');
  await openDoc(fTwo(srcA, srcB, 'i7a'), 'i7a');
  record('I7', '两图·操作前', { blocks: await blockList() });

  const pb = await toOuter('#imgB');
  await hoverAt(pb);
  const g = await gripState();
  const rB = await rectOf('#imgB'); const rA = await rectOf('#imgA');
  record('I7', '悬停第二张图的手柄位置', { grip: g, imgA: rA, imgB: rB, 贴着: g.visible ? (Math.abs(g.y - rB.y) < 16 ? 'imgB' : (Math.abs(g.y - rA.y) < 16 ? 'imgA' : '其他')) : '无' });
  const gp = await clickGrip();
  const items = await menuItems();
  record('I7', '第二张图的菜单项', { items });
  if (gp) await shot('I7-menu-on-imgB.png', gp);

  await frame.locator('.ws-blockmenu-item', { hasText: '删除' }).click();
  await page.waitForTimeout(400);
  record('I7', '点删除后', {
    blocks: await blockList(),
    imgAStillThere: await page.evaluate(() => !!document.getElementById('doc-frame').contentDocument.querySelector('#imgA')),
    imgBStillThere: await page.evaluate(() => !!document.getElementById('doc-frame').contentDocument.querySelector('#imgB')),
  });
  await shot('I7-after-delete-imgB.png');

  // 已有说明的图：菜单项里还有没有「加说明」
  await openDoc(fCap(srcA, 'i7b'), 'i7b');
  const pf = await toOuter('#img1');
  await hoverAt(pf);
  const gp2 = await clickGrip();
  record('I7', '已有说明的图·菜单项', { items: await menuItems() });
  if (gp2) await shot('I7-menu-on-captioned.png', gp2);
});

// ============ I8：多图一次插入 + 撤销粒度 ============
test('I8 多图插入：3 个文件 → 几个块 + 一次 undo 撤掉几张', async () => {
  await launch();
  await openDoc('<p id="p-before">第一段·i8a</p><p id="p-after">第二段</p>', 'i8a');
  // 造 3 个真 PNG 文件
  const files = [];
  for (const l of ['1', '2', '3']) {
    const du = await pngDataUrl(200, 140, l);
    const p = path.join(tmpDir, 'pick-' + l + '.png');
    await fs.writeFile(p, Buffer.from(du.split(',')[1], 'base64'));
    files.push(p);
  }
  await app.evaluate(({ dialog }, ps) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ps }); }, files);

  record('I8', '插入前', { blocks: await blockList() });
  await frame.locator('#p-after').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu-item', { hasText: '图片' })).toBeVisible({ timeout: 5000 });
  await frame.locator('.ws-slashmenu-item', { hasText: '图片' }).click();
  await expect.poll(async () => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('img').length), { timeout: 10000 }).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(400);
  record('I8', '插入 3 张后', {
    blocks: await blockList(),
    imgTotal: await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('img').length),
    imgAllTopLevel: await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.querySelectorAll('img')].every((i) => i.parentElement.tagName === 'BODY')),
  });
  await shot('I8-after-insert-3.png');

  // undo 走菜单（keyboard Meta+z 不触发加速器 = 假 FAIL）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'undo'));
  await page.waitForTimeout(800);
  record('I8', '一次 undo 后', {
    blocks: await blockList(),
    imgTotal: await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('img').length),
  });
  await shot('I8-after-one-undo.png');
});

// ============ I9：插入落点粒度 ============
test('I9 插入落点：空段落原地替换 / 段落中部插入 / 空标题', async () => {
  await launch();
  const du = await pngDataUrl(200, 140, 'X');
  const pick = path.join(tmpDir, 'pick.png');
  await fs.writeFile(pick, Buffer.from(du.split(',')[1], 'base64'));
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, pick);

  const doInsert = async () => {
    await page.keyboard.type('/');
    await expect(frame.locator('.ws-slashmenu-item', { hasText: '图片' })).toBeVisible({ timeout: 5000 });
    await frame.locator('.ws-slashmenu-item', { hasText: '图片' }).click();
    await expect.poll(async () => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('img').length), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(350);
  };

  // 轮一：空段落上插
  await openDoc('<h1 id="t">标题</h1><p id="p-before">第一段·i9a</p><p id="p-after">第二段</p>', 'i9a');
  await frame.locator('#t').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  record('I9', '轮一·空段落上插图·插前', { blocks: await blockList() });
  await doInsert();
  record('I9', '轮一·插后', {
    blocks: await blockList(),
    imgPrevSibling: await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      const i = d.querySelector('img'); const p = i && i.previousElementSibling;
      return p ? p.tagName + (p.id ? '#' + p.id : '') : null;
    }),
  });
  await shot('I9-round1-empty-p.png');

  // 轮二：有字的段落中部插
  await openDoc('<h1 id="t">标题</h1><p id="p-before">第一段落有一串比较长的文字·i9b</p><p id="p-after">第二段</p>', 'i9b');
  const mid = await toOuter('#p-before', { dx: 90 });
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(250);
  record('I9', '轮二·段落中部放光标·插前', {
    blocks: await blockList(),
    caretOffset: await page.evaluate(() => { const s = document.getElementById('doc-frame').contentDocument.getSelection(); return s ? s.anchorOffset : null; }),
  });
  await doInsert();
  record('I9', '轮二·插后', {
    blocks: await blockList(),
    pBeforeText: await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; const p = d.querySelector('#p-before'); return p ? p.textContent : null; }),
    imgPrevSibling: await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      const i = d.querySelector('img'); const p = i && i.previousElementSibling;
      return p ? p.tagName + (p.id ? '#' + p.id : '') : null;
    }),
  });
  await shot('I9-round2-mid-paragraph.png', mid);

  // 轮三：空标题上插（内部不一致：斜杠路径只要 isEditableEl 就原地替换）
  await openDoc('<p id="p-before">第一段·i9c</p><h2 id="h2e">删</h2><p id="p-after">第二段</p>', 'i9c');
  await frame.locator('#h2e').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  record('I9', '轮三·空标题上插·插前', { blocks: await blockList() });
  await doInsert();
  record('I9', '轮三·插后', { blocks: await blockList() });
  await shot('I9-round3-empty-heading.png');
});

// ============ I10：OS 文件拖入的落点反馈 + 落点算法 ============
test('I10 文件拖入：拖动中有无插入线 + 落点归属', async () => {
  await launch();
  const src = await pngDataUrl(240, 160, 'A');
  await openDoc('<p id="p-before">第一段·i10a</p><p id="p-mid">第二段</p><p id="p-after">第三段</p>', 'i10a');

  const dropPng = (await pngDataUrl(160, 120, 'D')).split(',')[1];
  // 造带 File 的 DataTransfer 并派发 dragenter/dragover
  const fileDrag = (type, sel, dy, b64) => page.evaluate(({ type, sel, dy, b64 }) => {
    const d = document.getElementById('doc-frame').contentDocument; const w = d.defaultView;
    const t = d.querySelector(sel); if (!t) return { err: 'no target' };
    if (!w.__probeFileDT) {
      const bin = atob(b64); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const f = new w.File([u8], 'dropped.png', { type: 'image/png' });
      const dt = new w.DataTransfer(); dt.items.add(f);
      w.__probeFileDT = dt;
    }
    const dt = w.__probeFileDT;
    const r = t.getBoundingClientRect();
    const x = r.left + r.width / 2; const y = r.top + dy;
    const node = d.elementFromPoint(x, y) || t;
    node.dispatchEvent(new w.DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt }));
    return { at: { x: Math.round(x), y: Math.round(y) }, node: node.tagName + (node.id ? '#' + node.id : ''), dropEffect: dt.dropEffect, files: dt.files.length };
  }, { type, sel, dy, b64 });

  // ① p-mid 上边缘之上 5px：dragover 期间有没有插入线？
  const a1 = await fileDrag('dragenter', '#p-mid', -5, dropPng);
  const a2 = await fileDrag('dragover', '#p-mid', -5, dropPng);
  const ind = await dropAttr();
  const rMid = await rectOf('#p-mid');
  const outer = await outerOf({ x: rMid.x + rMid.w / 2, y: rMid.y - 5 });
  record('I10', '① dragover 在 p-mid 上边缘 −5px', { dragenter: a1, dragover: a2, dropIndicator: ind, pMid: rMid });
  await shot('I10-dragover-above-pmid.png', outer);
  await fileDrag('drop', '#p-mid', -5, dropPng);
  await expect.poll(async () => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('img').length), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(300);
  record('I10', '① drop 后落点', {
    blocks: await blockList(),
    imgPrev: await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; const i = d.querySelector('img'); const p = i && i.previousElementSibling; return p ? p.tagName + (p.id ? '#' + p.id : '') : null; }),
  });
  await shot('I10-after-drop-above.png');

  // ② 换一份文档：p-mid 上边缘之下 5px
  await page.evaluate(() => { const w = document.getElementById('doc-frame').contentWindow; w.__probeFileDT = null; });
  await openDoc('<p id="p-before">第一段·i10b</p><p id="p-mid">第二段</p><p id="p-after">第三段</p>', 'i10b');
  const b2 = await fileDrag('dragover', '#p-mid', 5, dropPng);
  const ind2 = await dropAttr();
  const rMid2 = await rectOf('#p-mid');
  const outer2 = await outerOf({ x: rMid2.x + rMid2.w / 2, y: rMid2.y + 5 });
  record('I10', '② dragover 在 p-mid 上边缘 +5px', { dragover: b2, dropIndicator: ind2, pMid: rMid2 });
  await shot('I10-dragover-below-pmid-top.png', outer2);
  await fileDrag('drop', '#p-mid', 5, dropPng);
  await expect.poll(async () => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('img').length), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(300);
  record('I10', '② drop 后落点', {
    blocks: await blockList(),
    imgPrev: await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; const i = d.querySelector('img'); const p = i && i.previousElementSibling; return p ? p.tagName + (p.id ? '#' + p.id : '') : null; }),
  });
  await shot('I10-after-drop-below.png');

  // ③ p-mid 下半区（越过它的中线）——看落点是否真的翻到 p-mid 之后（验「Y 最近块 + 上半区归前一块」）
  await page.evaluate(() => { const w = document.getElementById('doc-frame').contentWindow; w.__probeFileDT = null; });
  await openDoc('<p id="p-before">第一段·i10c</p><p id="p-mid">第二段</p><p id="p-after">第三段</p>', 'i10c');
  const rMid3 = await rectOf('#p-mid');
  const c3 = await fileDrag('dragover', '#p-mid', rMid3.h - 4, dropPng);
  const ind3 = await dropAttr();
  record('I10', '③ dragover 在 p-mid 下半区', { dragover: c3, dropIndicator: ind3, pMid: rMid3 });
  await shot('I10-dragover-lower-pmid.png', await outerOf({ x: rMid3.x + rMid3.w / 2, y: rMid3.y + rMid3.h - 4 }));
  await fileDrag('drop', '#p-mid', rMid3.h - 4, dropPng);
  await expect.poll(async () => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('img').length), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(300);
  record('I10', '③ drop 后落点', {
    blocks: await blockList(),
    imgPrev: await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; const i = d.querySelector('img'); const p = i && i.previousElementSibling; return p ? p.tagName + (p.id ? '#' + p.id : '') : null; }),
  });
  await shot('I10-after-drop-lower.png');
});

// ============ I11 / I12：起拖区 + 落点指示线 ============
test('I11+I12 起拖区与落点指示线：手柄 vs 图片本体、上下半区', async () => {
  await launch();
  const src = await pngDataUrl(240, 160, 'A');

  // I12：手柄拖图片 → 停在 p-after 上半区 / 下半区，各读一次指示线
  await openDoc(fBare(src, 'i12a'), 'i12a');
  await hoverAt(await toOuter('#img1'));
  await dragStartOn('.ws-grip');
  await dragEventAt('dragover', '#p-after', 0.25);
  const up = await dropAttr();
  const rPa = await rectOf('#p-after');
  const oUp = await outerOf({ x: rPa.x + rPa.w / 2, y: rPa.y + rPa.h * 0.25 });
  record('I12', '向下拖·停在 p-after 上半区', { dropIndicator: up, target: rPa, 内容列宽: rPa.w });
  await shot('I12-dragover-pafter-upper.png', oUp);
  await dragEventAt('dragover', '#p-after', 0.75);
  const down = await dropAttr();
  const oDn = await outerOf({ x: rPa.x + rPa.w / 2, y: rPa.y + rPa.h * 0.75 });
  record('I12', '向下拖·停在 p-after 下半区', { dropIndicator: down });
  await shot('I12-dragover-pafter-lower.png', oDn);
  // 反向：停在 p-before 上（源在目标之后）
  await dragEventAt('dragover', '#p-before', 0.75);
  const rev = await dropAttr();
  record('I12', '向上拖·停在 p-before 下半区', { dropIndicator: rev });
  const rPb = await rectOf('#p-before');
  await shot('I12-dragover-pbefore-lower.png', await outerOf({ x: rPb.x + rPb.w / 2, y: rPb.y + rPb.h * 0.75 }));
  await dragEndOn('.ws-grip');

  // I11 正对照：手柄拖到 p-before → 真重排
  await openDoc(fBare(src, 'i11a'), 'i11a');
  record('I11', '正对照·拖前', { blocks: await blockList() });
  await hoverAt(await toOuter('#img1'));
  await dragStartOn('.ws-grip');
  await dragEventAt('dragover', '#p-before', 0.5);
  await dragEventAt('drop', '#p-before', 0.5);
  await dragEndOn('.ws-grip');
  await page.waitForTimeout(300);
  record('I11', '正对照·拖后（手柄起拖）', { blocks: await blockList() });
  await shot('I11-after-grip-drag.png');

  // I11 实验：直接拖图片本体
  await openDoc(fBare(src, 'i11b'), 'i11b');
  record('I11', '实验·拖前', { blocks: await blockList() });
  await hoverAt(await toOuter('#img1'));
  const s = await dragStartOn('#img1');
  const ov = await dragEventAt('dragover', '#p-before', 0.5);
  const indi = await dropAttr();
  await dragEventAt('drop', '#p-before', 0.5);
  await dragEndOn('#img1');
  await page.waitForTimeout(300);
  record('I11', '实验·拖后（图片本体起拖）', { dragstart: s, dragover: ov, dropIndicator: indi, blocks: await blockList() });
  await shot('I11-after-img-body-drag.png');
});

// ============ I13：键盘停靠位 ============
test('I13 键盘停靠位：↓ 穿过带说明的图 / 裸图', async () => {
  await launch();
  const src = await pngDataUrl(240, 160, 'A');

  await openDoc(fCap(src, 'i13a'), 'i13a');
  await frame.locator('#p-before').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(200);
  record('I13', '带说明·起点(p-before 末尾)', { state: await stateTriple() });
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(260);
    record('I13', '带说明·第 ' + i + ' 次 ↓', { state: await stateTriple() });
    await shot('I13-cap-down-' + i + '.png');
  }

  await openDoc(fBare(src, 'i13b'), 'i13b');
  await frame.locator('#p-before').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(200);
  record('I13', '裸图·起点', { state: await stateTriple() });
  for (let i = 1; i <= 2; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(260);
    record('I13', '裸图·第 ' + i + ' 次 ↓', { state: await stateTriple() });
    await shot('I13-bare-down-' + i + '.png');
  }
});

// ============ I14：跨块拖选罩住图片 ============
test('I14 跨块选区：图片以什么单元参与高亮 + 所见即所删', async () => {
  await launch();
  const src = await pngDataUrl(240, 160, 'A');
  await openDoc(fCap(src, 'i14a'), 'i14a');

  // 先点进文档（把焦点交给 iframe）——只设 Range 不点，键盘事件落在外层窗口 = 后面的 Backspace 是哑动作
  await frame.locator('#p-before').click();
  await page.waitForTimeout(250);
  const setRange = () => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const a = d.querySelector('#p-before').firstChild;
    const b = d.querySelector('#p-after').firstChild;
    const r = d.createRange();
    r.setStart(a, 2); r.setEnd(b, 3);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
    return { anchor: a.textContent.slice(0, 6), focus: b.textContent.slice(0, 6) };
  });
  record('I14', '设置跨块选区', { range: await setRange() });
  await page.waitForTimeout(500);
  const hl = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('[data-ws2-rangesel]')].map((el) => {
      const b = el.getBoundingClientRect(); const st = d.defaultView.getComputedStyle(el);
      return { tag: el.tagName, id: el.id || null, bg: st.backgroundColor, boxShadow: st.boxShadow, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    });
  });
  record('I14', '高亮元素清单', { highlighted: hl, figure: await rectOf('#fig1'), img: await rectOf('#img1'), caption: await rectOf('#cap1') });
  await shot('I14-rangesel-highlight.png');

  record('I14', '删前块序', { blocks: await blockList() });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  record('I14', '删后块序（所见即所删？）', {
    blocks: await blockList(),
    counts: await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      return { img: d.querySelectorAll('img').length, figure: d.querySelectorAll('figure').length, figcaption: d.querySelectorAll('figcaption').length };
    }),
  });
  await shot('I14-after-backspace.png');
});
