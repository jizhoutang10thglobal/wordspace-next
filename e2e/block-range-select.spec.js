// 块编辑器跨块选区的「块级高亮」真门（Wendi 2026-07-22 bug2：拖选跨多块时原生只高亮文字片段、
// 看不清选中了哪几行；对齐 Notion——选区罩住的整行块给蓝底）。强断言读 computed background（真渲染
// 出蓝底,不是只查 attribute——S4 教训：代理断言≠视觉验证）。宿主/CI 真启动 Electron。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

test.beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-rangesel-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
});
test.afterAll(async () => {
  try { if (app) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())); } catch {}
  try { if (app) await app.close(); } catch {}
  try { if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
});

async function openDoc(bodyHtml) {
  const dst = path.join(tmpDir, 'doc-' + Math.abs(bodyHtml.length) + '.html');
  await fs.writeFile(dst, '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>' + bodyHtml + '</body></html>', 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, dst);
  frame = page.frameLocator('#doc-frame');
  await frame.locator('body :is(p,h1,h2,li)').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(1600); // 躲开开文档后的自动保存 reload 竞态
}

// 造跨块选区(用 startSel/endSel 选择器定位起止块的文字节点),返回各块 {文本, marked, computed背景}
const selectAcross = (startSel, endSel) => frame.locator('body').evaluate((body, { s, e }) => {
  const doc = body.ownerDocument;
  const a = body.querySelector(s), b = body.querySelector(e);
  const sel = doc.getSelection(); const r = doc.createRange();
  r.setStart(a.firstChild, 0); r.setEnd(b.firstChild, b.firstChild.length);
  sel.removeAllRanges(); sel.addRange(r);
}, { s: startSel, e: endSel });

const readBlocks = () => frame.locator('body').evaluate((body) =>
  [...body.children].filter((c) => c.nodeType === 1 && !(c.hasAttribute && c.hasAttribute('data-ws2-ui')))
    .map((b) => ({ t: (b.textContent || '').replace(/\s+/g, '').slice(0, 6), marked: b.hasAttribute('data-ws2-rangesel'), bg: getComputedStyle(b).backgroundColor })));

const collapse = () => frame.locator('body').evaluate((body) => { const s = body.ownerDocument.getSelection(); s.removeAllRanges(); s.dispatchEvent && body.ownerDocument.dispatchEvent(new Event('selectionchange')); });

function isBlue(bg) { return /rgba?\(\s*26,\s*115,\s*232/.test(bg); }
function isTransparent(bg) { return bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent'; }

test('跨块选区：选区罩住的块整行标 rangesel 且真渲染蓝底；选区外的块不标；折叠后清除', async () => {
  await openDoc('<h1>标题</h1><p>第一段</p><ul class="ws-todo"><li>待办项</li></ul><p>第三段</p>');

  // 第一段首 → 待办项末：跨 p 和 ul.ws-todo 两块（含 heading 之上、第三段之下都在选区外）
  await selectAcross('p', 'ul.ws-todo li');
  await page.waitForTimeout(250);
  let blocks = await readBlocks();

  const first = blocks.find((b) => b.t.startsWith('第一段'));
  const todo = blocks.find((b) => b.t.startsWith('待办项'));
  const title = blocks.find((b) => b.t.startsWith('标题'));
  const third = blocks.find((b) => b.t.startsWith('第三段'));

  // 选区内两块：标记 + 真蓝底（强断言：读 computed background，防哑高亮）
  expect(first.marked, '第一段应被标记').toBe(true);
  expect(todo.marked, '待办块应被标记').toBe(true);
  expect(isBlue(first.bg), '第一段应渲染出蓝底，实测=' + first.bg).toBe(true);
  expect(isBlue(todo.bg), '待办块应渲染出蓝底，实测=' + todo.bg).toBe(true);
  // 选区外两块：不标记、无蓝底
  expect(title.marked, '标题在选区外不该标记').toBe(false);
  expect(third.marked, '第三段在选区外不该标记').toBe(false);
  expect(isTransparent(title.bg), '标题背景应透明').toBe(true);
  expect(isTransparent(third.bg), '第三段背景应透明').toBe(true);

  // 折叠选区 → 全部清除
  await collapse();
  await page.waitForTimeout(200);
  blocks = await readBlocks();
  expect(blocks.every((b) => !b.marked), '折叠后不应有任何 rangesel 标记').toBe(true);
  expect(blocks.every((b) => isTransparent(b.bg)), '折叠后不应有任何块残留蓝底').toBe(true);
});

test('单块内选区不标块级高亮（维持原生文字高亮，不误标整行）', async () => {
  await openDoc('<p>单块选一部分</p><p>另一段</p>');
  // 只在第一个 p 内选一段（起止同块）
  await frame.locator('body').evaluate((body) => {
    const p = body.querySelector('p'); const doc = body.ownerDocument;
    const sel = doc.getSelection(); const r = doc.createRange();
    r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 3);
    sel.removeAllRanges(); sel.addRange(r);
  });
  await page.waitForTimeout(250);
  const blocks = await readBlocks();
  expect(blocks.every((b) => !b.marked), '单块内选区不应触发块级高亮').toBe(true);
});

// U26（Colin 2026-07-24「toggle 块操作与其他块同步」）：跨 toggle 边界删除不再空操作——端点上卷、
// toggle 整删（与块级高亮 refreshRangeSel 同款上卷 = 所见即所删；对齐 table 的 ED-A2「结构端点整块删」先例）。
// 旧 U23 的「一致化空操作」是 deferred 的临时保守解（a254cb6），本轮按拍板收账。
const serialize23 = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conform23 = (h) => page.evaluate((x) => WS2SchemaRegistry.classify(new DOMParser().parseFromString(x, 'text/html')).conform, h);

test('U26c(翻转旧U23)：todo 项选进 toggle 体内 → toggle 整删 + todo 项裁剪（不再空操作）', async () => {
  await openDoc('<p id="pre">前段AAAA</p><ul class="ws-todo"><li id="t1">待办甲</li></ul><details open><summary id="sm">标题S</summary><p id="bd">体内容BBBB</p></details><p id="post">后段</p>');
  await frame.locator('#t1').click();
  await selectAcross('#t1', '#bd'); // 从 todo 项选进 toggle 体内（跨 details 边界）
  await page.waitForTimeout(250);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  const after = await frame.locator('body').evaluate(() => ({
    det: document.querySelectorAll('details').length,
    t1: !!document.getElementById('t1'),
    ul: document.querySelectorAll('ul').length,
    pre: (document.getElementById('pre') || {}).textContent,
    post: (document.getElementById('post') || {}).textContent,
  }));
  expect(after.det, 'toggle 应整删（块级高亮标了整块=所见即所删）').toBe(0);
  expect(after.t1, '待办项文字被全选 → 该项删掉').toBe(false);
  expect(after.pre, '选区外前段不动').toBe('前段AAAA');
  expect(after.post, '选区外后段不动').toBe('后段');
  expect(await conform23(await serialize23())).toBe(true);
});

test('U23 回归：选区整体罩住 toggle → 删除成功（不被 no-op 误伤）', async () => {
  await openDoc('<p id="pre">前AAAA</p><details open><summary>T</summary><p>Bpara</p></details><p id="post">后CCCC</p>');
  await frame.locator('#pre').click();
  await selectAcross('#pre', '#post'); // 两端都在 toggle 外 → detOf 相等 → 不拦、可整删
  await page.waitForTimeout(250);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  expect(await frame.locator('details').count(), '整体包含的 toggle 应被删掉').toBe(0);
  expect(await conform23(await serialize23())).toBe(true);
});

// 对抗审查（PR-E delete reviewer）：detOf 用 closest('details') 把「端点锚在 details 元素本身」（⌘A 全选把端点
// 锚在首/末块上）误算成部分跨界 → 文档首/末是 toggle 时「⌘A 全选删」整个吞成空操作（HIGH 回归）。
test('U23 对抗审查：文档首块是 toggle，⌘A 全选删仍清空（detOf 不把 details 自身算进去）', async () => {
  await openDoc('<details open><summary>标题S</summary><p>体内容</p></details><p id="p2">段落BBBB</p><p id="p3">段落CCCC</p>');
  await frame.locator('#p2').click();
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('ControlOrMeta+a'); // 双 ⌘A = 全篇
  await page.waitForTimeout(120);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  const blocks = await readBlocks();
  const nonUi = blocks.filter((b) => b.t !== '');
  expect(nonUi.length, '全选删应清空（首块 toggle 不该让删除变空操作）').toBe(0);
  expect(await conform23(await serialize23())).toBe(true);
});

test('U23 对抗审查：文档末块是 toggle，⌘A 全选删仍清空', async () => {
  await openDoc('<p id="p1">段落AAAA</p><p id="p2">段落BBBB</p><details open><summary>末T</summary><p>末体</p></details>');
  await frame.locator('#p1').click();
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('ControlOrMeta+a');
  await page.waitForTimeout(120);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  expect((await readBlocks()).filter((b) => b.t !== '').length, '末块 toggle 时全选退格也清空').toBe(0);
  expect(await conform23(await serialize23())).toBe(true);
});


// ── U26a/b/d：同一 toggle 内跨 summary↔正文 的删除（Colin 2026-07-24 主诉：「全选标题+内容按 Delete 没反应」）──
test('U26a：summary 头选到末正文块尾（全覆盖）Delete → 整个 toggle 没了', async () => {
  await openDoc('<p id="pre">前段</p><details open id="dt"><summary id="sm">标题S</summary><p id="b1">正文一</p><p id="b2">正文二</p></details><p id="post">后段</p>');
  await frame.locator('#sm').click();
  await selectAcross('#sm', '#b2'); // summary 头 → 末正文块尾 = 用户「全选整个 toggle」
  await page.waitForTimeout(250);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  const after = await frame.locator('body').evaluate(() => ({
    det: document.querySelectorAll('details').length,
    pre: (document.getElementById('pre') || {}).textContent,
    post: (document.getElementById('post') || {}).textContent,
  }));
  expect(after.det, '全选 toggle 内容按 Delete = 整个 toggle 删掉').toBe(0);
  expect(after.pre).toBe('前段');
  expect(after.post).toBe('后段');
  expect(await conform23(await serialize23())).toBe(true);
});

test('U26b：summary 中选到首正文块中（部分覆盖）→ 裁剪不合并：summary 留头、b1 裁头、b2 完好', async () => {
  await openDoc('<details open id="dt"><summary id="sm">标题S</summary><p id="b1">正文一</p><p id="b2">正文二</p></details>');
  await frame.locator('#sm').click();
  await frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const sm = body.querySelector('#sm').firstChild, b1 = body.querySelector('#b1').firstChild;
    const r = doc.createRange(); r.setStart(sm, 2); r.setEnd(b1, 2); // 「标题|S」→「正文|一」
    const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.waitForTimeout(250);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  const after = await frame.locator('body').evaluate(() => ({
    det: document.querySelectorAll('details').length,
    sm: (document.querySelector('details > summary') || {}).textContent,
    b1: (document.getElementById('b1') || {}).textContent,
    b2: (document.getElementById('b2') || {}).textContent,
  }));
  expect(after.det, 'toggle 本体保留').toBe(1);
  expect(after.sm, 'summary 裁尾留头（不吞正文=合规红线）').toBe('标题');
  expect(after.b1, '首正文块裁头').toBe('一');
  expect(after.b2, '选区外正文块不动').toBe('正文二');
  expect(await conform23(await serialize23())).toBe(true);
});

test('U26d：跨两个 toggle（A 体内→B 体内）Delete → 两个都整删、中间块删、外围不动', async () => {
  await openDoc('<p id="pre">前段</p><details open><summary>甲</summary><p id="a1">甲体内容</p></details><p id="mid">中段</p><details open><summary>乙</summary><p id="z1">乙体内容</p></details><p id="post">后段</p>');
  await frame.locator('#a1').click();
  await selectAcross('#a1', '#z1');
  await page.waitForTimeout(250);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  const after = await frame.locator('body').evaluate(() => ({
    det: document.querySelectorAll('details').length,
    mid: !!document.getElementById('mid'),
    pre: (document.getElementById('pre') || {}).textContent,
    post: (document.getElementById('post') || {}).textContent,
  }));
  expect(after.det, '两个 toggle 都整删').toBe(0);
  expect(after.mid, '夹在中间的段落删').toBe(false);
  expect(after.pre).toBe('前段');
  expect(after.post).toBe('后段');
  expect(await conform23(await serialize23())).toBe(true);
});

test('U26e：toggle 体内删空 → 铁则补空正文块（summary 中→末正文块尾,非全覆盖）', async () => {
  await openDoc('<details open id="dt"><summary id="sm">标题S</summary><p id="b1">正文一</p></details>');
  await frame.locator('#sm').click();
  await frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const sm = body.querySelector('#sm').firstChild, b1 = body.querySelector('#b1').firstChild;
    const r = doc.createRange(); r.setStart(sm, 2); r.setEnd(b1, b1.length); // 「标题|S」→ 正文尾（summary 有残留=非全覆盖）
    const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.waitForTimeout(250);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  const after = await frame.locator('body').evaluate(() => {
    const det = document.querySelector('details');
    const bodyBlocks = det ? [...det.children].filter((c) => c.tagName !== 'SUMMARY' && !c.hasAttribute('data-ws2-ui')) : [];
    return { det: !!det, sm: det ? det.querySelector('summary').textContent : null, bodyCount: bodyBlocks.length };
  });
  expect(after.det, 'toggle 保留（summary 有残留文字）').toBe(true);
  expect(after.sm).toBe('标题');
  expect(after.bodyCount, '正文删空 → ≥1 块铁则补空 <p>').toBeGreaterThanOrEqual(1);
  expect(await conform23(await serialize23())).toBe(true);
});
