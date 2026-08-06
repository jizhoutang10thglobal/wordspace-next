// 对拍探针（batch2：表格 / 图片 / callout）——**只记录、不断言**，取证不是门（align-notion 阶段一）。
// 读数写 JSON 到 PROBE_OUT，截图写 SHOTS_DIR；红圈标注鼠标位置一律画在**外层窗口**（注进 iframe 会让
// 编辑器把 .ws-grip 藏掉 = 假证据，skill 技术坑清单实证过）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2b2shots');
const OUT = process.env.PROBE_OUT || path.join(os.tmpdir(), 'ws2b2shots', 'readings.json');
const CLIP = { x: 180, y: 20, width: 940, height: 500 };
let app, page, frame, tmpDir;
const readings = [];

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2b2-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
}

// 每份 fixture 带唯一哨兵 id 并校验可见——open-file IPC 约 1/8 概率静默不生效，
// 不校验的话后续读数全在旧文档上跑（skill 技术坑清单）。
async function openDoc(body, sentinelId) {
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>probe</title></head><body>' + body + '</body></html>';
  const p = path.join(tmpDir, 'doc-' + sentinelId + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('#' + sentinelId)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(450);
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

// ⚠ 标注必须走 CSSOM 逐条 setProperty，不能 setAttribute('style', ...)：
// app 的 CSP 是 `style-src 'self' file:`（无 unsafe-inline），整条 style 属性会被拦掉 →
// 元素在 DOM 里但零样式（实测 rect 变成 x:1280,w:0,h:900 的裸 flex 子项）= 哑标注，
// 截图上什么都看不见却毫无报错。CSSOM 不受 style-src 管辖。
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
  // 自检：标注必须真的是 18x18，否则本次截图的悬停证据不成立
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

// 悬停到「外层窗口坐标」——真鼠标移动（先移开再移入，制造真实轨迹，否则常不触发 hover 态）
async function hoverAt(pt) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(80);
  await page.mouse.move(pt.x, pt.y, { steps: 8 });
  await page.waitForTimeout(260);
}

// 手柄（.ws-grip）当前几何：它挂在 iframe 的 documentElement 上，坐标是 iframe 内坐标
const gripState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const g = d.querySelector('.ws-grip');
  if (!g) return { present: false };
  const st = d.defaultView.getComputedStyle(g);
  const b = g.getBoundingClientRect();
  return {
    present: true,
    display: st.display,
    visible: st.display !== 'none' && b.width > 0,
    x: Math.round(b.x), y: Math.round(b.y), h: Math.round(b.height),
    cy: Math.round(b.y + b.height / 2),
  };
});

// 块菜单项文本（打开菜单后读）
const menuItems = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const m = d.querySelector('.ws-blockmenu');
  if (!m || m.style.display === 'none') return null;
  return [...m.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.trim())
    .map((n) => n.textContent.trim());
});

// 元素几何（iframe 内坐标）
const rectOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), cy: Math.round(b.y + b.height / 2) };
}, sel);

function record(dim, fact, data) {
  readings.push({ dim, fact, ...data });
}

// ---- fixtures：与 Notion 侧同构（前后各一段落包夹目标块）----
const F_TABLE =
  '<p id="p-before">表格前的段落</p>' +
  '<table class="ws-table"><thead><tr>' +
  '<th scope="col" id="th1">列一</th><th scope="col" id="th2">列二</th><th scope="col" id="th3">列三</th>' +
  '</tr></thead><tbody>' +
  '<tr id="tr1"><td id="c11">甲一</td><td>甲二</td><td>甲三</td></tr>' +
  '<tr id="tr2"><td id="c21">乙一</td><td>乙二</td><td>乙三</td></tr>' +
  '<tr id="tr3"><td id="c31">丙一</td><td>丙二</td><td>丙三</td></tr>' +
  '</tbody></table>' +
  '<p id="p-after">表格后的段落</p>';

const F_CALLOUT =
  '<p id="p-before">标注块前的段落</p>' +
  '<div class="ws-callout" id="co1"><p id="co-p1">标注块第一段</p><p id="co-p2">标注块第二段</p></div>' +
  '<p id="p-after">标注块后的段落</p>';

const fImage = (src) =>
  '<p id="p-before">图片前的段落</p>' +
  '<figure id="fig1"><img id="img1" src="' + src + '" alt="演示图"><figcaption id="cap1">这是图片说明</figcaption></figure>' +
  '<p id="p-after">图片后的段落</p>';

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

// ============ 表格 ============
test('表格：手柄作用单元 + 菜单作用域', async () => {
  await launch();
  await openDoc(F_TABLE, 'p-before');

  // 悬停第 2 数据行的首格 → 手柄出现在哪？（块级 = 对齐表格顶；行级 = 对齐该行）
  const c21 = await toOuter('#c21', { dx: 30 });
  await hoverAt(c21);
  const g = await gripState();
  const rTable = await rectOf('table');
  const rTr2 = await rectOf('#tr2');
  record('table', 'T-手柄作用单元', {
    grip: g, table: rTable, row2: rTr2,
    对齐到: g.visible ? (Math.abs(g.cy - rTr2.cy) < 14 ? '该行' : (Math.abs(g.cy - (rTable.y + 12)) < 24 ? '整表顶部' : '其他')) : '手柄未出现',
  });
  await shot('b2-table-hover-row2.png', c21);

  // 打开块菜单读作用域
  if (g.visible) {
    const gb = await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      const el = d.querySelector('.ws-grip'); const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    const box = await page.locator('#doc-frame').boundingBox();
    await page.mouse.click(box.x + gb.x, box.y + gb.y);
    await page.waitForTimeout(350);
    record('table', 'T-菜单项', { items: await menuItems() });
    await shot('b2-table-menu.png', { x: box.x + gb.x, y: box.y + gb.y });
  }
});

// 行列操作的可达路径：悬停开菜单 vs 先点进格子再开菜单，菜单项是否不同
test('表格：行列操作的可达路径（悬停 vs 进入 cell）', async () => {
  await launch();
  await openDoc(F_TABLE, 'p-before');
  const box = await page.locator('#doc-frame').boundingBox();

  const openMenuViaGrip = async () => {
    const gb = await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      const el = d.querySelector('.ws-grip');
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    if (!gb) return null;
    await page.mouse.click(box.x + gb.x, box.y + gb.y);
    await page.waitForTimeout(350);
    return { items: await menuItems(), pt: { x: box.x + gb.x, y: box.y + gb.y } };
  };
  const closeMenu = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(200); };

  // ① 只悬停第 2 行，不进 cell
  const c21 = await toOuter('#c21', { dx: 30 });
  await hoverAt(c21);
  const hoverOnly = await openMenuViaGrip();
  record('table', 'T-菜单项(仅悬停行)', { items: hoverOnly && hoverOnly.items });
  if (hoverOnly) await shot('b2-table-menu-hoveronly.png', hoverOnly.pt);
  await closeMenu();

  // ② 先点进第 2 行首格（进入 cell 编辑态）再开菜单
  await page.mouse.click(c21.x, c21.y);
  await page.waitForTimeout(300);
  const inCell = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const a = d.activeElement;
    return { tag: a && a.tagName, ce: a && a.getAttribute && a.getAttribute('contenteditable') };
  });
  await hoverAt(c21);
  const afterCell = await openMenuViaGrip();
  record('table', 'T-菜单项(先进入cell)', { activeEl: inCell, items: afterCell && afterCell.items });
  if (afterCell) await shot('b2-table-menu-incell.png', afterCell.pt);
});

// 选中粒度：点击块本体，选中的是什么
test('三维度：点击的选中粒度', async () => {
  await launch();
  await openDoc(F_TABLE, 'p-before');
  const sel = () => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.querySelector('[data-ws2-sel], .ws-selected, [data-ws2-rangesel]');
    return s ? { tag: s.tagName, id: s.id || null, cls: s.className || null } : null;
  });
  // 表格：点表头单元格
  await frame.locator('#th1').click();
  await page.waitForTimeout(280);
  record('table', 'T-点击表头格的选中粒度', { selected: await sel() });

  await openDoc(F_CALLOUT, 'p-before');
  await frame.locator('#co-p1').click();
  await page.waitForTimeout(280);
  record('callout', 'C-点击内层段落的选中粒度', {
    selected: await sel(),
    activeEl: await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      const a = d.activeElement;
      return { tag: a && a.tagName, id: a && a.id, ce: a && a.getAttribute && a.getAttribute('contenteditable') };
    }),
  });
});

// ============ Callout ============
test('callout：手柄作用单元 + 内段落粒度', async () => {
  await launch();
  await openDoc(F_CALLOUT, 'p-before');

  const p2 = await toOuter('#co-p2', { dx: 40 });
  await hoverAt(p2);
  const g = await gripState();
  const rCo = await rectOf('#co1');
  const rP2 = await rectOf('#co-p2');
  record('callout', 'C-手柄作用单元', {
    grip: g, callout: rCo, innerP2: rP2,
    对齐到: g.visible ? (Math.abs(g.cy - rP2.cy) < 14 ? '内层段落' : (Math.abs(g.cy - (rCo.y + 12)) < 26 ? '整个callout顶部' : '其他')) : '手柄未出现',
  });
  await shot('b2-callout-hover-inner-p2.png', p2);
});

// ============ 图片 ============
test('图片：手柄作用单元 + 说明粒度', async () => {
  await launch();
  const png = path.join(tmpDir, 'demo.png');
  // 造一张真 PNG（纯色 240x160），避免依赖网络
  const { execFileSync } = require('child_process');
  try {
    execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '/System/Library/CoreServices/DefaultDesktop.heic', '--out', png, '-Z', '240'], { stdio: 'ignore' });
  } catch {
    // 兜底：1x1 透明 png（放大显示）
    await fs.writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  }
  await openDoc(fImage('demo.png'), 'p-before');

  const cap = await toOuter('#cap1', { dx: 40 });
  await hoverAt(cap);
  const g = await gripState();
  const rFig = await rectOf('#fig1');
  const rCap = await rectOf('#cap1');
  record('image', 'I-手柄作用单元(悬停说明)', {
    grip: g, figure: rFig, caption: rCap,
    对齐到: g.visible ? (Math.abs(g.cy - rCap.cy) < 14 ? '说明行' : (Math.abs(g.cy - (rFig.y + 12)) < 26 ? '整个figure顶部' : '其他')) : '手柄未出现',
  });
  await shot('b2-image-hover-caption.png', cap);
});
