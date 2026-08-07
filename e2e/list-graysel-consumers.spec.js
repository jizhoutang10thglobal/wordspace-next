// 行灰选（Esc×1 → selectedEl=<li>）态的下游消费者门（2026-08-07 todo 深扫 A 组，同根四漏 + 剪贴板连带）：
// Esc 三档把「选中的一定是顶层块」这个旧不变式打破了，Backspace/Delete 当年单独补过（:4960 注释），
// Enter / ⌘X / ⌘C / ⌘V / 方向键 / fmtbar「转为」六个入口漏了——轻则光标飞错块，重则 <p> 进 <ul>
// 非合规落盘、下次打开整篇降级。本门逐入口断言「行语义」：结构 + 磁盘字节 reparse 合规 + 作用对象。
// 行单元契约（docs/features/todo-list.md）：按行作用的交互必须作用于行，不许拿行当顶层块。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, docPath, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2gc-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.waitForTimeout(250);
}
async function openDoc(body) {
  const tag = 'gc' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title></head><body>${body}</body></html>`;
  docPath = path.join(tmpDir, 'd' + seq + '.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(400);
}
// 顶层结构摘要（跳过 UI 覆盖层）
const topShape = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].filter((e) => !e.hasAttribute('data-ws2-ui'))
    .map((e) => e.tagName + (e.id ? '#' + e.id : '') + (e.tagName === 'UL' || e.tagName === 'OL'
      ? '[' + [...e.children].map((c) => c.tagName + (c.id ? '#' + c.id : '')).join(',') + ']' : ''));
});
const graySel = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const s = d.querySelector('[data-ws2-selected]');
  return s ? s.tagName + (s.id ? '#' + s.id : '') : null;
});
// 磁盘字节 reparse 判合规（铁律③：绝不喂活 DOM）
const diskConform = async () => {
  await page.waitForTimeout(1800); // 等自动保存
  const bytes = await fs.readFile(docPath, 'utf8');
  return page.evaluate((b) => {
    const dm = new DOMParser().parseFromString(b, 'text/html');
    const r = window.WS2SchemaRegistry.classify(dm);
    return { conform: r.conform, violations: (r.violations || []).map((v) => v.rule + ':' + v.tag) };
  }, bytes);
};
async function escSelectRow(rowSel) {
  await frame.locator(rowSel).click();
  await page.waitForTimeout(180);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(220);
  expect(await graySel(), `Esc×1 后灰选必须是 ${rowSel} 那一行`).toBe('LI' + rowSel.replace(/^.*#/, '#'));
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); app = null; }
});

const DOC = '<p id="p0">上方段落</p><ul class="ws-todo" id="lst"><li id="r1">待办一</li><li id="r2">待办二</li><li id="r3">待办三</li></ul><p id="p1">下方段落</p>';

test('GC-1 行灰选 Enter：同层插一个新空行，绝不把 <p> 插进 <ul>', async () => {
  await launch(); await openDoc(DOC);
  await escSelectRow('#r2');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await page.keyboard.type('新行文字');
  await page.waitForTimeout(300);
  const shape = await topShape();
  expect(shape.join('|'), 'ul 里只许有 li，新行是 li 且在 r2 之后').toBe('P#p0|UL#lst[LI#r1,LI#r2,LI,LI#r3]|P#p1');
  const newRowText = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.getElementById('lst').children].map((c) => c.textContent.trim());
  });
  expect(newRowText, '打的字进了新行、不是别的块').toEqual(['待办一', '待办二', '新行文字', '待办三']);
  const v = await diskConform();
  expect(v.conform, '磁盘字节 reparse 必须合规，实得 ' + JSON.stringify(v.violations)).toBe(true);
});

test('GC-2 行灰选 ⌘V（段落剪贴板）：列表劈开插中间，绝不塞进 <ul> 内部', async () => {
  await launch(); await openDoc(DOC);
  await escSelectRow('#r2');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const dt = new DataTransfer();
    dt.setData('text/html', '<meta charset="utf-8"><div data-ws2-clip="b"><p id="pz">外来段落</p></div>');
    dt.setData('text/plain', '外来段落');
    d.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(350);
  const shape = await topShape();
  // 合法产物：[ul(r1,r2)] [P] [ul(r3)]（劈开插中间）。硬红线：ul 的直接子里绝不能出现 P。
  expect(shape.some((s) => /U?L#?\w*\[[^\]]*P/.test(s)), 'ul 直接子出现 P = 结构违规，实得 ' + shape.join('|')).toBe(false);
  expect(shape.join('|'), '段落必须真插进来（在两半列表之间）').toContain('P#pz');
  const v = await diskConform();
  expect(v.conform, '磁盘必须合规，实得 ' + JSON.stringify(v.violations)).toBe(true);
});

test('GC-3a 行灰选 ⌘X：删的是那一行（removeRow），列表剩两行、不降级', async () => {
  await launch(); await openDoc(DOC);
  await escSelectRow('#r2');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+x' : 'Control+x');
  await page.waitForTimeout(300);
  expect((await topShape()).join('|'), '只删 r2，列表还在').toBe('P#p0|UL#lst[LI#r1,LI#r3]|P#p1');
  const v = await diskConform();
  expect(v.conform, '磁盘必须合规，实得 ' + JSON.stringify(v.violations)).toBe(true);
});

test('GC-3b 纯清单文档（无其他块）行灰选 ⌘X：同样走行删除，绝不产 <ul><p></p></ul>', async () => {
  await launch(); await openDoc('<ul class="ws-todo" id="lst"><li id="r1">一</li><li id="r2">二</li></ul>');
  await escSelectRow('#r2');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+x' : 'Control+x');
  await page.waitForTimeout(300);
  const shape = await topShape();
  expect(shape.join('|'), '剩一行的干净列表').toBe('UL#lst[LI#r1]');
  const v = await diskConform();
  expect(v.conform, '磁盘必须合规（A3 主症状：<ul><p></p></ul> 降级），实得 ' + JSON.stringify(v.violations)).toBe(true);
});

test('GC-3c 最后一行 ⌘X：列表收敛（removeRow 掏空契约=原位换空段落），不留隐形空 <ul></ul> 僵尸块', async () => {
  await launch(); await openDoc('<p id="p0">前</p><ul class="ws-todo" id="lst"><li id="r1">唯一</li></ul><p id="p1">后</p>');
  await escSelectRow('#r1');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+x' : 'Control+x');
  await page.waitForTimeout(300);
  const shape = await topShape();
  expect(shape.some((s) => s.startsWith('UL')), 'A3-B 主症状：0 高的空 <ul></ul> 僵尸块留在文档里').toBe(false);
  expect(shape.join('|'), '掏空收敛 = 原位换成空段落（Delete 路径同款契约）').toBe('P#p0|P|P#p1');
});

test('GC-7 行灰选 ⌘C：剪贴板是 ws-todo 列表片段，绝不携带裸 <li>', async () => {
  await launch(); await openDoc('<ul class="ws-todo" id="lst"><li id="r1">一</li><li id="r2" data-checked="true">二勾</li></ul>');
  await escSelectRow('#r2');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
  await page.waitForTimeout(300);
  const html = await app.evaluate(({ clipboard }) => clipboard.readHTML());
  expect(/<(ul|ol)[^>]*ws-todo[^>]*>\s*<li/i.test(html), '必须包在 ws-todo 列表容器里，实得: ' + html.slice(0, 200)).toBe(true);
  expect(/data-checked="true"/.test(html), '勾选态随行走').toBe(true);
  expect(/^\s*<div[^>]*>\s*<li/i.test(html.replace(/<meta[^>]*>/i, '')), '裸 <li> 直接挂在 clip div 下 = 违约').toBe(false);
});

test('GC-4 行灰选方向键：↓/↑ 在行间移动灰选，边界出块；绝不飞到文档第一块', async () => {
  await launch(); await openDoc('<h1 id="h">标题</h1>' + DOC);
  await escSelectRow('#r2');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  expect(await graySel(), '↓ = 下一行 r3').toBe('LI#r3');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  expect(await graySel(), '↑ = 回到 r2').toBe('LI#r2');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  expect(await graySel(), '↑ = r1').toBe('LI#r1');
  // 上边界：从首行再 ↑ → 出块到上一个顶层块（p0），绝不是文档第一块 h1
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.querySelector('[data-ws2-selected]');
    const ed = d.querySelector('[data-ws2-editing]');
    const sel = d.getSelection();
    const an = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
    return { sel: s ? s.tagName + '#' + s.id : null, edit: ed ? ed.tagName + '#' + ed.id : null, caretIn: an ? (an.closest('p,h1,li') || {}).id || an.tagName : null };
  });
  expect(st.edit === 'P#p0' || st.sel === 'P#p0' || st.caretIn === 'p0', '出块到紧邻的 p0，实得 ' + JSON.stringify(st)).toBe(true);
  // 光标绝不在 h1 里（A4 主症状）
  expect(st.caretIn === 'h' || st.edit === 'H1#h', 'A4 主症状：飞到文档第一块').toBe(false);
});

test('GC-5 行灰选 fmtbar「转为正文」：只抽那一行（前后仍是列表），嵌套行零变更', async () => {
  await launch(); await openDoc(DOC);
  await escSelectRow('#r2');
  // fmtbar 在灰选态可见 → 点「转为」→ 点「正文」
  const clicked = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const bar = d.querySelector('.ws-fmtbar');
    if (!bar || bar.style.display === 'none') return 'fmtbar 不可见';
    const turn = [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').includes('转为'));
    if (!turn) return '找不到「转为」';
    turn.click();
    return 'ok';
  });
  expect(clicked).toBe('ok');
  await page.waitForTimeout(250);
  const picked = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const it = d.querySelector('.ws-fmtbar-menu-item[data-key="text"]');
    if (!it) return '菜单没开';
    it.click();
    return 'ok';
  });
  expect(picked).toBe('ok');
  await page.waitForTimeout(350);
  const shape = await topShape();
  // id 流向不钉（单行抽取走共享 turnIntoLines：产物继承列表 id、行 id 丢——既有语义，欠账记 spec）；
  // 钉的是结构：抽出的段落夹在两半列表之间，ul 里绝无 P。
  expect(shape.map((s) => s.replace(/#[\w-]+/g, '')).join('|'), '抽出 r2 成段落，前后仍是列表')
    .toBe('P|UL[LI]|P|UL[LI]|P');
  const midText = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const tops = [...d.body.children].filter((e) => !e.hasAttribute('data-ws2-ui'));
    return (tops[2] && tops[2].textContent || '').trim();
  });
  expect(midText, '抽出的正是 r2 那一行').toBe('待办二');
  const v = await diskConform();
  expect(v.conform, '磁盘必须合规（A2 主症状：li 原地 retag 成 <p> 留在 ul 里），实得 ' + JSON.stringify(v.violations)).toBe(true);
});

test('GC-5b 嵌套行灰选 fmtbar「转为」：结构性抽不出 → 零变更、不产非法结构', async () => {
  await launch(); await openDoc('<ul class="ws-todo" id="lst"><li id="pa">父行<ul class="ws-todo" id="sub"><li id="n1">子一</li><li id="n2">子二</li></ul></li><li id="pb">父二</li></ul>');
  await escSelectRow('#n1');
  const before = await topShape();
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const bar = d.querySelector('.ws-fmtbar');
    const turn = bar && [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').includes('转为'));
    if (turn) turn.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const it = d.querySelector('.ws-fmtbar-menu-item[data-key="text"]');
    if (it) it.click();
  });
  await page.waitForTimeout(350);
  const after = await topShape();
  expect(after.join('|'), '嵌套行转为 = 零变更（turnIntoLines 对非直接子项返回 null）').toBe(before.join('|'));
  const nested = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const sub = d.getElementById('sub');
    return sub ? [...sub.children].map((c) => c.tagName + '#' + c.id).join(',') : 'GONE';
  });
  expect(nested, '嵌套列表原样').toBe('LI#n1,LI#n2');
  const v = await diskConform();
  expect(v.conform, '磁盘合规，实得 ' + JSON.stringify(v.violations)).toBe(true);
});
