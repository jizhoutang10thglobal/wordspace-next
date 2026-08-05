// PR-3（Notion parity 第三批）：callout/quote 容器化核心——框内每个直接子 <p> 是独立**交互**行。
// 存储不动（磁盘仍一个容器、Schema 决策4 文法原样）；机制 = 列表行级（U1-U4）的推广。
// Notion 对照（对拍实测）：首段悬停给**容器**手柄、其余段给**段**手柄（C1）；段菜单删除只删该段（C2）；
// 「在下方插入」落框内（C5）；框末 Enter 新行留框内（C6）；框中 Enter 框不劈（C7）；Esc 蓝罩只罩该段（C9）；
// 外部段落可拖入框内成为子段（C11）。
// ⚠ fixture 必须带兄弟块（单一顶层 div 会被 pickBlockRoot 包裹启发式当画布根）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  if (!tmpDir) tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2cc-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
}
const HEAD = '<style id="ws-callout-style" data-ws-schema-css="callout">.ws-callout{background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px}.ws-callout>p{margin:6px 0}</style>';
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
const DOC3 = '<p id="up">上面一段</p><div class="ws-callout" id="C"><p id="c1">框一</p><p id="c2">框二</p><p id="c3">框三</p></div><p id="z">下面一段</p>';
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);
const calloutShape = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const c = d.querySelector('.ws-callout');
  return {
    count: d.querySelectorAll('.ws-callout').length,
    paras: c ? [...c.querySelectorAll(':scope > p')].map((p) => (p.textContent || '').trim()) : null,
    order: [...d.body.children].filter((el) => !el.hasAttribute('data-ws2-ui')).map((el) => el.tagName + (el.id ? '#' + el.id : '')),
  };
});
// 手柄纵向中线归属哪个元素
const gripYIn = (sel) => page.evaluate((q) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const g = d.querySelector('.ws-grip'); const t = d.querySelector(q);
  if (!g || !t) return null;
  const gr = g.getBoundingClientRect(); const tr = t.getBoundingClientRect();
  const cy = gr.top + gr.height / 2;
  return { inside: cy >= tr.top - 1 && cy <= tr.bottom + 1, visible: getComputedStyle(g).display !== 'none' };
}, sel);
async function hoverAnd(sel, ms) { await frame.locator(sel).hover(); await page.waitForTimeout(ms || 220); }

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('C1 手柄分域：悬停第 2 段手柄对齐该段；悬停首段手柄回容器（钉框顶）', async () => {
  await launch(); await openDoc(DOC3);
  await hoverAnd('#c2');
  const at2 = await gripYIn('#c2');
  expect(at2.visible).toBe(true);
  expect(at2.inside).toBe(true); // 段手柄对齐第 2 段
  await hoverAnd('#c1');
  const atC = await gripYIn('#C');
  const at1 = await gripYIn('#c1');
  expect(atC.inside).toBe(true); // 首段悬停 → 容器手柄（框顶 == 首段所在行，两个判定都应成立）
  expect(at1.inside).toBe(true);
});

test('C2 段菜单：标题是「正文」、删除只删那一段、框和其余段原样', async () => {
  await launch(); await openDoc(DOC3);
  await hoverAnd('#c2');
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  const head = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const h = d.querySelector('.ws-blockmenu-head');
    return h ? h.textContent.trim() : null;
  });
  if (head) expect(head).toBe('正文'); // Notion 段菜单标题 "Text"
  await frame.locator('.ws-blockmenu-item', { hasText: '删除' }).first().click();
  await page.waitForTimeout(300);
  const s = await calloutShape();
  expect(s.count).toBe(1);
  expect(s.paras).toEqual(['框一', '框三']);
  expect(await conformOf(await serialize())).toBe(true);
});

test('C5 「在下方插入」与「+」都落框内', async () => {
  await launch(); await openDoc(DOC3);
  await hoverAnd('#c2');
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  await frame.locator('.ws-blockmenu-item', { hasText: '在下方插入' }).click();
  await page.waitForTimeout(300);
  let s = await calloutShape();
  expect(s.paras).toEqual(['框一', '框二', '', '框三']); // 新空段在第 2 段之后、框内
  await page.keyboard.type('新加的');
  await page.waitForTimeout(250);
  s = await calloutShape();
  expect(s.paras).toEqual(['框一', '框二', '新加的', '框三']); // 光标真在新段里
  // 「+」：悬停第 3 段（原框三）点 +
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await hoverAnd('#c3');
  await frame.locator('.ws-plus').click();
  await page.waitForTimeout(300);
  await page.keyboard.type('加号来的');
  await page.waitForTimeout(250);
  s = await calloutShape();
  expect(s.paras).toEqual(['框一', '框二', '新加的', '框三', '加号来的']);
  expect(await conformOf(await serialize())).toBe(true);
});

test('C6 框末 Enter：新行留框内（此前掉框外）', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c3').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await page.keyboard.type('第四行');
  await page.waitForTimeout(250);
  const s = await calloutShape();
  expect(s.count).toBe(1); // 框没劈
  expect(s.paras).toEqual(['框一', '框二', '框三', '第四行']);
  expect(s.order).toEqual(['P#up', 'DIV#C', 'P#z']); // 没有东西掉到框外
  expect(await conformOf(await serialize())).toBe(true);
});

test('C7 框中 Enter：行一分为二、框还是一个（此前框被劈成两个）', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight'); // 光标在「框」和「二」之间
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const s = await calloutShape();
  expect(s.count).toBe(1);
  expect(s.paras).toEqual(['框一', '框', '二', '框三']);
  expect(await conformOf(await serialize())).toBe(true);
});

test('C7b 单段裸文本框中 Enter：升出第二行、框不劈', async () => {
  await launch(); await openDoc('<p id="up">上</p><div class="ws-callout" id="C">前后</div><p id="z">下</p>');
  await frame.locator('#C').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const raw = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelector('#C').innerHTML.replace(/ ?data-ws2-[a-z]+(="[^"]*")?/g, '').replace(/ ?contenteditable="[^"]*"/g, ''));
  expect(raw).toBe('前<p>后</p>'); // 裸行内保留在原位、光标后内容进新 <p>（phrasing+<p> 混合合规）
  expect((await calloutShape()).count).toBe(1);
  expect(await conformOf(await serialize())).toBe(true);
});

test('C6b 空末行 Enter：跳出框（双回车退出，列表同款约定）', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c3').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter'); // 产生空第四行
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); // 空末行再回车 → 跳出
  await page.waitForTimeout(300);
  await page.keyboard.type('框外了');
  await page.waitForTimeout(250);
  const s = await calloutShape();
  expect(s.paras).toEqual(['框一', '框二', '框三']); // 空行没留下
  const orderText = await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.body.children].filter((el) => !el.hasAttribute('data-ws2-ui')).map((el) => (el.textContent || '').trim().slice(0, 4)));
  expect(orderText).toEqual(['上面一段'.slice(0, 4), '框一框二'.slice(0, 4), '框外了', '下面一段'.slice(0, 4)]);
});

test('C9 Esc 分级：第一级选中那一段，第二级整框，Delete 只删选中段', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const sel1 = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('[data-ws2-selected]')].map((el) => el.tagName + (el.id ? '#' + el.id : ''));
  });
  expect(sel1).toEqual(['P#c2']); // 第一级：只罩那一段（Notion C9）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const sel2 = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('[data-ws2-selected]')].map((el) => el.tagName + (el.id ? '#' + el.id : ''));
  });
  expect(sel2).toEqual(['DIV#C']); // 第二级：整框
  // 重来：段选中态按 Delete → 只删那段
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const s = await calloutShape();
  expect(s.count).toBe(1);
  expect(s.paras).toEqual(['框一', '框三']);
});

test('C11 拖入：顶层段落拖到框内第 2 段下半区 → 成为框内子段；源位置消失', async () => {
  await launch(); await openDoc(DOC3);
  await hoverAnd('#up'); // 让 grip 锚定 up（顶层段落，dragFrom=gripEl）
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const tgt = d.querySelector('#c2');
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    const ev = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 10), clientY: Math.round(r.bottom - 3) };
    tgt.dispatchEvent(new DragEvent('dragover', ev));
    window.__probeMark = (() => { const m = d.querySelector('[data-ws2-drop]'); return m ? (m.id || m.tagName) + ':' + m.getAttribute('data-ws2-drop') : null; })();
    tgt.dispatchEvent(new DragEvent('drop', ev));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__probeMark)).toBe('c2:bottom'); // 指示线画在段缝（不是整框缝）
  const s = await calloutShape();
  expect(s.paras).toEqual(['框一', '框二', '上面一段', '框三']);
  expect(s.order).toEqual(['DIV#C', 'P#z']); // 源位置的段落没了（搬进框）
  expect(await conformOf(await serialize())).toBe(true);
});

test('C11b 段拖出：框内段拖到顶层段缝 → 脱框成顶层块；框带剩下的', async () => {
  await launch(); await openDoc(DOC3);
  await hoverAnd('#c2'); // 段手柄锚定 c2（gripRow=P）
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const tgt = d.querySelector('#z');
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    const ev = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 10), clientY: Math.round(r.bottom - 3) };
    tgt.dispatchEvent(new DragEvent('dragover', ev));
    tgt.dispatchEvent(new DragEvent('drop', ev));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(300);
  const s = await calloutShape();
  expect(s.paras).toEqual(['框一', '框三']);
  expect(s.order).toEqual(['P#up', 'DIV#C', 'P#z', 'P#c2']); // c2 成为顶层块、落 z 之后
  expect(await conformOf(await serialize())).toBe(true);
});

test('C-undo：框内切行 + 段删除各是一步撤销', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c3').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await page.keyboard.type('临时行');
  await page.waitForTimeout(400);
  const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
  await menu('undo'); await page.waitForTimeout(300); // 撤打字
  await menu('undo'); await page.waitForTimeout(300); // 撤切行
  const s = await calloutShape();
  expect(s.paras).toEqual(['框一', '框二', '框三']);
});

// ── 对抗审查回归钉（ADV-C1..C5，全部实机复现过）────────────────────────────
test('ADV-C1 反向跨段选区 + Enter：先删选区再切行——绝不产嵌套 <p>/重复 id', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');           // 框|二
  await page.keyboard.press('Shift+ArrowUp');        // 反向选区（anchor 在 c2、focus 进 c1）
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return {
      nestedP: d.querySelectorAll('.ws-callout p p').length,
      dupIds: ['c1', 'c2', 'c3'].filter((i) => d.querySelectorAll('#' + i).length > 1),
      count: d.querySelectorAll('.ws-callout').length,
      text: d.querySelector('.ws-callout').textContent.replace(/\s+/g, ''),
    };
  });
  expect(st.nestedP).toBe(0);      // 修前：<p><p id=c1>…（活 DOM 与 reparse 落盘分叉）
  expect(st.dupIds).toEqual([]);   // 修前：两个 #c1 两个 #c2
  expect(st.count).toBe(1);
  expect(st.text).not.toContain('框一框二'); // 选中的跨段内容真被删了
  expect(await conformOf(await serialize())).toBe(true);
});

test('ADV-C4 同段选中文字 + Enter：删选中、从光标劈行（与全编辑器 Enter 语义一致）', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight'); // 选中「框」
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const s = await calloutShape();
  expect(s.paras).toEqual(['框一', '', '二', '框三']); // 「框」被删、剩「二」在新行；修前：字没删、整行搬走、id 留空壳
});

test('ADV-C2 框内段间退格：自管合并，不留 Chromium font-family 垃圾 span', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace'); // 第二段行首 → 并进第一段
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const c = d.querySelector('.ws-callout');
    return { paras: [...c.querySelectorAll(':scope > p')].map((p) => (p.textContent || '').trim()),
      fontSpans: c.querySelectorAll('span[style*="font"]').length,
      anyStyle: c.querySelectorAll('[style]').length };
  });
  expect(st.paras).toEqual(['框一框二', '框三']);
  expect(st.fontSpans).toBe(0); // 修前：<span style="font-family: -apple-system…">框二</span> 落盘
  expect(st.anyStyle).toBe(0);
  expect(await conformOf(await serialize())).toBe(true);
  // 镜像：段末 Delete
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const st2 = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const c = d.querySelector('.ws-callout');
    return { paras: [...c.querySelectorAll(':scope > p')].map((p) => (p.textContent || '').trim()), styles: c.querySelectorAll('[style]').length };
  });
  expect(st2.paras).toEqual(['框一框二框三']);
  expect(st2.styles).toBe(0);
});

test('ADV-C3 多行粘贴进框：逐行成框内 <p>，一个框绝不粘成三个', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const dt = new DataTransfer();
    dt.setData('text/plain', '甲行\n乙行\n丙行');
    (d.querySelector('.ws-callout') || d.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(350);
  const s = await calloutShape();
  expect(s.count).toBe(1); // 修前：splitBlock 把一个 callout 劈成三个
  expect(s.paras).toEqual(['框一', '框二甲行', '乙行', '丙行', '框三']);
  // 死空段检查：所有空段必须带 <br> 占位
  const deadEmpty = await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.querySelectorAll('.ws-callout > p')].filter((p) => !p.textContent && !p.querySelector('br,img')).length);
  expect(deadEmpty).toBe(0);
  expect(await conformOf(await serialize())).toBe(true);
});

test('ADV-C5 段选中态拖走该段：不留 data-ws2-selected 幽灵蓝条', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); // 段选中（属性在 c2 上）
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const tgt = d.querySelector('#z');
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    const ev = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 10), clientY: Math.round(r.bottom - 3) };
    tgt.dispatchEvent(new DragEvent('dragover', ev));
    tgt.dispatchEvent(new DragEvent('drop', ev));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(300);
  const ghosts = await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.querySelectorAll('[data-ws2-selected]')].map((el) => el.tagName + '#' + el.id));
  expect(ghosts).toEqual([]); // 修前：P#c2 搬到顶层还挂着选中蓝罩、Delete 死键
});

test('QUOTE 覆盖：blockquote 与 callout 共享全部容器化路径（段菜单删段 + 框内 Enter 切行）', async () => {
  await launch();
  await openDoc('<p id="up">上</p><blockquote id="Q"><p id="q1">引一</p><p id="q2">引二</p><p id="q3">引三</p></blockquote><p id="z">下</p>');
  await frame.locator('#q2').hover();
  await page.waitForTimeout(220);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  await frame.locator('.ws-blockmenu-item', { hasText: '删除' }).first().click();
  await page.waitForTimeout(300);
  let qs = await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.querySelectorAll('#Q > p')].map((p) => p.textContent.trim()));
  expect(qs).toEqual(['引一', '引三']); // 段菜单只删该段
  await frame.locator('#q3').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('引四');
  await page.waitForTimeout(300);
  qs = await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.querySelectorAll('#Q > p')].map((p) => p.textContent.trim()));
  expect(qs).toEqual(['引一', '引三', '引四']); // 框内 Enter 留框内
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('blockquote').length)).toBe(1);
  expect(await conformOf(await serialize())).toBe(true);
});

