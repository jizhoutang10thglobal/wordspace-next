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

// U23/select-4：选区端点部分跨 toggle(details)边界的删除 → 一致化为空操作 + 反馈动画（消除半应用）。
const serialize23 = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conform23 = (h) => page.evaluate((x) => WS2SchemaRegistry.classify(new DOMParser().parseFromString(x, 'text/html')).conform, h);

test('U23：选区部分跨 toggle 边界删除 → 空操作不半删 + 反馈动画（select-4）', async () => {
  await openDoc('<p id="pre">前段AAAA</p><ul class="ws-todo"><li id="t1">待办甲</li></ul><details open><summary id="sm">标题S</summary><p id="bd">体内容BBBB</p></details>');
  await frame.locator('#t1').click(); // 建焦点，保证 keydown 路由到删除处理
  await selectAcross('#t1', '#bd'); // 从 todo 项选进 toggle 体内 p（部分跨 details 边界）
  await page.waitForTimeout(250);
  const before = await frame.locator('body').evaluate(() => ({ t1: document.getElementById('t1').textContent, bd: document.getElementById('bd').textContent, det: document.querySelectorAll('details').length, sm: !!document.getElementById('sm') }));
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('[data-ws2-nope]').count(), { message: 'no-op 反馈动画应出现', timeout: 700, intervals: [20, 30, 50, 80] }).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  const after = await frame.locator('body').evaluate(() => ({ t1: (document.getElementById('t1') || {}).textContent, bd: (document.getElementById('bd') || {}).textContent, det: document.querySelectorAll('details').length, sm: !!document.getElementById('sm') }));
  expect(after, 'DOM 前后完全不变（无半删）').toEqual(before);
  await expect.poll(() => frame.locator('[data-ws2-nope]').count(), { message: '反馈动画随后消失', timeout: 1500 }).toBe(0);
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

test('U23 对抗审查：no-op 反馈标记 data-ws2-nope 不漏进存盘字节（serialize 白名单）', async () => {
  await openDoc('<p id="pre">前段</p><ul class="ws-todo"><li id="t1">待办甲</li></ul><details open><summary id="sm">标题</summary><p id="bd">体内容</p></details>');
  await frame.locator('#t1').click();
  await selectAcross('#t1', '#bd'); // 部分跨 toggle → 触发 no-op + flashNope
  await page.waitForTimeout(250);
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('[data-ws2-nope]').count(), { timeout: 700, intervals: [20, 30, 50] }).toBeGreaterThan(0); // 标记确实挂上了
  const html = await serialize23(); // 挂着标记时序列化
  expect(/data-ws2-nope/.test(html), '存盘字节绝不含 data-ws2-nope 交互标记').toBe(false);
});
