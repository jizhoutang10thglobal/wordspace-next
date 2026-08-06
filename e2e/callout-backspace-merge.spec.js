// C8（Notion 粒度对拍第二批）：多段 callout 首行行首 Backspace 此前是**静默死键**——
// isLeafTextBlock 对多段 callout 判 false，叶子-叶子拼接分支直接 return，零变更、连「未保存」都不亮。
// Notion 的解：只有第一个子块脱框并进上一块，框带着剩下的继续存在。单段 callout 两侧本就一致，不动。
// ⚠ 多段 callout 只能来自外部文件/粘贴（编辑器自己造不出来），所以 fixture 直接写盘。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2callback-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
const CSS = '.ws-callout{background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px;margin:14px 0}';
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title><style id="ws-callout-style" data-ws-schema-css="callout">${CSS}</style></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}

const shape = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const cs = [...d.querySelectorAll('.ws-callout')];
  return {
    order: [...d.body.children].filter((el) => !el.hasAttribute('data-ws2-ui')).map((el) => el.tagName + (el.id ? '#' + el.id : '')),
    up: (d.querySelector('#up') || {}).textContent,
    calloutCount: cs.length,
    calloutInnerP: cs.map((c) => c.querySelectorAll(':scope > p').length),
    calloutTexts: cs.map((c) => (c.textContent || '').replace(/\s+/g, '')),
  };
});
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);

// 把光标放到 callout 第一段的行首后按退格（点进去 → Home 归位，别依赖点击落点像素）
async function backspaceAtCalloutStart(sel) {
  await frame.locator(sel).click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Home');
  await page.waitForTimeout(80);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('C8-1 多段 callout 首行退格：第一段脱框并进上一块，框带着剩下的继续在（不再是死键）', async () => {
  await launch();
  await openDoc('<p id="up">上块文字</p><div class="ws-callout" id="C"><p id="c1">甲</p><p id="c2">乙</p></div>');
  expect(await shape()).toMatchObject({ up: '上块文字', calloutCount: 1, calloutInnerP: [2] });
  await backspaceAtCalloutStart('#c1');
  const s = await shape();
  expect(s.up).toBe('上块文字甲');       // 内容并入、不丢字
  expect(s.calloutCount).toBe(1);        // 框还在
  expect(s.calloutInnerP).toEqual([1]);  // 只脱了第一段
  expect(s.calloutTexts).toEqual(['乙']);
});

test('C8-2 三段 callout 连按两次：一次脱一段，框始终不整体消失', async () => {
  await launch();
  await openDoc('<p id="up">上</p><div class="ws-callout" id="C"><p id="c1">甲</p><p id="c2">乙</p><p id="c3">丙</p></div>');
  await backspaceAtCalloutStart('#c1');
  expect(await shape()).toMatchObject({ up: '上甲', calloutInnerP: [2], calloutTexts: ['乙丙'] });
  await backspaceAtCalloutStart('#c2');
  const s = await shape();
  expect(s.up).toBe('上甲乙');
  expect(s.calloutInnerP).toEqual([1]);
  expect(s.calloutTexts).toEqual(['丙']);
});

test('C8-3 最后一段脱框后空框不留（终态与单段那半一致）', async () => {
  await launch();
  await openDoc('<p id="up">上</p><div class="ws-callout" id="C"><p id="c1">甲</p><p id="c2">乙</p></div>');
  await backspaceAtCalloutStart('#c1');
  await backspaceAtCalloutStart('.ws-callout > p');
  const s = await shape();
  expect(s.up).toBe('上甲乙');
  expect(s.calloutCount).toBe(0);
  expect(s.order).toEqual(['P#up']);
});

test('C8-4 单段 callout 路径不回归：仍是整框并入上一块、不丢字', async () => {
  await launch();
  await openDoc('<p id="up">上块文字</p><div class="ws-callout" id="C">甲</div>');
  await backspaceAtCalloutStart('#C');
  const s = await shape();
  expect(s.up).toBe('上块文字甲');
  expect(s.calloutCount).toBe(0);
});

test('C8-5 产出仍然合规入盘（脱出的内容不带 <p> 进 <p>）', async () => {
  await launch();
  await openDoc('<p id="up">上</p><div class="ws-callout" id="C"><p id="c1">甲</p><p id="c2">乙</p></div>');
  await backspaceAtCalloutStart('#c1');
  const html = await serialize();
  expect(await conformOf(html)).toBe(true);
  expect(html).not.toMatch(/<p[^>]*>\s*<p/);
  expect(html).toContain('上甲');
});

// —— 下面四条补的是「fixture 形态盲区」：上面六条的 fixture 全是零空白单行字符串，
// 而多段 callout 的唯一来源是外部 HTML 文件，几乎必然带缩进换行。对抗审查实测：修复在真实形态上完全不生效
// （isCaretAtStart 严格相等，"\n  " 让守卫直接 return）。这是 CLAUDE.md 那条「fixture 的字符串本身
// 也是测试变量、同形态巧合会让门变哑门」的同款。

test('C8-7 真实磁盘形态（带缩进换行）：首行退格照样生效', async () => {
  await launch();
  await openDoc('<p id="up">上块文字</p>\n<div class="ws-callout" id="C">\n  <p id="c1">甲</p>\n  <p id="c2">乙</p>\n</div>');
  await backspaceAtCalloutStart('#c1');
  const s = await shape();
  expect(s.up).toBe('上块文字甲');
  expect(s.calloutInnerP).toEqual([1]);
  expect(s.calloutTexts).toEqual(['乙']);
});

test('C8-8 带缩进时连按两次仍各脱一段（第二次不能变死键）', async () => {
  await launch();
  await openDoc('<p id="up">上</p>\n<div class="ws-callout" id="C">\n  <p id="c1">甲</p>\n  <p id="c2">乙</p>\n  <p id="c3">丙</p>\n</div>');
  await backspaceAtCalloutStart('#c1');
  expect((await shape()).up).toBe('上甲');
  await backspaceAtCalloutStart('#c2');
  const s = await shape();
  expect(s.up).toBe('上甲乙');
  expect(s.calloutTexts).toEqual(['丙']);
});

test('C8-9 混排（行内内容开头）：整行脱框，不从中间劈开', async () => {
  await launch();
  await openDoc('<p id="up">上</p><div class="ws-callout" id="C">提示<strong>要点</strong>正文<p id="c2">第二段</p></div>');
  await backspaceAtCalloutStart('#C strong');
  const s = await shape();
  expect(s.up).toBe('上提示要点正文'); // 修前边界取 firstElementChild(=<strong>) → 只搬走「提示」
  expect(s.calloutTexts).toEqual(['第二段']);
  expect(await conformOf(await serialize())).toBe(true);
});

// 收手时必须是**真的**收手：不 checkpoint、不 markDirty、不把光标弹到上一块。
// 修前（对抗审查 C8-3 实测）零搬运路径照样亮「未保存」并把光标搬到上一块末尾 —— 用户看没反应再按一次，
// 删掉的是上一块的最后一个字。这条用「上一块是图片」这个合规且可达的收手场景钉住这个性质。
const dirtyHidden = () => page.evaluate(() => { const d = document.querySelector('#dirty-dot'); return d ? d.hidden : 'no-such-element'; });
test('C8-10 收手时零副作用：不亮「未保存」、光标不被弹到上一块', async () => {
  await launch();
  await openDoc('<img id="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="x"><div class="ws-callout" id="C"><p id="c1">甲</p><p id="c2">乙</p></div>');
  expect(await dirtyHidden()).toBe(true); // 前置：这个断言若拿不到元素会当场炸，不会静默跳过
  await backspaceAtCalloutStart('#c1');
  expect(await dirtyHidden()).toBe(true);
  const caretIn = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.getSelection(); if (!s || !s.anchorNode) return null;
    const n = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
    return n.closest('.ws-callout') ? 'in-callout' : (n.id || n.tagName);
  });
  expect(caretIn).toBe('in-callout'); // 光标留在框内，没被弹走
  const s = await shape();
  expect(s.calloutInnerP).toEqual([2]);
});

test('C8-6 上一块不可合并（图片）时保持原样，不吞内容', async () => {
  await launch();
  await openDoc('<img id="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="x"><div class="ws-callout" id="C"><p id="c1">甲</p><p id="c2">乙</p></div>');
  const before = await shape();
  await backspaceAtCalloutStart('#c1');
  expect(await shape()).toEqual(before); // 图片不是叶子文字块 → 不并、零变更（既有约定）
});

// —— 引用块：与提示框同一条文法（Schema 决策4 的 childrenAreMultiPara），退格语义原样推广。
// 2026-08-05 死键扫描实测：此前引用块首行退格 HTML 一字未变、dirty 都不亮，与提示框修前一模一样。
test('C8-11 多段引用块首行退格：第一段脱出并进上一块，引用框带着剩下的继续在', async () => {
  await launch();
  await openDoc('<p id="up">上块文字</p><blockquote id="Q"><p id="q1">引甲</p><p id="q2">引乙</p></blockquote>');
  await backspaceAtCalloutStart('#q1');
  const s = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const q = d.querySelector('blockquote');
    return { up: d.querySelector('#up').textContent, qCount: d.querySelectorAll('blockquote').length,
      qInnerP: q ? q.querySelectorAll(':scope > p').length : null, qText: q ? (q.textContent || '').replace(/\s+/g, '') : null };
  });
  expect(s.up).toBe('上块文字引甲');
  expect(s.qCount).toBe(1);
  expect(s.qInnerP).toBe(1);
  expect(s.qText).toBe('引乙');
  expect(await conformOf(await serialize())).toBe(true);
});

test('C8-12 引用块带缩进（真实磁盘形态）同样生效', async () => {
  await launch();
  await openDoc('<p id="up">上</p>\n<blockquote id="Q">\n  <p id="q1">引甲</p>\n  <p id="q2">引乙</p>\n</blockquote>');
  await backspaceAtCalloutStart('#q1');
  const up = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelector('#up').textContent);
  expect(up).toBe('上引甲');
});

// ── C8-13/14（2026-08-05，对抗审查 X4）：上一块是**列表**时的同款语义 ─────────────────
// 实测的病灶（带对照组）：上一块是列表 → changed=false / dirtyDot=false，**静默死键**；
// 同一个提示框只要把上一块换成段落就正常并入。同一个键两种表现，用户没法理解。
// 病根是列表分支先截胡（`if (!isLeafTextBlock(cur)) return`），C8 那半根本够不着。

test('C8-13 上一块是列表：第一段并进列表末项，框带着剩下的继续在（此前是静默死键）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="r1">项一</li><li id="r2">项二</li></ul>'
    + '<div class="ws-callout" id="C"><p id="c1">甲</p><p id="c2">乙</p></div>');
  await backspaceAtCalloutStart('#c1');
  const s = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const c = d.querySelector('.ws-callout');
    return {
      liTexts: [...d.querySelectorAll('#L > li')].map((li) => (li.textContent || '').replace(/\s+/g, '')),
      cCount: d.querySelectorAll('.ws-callout').length,
      cInnerP: c ? c.querySelectorAll(':scope > p').length : null,
      cText: c ? (c.textContent || '').replace(/\s+/g, '') : null,
    };
  });
  expect(s.liTexts, '并进的是**视觉上的上一行**=列表末项，不是新增一项').toEqual(['项一', '项二甲']);
  expect(s.cCount).toBe(1);
  expect(s.cInnerP).toBe(1);
  expect(s.cText).toBe('乙');
  expect(await conformOf(await serialize()), '产物必须仍然合规（<li> 里不许出现块级 <p>）').toBe(true);
});

test('C8-14 上一块是列表 + 框里只剩一段：掏空的框不留（与上一块是段落时终态一致）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="r1">项一</li></ul>'
    + '<div class="ws-callout" id="C"><p id="c1">甲</p></div>');
  await backspaceAtCalloutStart('#c1');
  const s = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return {
      liTexts: [...d.querySelectorAll('#L > li')].map((li) => (li.textContent || '').replace(/\s+/g, '')),
      cCount: d.querySelectorAll('.ws-callout').length,
    };
  });
  expect(s.liTexts).toEqual(['项一甲']);
  expect(s.cCount, '掏空的框不该留在文档里').toBe(0);
  expect(await conformOf(await serialize())).toBe(true);
});
