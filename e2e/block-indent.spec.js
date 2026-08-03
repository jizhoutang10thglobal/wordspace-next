// Track2 方案B（2026-07-24 拍板）：段落/标题/引用/callout 整块缩进 ws-indent-1..6 类原语。
// 计划：docs/plans/2026-07-24-002-feat-app-block-indent-ws-indent-plan.md §U4（13 条 + M1-M7 变异自检）。
// 强断言纪律（S4）：每个缩进用例 class + getBoundingClientRect 坐标双断言——class 是 JS 直接设的，
// CSS 全废它照过；坐标断言才证明 CSS 真生效（M4 变异专打这个）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, docPath;

// 与实现同款的入盘缩进 CSS（fixture 预置档位用；attach 的 refreshSemanticStyles 会按内容 diff 升级成实现版，坐标语义一致）
const INDENT_STYLE = '<style id="ws-indent-style" data-ws-schema-css="indent">'
  + Array.from({ length: 6 }, (_, i) => `.ws-indent-${i + 1}{position:relative;left:${(i + 1) * 24}px}`).join('')
  + '</style>';

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2bind-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body, headExtra = '') {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>${headExtra}</head><body>${body}</body></html>`;
  docPath = path.join(tmpDir, 'doc.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
const rectX = (sel) => frame.locator(sel).evaluate((el) => el.getBoundingClientRect().x);
const rectTop = (sel) => frame.locator(sel).evaluate((el) => el.getBoundingClientRect().top);
const clsOf = (sel) => frame.locator(sel).evaluate((el) => el.className);
async function clickIn(sel) { await frame.locator(sel).click(); await page.waitForTimeout(80); }
async function shiftTab() { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); await page.waitForTimeout(60); }
async function tab(n = 1) { for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); await page.waitForTimeout(60); } }

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('1 段落 Tab 缩一档：class+坐标双断言，且不挤动下方块', async () => {
  await launch();
  await openDoc('<p id="a">甲段</p><p id="b">乙段</p><p id="c">丙段</p>');
  const x0 = await rectX('#b');
  const cTop0 = await rectTop('#c');
  await clickIn('#b');
  await tab();
  expect(await clsOf('#b'), 'b 挂 ws-indent-1').toContain('ws-indent-1');
  expect(Math.abs((await rectX('#b')) - (x0 + 24)), 'b 视觉右移 24px（CSS 真生效）').toBeLessThanOrEqual(1);
  expect(await rectTop('#c'), 'c 的 top 不变（不挤下方块）').toBe(cTop0);
});

test('2 相对+绝对封顶：8 块阶梯，第 7/8 块都封 6，全文档无 ws-indent-7', async () => {
  await launch();
  // ⚠ 必须 8 块：第 7 块的相对封顶恰好=6=绝对封顶，7 块测不出 INDENT_MAX 被删（M1）
  await openDoc('<p id="a">a1</p><p id="b">b2</p><p id="c">c3</p><p id="d">d4</p><p id="e">e5</p><p id="f">f6</p><p id="g">g7</p><p id="h">h8</p>');
  const baseX = await rectX('#a');
  for (const id of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    await clickIn('#' + id);
    await tab(8); // 连按 8 次：能到的档位全走满，封顶后剩余按键必须 no-op
  }
  const levels = await frame.locator('body').evaluate((body) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => {
    const el = body.querySelector('#' + id);
    for (let n = 6; n >= 1; n--) if (el.classList.contains('ws-indent-' + n)) return n;
    return 0;
  }));
  expect(levels, '阶梯 = 每块最多比上一块深一级，7/8 两块都封绝对 6 档').toEqual([0, 1, 2, 3, 4, 5, 6, 6]);
  // 负向断言直接断：全文档不存在超词汇 class（有限词汇表铁律）
  expect(await frame.locator('[class*="ws-indent-7"]').count(), '绝不产生 ws-indent-7').toBe(0);
  expect(Math.abs((await rectX('#h')) - (baseX + 6 * 24)), 'h 视觉 = 6 档 × 24px').toBeLessThanOrEqual(1);
});

test('3 Shift+Tab 逐档减到 0：class 清光坐标复原，0 档再按 DOM 零变化', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b" class="ws-indent-2">乙</p>', INDENT_STYLE);
  const baseX = await rectX('#a');
  await clickIn('#b');
  await shiftTab();
  expect(await clsOf('#b'), '2 档 → 1 档').toContain('ws-indent-1');
  expect(Math.abs((await rectX('#b')) - (baseX + 24))).toBeLessThanOrEqual(1);
  await shiftTab();
  expect((await clsOf('#b')).includes('ws-indent'), '1 档 → 0 档：class 全无').toBe(false);
  expect(Math.abs((await rectX('#b')) - baseX), '坐标复原').toBeLessThanOrEqual(1);
  const htmlBefore = await frame.locator('body').evaluate((b) => b.innerHTML);
  await shiftTab(); // 0 档再按 = 静默 no-op
  expect(await frame.locator('body').evaluate((b) => b.innerHTML), '0 档 Shift+Tab 后 DOM 零变化').toBe(htmlBefore);
});

test('4 首块 Tab 缩不了（上面没块，maxAllowed=0）', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙</p>');
  const x0 = await rectX('#a');
  await clickIn('#a');
  await tab(2);
  expect((await clsOf('#a')).includes('ws-indent'), '首块不产生任何 ws-indent class').toBe(false);
  expect(await rectX('#a'), '首块坐标不动').toBe(x0);
});

test('5 toggle 协调：进 toggle 剥缩进无双偏移，体内 Shift+Tab 出来归 0 档', async () => {
  await launch();
  // #in2 预置 ws-indent-1（模拟外部/AI 文档 toggle 体内自带档位）：出 toggle 的 stripIndent 必须真剥它——
  // 不然「出来归 0 档」断言对刚被进场剥光的 #b 是平凡真、没牙。
  await openDoc('<p id="z">零</p><details open><summary>标</summary><p id="in">体</p><p id="in2" class="ws-indent-1">体2</p></details><p id="b" class="ws-indent-2">乙</p>', INDENT_STYLE);
  await clickIn('#b');
  await tab(); // 前兄弟是 <details> → 走既有嵌入，ws-indent 剥光
  expect(await frame.locator('#b').evaluate((el) => el.parentElement.tagName), 'b 进 toggle 体').toBe('DETAILS');
  expect((await clsOf('#b')).includes('ws-indent'), '进 toggle 后 ws-indent 剥光').toBe(false);
  expect(Math.abs((await rectX('#b')) - (await rectX('#in'))), '无双偏移：与体内其它块同 x').toBeLessThanOrEqual(1);
  await shiftTab(); // 体内 Shift+Tab → 出 toggle，0 档
  expect(await frame.locator('#b').evaluate((el) => el.parentElement.tagName), 'b 回顶层').toBe('BODY');
  expect((await clsOf('#b')).includes('ws-indent'), '出 toggle 归 0 档').toBe(false);
  // 出 toggle 剥缩进的真牙：体内预置档位块出来必须被剥光 + 坐标与顶层基线块一致
  await clickIn('#in2');
  await shiftTab();
  expect(await frame.locator('#in2').evaluate((el) => el.parentElement.tagName), 'in2 出到顶层').toBe('BODY');
  expect((await clsOf('#in2')).includes('ws-indent'), '预置 ws-indent-1 被出场 stripIndent 剥光').toBe(false);
  expect(Math.abs((await rectX('#in2')) - (await rectX('#z'))), '坐标回到顶层基线（CSS 层面也归 0）').toBeLessThanOrEqual(1);
});

test('5b toggle 嵌入后 undo：块回顶层且 ws-indent-2 恢复（strip 必须在 checkpoint 之前，M7 门）', async () => {
  await launch();
  await openDoc('<p id="z">零</p><details open><summary>标</summary><p id="in">体</p></details><p id="b" class="ws-indent-2">乙</p>', INDENT_STYLE);
  const baseX = await rectX('#z');
  await clickIn('#b');
  await tab(); // 嵌入 + 剥 class（一步，checkpoint 打在 strip 之后）
  await page.waitForTimeout(150);
  await menu('undo'); // 菜单路径（keyboard Meta+z 不触发加速器 = 假 FAIL）
  await page.waitForTimeout(200);
  expect(await frame.locator('#b').evaluate((el) => el.parentElement.tagName), 'undo 后 b 回顶层').toBe('BODY');
  expect(await clsOf('#b'), 'undo 后 ws-indent-2 恢复').toContain('ws-indent-2');
  expect(Math.abs((await rectX('#b')) - (baseX + 48)), 'undo 后视觉 = 2 档（若 strip 被挪到 checkpoint 后，这里会回滚出 toggle 体内带缩进的双偏移）').toBeLessThanOrEqual(1);
});

test('6 光标不动：段中 Tab 缩进后 anchorNode/anchorOffset 原样', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙丙丁戊</p>');
  await clickIn('#b');
  await frame.locator('#b').evaluate((el) => {
    const tn = [...el.childNodes].find((n) => n.nodeType === 3);
    const d = el.ownerDocument; const r = d.createRange(); r.setStart(tn, 2); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await tab();
  const sel = await frame.locator('#b').evaluate((el) => {
    const s = el.ownerDocument.getSelection();
    const n = s.anchorNode;
    return { offset: s.anchorOffset, inB: !!(n && el.contains(n.nodeType === 3 ? n.parentElement : n)) || n === el.firstChild || el.contains(n) };
  });
  expect(sel.offset, '光标 offset 仍 2').toBe(2);
  expect(sel.inB, '光标仍在原块').toBe(true);
  await page.keyboard.type('X'); // 双保险：打字落在 offset 2
  await expect.poll(() => frame.locator('#b').textContent()).toContain('乙丙X丁戊');
});

test('7 类型覆盖：h2/blockquote/callout 都缩，table 不缩（负向直接断言）', async () => {
  await launch();
  // ⚠ pre 不在 TOP_BLOCKS 白名单，放进来整份文档变非合规、blockedit 不挂（实测），pre 负向单独一条（7b）。
  // 合规文档里块编辑态的非 indentable 负向代表用 table（classify=other 且无 ws-callout class）。
  await openDoc('<p id="z">零</p><h2 id="h">标题</h2><blockquote id="q">引用</blockquote><div class="ws-callout" id="c">提示</div><table id="r" class="ws-table"><tbody><tr><td>格</td></tr></tbody></table>');
  const baseX = await rectX('#h');
  await clickIn('#h');
  await tab();
  expect(await clsOf('#h'), 'h2 缩 1 档').toContain('ws-indent-1');
  expect(Math.abs((await rectX('#h')) - (baseX + 24))).toBeLessThanOrEqual(1);
  await clickIn('#q');
  await tab();
  expect(await clsOf('#q'), 'blockquote 缩 1 档').toContain('ws-indent-1');
  await clickIn('#c');
  await tab();
  expect(await clsOf('#c'), 'callout（classify=other，靠 class 判）缩 1 档').toContain('ws-indent-1');
  await frame.locator('#r').click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  expect((await clsOf('#r')).includes('ws-indent'), 'table 不产生任何 ws-indent class').toBe(false);
});

test('7b pre（非合规 → 基础编辑）：Tab 不产生任何 ws-indent class（现状保持）', async () => {
  await launch();
  await openDoc('<p id="z">零</p><pre id="r">code</pre>');
  await frame.locator('#r').click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  expect(await frame.locator('[class*="ws-indent-"]').count(), '全文档无任何 ws-indent class').toBe(0);
});

test('8 自愈：文档带 ws-indent-2 但 head 无 indent CSS → attach 补注、视觉生效', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b" class="ws-indent-2">乙</p>'); // 有意不带 INDENT_STYLE
  expect(await frame.locator('head style[data-ws-schema-css="indent"]').count(), 'refreshSemanticStyles 补注 indent CSS').toBe(1);
  expect(Math.abs((await rectX('#b')) - ((await rectX('#a')) + 48)), '补注后 2 档视觉生效').toBeLessThanOrEqual(1);
});

test('9 劈块继承同档、段末 Enter 新块 0 档', async () => {
  await launch();
  await openDoc('<p id="a" class="ws-indent-1">甲</p><p id="b" class="ws-indent-2">乙丙丁戊</p>', INDENT_STYLE);
  await clickIn('#b');
  await frame.locator('#b').evaluate((el) => {
    const tn = [...el.childNodes].find((n) => n.nodeType === 3);
    const d = el.ownerDocument; const r = d.createRange(); r.setStart(tn, 2); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Enter'); // 段中劈块
  await page.waitForTimeout(150);
  expect(await clsOf('#b'), '前半保持 2 档').toContain('ws-indent-2');
  const nextCls = await frame.locator('#b').evaluate((el) => el.nextElementSibling.className);
  expect(nextCls, '后半继承同档（splitBlock 复制 className，既有机制）').toContain('ws-indent-2');
  // 段末 Enter：光标在后半末尾 → 新块 0 档
  await frame.locator('#b').evaluate((el) => {
    const nx = el.nextElementSibling;
    const d = el.ownerDocument; const r = d.createRange(); r.selectNodeContents(nx); r.collapse(false);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const newCls = await frame.locator('#b').evaluate((el) => el.nextElementSibling.nextElementSibling.className);
  expect(newCls.includes('ws-indent'), '段末 Enter 新块 0 档（不继承）').toBe(false);
});

test('10 undo：缩进后菜单撤销 → class 与坐标双复原', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙</p>');
  const x0 = await rectX('#b');
  await clickIn('#b');
  await tab();
  expect(await clsOf('#b')).toContain('ws-indent-1');
  await page.waitForTimeout(150);
  await menu('undo');
  await page.waitForTimeout(200);
  expect((await clsOf('#b')).includes('ws-indent'), 'undo 后 class 复原').toBe(false);
  expect(Math.abs((await rectX('#b')) - x0), 'undo 后坐标复原').toBeLessThanOrEqual(1);
});

test('11 落盘：缩进后自动保存，磁盘字节含 ws-indent-1 与 indent schema CSS', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙</p>');
  await clickIn('#b');
  await tab();
  await page.waitForTimeout(1500); // 等自动保存（~1.2s 去抖，照 toggle.spec.js 现成模式）
  const disk = await fs.readFile(docPath, 'utf8');
  expect(disk, '块 class 原样入盘').toContain('ws-indent-1');
  expect(disk, '缩进 CSS 随文件走').toContain('data-ws-schema-css="indent"');
});

test('12 向下归一化：残留档位超过 maxAllowed 时 Tab 拉回（绝非 no-op、绝非加档）', async () => {
  await launch();
  await openDoc('<p id="x">x0</p><p id="y" class="ws-indent-3">y3</p>', INDENT_STYLE);
  const baseX = await rectX('#x');
  await clickIn('#y');
  await tab();
  expect(await clsOf('#y'), 'y 归一化到 maxAllowed=1').toContain('ws-indent-1');
  expect((await clsOf('#y')).includes('ws-indent-3'), '旧 3 档 class 被清').toBe(false);
  expect((await clsOf('#y')).includes('ws-indent-4'), '绝不加档').toBe(false);
  expect(Math.abs((await rectX('#y')) - (baseX + 24)), '视觉 = 1 档').toBeLessThanOrEqual(1);
});

test('13 a11y 退出路径：Esc 到灰选中态后 Tab 移焦出编辑区、不产生缩进（WCAG 2.1.2 回归门）', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙</p>');
  await clickIn('#b');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  expect(await frame.locator('#b').evaluate((el) => el.hasAttribute('data-ws2-selected')), 'Esc 后灰选中态').toBe(true);
  expect(await frame.locator('[data-ws2-editing]').count(), '不再是编辑态').toBe(0);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  // 负向直接断言：灰选中态 Tab 不进缩进分支（editingEl gate），块无任何 ws-indent class
  expect((await clsOf('#b')).includes('ws-indent'), '灰选中态 Tab 不缩进').toBe(false);
  expect(await frame.locator('[data-ws2-editing]').count(), 'Tab 没有拽回编辑态（焦点正常移出编辑区）').toBe(0);
});
