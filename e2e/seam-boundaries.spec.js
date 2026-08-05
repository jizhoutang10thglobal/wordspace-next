// PR-1（Notion parity 第三批）：五处零反馈边界 + 接缝对称。
// 立论（业界通则，Colin 授权按 industry practice 拍板）：
// ① 同一条接缝，Backspace（从缝后按）与 Delete（从缝前按）必须产生**同一个结果**；
// ② 跨结构边界（表格/折叠块）的第一次删除键只移动光标、不隔墙拆结构（「先进入再删」，Notion/Docs 同）；
// ③ 段 ↔ 多段容器的缝：缝前删=容器首段脱框并进来（C8 语义）；缝后删=缝旁块并进容器末行。
// 修前这五处全是死键：HTML 一字未变、连「未保存」都不亮（2026-08-05 死键扫描实测 7/12）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  if (!tmpDir) tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2seam-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
}
const HEAD = '<style id="ws-callout-style" data-ws-schema-css="callout">.ws-callout{background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px}</style>';
async function openDoc(body) {
  const tag = 'run' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title>${HEAD}</head><body>${body}</body></html>`;
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
// 剥交互态再读（死键扫描的教训：不剥 contenteditable 会把「点进块」当成变化）
const shape = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return {
    body: (d.body.innerHTML || '').replace(/ ?data-ws2-[a-z]+(="[^"]*")?/g, '').replace(/ ?contenteditable="[^"]*"/g, '').replace(/\s*\n\s*/g, '').replace(/>\s+</g, '><').trim(),
    text: (d.body.textContent || '').replace(/\s+/g, ''),
  };
});
// 光标真相：所在的 cell / 顶层块 / summary
const caretHost = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const s = d.getSelection(); if (!s || !s.anchorNode) return null;
  const n = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
  const cell = n.closest && n.closest('td,th');
  if (cell) return 'cell:' + (cell.id || cell.textContent.trim());
  const sm = n.closest && n.closest('summary');
  if (sm) return 'summary:' + (sm.id || sm.textContent.trim());
  // 爬到「parent 是 body 或 details」为止 —— 折叠块体内块要报块自己（P#d2），不是 DETAILS
  let b = n; while (b && b.parentElement && b.parentElement !== d.body && b.parentElement.tagName !== 'DETAILS') b = b.parentElement;
  return b ? (b.tagName + (b.id ? '#' + b.id : '')) : null;
});
async function caretStart(sel) { await frame.locator(sel).click(); await page.waitForTimeout(160); await page.keyboard.press('Home'); await page.waitForTimeout(60); }
async function caretEnd(sel) { await frame.locator(sel).click(); await page.waitForTimeout(160); await page.keyboard.press('End'); await page.waitForTimeout(60); }
const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(300); };
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

// ── 缝一：段 ↔ 多段容器（四个方向，同缝同果）─────────────────────────────
const QUOTE_DOC = '<p id="a">缝前段</p><blockquote id="Q"><p id="q1">引甲</p><p id="q2">引乙</p></blockquote><p id="z">缝后段</p>';
const CALLOUT_DOC = '<p id="a">缝前段</p><div class="ws-callout" id="C"><p id="c1">框甲</p><p id="c2">框乙</p></div><p id="z">缝后段</p>';

test('S1a 容器末行 Delete：缝后段并进容器末行（修前死键）', async () => {
  await launch(); await openDoc(QUOTE_DOC);
  await caretEnd('#q2'); await key('Delete');
  const s = await shape();
  expect(s.text).toBe('缝前段引甲引乙缝后段');
  expect(s.body).toContain('引乙缝后段</p>'); // 并进末段，不是新段
  expect(s.body).not.toContain('id="z"');
  expect(await conformOf(await serialize())).toBe(true);
});

test('S1b 同缝 Backspace 方向：缝后段行首退格 → 与 S1a 同一个结果', async () => {
  await launch(); await openDoc(QUOTE_DOC);
  await caretStart('#z'); await key('Backspace');
  const s = await shape();
  expect(s.text).toBe('缝前段引甲引乙缝后段');
  expect(s.body).toContain('引乙缝后段</p>');
  // 光标在容器内（接合点），继续打字进容器
  expect(await caretHost()).toBe('BLOCKQUOTE#Q');
});

test('S1c 提示框同款（前缝 Delete）：框首段脱框并进缝前段，框留着', async () => {
  await launch(); await openDoc(CALLOUT_DOC);
  await caretEnd('#a'); await key('Delete');
  const s = await shape();
  expect(s.text).toBe('缝前段框甲框乙缝后段');
  expect(s.body).toContain('缝前段框甲</p>'); // C8 语义：首段脱框并进来
  expect(s.body).toContain('框乙'); // 框带着剩下的
  expect(await conformOf(await serialize())).toBe(true);
});

test('S1d 前缝两方向同果：Delete（从段末）与 Backspace（从框首段行首）产出一致', async () => {
  await launch(); await openDoc(CALLOUT_DOC);
  await caretEnd('#a'); await key('Delete');
  const viaDelete = (await shape()).body;
  // 文档已脏，open-file 不换文档（harness 已知坑）→ 必须重启实例再开第二份
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  app = null;
  await launch(); await openDoc(CALLOUT_DOC);
  await caretStart('#c1'); await key('Backspace');
  const viaBackspace = (await shape()).body;
  expect(viaDelete).toBe(viaBackspace);
});

test('S1e 容器末行 Delete、下一块是图片：不吞不动（与 Backspace 侧既有约定对称）', async () => {
  await launch();
  await openDoc('<blockquote id="Q"><p id="q1">引甲</p><p id="q2">引乙</p></blockquote><img id="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="x">');
  const before = (await shape()).body;
  await caretEnd('#q2'); await key('Delete');
  expect((await shape()).body).toBe(before);
});

// ── 缝二：段 ↔ 表格（先进入再删）───────────────────────────────────────
const TABLE_DOC = '<p id="a">表前段</p><table id="T"><tbody><tr><td id="t11">甲</td><td id="t12">乙</td></tr><tr><td id="t21">丙</td><td id="t22">丁</td></tr></tbody></table><p id="z">表后段</p>';

test('S2a 表后段行首 Backspace：光标进末格末尾，整表零变化（修前死键）', async () => {
  await launch(); await openDoc(TABLE_DOC);
  const before = (await shape()).text;
  await caretStart('#z'); await key('Backspace');
  expect(await caretHost()).toBe('cell:t22'); // 进的是末格
  expect((await shape()).text).toBe(before);  // 一字未删
  // 第二下：已在格内，原生删格内字 —— 键不再是死的
  await key('Backspace');
  const t22 = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelector('#t22').textContent);
  expect(t22).toBe(''); // 「丁」被删
});

test('S2b 表前段末尾 Delete：光标进首格开头，整表零变化（修前死键）', async () => {
  await launch(); await openDoc(TABLE_DOC);
  const before = (await shape()).text;
  await caretEnd('#a'); await key('Delete');
  expect(await caretHost()).toBe('cell:t11');
  expect((await shape()).text).toBe(before);
  await key('Delete');
  const t11 = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelector('#t11').textContent);
  expect(t11).toBe(''); // 「甲」被删（光标在首格开头，Delete 前向删）
});

// ── 缝三：段 ↔ 折叠块（光标去可见末端）─────────────────────────────────
test('S3a 收起的折叠块后段行首 Backspace：光标到标题末，不展开不吞（修前死键）', async () => {
  await launch();
  await openDoc('<details id="D"><summary id="S">标题</summary><p id="d1">体内</p></details><p id="z">后段</p>');
  const before = (await shape()).body;
  await caretStart('#z'); await key('Backspace');
  expect(await caretHost()).toBe('summary:S');
  const s = await shape();
  expect(s.body).toBe(before); // 不吞内容、不 open
  expect(s.body).not.toContain('<details id="D" open'); // 显式：没被展开
});

test('S3b 展开的折叠块后段行首 Backspace：光标到体内末块末尾', async () => {
  await launch();
  await openDoc('<details id="D" open><summary id="S">标题</summary><p id="d1">体内甲</p><p id="d2">体内乙</p></details><p id="z">后段</p>');
  const beforeText = (await shape()).text;
  await caretStart('#z'); await key('Backspace');
  expect(await caretHost()).toBe('P#d2');
  expect((await shape()).text).toBe(beforeText);
});

// ── 排版过的文件同样生效（这批判据全走 isBlankRun/lastLineHostOf，缩进不改变行为）──
test('S4 缩进形态：容器末行 Delete 照样并入（不因源码空白变死键）', async () => {
  await launch();
  await openDoc('<p id="a">缝前段</p>\n<blockquote id="Q">\n  <p id="q1">引甲</p>\n  <p id="q2">引乙</p>\n</blockquote>\n<p id="z">缝后段</p>');
  await caretEnd('#q2'); await key('Delete');
  expect((await shape()).text).toBe('缝前段引甲引乙缝后段');
  expect((await shape()).body).toContain('引乙缝后段');
});

// ── isCaretAtRealEnd 的源码空白豁免：只豁免以换行开头的（B 组「用户尾随空格」维持旧判）──
test('S5 排版文件段尾 Enter：正确判块末 → 新建空块（不把源码换行错当段中内容）', async () => {
  await launch();
  await openDoc('<p id="a">上一段</p>\n<p id="b">\n  甲乙\n</p>\n<p id="z">下一段</p>');
  await caretEnd('#b'); await key('Enter');
  const s = await shape();
  // 修前：isCaretAtRealEnd 对 "\n" 判 false → 走段中劈块 → 劈出含源码空白的「假内容段」。
  // 修后：判块末 → 新建空段。两种路径的可观测差别：新段必须是**空**的。
  const m = s.body.match(/甲乙<\/p><p[^>]*>(.*?)<\/p><p id="z"/);
  expect(m, '「甲乙」后应有新块、且在下一段之前').not.toBeNull();
  expect(m[1].replace(/<br>/g, '')).toBe(''); // 新块必须为空
});
