// 跨块 rangesel 态的键盘退出门（2026-08-07 todo 深扫 B3 + C3 复查）：
// ⌘A 按到全篇（整屏蓝底）后，Esc / 四个方向键此前全部空转——键盘上没有任何退出路径；
// 用户以为退掉了、随手一个退格全文被删（1.8s 落盘）。修：Esc 塌回 ⌘A 出发点，←↑ 塌到选区
// 起点、→↓ 塌到终点，落点块直接进编辑。C3（全选退出后第一次点击被吞）在本门 RX-4 一并钉。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;
const CMDA = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2rx-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.waitForTimeout(250);
}
async function openDoc(body) {
  const tag = 'rx' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'd' + seq + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(400);
}
const state = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const sel = d.getSelection();
  const ed = d.querySelector('[data-ws2-editing]');
  const an = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
  return {
    rangesel: [...d.querySelectorAll('[data-ws2-rangesel]')].map((x) => x.tagName + (x.id ? '#' + x.id : '')),
    collapsed: sel ? sel.isCollapsed : null,
    editing: ed ? ed.tagName + (ed.id ? '#' + ed.id : '') : null,
    caretIn: an ? ((an.closest('p,h1,li,blockquote,div') || {}).id || an.tagName) : null,
  };
});
const DOC = '<h1 id="h">标题</h1><p id="p1">第一段</p><ul class="ws-todo" id="L"><li id="r1">待办一</li><li id="r2">待办二</li></ul><p id="p2">尾段</p>';

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); app = null; }
});

async function toFullDoc(clickSel) {
  await frame.locator(clickSel).click();
  await page.waitForTimeout(180);
  for (let i = 0; i < 3; i++) { await page.keyboard.press(CMDA); await page.waitForTimeout(180); }
  const st = await state();
  expect(st.rangesel.length, '前置：⌘A×3 = 全篇 rangesel').toBeGreaterThan(2);
  expect(st.collapsed, '前置：存在非折叠选区').toBe(false);
  return st;
}

test('RX-1 全篇选中 → Esc：塌回出发块进编辑；随后退格只删一个字、不清全文', async () => {
  await launch(); await openDoc(DOC);
  await toFullDoc('#p1');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const st = await state();
  expect(st.rangesel, 'rangesel 必须清空').toEqual([]);
  expect(st.collapsed, '选区塌成光标').toBe(true);
  expect(st.caretIn, 'Esc 回到 ⌘A 出发的块（不跳文档头）').toBe('p1');
  // 危险尾巴复查：光标回的是**用户出发的位置**（段中，不是块首——块首退格会合法并块），
  // 此时退格只是普通删一个字
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  const texts = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return {
      h: (d.getElementById('h') || { textContent: 'GONE' }).textContent.trim(),
      p1: (d.getElementById('p1') || { textContent: 'GONE' }).textContent.trim(),
      p2: (d.getElementById('p2') || { textContent: 'GONE' }).textContent.trim(),
    };
  });
  expect(texts.h, '标题原样（没被并进/清掉）').toBe('标题');
  expect(texts.p2, '尾段原样').toBe('尾段');
  expect(texts.p1.length, 'p1 只少一个字（普通删字，不是清全文）').toBe('第一段'.length - 1);
});

test('RX-2 全篇选中 → ↓：塌到末块进编辑；↑ 变体塌到首块', async () => {
  await launch(); await openDoc(DOC);
  await toFullDoc('#p1');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  let st = await state();
  expect(st.rangesel, 'rangesel 清空').toEqual([]);
  expect(st.collapsed, '塌成光标').toBe(true);
  expect(st.caretIn, '↓ 塌到选区终点（尾段）').toBe('p2');
  // ↑ 变体
  await toFullDoc('#p1');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(250);
  st = await state();
  expect(st.collapsed, '塌成光标').toBe(true);
  expect(st.caretIn, '↑ 塌到选区起点（标题）').toBe('h');
});

test('RX-3 危险尾巴仍可达：全篇选中直接退格 = 删全文（既有语义不动，undo 可救）', async () => {
  await launch(); await openDoc(DOC);
  await toFullDoc('#p1');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(350);
  const left = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return d.body.textContent.replace(/\s+/g, '');
  });
  expect(left.includes('待办一'), '全篇删除语义保留（本门只加退出路径、不动删除）').toBe(false);
});

test('RX-4 C3 复查：全选 → Esc → 第一次点击提示框段落就进编辑（不吞首击）', async () => {
  await launch();
  await openDoc('<p id="pre">前</p><div class="ws-callout" id="C"><p id="c1">第一段</p><p id="c2">第二段</p><p id="c3">第三段</p></div><p id="post">后</p>');
  await frame.locator('#c2').click();
  await page.waitForTimeout(180);
  for (let i = 0; i < 3; i++) { await page.keyboard.press(CMDA); await page.waitForTimeout(180); }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await frame.locator('#c2').click();
  await page.waitForTimeout(300);
  const st = await state();
  expect(st.collapsed, '首击后光标存在').toBe(true);
  expect(st.caretIn, '首击直接进 c2 编辑（C3 主症状：点了没反应要点第二次）').toBe('c2');
  await page.keyboard.type('X');
  await page.waitForTimeout(250);
  const t = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return d.getElementById('c2').textContent;
  });
  expect(t.includes('X'), '首击后打字立即生效').toBe(true);
});

test('RX-5 C3 变体：全选态**直接**点击段落（不经 Esc），首击也要进编辑', async () => {
  await launch();
  await openDoc('<p id="pre">前</p><div class="ws-callout" id="C"><p id="c1">第一段</p><p id="c2">第二段</p></div><p id="post">后</p>');
  await frame.locator('#c2').click();
  await page.waitForTimeout(180);
  for (let i = 0; i < 3; i++) { await page.keyboard.press(CMDA); await page.waitForTimeout(180); }
  await frame.locator('#c1').click();
  await page.waitForTimeout(300);
  const st = await state();
  expect(st.caretIn, '全选态直接点 c1，首击进编辑').toBe('c1');
  expect(st.rangesel, 'rangesel 已清').toEqual([]);
});
