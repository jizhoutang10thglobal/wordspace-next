// Toggle（<details>）可折叠块 e2e 真门：CI 用 xvfb 真启动 Electron。
// 覆盖：创建（slash 插入种子 + 光标落 summary）、入盘语义 CSS（chevron/marker-kill，data-ws-schema-css）、
// 合规往返、折叠持久化、嵌套可达、键盘边界、撤销解耦、分页/PDF 强制展开、查找自动展开、剪贴板。
// 强断言纪律（S4）：查 computed-style/几何 + 磁盘字节 reparse，绝不查 class-contains。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2toggle-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_PDF_OUT: path.join(tmpDir, 'export.pdf') },
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
const editingTag = () => frame.locator('body').evaluate(() => { const e = document.querySelector('[data-ws2-editing]'); return e ? e.tagName : null; });
// 校验器判磁盘字节是否合规（reparse，不信 meta 自称）
const conformOf = (html) => page.evaluate((h) => {
  const doc = new DOMParser().parseFromString(h, 'text/html');
  return WS2SchemaRegistry.classify(doc).conform;
}, html);

const SIMPLE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="p1">正文一段</p></body></html>';

// 在 #p1 后 slash 插入一个 toggle，返回后光标在 summary（编辑态）。
async function insertToggle() {
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: '折叠' }).click();
  await page.waitForTimeout(200);
}
const detailsOpen = () => frame.locator('body').evaluate(() => { const d = document.querySelector('details'); return d ? d.hasAttribute('open') : null; });
const summaryText = () => frame.locator('body').evaluate(() => { const s = document.querySelector('details > summary'); return s ? s.textContent : null; });
const editInfo = () => frame.locator('body').evaluate(() => { const e = document.querySelector('[data-ws2-editing]'); return e ? { tag: e.tagName, parent: e.parentElement.tagName, inDetails: !!e.closest('details') } : null; });
// 设跨块选区（还原拖选态），照 app.spec setCrossSel 范式。
async function setCrossSel(a, b, c, d) {
  await frame.locator('body').evaluate((body, [a, b, c, d]) => {
    const r = document.createRange(); r.setStart(document.getElementById(a).firstChild, b); r.setEnd(document.getElementById(c).firstChild, d);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  }, [a, b, c, d]);
  await frame.locator('body').evaluate(() => new Promise((res) => { let n = 0; const chk = () => { const s = document.getSelection(); if (s && s.rangeCount && !s.isCollapsed) res(); else if (n++ > 90) res(); else requestAnimationFrame(chk); }; chk(); }));
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

// U4: slash /折叠 → 合规 toggle（U24 起空块原地变身 turnInto，summary 空占位 <br>），光标落 summary；
// 入盘 chevron/marker-kill CSS（data-ws-schema-css="toggle"）；chevron 用 computed-style 强断言。
test('U4: slash 插入 toggle 种子 + 光标落 summary + 入盘 chevron CSS', async () => {
  await launch();
  await openDoc(SIMPLE);
  // 在 #p1 后新建空块，slash 插入 toggle
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: '折叠' }).click();
  await page.waitForTimeout(250);

  // 结构：恰一个 details，含 open + 首子 summary + 一个 p 正文
  const shape = await frame.locator('body').evaluate(() => {
    const d = document.querySelector('details');
    if (!d) return { ok: false };
    const kids = [...d.children];
    return {
      ok: true, open: d.hasAttribute('open'),
      firstIsSummary: kids[0] && kids[0].tagName === 'SUMMARY',
      summaryCount: kids.filter((k) => k.tagName === 'SUMMARY').length,
      hasBodyP: kids.some((k) => k.tagName === 'P'),
    };
  });
  expect(shape.ok).toBe(true);
  expect(shape.open).toBe(true);
  expect(shape.firstIsSummary).toBe(true);
  expect(shape.summaryCount).toBe(1);
  expect(shape.hasBodyP).toBe(true);

  // 光标落 summary（R1/KD7）
  expect(await editingTag()).toBe('SUMMARY');

  // chevron 强断言：原生三角被干掉（list-style none）+ 自定义 chevron ::before 有内容
  const chev = await frame.locator('body').evaluate(() => {
    const s = document.querySelector('details > summary');
    const cs = getComputedStyle(s);
    const before = getComputedStyle(s, '::before');
    return { listStyle: cs.listStyleType, beforeContent: before.content, beforeDisplay: before.display };
  });
  expect(chev.listStyle).toBe('none');                 // 原生 marker 关
  expect(chev.beforeContent).not.toBe('none');         // 自定义 chevron 在
  expect(chev.beforeContent).not.toBe('normal');

  // 入盘：baked toggle CSS + 合规往返 + 无覆盖层泄漏
  const html = await serialize();
  expect(html).toMatch(/data-ws-schema-css="toggle"/);       // 语义 CSS 入盘（校验器 head 白名单认）
  expect(html).toMatch(/summary::-webkit-details-marker\{display:none\}/); // marker-kill 双配方之一入盘
  expect(html).toMatch(/<details open[^>]*><summary>(<br>)?<\/summary><p><\/p><\/details>/); // 种子形态入盘（open 可能序列化成 open=""；空块原地变身路径 summary 带 <br> 占位=U17 canonical）
  expect(html).not.toMatch(/ws-grip|ws-fmtbar|ws-slashmenu|data-ws2-ce|contenteditable/); // 覆盖层/编辑态不泄漏
  expect(await conformOf(html), 'toggle 文档必须合规（走块编辑器，非基础编辑器）').toBe(true);
});

// U5: summary 编辑（原生激活拦截：Space 不折叠）+ Enter→首正文块 + 合规往返。
test('U5: summary 可编辑 + Space 不折叠 + Enter 进正文', async () => {
  await launch();
  await openDoc(SIMPLE);
  await insertToggle(); // 光标在 summary
  await page.keyboard.type('标题');
  await page.keyboard.press('Space');
  await page.keyboard.type('A');
  await page.waitForTimeout(120);
  expect(await detailsOpen(), 'Space 不该折叠 toggle').toBe(true);
  expect(await summaryText()).toBe('标题 A'); // 空格插入、无折叠

  await page.keyboard.press('Enter'); // → 首正文块
  await page.waitForTimeout(120);
  const editing = await frame.locator('body').evaluate(() => {
    const e = document.querySelector('[data-ws2-editing]');
    return e ? { tag: e.tagName, inDetails: !!e.closest('details') } : null;
  });
  expect(editing, 'Enter 后应在编辑正文块').toEqual({ tag: 'P', inDetails: true });
  await page.keyboard.type('正文');
  await page.waitForTimeout(150);

  const html = await serialize();
  expect(html).toMatch(/<details open[^>]*><summary>标题 A<\/summary><p>正文<\/p><\/details>/);
  expect(await conformOf(html)).toBe(true);
  expect(html).not.toMatch(/data-ws2-ce|contenteditable/); // 编辑态不泄漏
});

// U5: chevron 折叠 → 真落盘持久化（'toggle' 事件 → markDirty → 自动保存）。这是持久化承重断言。
test('U5: chevron 折叠 → open 落盘持久化 + 展开恢复', async () => {
  await launch();
  const docPath = await openDoc(SIMPLE);
  await insertToggle();
  await page.keyboard.type('标题');
  await page.keyboard.press('Enter');
  await page.keyboard.type('正文');
  await page.mouse.click(1200, 800); // 退出编辑
  await page.waitForTimeout(200);
  expect(await detailsOpen()).toBe(true);

  // 点 chevron 区（summary 左缘 5px 内）→ 折叠
  await frame.locator('details > summary').click({ position: { x: 5, y: 8 } });
  await page.waitForTimeout(1500); // 等自动保存（~1.2s 去抖）
  expect(await detailsOpen(), 'chevron 应折叠').toBe(false);
  let disk = await fs.readFile(docPath, 'utf8');
  expect(disk, '折叠态应落盘：details 无 open').toMatch(/<details><summary>标题<\/summary>/);
  expect(disk).not.toMatch(/<details open/);
  expect(await conformOf(disk)).toBe(true);

  // 再点 → 展开，落盘恢复 open
  await frame.locator('details > summary').click({ position: { x: 5, y: 8 } });
  await page.waitForTimeout(1500);
  expect(await detailsOpen()).toBe(true);
  disk = await fs.readFile(docPath, 'utf8');
  expect(disk, '展开态应落盘：details open').toMatch(/<details open[^>]*><summary>标题<\/summary>/);
});

// U6: 正文块=一等嵌套块——体内可编辑、Enter 体内分裂、slash 体内插块、嵌套 toggle 全合规。
test('U6: toggle 体内块可编辑 + Enter 分裂 + slash 插块 + 嵌套 toggle', async () => {
  await launch();
  await openDoc(SIMPLE);
  await insertToggle();
  await page.keyboard.type('外标题');
  await page.keyboard.press('Enter');       // → 首正文块
  await page.keyboard.type('正文一');
  await page.keyboard.press('Enter');       // 体内分裂 → 第二正文块（.after 落体内）
  await page.keyboard.type('正文二');
  await page.waitForTimeout(120);
  // 断言：details 体内有 2 个 p，且都在 details 内
  const bodyPs = await frame.locator('body').evaluate(() => {
    const d = document.querySelector('details');
    return [...d.children].filter((c) => c.tagName === 'P').map((p) => p.textContent);
  });
  expect(bodyPs).toEqual(['正文一', '正文二']);

  // slash 体内插无序列表
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: '无序列表' }).click();
  await page.waitForTimeout(150);
  const hasBodyUl = await frame.locator('body').evaluate(() => { const d = document.querySelector('details'); return !!d.querySelector(':scope > ul'); });
  expect(hasBodyUl, '列表应作为一等块插进 toggle 体内').toBe(true);

  // 嵌套 toggle：把光标移回体内某块，slash 折叠
  await frame.locator('details > p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: '折叠' }).click();
  await page.waitForTimeout(150);
  await page.keyboard.type('内标题');
  await page.waitForTimeout(150);

  const html = await serialize();
  expect(html, '嵌套 toggle：details 内含 details').toMatch(/<details open[^>]*>[\s\S]*<details open[^>]*><summary>内标题<\/summary>/);
  expect(await conformOf(html), '嵌套 toggle 文档必须合规').toBe(true);
  // 嵌套块独立可选中：点内层 summary 编辑，data-ws2-editing 落在内层 summary（非外层 details）
  expect((await editInfo()).tag).toBe('SUMMARY');
});

// U6: 体内同作用域跨块删（≥1 块铁则：删空补空 p，不留 summary-only 死胡同）。
test('U6: toggle 体内跨块删除保持合规 + ≥1 块铁则', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<details open id="dt"><summary id="sm">标题</summary><p id="b1">正文一</p><p id="b2">正文二</p></details></body></html>');
  await frame.locator('#b1').click();
  await setCrossSel('b1', 0, 'b2', 3); // 体内跨两块全选
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  const html = await serialize();
  expect(await conformOf(html), '体内跨块删后仍合规').toBe(true);
  // ≥1 块铁则：details 仍有 summary + 至少一个正文块（非 summary-only）
  const shape = await frame.locator('body').evaluate(() => { const d = document.querySelector('#dt'); return { summary: !!d.querySelector(':scope > summary'), bodyCount: [...d.children].filter((c) => c.tagName !== 'SUMMARY' && !c.hasAttribute('data-ws2-ui')).length }; });
  expect(shape.summary).toBe(true);
  expect(shape.bodyCount).toBeGreaterThanOrEqual(1);
});

// U7: Enter 空末块退出 toggle + Backspace 首块回 summary。
test('U7: Enter 空末块退出 + Backspace 首块回 summary', async () => {
  await launch();
  await openDoc(SIMPLE);
  await insertToggle();
  await page.keyboard.type('标题');
  await page.keyboard.press('Enter');   // → 首正文块
  await page.keyboard.type('B1');
  await page.keyboard.press('Enter');   // 分裂出空的第二块（末块）
  await page.keyboard.press('Enter');   // 空末块回车 → 退出 toggle
  await page.waitForTimeout(150);
  const exited = await editInfo();
  expect(exited.inDetails, 'Enter 空末块应退出 toggle').toBe(false);
  expect(exited.parent).toBe('BODY'); // 落在外层（blockRoot=body）
  // toggle 体内仍 ≥1 块（空末块被移除、留 B1）
  const bodyCount = await frame.locator('body').evaluate(() => { const d = document.querySelector('details'); return [...d.children].filter((c) => c.tagName !== 'SUMMARY' && !c.hasAttribute('data-ws2-ui')).length; });
  expect(bodyCount).toBe(1);

  // Backspace 首块起始 → 回 summary 末
  await frame.locator('details > p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  expect((await editInfo()).tag, 'Backspace 首块起始应把光标送回 summary').toBe('SUMMARY');
  expect(await conformOf(await serialize())).toBe(true);
});

// U7: Tab 把块嵌进前一个 details / Shift-Tab 移出。
test('U7: Tab 嵌入 details 体 / Shift-Tab 移出', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<details open id="dt"><summary>标题</summary><p>正文</p></details><p id="tab">要嵌入的块</p></body></html>');
  await frame.locator('#tab').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  let where = await frame.locator('body').evaluate(() => { const t = document.getElementById('tab'); return t ? t.parentElement.tagName + (t.closest('#dt') ? '#dt' : '') : 'GONE'; });
  expect(where, 'Tab 应把 #tab 嵌进 details 体').toBe('DETAILS#dt');
  expect(await conformOf(await serialize())).toBe(true);

  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(150);
  where = await frame.locator('body').evaluate(() => { const t = document.getElementById('tab'); return t ? (t.parentElement.tagName === 'BODY' && !t.closest('details') ? 'OUT' : 'IN') : 'GONE'; });
  expect(where, 'Shift-Tab 应把 #tab 移出到 details 后').toBe('OUT');
  expect(await conformOf(await serialize())).toBe(true);
});

// U10（KD5）承重断言：toggle 展开态下改正文 → Cmd+Z 还原正文，但 toggle 仍展开（快照剥了 open，
// 只有 _applyFold 能保住 open；这条正是变异自检打的地方——不做重贴则 undo 后 toggle 塌成折叠）。
test('U10: 撤销还原正文但不重折叠（OPEN 承重变体）', async () => {
  await launch();
  await openDoc(SIMPLE);
  await insertToggle();
  await page.keyboard.type('标题');
  await page.keyboard.press('Enter');       // → 正文块
  await page.keyboard.type('OLD');
  await page.waitForTimeout(700);           // checkpoint
  await page.keyboard.type(' NEW');
  await page.waitForTimeout(700);           // checkpoint
  expect(await detailsOpen()).toBe(true);
  await page.keyboard.press('Meta+z');      // 撤销 " NEW"
  await page.waitForTimeout(250);
  const bodyText = await frame.locator('body').evaluate(() => { const p = document.querySelector('details > p'); return p ? p.textContent : null; });
  expect(bodyText, 'Cmd+Z 应还原正文到 OLD').toBe('OLD');
  expect(await detailsOpen(), 'Cmd+Z 后 toggle 必须仍展开（fold 不进撤销，_applyFold 保住）').toBe(true);
});

// U13（R14）：多行粘贴——体内劈成多块（scoped splitBlock）；summary 内合成单行（绝不劈出第二个 summary）。
test('U13: 多行粘贴——体内多块 / summary 单行', async () => {
  await launch();
  await openDoc(SIMPLE);
  await insertToggle();
  // summary 内多行粘贴 → 合成单行（poll 等 paste 真落进 DOM；固定睡在慢 CI 上会在 insertText 前读到空 summary → flake，见 team-memory 2026-07-21 CI 门条）
  await app.evaluate(({ clipboard }) => clipboard.writeText('标一\n标二'));
  await page.keyboard.press('ControlOrMeta+v'); // 粘贴是原生动作，绑 OS 快捷键：mac=Cmd+V / Linux CI=Ctrl+V。硬编码 Meta+v 在 Linux 上按的是 Super、触发不了粘贴（U13 从没在 CI 过的真因）
  await expect.poll(async () => frame.locator('body').evaluate(() => document.querySelector('details').querySelector(':scope > summary').textContent), { message: 'summary 多行粘贴应合成单行' }).toBe('标一 标二');
  // 落定后再查「绝不第二个 summary」——负向不变量不折进 poll（空态也满足 ===1 = 假绿）
  const summaryCount = await frame.locator('body').evaluate(() => document.querySelector('details').querySelectorAll(':scope > summary').length);
  expect(summaryCount, '绝不产生第二个 summary').toBe(1);

  // 进正文块，多行粘贴 → 劈成多个体内块
  await page.keyboard.press('Enter'); // → 首正文块
  await app.evaluate(({ clipboard }) => clipboard.writeText('体一\n体二\n体三'));
  await page.keyboard.press('ControlOrMeta+v'); // 粘贴是原生动作，绑 OS 快捷键：mac=Cmd+V / Linux CI=Ctrl+V。硬编码 Meta+v 在 Linux 上按的是 Super、触发不了粘贴（U13 从没在 CI 过的真因）
  await expect.poll(async () => frame.locator('body').evaluate(() => [...document.querySelector('details').children].filter((c) => c.tagName === 'P').map((p) => p.textContent).join('|')), { message: '多行粘贴劈成多个体内块' }).toBe('体一|体二|体三');
  expect(await conformOf(await serialize())).toBe(true);
});

// 合成拖拽（原生拖拽在 Playwright+iframe 里卡死、自动化不了，仓库既有做法）：hover 源→grip dragstart 设 dragFrom→drop 落目标。
async function synthDrag(hoverSel, tgtSel) {
  await frame.locator(hoverSel).hover();
  await page.waitForTimeout(80);
  await frame.locator('.ws-grip').dispatchEvent('dragstart');
  await frame.locator(tgtSel).dispatchEvent('drop');
  await page.waitForTimeout(150);
}

// U8（R6）：拖块进 toggle 体（scoped .before/.after 自动获得）。
test('U8: 拖块进 toggle 体', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<details open id="dt"><summary>标题</summary><p id="body1">体内</p></details><p id="src">要拖进去的</p></body></html>');
  await synthDrag('#src', '#body1');
  const inBody = await frame.locator('body').evaluate(() => { const s = document.getElementById('src'); return s ? !!s.closest('#dt') : 'gone'; });
  expect(inBody, '#src 应进入 toggle 体（scoped drop）').toBe(true);
  expect(await conformOf(await serialize())).toBe(true);
});

// U8（R6）：自嵌守卫——details 不能拖进自己的体（无限嵌套）。
test('U8: 自嵌守卫（details 不拖进自己体）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<details open id="dt"><summary>标题</summary><p id="inner">体内块</p></details></body></html>');
  await synthDrag('#dt > summary', '#inner'); // hover summary → dragFrom=#dt；drop 落在它自己的体内块
  const st = await frame.locator('body').evaluate(() => {
    const dt = document.getElementById('dt'), inner = document.getElementById('inner');
    return { dtTop: !!(dt && dt.parentElement.tagName === 'BODY'), innerInDt: !!(inner && inner.closest('details') === dt), selfNest: !!(dt && dt.querySelector('details')) };
  });
  expect(st.dtTop, '自嵌被拒 → #dt 仍在顶层').toBe(true);
  expect(st.innerInDt).toBe(true);
  expect(st.selfNest, '不该产生自嵌套 details').toBe(false);
  expect(await conformOf(await serialize())).toBe(true);
});

// ======== bug-sweep 回归门（对抗审查抓到的真 bug，修后加门防复发）========

// BF-P0：编辑 summary 时「转为」绝不产非 conform（原 bug：retag 掉 summary → 零 summary）。修=转为作用于整个 toggle。
test('BF-P0: 编辑 summary 时转为 → 仍合规（不 retag 掉 summary）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<details open id="dt"><summary id="sm">标题ABC</summary><p>正文</p></details></body></html>');
  await frame.locator('#sm').click();
  await frame.locator('#sm').selectText();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await frame.locator('.ws-fmtbar-menu-item', { hasText: '正文' }).click();
  await page.waitForTimeout(200);
  const html = await serialize();
  expect(await conformOf(html), '编辑 summary 转为后必须仍合规（原 bug 是非合规）').toBe(true);
  // 每个残留 details 都恰有一个 summary（不存在零 summary 的 details）
  const bad = await frame.locator('body').evaluate(() => [...document.querySelectorAll('details')].some((d) => d.querySelectorAll(':scope > summary').length !== 1));
  expect(bad, '不该有零/多 summary 的 details').toBe(false);
  expect(html).toMatch(/标题ABC/); // 内容没丢
});

// BF-P1：前向 Delete 在 toggle 体末块绝不吞顶层块（原 bug：topBlocks→indexOf=-1→合并 blocks[0]）。
test('BF-P1: Delete 体末块不吞顶层块', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<p id="alpha">ALPHA</p><details open id="dt"><summary>t</summary><p id="beta">BETA</p></details></body></html>');
  await frame.locator('#beta').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  const st = await frame.locator('body').evaluate(() => ({
    alpha: (document.getElementById('alpha') || {}).textContent,
    beta: (document.querySelector('#dt > p') || {}).textContent,
    alphaTop: !!(document.getElementById('alpha') && document.getElementById('alpha').parentElement.tagName === 'BODY'),
  }));
  expect(st.alpha, 'ALPHA 必须原封不动（原 bug：被吞进 toggle 体）').toBe('ALPHA');
  expect(st.alphaTop).toBe(true);
  expect(st.beta).toBe('BETA');
  expect(await conformOf(await serialize())).toBe(true);
});

// BF：方向键从体内不跳到 blocks[0]；体首 ←/↑ 回 summary（原 bug：topBlocks→teleport 顶层）。
test('BF: 方向键从 toggle 体内不 teleport 顶层 + 体首←回 summary', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<p id="top">TOP</p><details open id="dt"><summary>S</summary><p id="b1">B1</p></details></body></html>');
  await frame.locator('#b1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight'); // 体末 → 无外层块（details 是最后）→ 不动，绝不跳 TOP
  await page.waitForTimeout(120);
  let ed = await editInfo();
  expect(ed && ed.inDetails, 'ArrowRight 不该 teleport 到顶层 TOP').toBe(true);
  await frame.locator('#b1').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft'); // 体首 → 回 summary
  await page.waitForTimeout(120);
  ed = await editInfo();
  expect(ed && ed.tag, 'ArrowLeft 体首应回 summary').toBe('SUMMARY');
});

// BF-P2：查找自动展开是「只读揭示」——纯搜索不把折叠态改写进磁盘（原 bug：markDirty→autosave 落 open）。
test('BF-P2: 查找自动展开不改写磁盘折叠态', async () => {
  await launch();
  const docPath = await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<p id="p1">前段</p><details id="dt"><summary>标题</summary><p id="bd">藏着SECRETQQ的正文</p></details></body></html>');
  await page.waitForTimeout(200);
  await menu('find-in-doc');
  await expect(page.locator('.ws-docfind')).toBeVisible();
  await page.locator('.ws-docfind-input').fill('SECRETQQ');
  await page.waitForTimeout(1600); // 过 autosave 去抖
  expect(await detailsOpen(), '实时 DOM 应展开（可见）').toBe(true);
  const disk = await fs.readFile(docPath, 'utf8');
  expect(disk, '纯搜索绝不把折叠态写进磁盘：details 仍无 open').not.toMatch(/<details open/);
  expect(disk).toMatch(/<details[^>]*><summary>标题<\/summary>/); // details 仍在、折叠（无 open）
});

// BF-P2（U26 翻转，Colin 2026-07-24「块操作与其他块同步」）：跨作用域删（顶层→toggle 体内）——
// toggle 整删，兑现块级高亮承诺（refreshRangeSel 早把部分进入的 toggle 整块标蓝=所见即所删）；
// 对齐 table 的 ED-A2 结构端点整块删。旧「夹住不删」是 deferred 空操作时代的保守解，随 U26 废除。
test('BF-P2(U26): 跨作用域删（顶层→toggle 体内）→ toggle 整删 + 外块裁剪（所见即所删）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<p id="top">AAAA</p><details open id="dt"><summary id="sm">S</summary><p id="b1">BBBB</p><p id="b2">CCCC</p></details><p id="tail">DDDD</p></body></html>');
  await frame.locator('#top').click();
  await setCrossSel('top', 2, 'b1', 2); // 从 top 中间选进 b1 中间——块级高亮此时把整个 dt 标蓝
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  const st = await frame.locator('body').evaluate(() => ({
    hasDt: !!document.getElementById('dt'),
    top: (document.getElementById('top') || {}).textContent,
    tail: (document.getElementById('tail') || {}).textContent,
  }));
  expect(st.hasDt, 'toggle 整删（高亮标了整块=所见即所删）').toBe(false);
  expect(st.top, '外侧起块裁剪保留选区前文字').toBe('AA');
  expect(st.tail, '选区外的后段不动').toBe('DDDD');
  expect(await conformOf(await serialize())).toBe(true);
});

// U12（R11）：app 内查找命中折叠 toggle 里的文字 → 自动展开其 details 祖先，匹配可见。
test('U12: 查找命中折叠 toggle 内文字 → 自动展开', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<p id="p1">前段</p><details id="dt"><summary>标题</summary><p id="bd">藏着SECRETZZZ的正文</p></details></body></html>');
  await page.waitForTimeout(200);
  expect(await detailsOpen(), '初始应折叠').toBe(false);
  const bodyHiddenBefore = await frame.locator('body').evaluate(() => document.getElementById('bd').offsetHeight);
  expect(bodyHiddenBefore, '折叠时正文应隐藏（offsetHeight 0）').toBe(0);

  await menu('find-in-doc');
  await expect(page.locator('.ws-docfind')).toBeVisible();
  await page.locator('.ws-docfind-input').fill('SECRETZZZ');
  await page.waitForTimeout(400); // 搜索 + 定位当前匹配 + 自动展开

  expect(await detailsOpen(), '查找命中折叠体 → 应自动展开 details').toBe(true);
  const bodyShownAfter = await frame.locator('body').evaluate(() => document.getElementById('bd').offsetHeight);
  expect(bodyShownAfter, '展开后正文可见（offsetHeight > 0）').toBeGreaterThan(0);
});

// U9（R2）：段落 → toggle（格式条「转为」→折叠），内容成 summary、空正文体。
test('U9: 段落转 toggle（内容成 summary）', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  await frame.locator('#p1').selectText();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await frame.locator('.ws-fmtbar-menu-item', { hasText: '折叠' }).click();
  await page.waitForTimeout(200);
  const shape = await frame.locator('body').evaluate(() => {
    const d = document.querySelector('details');
    if (!d) return { ok: false };
    const s = d.querySelector(':scope > summary');
    return { ok: true, summaryText: s ? s.textContent : null, bodyCount: [...d.children].filter((c) => c.tagName === 'P').length, noP1: !document.getElementById('p1') };
  });
  expect(shape.ok).toBe(true);
  expect(shape.summaryText).toBe('正文一段'); // 段落内容成了 summary
  expect(shape.bodyCount).toBe(1);            // 空正文体
  expect(shape.noP1).toBe(true);
  expect(await conformOf(await serialize())).toBe(true);
});

// U9（R2）：toggle → 文本（块菜单「转为正文」），summary + 全部正文块零丢失、按序。
test('U9: toggle 转文本（内容零丢失）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<details open id="dt"><summary>标题S</summary><p>正文B1</p><p>正文B2</p></details></body></html>');
  await frame.locator('#dt > summary').hover();
  await page.waitForTimeout(150);
  await frame.locator('.ws-grip').click();
  await page.waitForTimeout(150);
  await frame.locator('.ws-blockmenu-item', { hasText: '转为正文' }).click();
  await page.waitForTimeout(200);
  const result = await frame.locator('body').evaluate(() => ({
    hasDetails: !!document.querySelector('details'),
    texts: [...document.body.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui')).map((c) => c.tagName + ':' + c.textContent),
  }));
  expect(result.hasDetails, 'toggle 应已转成文本').toBe(false);
  expect(result.texts, 'summary + 两正文块全在、按序').toEqual(['P:标题S', 'P:正文B1', 'P:正文B2']);
  expect(await conformOf(await serialize())).toBe(true);
});

// U11（AE4/R13）：导出前把折叠的 toggle 强制展开——折叠内容绝不从 PDF 丢失。承重断言=打印 HTML 里
// 每个 <details> 都带 open（force-expand 决定渲染时正文可见=进 PDF）。
test('U11: 导出 print HTML 强制展开所有 toggle（折叠内容不丢）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<p id="p1">前段</p><details id="dt"><summary>折叠标题</summary><p>折叠正文SECRET</p></details></body></html>');
  await page.waitForTimeout(200);
  // 实时 DOM：toggle 折叠（无 open）
  expect(await detailsOpen()).toBe(false);
  const printHtml = await page.evaluate(() => window.__wsBuildPrintHtml());
  // 承重：打印 HTML 里每个 details 都带 open（force-expand），折叠正文内容在
  const detailsInfo = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, 'text/html');
    const dets = [...d.querySelectorAll('details')];
    return { count: dets.length, allOpen: dets.every((x) => x.hasAttribute('open')), hasBody: /折叠正文SECRET/.test(h) };
  }, printHtml);
  expect(detailsInfo.count).toBeGreaterThan(0);
  expect(detailsInfo.allOpen, '导出 print HTML 里所有 details 必须 force-expand（open）').toBe(true);
  expect(detailsInfo.hasBody).toBe(true);
  // 且实时 DOM 不被导出改动（force-expand 只作用于克隆）
  expect(await detailsOpen(), '导出不该改实时 DOM 的折叠态').toBe(false);
});

// U10：折叠不是撤销步——折叠后 Cmd+Z 撤的是内容编辑，不是折叠。
test('U10: 折叠不消耗撤销步', async () => {
  await launch();
  await openDoc(SIMPLE);
  await insertToggle();
  await page.keyboard.type('标题T');
  await page.waitForTimeout(700);           // 标题编辑 checkpoint
  // 折叠（chevron 区）——不该压撤销步
  await frame.locator('details > summary').click({ position: { x: 5, y: 8 } });
  await page.waitForTimeout(200);
  expect(await detailsOpen()).toBe(false);
  await page.keyboard.press('Meta+z');      // 应撤「标题T」编辑，不是折叠
  await page.waitForTimeout(250);
  expect(await summaryText(), 'Cmd+Z 应撤内容编辑（标题清空），证明折叠没占撤销步').toBe('');
});

// U24（Wendi 2026-07-24 视频反馈「新建 toggle 往下跳半行」）：空块 slash 选折叠，旧行为是 insertAfter——
// 输入 /togg 的空段落留在原地、details 插到它下面，光标突然下坠一行 + 留空段落垃圾。其他块类型空块
// 都走 turnInto 原地变身，唯独 toggle 被例外。修后：空块原地变身（行几何不动），非空块维持 insertAfter。
test('U24a: 空块 slash 折叠 → 原地变身：不留空段落、summary 行几何不跳', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  // 记录空块（即将变身的块）的几何
  const beforeTop = await frame.locator('body').evaluate(() => {
    const e = document.querySelector('[data-ws2-editing]');
    return e ? e.getBoundingClientRect().top : null;
  });
  expect(beforeTop).not.toBe(null);
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await page.keyboard.type('togg');
  await page.waitForTimeout(120);
  await frame.locator('.ws-slashmenu-item', { hasText: '折叠' }).click();
  await page.waitForTimeout(250);
  // ① 结构：空段落被吃掉——#p1 的下一个兄弟就是 details，中间没有残留空 P
  const shape = await frame.locator('body').evaluate(() => {
    const p1 = document.getElementById('p1');
    const next = p1 && p1.nextElementSibling;
    return { nextIsDetails: !!next && next.tagName === 'DETAILS',
             emptyPCount: [...document.querySelectorAll('body > p')].filter((p) => p.id !== 'p1' && (p.textContent || '').trim() === '').length };
  });
  expect(shape.nextIsDetails, '空块该原地变身成 details（p1 下一个兄弟就是它）').toBe(true);
  expect(shape.emptyPCount, '不该留下空段落垃圾').toBe(0);
  // ② 几何：summary 行没往下跳（顶部与原空块一致，容差 3px）
  const afterTop = await frame.locator('body').evaluate(() => {
    const s = document.querySelector('details > summary');
    return s ? s.getBoundingClientRect().top : null;
  });
  expect(afterTop).not.toBe(null);
  expect(Math.abs(afterTop - beforeTop), `summary 行跳了 ${afterTop - beforeTop}px（旧 bug：往下坠一行）`).toBeLessThan(3);
  // ③ 光标落 summary
  expect(await editingTag()).toBe('SUMMARY');
});

test('U24b: 非空块 slash 折叠 → 维持插入下方：原块内容不吞', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await page.keyboard.type('togg');
  await page.waitForTimeout(120);
  await frame.locator('.ws-slashmenu-item', { hasText: '折叠' }).click();
  await page.waitForTimeout(250);
  const shape = await frame.locator('body').evaluate(() => {
    const p1 = document.getElementById('p1');
    return { p1Text: p1 ? p1.textContent : null,
             nextIsDetails: !!(p1 && p1.nextElementSibling) && p1.nextElementSibling.tagName === 'DETAILS' };
  });
  expect(shape.p1Text, '非空块内容不该被吞（query 已删干净）').toBe('正文一段');
  expect(shape.nextIsDetails, '非空块 → details 插在其后').toBe(true);
  expect(await editingTag()).toBe('SUMMARY');
});

// U25（Wendi 2026-07-24「三角丑」）：chevron=细线两边框（对齐 ui-demo lucide 视觉），不是实心字符。
// 强断言锚 computed-style：content 空串（非 \25B6 字符）+ 1.5px 细线 + 折叠/展开旋转相反。
// U4 的 content!=none 挡不住「换回实心字符」的回退——这里把设计钉死。
test('U25: chevron 细线样式强断言（content 空 + border 1.5px + 两态旋转）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<details open id="d1"><summary>展开的</summary><p>体</p></details>'
    + '<details id="d2"><summary>折叠的</summary><p>体</p></details></body></html>');
  const probe = await frame.locator('body').evaluate(() => {
    const read = (sel) => {
      const s = document.querySelector(sel + ' > summary');
      const b = getComputedStyle(s, '::before');
      return { content: b.content, borderRW: b.borderRightWidth, borderBW: b.borderBottomWidth, transform: b.transform };
    };
    return { open: read('#d1'), closed: read('#d2') };
  });
  // 实心字符已死：content 是空串（"" 或 'none' 都不是 "\25B6"）
  expect(probe.open.content).toBe('""');
  // 细线在：两条边框 1.5px（下取整浏览器可能给 1.5 或 device 取整值，锚「非 0px」+ 数值 ≤2）
  for (const st of [probe.open, probe.closed]) {
    const w = parseFloat(st.borderRW);
    expect(w, `border-right ${st.borderRW} 应为细线(0<w≤2px)`).toBeGreaterThan(0);
    expect(w).toBeLessThanOrEqual(2);
    expect(parseFloat(st.borderBW)).toBeGreaterThan(0);
  }
  // 两态旋转相反：都非 none 且互不相同（-45° vs 45°）
  expect(probe.open.transform).not.toBe('none');
  expect(probe.closed.transform).not.toBe('none');
  expect(probe.open.transform).not.toBe(probe.closed.transform);
});
