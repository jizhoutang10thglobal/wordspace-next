// Tab 按光标位置分派（Colin 2026-08-06 拍板）：光标在**行首** = 缩进/嵌套（既有语义一字不动）；
// 光标在**一行文字中间** = 插两个空格（Word / 代码编辑器的手感）。
// 本 spec = 新行为的正门 + 旧行为的负向回归钉（表格移格 / Shift+Tab / 有选区）。
// spec 正本：docs/features/editor-block-indent.md §「Tab 按光标位置分派」。
//
// 强断言纪律（S4）：插入类断言一律**码点 + 渲染宽度**双钉——
//   只断码点：CSS 全废、空格根本没显示出来它照过；
//   只断宽度：插一个全角空格、插制表符它也过。
// 而「为什么必须是 &nbsp; 不是普通空格」这条，用同文档的普通空格对照段直接量宽度证，不靠嘴说。
const { test, expect, _electron: electron } = require('@playwright/test');
const { JSDOM } = require('jsdom');
const schema = require('../src/lib/schema-validate.js');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const NB = '\u00a0'; // 字面写 \u00a0：源码里的裸 nbsp 肉眼与空格无异
let app, page, frame, tmpDir, docPath;

// 与实现同款的入盘缩进 CSS（fixture 预置档位用），照 block-indent.spec.js
const INDENT_STYLE = '<style id="ws-indent-style" data-ws-schema-css="indent">'
  + Array.from({ length: 6 }, (_, i) => `.ws-indent-${i + 1}{position:relative;left:${(i + 1) * 24}px}`).join('')
  + '</style>';

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2tabsp-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body, headExtra = '', name = 'doc') {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>${headExtra}</head><body>${body}</body></html>`;
  docPath = path.join(tmpDir, name + '.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
const clsOf = (sel) => frame.locator(sel).evaluate((el) => el.className);
const textOf = (sel) => frame.locator(sel).evaluate((el) => el.textContent);
const rectX = (sel) => frame.locator(sel).evaluate((el) => el.getBoundingClientRect().x);
// 元素文本的**渲染宽度**（不是块宽——块是满宽的，量不出插了空格没有）
const textWidth = (sel) => frame.locator(sel).evaluate((el) => {
  const r = el.ownerDocument.createRange(); r.selectNodeContents(el);
  return r.getBoundingClientRect().width;
});
// 码点串：分得清 U+00A0 / U+0020 / U+3000 / U+0009，textContent 比较分不清
const codesOf = (sel) => frame.locator(sel).evaluate((el) => [...el.textContent].map((c) => c.codePointAt(0).toString(16)).join(' '));
const cellId = () => frame.locator('body').evaluate(() => { const c = document.querySelector('[data-ws2-cell]'); return c ? c.id : null; });

async function clickIn(sel) { await frame.locator(sel).click(); await page.waitForTimeout(80); }
// 把光标放进 sel 的首个文本节点的 off 处（sel 必须已在编辑态）
async function caretAt(sel, off) {
  await frame.locator(sel).evaluate((el, o) => {
    const tn = [...el.childNodes].find((n) => n.nodeType === 3);
    const d = el.ownerDocument; const r = d.createRange(); r.setStart(tn, o); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  }, off);
  await page.waitForTimeout(50);
}
// 光标左侧（在 sel 内）的文字。前置断言用：钉死「光标真在行中 / 真在行首」这个前提，
// 门退化时当场喊，而不是让下游断言碰巧还过。
const caretBefore = (sel) => frame.locator(sel).evaluate((el) => {
  const d = el.ownerDocument; const s = d.getSelection();
  if (!s || !s.rangeCount) return '<no-range>';
  if (!s.isCollapsed) return '<not-collapsed>';
  const r = s.getRangeAt(0);
  if (el !== r.startContainer && !el.contains(r.startContainer)) return '<caret-outside>';
  const b = d.createRange(); b.setStart(el, 0); b.setEnd(r.startContainer, r.startOffset);
  return b.toString();
});
async function expectCaretMidLine(sel, expected) {
  expect(await caretBefore(sel), `前置：光标在 ${sel} 的行中（左侧有可见字符）`).toBe(expected);
}
async function expectCaretAtLineStart(sel) {
  const before = await caretBefore(sel);
  expect(/^[\t\n\r ]*$/.test(before), `前置：光标在 ${sel} 行首（左侧无可见字符），实测左侧=「${before}」`).toBe(true);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('1 段落行中 Tab → 插两个 U+00A0；块的缩进档位一点没变（负向）', async () => {
  await launch();
  // #ctl 是同文档的**普通空格对照段**：源码里写了两个普通空格，HTML 折叠成一个。
  // 用它量出来的宽度直接证「插普通空格用户只会看到一个」——这就是必须用 &nbsp; 的理由。
  await openDoc('<p id="a">甲</p><p id="b">乙丙丁戊</p><p id="ctl">乙丙  丁戊</p>');
  await clickIn('#b');
  await caretAt('#b', 2);
  const w0 = await textWidth('#b');
  await expectCaretMidLine('#b', '乙丙');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await codesOf('#b'), '恰好两个 U+00A0（不是普通空格、不是一个、不是制表符）').toBe('4e59 4e19 a0 a0 4e01 620a');
  const w1 = await textWidth('#b');
  expect(w1, '两个不间断空格真把文字撑宽了（CSS 层面也生效，不是只改了 DOM）').toBeGreaterThan(w0 + 2);
  expect(w1, '比「两个普通空格被折叠成一个」的对照段更宽 —— 这就是不用普通空格的理由').toBeGreaterThan(await textWidth('#ctl'));
  expect((await clsOf('#b')).includes('ws-indent'), '负向：行中 Tab 绝不顺手把整块也缩了').toBe(false);
  expect(await frame.locator('[class*="ws-indent-"]').count(), '负向：全文档零档位 class').toBe(0);
});

test('2 段落行首 Tab → 整块缩进一档，一个空格都没插', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙丙丁戊</p>');
  const x0 = await rectX('#b');
  await clickIn('#b');
  await page.keyboard.press('Home');
  await page.waitForTimeout(50);
  await expectCaretAtLineStart('#b');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await clsOf('#b'), '行首 Tab 仍是整块缩进').toContain('ws-indent-1');
  expect(Math.abs((await rectX('#b')) - (x0 + 24)), '视觉右移 24px（CSS 真生效）').toBeLessThanOrEqual(1);
  expect(await codesOf('#b'), '负向：缩进路径一个字符都没插').toBe('4e59 4e19 4e01 620a');
});

test('3 列表行中 Tab → 插两个空格，没变成子项（负向）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="p">父</li><li id="a">甲乙丙丁</li></ul>');
  await clickIn('#a');
  await caretAt('#a', 2);
  await expectCaretMidLine('#a', '甲乙');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await codesOf('#a'), '恰好两个 U+00A0 插在行中').toBe('7532 4e59 a0 a0 4e19 4e01');
  expect(await frame.locator('#p > ul, #p > ol').count(), '负向：没被嵌成子项').toBe(0);
  expect(await frame.locator('#lst > li').evaluateAll((els) => els.map((l) => l.id)), '负向：两项仍并列在顶层').toEqual(['p', 'a']);
});

test('4 列表行首 Tab → 嵌成子项，一个空格都没插', async () => {
  await launch();
  // ⚠ 这条是「行首判定必须相对 <li> 算、不能相对 editingEl(=整个 <ul>) 算」的定点门：
  //   #a 是第二项，相对 ul 判的话它左边有「父」= 永远判成行中 → 列表嵌套整个失能。
  await openDoc('<ul id="lst" class="ws-todo"><li id="p">父</li><li id="a">甲乙丙丁</li></ul>');
  await clickIn('#a');
  await page.keyboard.press('Home');
  await page.waitForTimeout(50);
  await expectCaretAtLineStart('#a');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await frame.locator('#p > ul > li').evaluateAll((els) => els.map((l) => l.id)), '#a 嵌进 #p 的子列表').toEqual(['a']);
  expect(await codesOf('#a'), '负向：嵌套路径一个字符都没插').toBe('7532 4e59 4e19 4e01');
});

test('4b 多段容器（引用/callout）第二段行首 Tab → 整块缩进，没插空格', async () => {
  await launch();
  // 同上的定点门，换容器版：引用/callout 的 editingEl 是**容器**，行宿主是容器里的 <p>。
  // 拿 editingEl 判行首的话第二段永远判成行中 → 容器第二段的行首 Tab 会变成插空格。
  await openDoc('<p id="z">零</p><blockquote id="q"><p id="q1">甲乙</p><p id="q2">丙丁戊己</p></blockquote>', INDENT_STYLE);
  const x0 = await rectX('#q');
  await clickIn('#q2');
  await page.keyboard.press('Home');
  await page.waitForTimeout(50);
  await expectCaretAtLineStart('#q2');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await clsOf('#q'), '容器整块缩一档').toContain('ws-indent-1');
  expect(Math.abs((await rectX('#q')) - (x0 + 24)), '视觉右移 24px').toBeLessThanOrEqual(1);
  expect(await codesOf('#q2'), '负向：一个字符都没插').toBe('4e19 4e01 620a 5df1');
});

test('5 有选区时 Tab → 走原缩进语义，选中的文字一个字没被替换', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙丙丁戊</p>');
  await clickIn('#b');
  // 选中「丙丁」（非折叠选区）。插入路径若在这儿也跑，会把选中内容替换掉 = 删数据。
  await frame.locator('#b').evaluate((el) => {
    const tn = [...el.childNodes].find((n) => n.nodeType === 3);
    const d = el.ownerDocument; const r = d.createRange(); r.setStart(tn, 1); r.setEnd(tn, 3);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(50);
  const sel0 = await frame.locator('#b').evaluate((el) => { const s = el.ownerDocument.getSelection(); return { collapsed: s.isCollapsed, text: s.toString() }; });
  expect(sel0.collapsed, '前置：选区非折叠').toBe(false);
  expect(sel0.text, '前置：选中的是「丙丁」').toBe('丙丁');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await codesOf('#b'), '选中的文字原样还在，一个字符没多没少').toBe('4e59 4e19 4e01 620a');
  expect(await clsOf('#b'), '走的是原缩进语义').toContain('ws-indent-1');
});

test('6 表格格内 Tab → 仍然移到下一格（负向回归：行中 Tab 不许吃掉表格语义）', async () => {
  await launch();
  await openDoc('<p id="z">零</p><table id="t" class="ws-table"><tbody><tr><td id="c1">甲乙丙</td><td id="c2">丁</td></tr></tbody></table>');
  await clickIn('#c1');
  await caretAt('#c1', 2); // 故意把光标放在**格内文字中间**——正是新逻辑会误伤的位置
  await expectCaretMidLine('#c1', '甲乙');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await cellId(), 'Tab 仍是移到下一格').toBe('c2');
  expect(await codesOf('#c1'), '负向：格内一个空格都没插').toBe('7532 4e59 4e19');
});

test('7 Shift+Tab → 仍然反缩进（负向回归：光标在行中也照样反缩进）', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b" class="ws-indent-2">乙丙丁戊</p>', INDENT_STYLE);
  await clickIn('#b');
  await caretAt('#b', 2);
  await expectCaretMidLine('#b', '乙丙');
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  expect(await clsOf('#b'), '2 档 → 1 档').toContain('ws-indent-1');
  expect(await codesOf('#b'), '负向：Shift+Tab 一个空格都没插').toBe('4e59 4e19 4e01 620a');
});

test('8 <br> 之后算行首（走缩进）；同一行再往后就是行中（插空格）', async () => {
  await launch();
  // 定点成对：硬换行右边是真的行边界；但「这一行里再往后」不是。
  // 这一对同时钉死「br 谓词存在」与「br 谓词不过宽」。
  await openDoc('<p id="a">甲</p><p id="b">前一行<br>后一行文字</p>', INDENT_STYLE);
  const x0 = await rectX('#b');
  await clickIn('#b');
  // 光标 = 紧跟 <br>（第二个文本节点 offset 0）
  await frame.locator('#b').evaluate((el) => {
    const tns = [...el.childNodes].filter((n) => n.nodeType === 3);
    const d = el.ownerDocument; const r = d.createRange(); r.setStart(tns[tns.length - 1], 0); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(50);
  // 前置：这个位置左侧**有**可见字符（isCaretAtStart 判 false），所以它只能靠 br 谓词才算行首
  expect(await caretBefore('#b'), '前置：光标左侧是「前一行」（Range.toString 看不见 <br>）').toBe('前一行');
  expect(await frame.locator('#b').evaluate((el) => {
    const s = el.ownerDocument.getSelection(); const r = s.getRangeAt(0);
    let n = r.startContainer.previousSibling; return n ? n.nodeName : '<none>';
  }), '前置：光标紧跟的前一个节点就是 <br>').toBe('BR');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await clsOf('#b'), '<br> 之后算行首 → 整块缩进').toContain('ws-indent-1');
  expect(Math.abs((await rectX('#b')) - (x0 + 24)), '视觉右移 24px').toBeLessThanOrEqual(1);
  expect(await textOf('#b'), '负向：没插空格').toBe('前一行后一行文字');

  // 同一行再往后两个字 → 行中 → 插空格、不再加档
  await frame.locator('#b').evaluate((el) => {
    const tns = [...el.childNodes].filter((n) => n.nodeType === 3);
    const d = el.ownerDocument; const r = d.createRange(); r.setStart(tns[tns.length - 1], 2); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(50);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await clsOf('#b'), '负向：第二行的行中 Tab 不再加档（仍是 1 档）').toContain('ws-indent-1');
  expect((await clsOf('#b')).includes('ws-indent-2'), '负向：确实没加到 2 档').toBe(false);
  expect(await textOf('#b'), '第二行行中插了两个空格').toBe('前一行后一' + NB + NB + '行文字');
});

test('9 存盘往返：磁盘字节里空格还在、reparse 后 validate() 判合规（p / li / 引用段 / callout 段 四种宿主）', async () => {
  await launch();
  await openDoc('<p id="p1">甲乙丙丁</p>'
    + '<ul id="lst"><li id="l1">甲乙丙丁</li></ul>'
    + '<blockquote id="q"><p id="q1">甲乙丙丁</p><p id="q2">戊己庚辛</p></blockquote>'
    + '<div class="ws-callout" id="co"><p id="co1">甲乙丙丁</p></div>');
  for (const sel of ['#p1', '#l1', '#q2', '#co1']) {
    await clickIn(sel);
    await caretAt(sel, 2);
    await expectCaretMidLine(sel, sel === '#q2' ? '戊己' : '甲乙');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(120);
    expect(await codesOf(sel), `${sel} 行中插入两个 U+00A0`).toContain('a0 a0');
  }
  await page.waitForTimeout(1600); // 等 ~1.2s 去抖自动保存
  const disk = await fs.readFile(docPath, 'utf8');
  // 序列化走 outerHTML → U+00A0 被 HTML 片段序列化算法转义成 &nbsp; 实体（不是裸 c2 a0 字节）
  expect(disk, '磁盘字节里空格以 &nbsp; 实体存在').toContain('&nbsp;&nbsp;');
  expect((disk.match(/&nbsp;&nbsp;/g) || []).length, '四个宿主各一处').toBe(4);
  // 合规判定的唯一权威口径（铁律③）：磁盘**字节** reparse 出的 Document，不是编辑器活 DOM
  const reDoc = new JSDOM(disk).window.document;
  const v = schema.validate(reDoc);
  expect(v.violations, 'reparse 后零违规').toEqual([]);
  expect(v.conform, '插了 &nbsp; 的文档仍合规（不会降级成基础编辑器）').toBe(true);
  for (const id of ['p1', 'l1', 'q2', 'co1']) {
    expect(reDoc.getElementById(id).textContent, `#${id} reparse 后两个 U+00A0 原样还在`).toContain(NB + NB);
  }
});

test('10 white-space 保留空白处插的是普通空格、其余处插 nbsp（按 computed 判、不按标签判）', async () => {
  await launch();
  // ⚠ 真 <pre> 在块编辑器里**造不出来**：PRE 不在 Schema TOP_BLOCKS，含 pre 的文档整篇非合规、
  //   走基础编辑器，blockedit 根本不挂（e2e/block-indent.spec.js 测 7b 就是这个事实的门）。
  //   而行内 <code> 的 BASELINE_CSS 没设 white-space，computed 是 normal。
  //   所以这条门用文档自带的语义 CSS 把 #c 变成 white-space:pre，直接测那条分支本身；
  //   #c2 保持默认 normal 当对照 —— 一起证明分支是按 computed 值走的，不是按标签名走的。
  await openDoc('<p id="a">甲</p><p id="b">前<code id="c">abcd</code>后</p><p id="d">前<code id="c2">abcd</code>后</p>',
    '<style data-ws-schema-css="wsprobe">#c{white-space:pre}</style>');
  const ws = await frame.locator('body').evaluate(() => ({
    c: getComputedStyle(document.getElementById('c')).whiteSpace,
    c2: getComputedStyle(document.getElementById('c2')).whiteSpace,
  }));
  expect(ws.c, '前置：#c 真的是 white-space:pre').toBe('pre');
  expect(ws.c2, '前置：#c2 是默认 normal（对照）').toBe('normal');
  const w0 = await textWidth('#c');
  await clickIn('#b');
  await frame.locator('#c').evaluate((el) => {
    const d = el.ownerDocument; const r = d.createRange(); r.setStart(el.firstChild, 2); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(50);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await codesOf('#c'), 'white-space:pre 处插两个**普通空格**（U+0020），不塞 nbsp 污染代码').toBe('61 62 20 20 63 64');
  expect(await textWidth('#c'), 'pre 保留空白 → 两个普通空格真的撑宽了').toBeGreaterThan(w0 + 2);

  await clickIn('#d');
  await frame.locator('#c2').evaluate((el) => {
    const d = el.ownerDocument; const r = d.createRange(); r.setStart(el.firstChild, 2); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(50);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await codesOf('#c2'), '默认 normal 处仍插两个 U+00A0（插普通空格会被折叠成一个）').toBe('61 62 a0 a0 63 64');
});

test('11 撤销粒度：两个空格自成一步，一次 undo 只撤它、不吞掉之前的打字', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙丙丁戊</p>');
  await clickIn('#b');
  await caretAt('#b', 2);
  await page.keyboard.type('XY');
  // ⚠ 只等 120ms（< input 那个 500ms 去抖 checkpoint）——这正是「不先冲一次 checkpoint
  //   就会把打字和空格吞进同一步」的复现条件。等满 500ms 的话这条门测不到东西。
  await page.waitForTimeout(120);
  expect(await textOf('#b'), '前置：打完字是 乙丙XY丁戊').toBe('乙丙XY丁戊');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await textOf('#b')).toBe('乙丙XY' + NB + NB + '丁戊');
  await menu('undo'); // 菜单路径：keyboard Meta+z 不触发加速器 = 假 FAIL（仓里现成教训）
  await page.waitForTimeout(250);
  expect(await textOf('#b'), 'undo×1 只撤掉两个空格，XY 还在').toBe('乙丙XY丁戊');
  await menu('undo');
  await page.waitForTimeout(250);
  expect(await textOf('#b'), 'undo×2 才撤掉打字').toBe('乙丙丁戊');
});

test('12 IME 组词中的 Tab 不接管（keyCode 229）——组词时 Tab 是候选词操作', async () => {
  await launch();
  await openDoc('<p id="a">甲</p><p id="b">乙丙丁戊</p>');
  await clickIn('#b');
  await caretAt('#b', 2);
  await expectCaretMidLine('#b', '乙丙');
  // 先用 keyCode 9 的合成事件确认「合成派发确实能到达 handler」——
  // 没有这条前置，下面的负向断言可能只是因为事件压根没送到，那就是一条彻头彻尾的哑门。
  const dispatchTab = (keyCode) => frame.locator('body').evaluate((body, kc) => {
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: () => kc });
    body.ownerDocument.dispatchEvent(ev);
  }, keyCode);
  await dispatchTab(9);
  await page.waitForTimeout(150);
  expect(await codesOf('#b'), '前置：合成 keydown 真能触发插入（keyCode 9）').toBe('4e59 4e19 a0 a0 4e01 620a');
  // 再把光标放回行中，派发 keyCode 229（IME 组词态）→ 必须什么都不做
  await caretAt('#b', 2);
  await dispatchTab(229);
  await page.waitForTimeout(150);
  expect(await codesOf('#b'), '组词态 Tab 不插空格（DOM 零变化）').toBe('4e59 4e19 a0 a0 4e01 620a');
  expect(await frame.locator('[class*="ws-indent-"]').count(), '组词态 Tab 也不缩进').toBe(0);
});
