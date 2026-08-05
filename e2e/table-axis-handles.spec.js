// PR-4（Notion parity 第三批）：表格行/列手柄 + 按轴菜单 + 退化守卫 + 末格 Tab。
// Notion 对照（对拍实测）：三套手柄并存（块手柄恒锚整表 + 行手柄随行 + 列手柄随列，T1）；
// 行菜单/列菜单按轴切干净、互不含对方操作（T5）；两种前置状态开的菜单一致（T7）；
// 最后一行/列的「删除」项直接消失、表恒 ≥1 行 ≥1 列、数据行删光**不**自动补（T9）；末格 Tab 不长新行（T11）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2axis-')); // 每实例独立 userData——共享会撞 SingletonLock（memory 已记：dev 重启秒退同款）
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
}
async function openDoc(body) {
  const tag = 'run' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc' + seq + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(300);
}
const T33 = '<p id="a">上</p><table id="T"><tbody>'
  + '<tr id="r1"><td id="c11">一甲</td><td id="c12">一乙</td><td id="c13">一丙</td></tr>'
  + '<tr id="r2"><td id="c21">二甲</td><td id="c22">二乙</td><td id="c23">二丙</td></tr>'
  + '<tr id="r3"><td id="c31">三甲</td><td id="c32">三乙</td><td id="c33">三丙</td></tr>'
  + '</tbody></table><p id="z">下</p>';
const texts = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelectorAll('#T tr')].map((r) => [...r.children].map((c) => (c.textContent || '').trim()));
});
const menuItems = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelectorAll('.ws-blockmenu-item')].map((it) => it.textContent.trim());
});
async function hoverCell(sel) { await frame.locator(sel).hover(); await page.waitForTimeout(250); }
async function openAxis(which) { await frame.locator(which === 'row' ? '.ws-rowsel' : '.ws-colsel').click(); await expect(frame.locator('.ws-blockmenu')).toBeVisible(); await page.waitForTimeout(100); }
const clickItem = async (label) => { await frame.locator('.ws-blockmenu-item', { hasText: label }).first().click(); await page.waitForTimeout(300); };

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('T1 三套手柄并存：悬停格出现行/列手柄，几何各随其行其列；块手柄仍锚整表', async () => {
  await launch(); await openDoc(T33);
  await hoverCell('#c22');
  const g = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const pick = (q) => { const el = d.querySelector(q); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, vis: getComputedStyle(el).display !== 'none' }; };
    return { row: pick('.ws-rowsel'), col: pick('.ws-colsel'), grip: pick('.ws-grip'),
      tbl: d.querySelector('#T').getBoundingClientRect().toJSON(), r2: d.querySelector('#r2').getBoundingClientRect().toJSON(), c22: d.querySelector('#c22').getBoundingClientRect().toJSON() };
  });
  expect(g.row.vis && g.col.vis).toBe(true);
  expect(g.row.x).toBeLessThan(g.tbl.left);                   // 行手柄在表左缘外
  expect(Math.abs(g.row.y - (g.r2.top + g.r2.height / 2))).toBeLessThan(4);  // y 对齐悬停行中线
  expect(g.col.y).toBeLessThan(g.tbl.top);                    // 列手柄在表顶外
  expect(Math.abs(g.col.x - (g.c22.left + g.c22.width / 2))).toBeLessThan(4); // x 对齐悬停列中线
  // 换行悬停 → 行手柄跟着走
  await hoverCell('#c31');
  const y2 = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const r = d.querySelector('.ws-rowsel').getBoundingClientRect();
    const r3 = d.querySelector('#r3').getBoundingClientRect();
    return Math.abs((r.top + r.height / 2) - (r3.top + r3.height / 2));
  });
  expect(y2).toBeLessThan(4);
});

test('T5 按轴切干净：行菜单只有行操作、列菜单只有列操作', async () => {
  await launch(); await openDoc(T33);
  await hoverCell('#c22');
  await openAxis('row');
  const rowItems = await menuItems();
  expect(rowItems).toEqual(['上方插行', '下方插行', '复制本行', '清空本行', '删除本行']); // Notion 行菜单项集的直译
  expect(rowItems.join('|')).not.toMatch(/列/); // 一个列操作都没有
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await hoverCell('#c22');
  await openAxis('col');
  const colItems = await menuItems();
  expect(colItems).toEqual(['左侧插列', '右侧插列', '复制本列', '清空本列', '删除本列']);
  expect(colItems.join('|')).not.toMatch(/行/); // 一个行操作都没有
});

test('T5b 行菜单作用：下方插入行（矩形保持、参照=悬停行）；删除本行只删那一行', async () => {
  await launch(); await openDoc(T33);
  await hoverCell('#c22');
  await openAxis('row');
  await clickItem('下方插行');
  let t = await texts();
  expect(t.length).toBe(4);
  expect(t[2]).toEqual(['', '', '']); // 新空行在第 2 行之后
  expect(t.map((r) => r.length)).toEqual([3, 3, 3, 3]); // 矩形
  await hoverCell('#c31'); // 第三行（原三甲行现在是第 4 行？不——插在 r2 后，r3 顺延为第 4 行）
  await openAxis('row');
  await clickItem('删除本行');
  t = await texts();
  expect(t).toEqual([['一甲', '一乙', '一丙'], ['二甲', '二乙', '二丙'], ['', '', '']]);
});

test('T5c 列菜单作用：右侧插入列 + 复制本列 + 清空本列', async () => {
  await launch(); await openDoc(T33);
  await hoverCell('#c22');
  await openAxis('col');
  await clickItem('右侧插列');
  let t = await texts();
  expect(t.map((r) => r.length)).toEqual([4, 4, 4]);
  expect(t.map((r) => r[2])).toEqual(['', '', '']); // 新空列在第 2 列右
  await hoverCell('#c21');
  await openAxis('col');
  await clickItem('复制本列');
  t = await texts();
  expect(t.map((r) => r.length)).toEqual([5, 5, 5]);
  expect(t.map((r) => r[1])).toEqual(['一甲', '二甲', '三甲']); // 副本紧随原列
  await hoverCell('#c21');
  await openAxis('col');
  await clickItem('清空本列');
  t = await texts();
  expect(t.map((r) => r[0])).toEqual(['', '', '']);
});

test('T9 退化守卫：删到最后一行/列时「删除」项消失；数据行删光不自动补', async () => {
  await launch();
  await openDoc('<p id="a">上</p><table id="T"><tbody><tr id="r1"><td id="c11">仅甲</td></tr><tr id="r2"><td id="c21">仅乙</td></tr></tbody></table><p id="z">下</p>');
  // 2 行 1 列：列菜单不该有「删除本列」
  await hoverCell('#c11');
  await openAxis('col');
  expect((await menuItems()).join('|')).not.toContain('删除本列');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // 行还剩 2，可删一行
  await hoverCell('#c11');
  await openAxis('row');
  await clickItem('删除本行');
  expect(await texts()).toEqual([['仅乙']]);
  // 只剩 1 行：行菜单不再给「删除本行」——表恒 ≥1 行 ≥1 列，退化态不可达
  await hoverCell('#c21');
  await openAxis('row');
  const items = await menuItems();
  expect(items.join('|')).not.toContain('删除本行');
  expect(items.length).toBeGreaterThanOrEqual(4); // 其余操作照给（插/复制/清空）
  // 表还立着（没有被自动删掉/补行）
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('#T tr').length)).toBe(1);
});

test('T7 前置状态一致：cell 编辑态与 Esc 灰选态开的块菜单，行列操作都不在（按轴分离后自然一致）', async () => {
  await launch(); await openDoc(T33);
  // 前置 A：点进格
  await frame.locator('#c22').click();
  await page.waitForTimeout(200);
  await expect(frame.locator('.ws-grip')).toBeVisible({ timeout: 8000 });
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  const itemsA = await menuItems();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // 前置 B：Esc 灰选整表
  await frame.locator('#c22').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await expect(frame.locator('.ws-grip')).toBeVisible({ timeout: 8000 });
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  const itemsB = await menuItems();
  expect(itemsA.join('|')).not.toMatch(/行|列/);
  expect(itemsB.join('|')).not.toMatch(/行|列/);
  expect(itemsA).toEqual(itemsB); // T7：两种前置状态项集一致
});

test('T11 末格 Tab 不长新行：行数不变、编辑框停在末格', async () => {
  await launch(); await openDoc(T33);
  await frame.locator('#c33').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { rows: d.querySelectorAll('#T tr').length, editing: d.querySelector('[data-ws2-cell]') ? d.querySelector('[data-ws2-cell]').id : null };
  });
  expect(st.rows).toBe(3);       // 修前：Tab 长出第 4 行
  expect(st.editing).toBe('c33'); // 停留原格（对照：中间格 Tab 会移格，cellNavTarget 'next' 未动）
  // 正对照：非末格 Tab 仍移格
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(200);
  const st2 = await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; const c = d.querySelector('[data-ws2-cell]'); return c ? c.id : null; });
  expect(st2).toBe('c32');
});

// ── 对抗审查回归钉（ADV-1/3/4，全部实测复现过）──────────────────────────────
test('ADV-1 cell 编辑态开轴菜单：格的编辑态被真正收掉；Esc 一下就关菜单', async () => {
  await launch(); await openDoc(T33);
  await frame.locator('#c22').click(); // 进 cell 编辑
  await page.waitForTimeout(200);
  await openAxisMenuAt2('#c22', 'row');
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { cellAttrs: d.querySelectorAll('[data-ws2-cell]').length, ce: d.querySelectorAll('#T [contenteditable="true"]').length };
  });
  expect(st).toEqual({ cellAttrs: 0, ce: 0 }); // 修前：菜单开着格还挂 contenteditable（exitEdit 对 cell 空转）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const menuOpen = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelector('.ws-blockmenu').style.display !== 'none');
  expect(menuOpen).toBe(false); // 修前：Esc 被 cell 分支截走，菜单关不掉（僵尸菜单下 Backspace 可删整表）
});

test('ADV-2 复制本行不拷编辑态：副本格不带幽灵 contenteditable/data-ws2-cell', async () => {
  await launch(); await openDoc(T33);
  await frame.locator('#c22').click(); // c22 编辑态（属性在身上）
  await page.waitForTimeout(200);
  await openAxisMenuAt2('#c21', 'row'); // 悬停同行别的格开菜单
  await clickItem('复制本行');
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { cellMarks: d.querySelectorAll('[data-ws2-cell]').length, ce: d.querySelectorAll('#T [contenteditable="true"]').length, rows: d.querySelectorAll('#T tr').length };
  });
  expect(st.rows).toBe(4);
  expect(st.cellMarks).toBeLessThanOrEqual(1); // 落点格自己（enterCell）至多 1 个——修前副本再带 1 个幽灵 = 2
  expect(st.ce).toBeLessThanOrEqual(1);
});

test('ADV-3 菜单开着再点另一根手柄：新菜单锚在手柄旁，不跳到文档左上角', async () => {
  await launch(); await openDoc(T33);
  await hoverCell('#c22');
  await openAxis('row');
  // 行菜单开着（手柄冻结可见），直接点列手柄切轴
  await frame.locator('.ws-colsel').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  await page.waitForTimeout(120);
  const g = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const m = d.querySelector('.ws-blockmenu').getBoundingClientRect();
    const t = d.querySelector('#T').getBoundingClientRect();
    return { mLeft: m.left, mTop: m.top, tLeft: t.left, tTop: t.top };
  });
  expect(g.mLeft).toBeGreaterThan(g.tLeft - 60); // 修前：rect 在 closeBlockMenu 之后读（手柄已藏、全零）→ 菜单跳 (0,4)
  expect(g.mTop).toBeGreaterThan(20);
});

test('ADV-4 慢速滑向手柄：途经表缘间隙手柄不消失（连续轨迹，非瞬移）', async () => {
  await launch(); await openDoc(T33);
  await hoverCell('#c21');
  const from = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const c = d.querySelector('#c21').getBoundingClientRect();
    const h = d.querySelector('.ws-rowsel').getBoundingClientRect();
    return { fx: c.left + c.width / 2, fy: c.top + c.height / 2, tx: h.left + h.width / 2, ty: h.top + h.height / 2 };
  });
  // iframe 内坐标 → 页面坐标：doc-frame 无偏移假设不可靠，直接量
  const off = await page.evaluate(() => { const r = document.getElementById('doc-frame').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await page.mouse.move(off.x + from.fx, off.y + from.fy);
  await page.mouse.move(off.x + from.tx, off.y + from.ty, { steps: 25 }); // 慢速连续轨迹，途经 8px 间隙
  await page.waitForTimeout(150);
  const vis = await page.evaluate(() => getComputedStyle(document.getElementById('doc-frame').contentDocument.querySelector('.ws-rowsel')).display !== 'none');
  expect(vis).toBe(true); // 修前：间隙里 el=null → hideAxisHandles，手柄在鼠标到达前消失
});

test('ADV-5b 列侧同源性：被标记的列格集合 === 删除本列后真正消失的格集合', async () => {
  await launch(); await openDoc(T33);
  await hoverCell('#c22');
  await openAxis('col');
  const marked = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('[data-ws2-menucol]')].map((n) => n.id).sort();
  });
  expect(marked).toEqual(['c12', 'c22', 'c32']);
  await clickItem('删除本列');
  const gone = await page.evaluate((ids) => {
    const d = document.getElementById('doc-frame').contentDocument;
    return ids.filter((i) => !d.getElementById(i)).sort();
  }, marked);
  expect(gone).toEqual(marked); // 标了哪列，删的就是哪列
});

// cell 编辑态下开轴菜单的入口（ADV-1/2 专用：先点格再 hover 开）
async function openAxisMenuAt2(cellSel, axis) {
  await frame.locator(cellSel).hover();
  await page.waitForTimeout(250);
  await frame.locator(axis === 'row' ? '.ws-rowsel' : '.ws-colsel').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  await page.waitForTimeout(80);
}
