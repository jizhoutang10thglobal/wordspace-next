// 块编辑器（ui-demo 式 Notion 块）e2e 真门：CI 用 xvfb 真启动 Electron 跑。
// 覆盖核心交互 + 存盘保真 + 安全红线（危险链接拒绝）+ CSP 强门（取色经 CSSOM span 真渲染）。
// 原画布编辑器的 app.spec 已废（#toolbar/tb-* 选择器全删），本文件整套重写对齐新编辑器。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(__dirname, 'screenshots');

let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2e2e-'));
  app = await electron.launch({
    // --no-sandbox：CI 无特权 runner 必需；与 iframe sandbox=allow-same-origin（挡文档脚本）无关
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_PDF_OUT: path.join(tmpDir, 'export.pdf') },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  // stub 原生弹窗：iframe sandbox 无 allow-modals，blockedit 用父窗口 prompt；openDoc 用 confirm
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}

async function openDoc(html, extra = {}) {
  const docPath = path.join(tmpDir, 'doc.html');
  await fs.writeFile(docPath, html, 'utf8');
  for (const [name, body] of Object.entries(extra)) await fs.writeFile(path.join(tmpDir, name), body, 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
  return docPath;
}

const clearUI = async () => { await page.keyboard.press('Escape').catch(() => {}); await page.mouse.click(1200, 800); await page.waitForTimeout(180); };
const tagOf = (id) => frame.locator('body').evaluate((b, id) => (b.ownerDocument.getElementById(id) || {}).tagName, id);
const htmlOf = (id) => frame.locator('body').evaluate((b, id) => { const e = b.ownerDocument.getElementById(id); return e ? e.outerHTML : null; }, id);
const blockCount = () => frame.locator('body').evaluate((b) => [...b.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui')).length);
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const editingId = () => frame.locator('body').evaluate(() => { const e = document.querySelector('[data-ws2-editing]'); return e ? (e.id || e.tagName) : null; });
// 设折叠光标到某块文本节点的指定偏移（块编辑/合并/方向键测试用）。先 click 进编辑，再调它覆盖光标。
async function setCaret(id, off) {
  await frame.locator('body').evaluate((body, [id, off]) => {
    const el = document.getElementById(id); const tn = el.firstChild || el;
    const r = document.createRange(); r.setStart(tn, off); r.collapse(true);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  }, [id, off]);
}

const SIMPLE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>
<h1 id="t">标题</h1><p id="p1">第一段文字。</p><p id="p2">第二段文字内容。</p><p id="p3">第三段。</p><blockquote id="q">引用。</blockquote></body></html>`;

test.afterEach(async ({}, testInfo) => {
  try {
    if (page) { await fs.mkdir(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, testInfo.title.replace(/[^\w一-龥]+/g, '_').slice(0, 40) + '.png') }); }
  } catch (e) { /* ignore */ }
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('单击即编辑 + 加粗 + 斜杠菜单 + Enter 新建 + Backspace 合并', async () => {
  await launch();
  await openDoc(SIMPLE);
  // 单击可编辑块直接进编辑（无对象框）
  await frame.locator('#p1').click();
  await expect(frame.locator('[data-ws2-editing]')).toHaveCount(1);
  // 选中文字 → 格式气泡浮现 → 加粗
  await frame.locator('#p1').selectText();
  await frame.locator('.ws-fmtbar [title="加粗"]').click();
  await page.waitForTimeout(150);
  expect(await htmlOf('p1')).toMatch(/<(b|strong)>/i);
  await clearUI();
  // 斜杠菜单
  await frame.locator('#p2').click();
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await clearUI();
  // Enter 段末新建正文块（块数 +1）
  let before = await blockCount();
  await frame.locator('#q').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('新块');
  await page.waitForTimeout(150);
  expect(await blockCount()).toBe(before + 1);
  await clearUI();
  // Backspace 块首合并（块数 -1）
  before = await blockCount();
  await frame.locator('#p3').click(); await page.keyboard.press('Home'); await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  expect(await blockCount()).toBe(before - 1);
});

test('转为列表产生合法 <ul><li>（非裸 ul，不写坏文件）', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  await frame.locator('#p1').selectText();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await frame.locator('.ws-fmtbar-menu-item', { hasText: '无序列表' }).click();
  await page.waitForTimeout(200);
  expect(await tagOf('p1')).toBe('UL');
  expect(await htmlOf('p1')).toMatch(/<li>/);
  // 存盘：列表合法（ul 内是 li，没有裸文本直挂 ul）
  const html = await serialize();
  expect(html).not.toMatch(/<ul[^>]*>\s*[^<\s]/); // <ul> 后紧跟非标签文本 = 裸文本，禁止
});

// A1（对抗发现，U3 修）：列表转引用/正文/标题前必须把 li 拍平成 phrasing，不能留孤儿 <li> 挂 blockquote 下。
test('A1: 列表转为引用 → 合法 <blockquote>、无孤儿 <li>、内容保留', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"></head>'
    + '<body><h1 id="h">标题</h1><ul id="mylist"><li>甲 <b>粗</b></li><li>乙</li></ul></body></html>');
  await frame.locator('#mylist').click();
  await frame.locator('#mylist').selectText();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await frame.locator('.ws-fmtbar-menu-item', { hasText: '引用' }).click();
  await page.waitForTimeout(200);
  expect(await tagOf('mylist')).toBe('BLOCKQUOTE');         // 变成引用块
  expect(await htmlOf('mylist')).not.toMatch(/<li/i);        // 无孤儿 <li>（A1 的 bug）
  expect(await htmlOf('mylist')).toMatch(/甲[\s\S]*乙/);     // 两项内容保留
  expect(await htmlOf('mylist')).toMatch(/<b>/i);            // 行内格式保留
  const html = await serialize();
  expect(html).not.toMatch(/<blockquote[^>]*>[\s\S]*?<li/i); // 存盘：blockquote 里没有 li
});

// U5（修 C1）：callout 框 CSS 烤进存盘文件——存盘自包含，app 外任何浏览器打开也渲染成提示框（非无样式纯文本）。
test('U5: callout 框 CSS 入盘（data-ws-schema-css，校验器 head 白名单认）', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#q').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: '提示' }).click();
  await page.waitForTimeout(200);
  expect(await frame.locator('.ws-callout').count()).toBeGreaterThan(0);
  const html = await serialize();
  expect(html).toMatch(/id="ws-callout-style"/);                  // 框 CSS 入盘
  expect(html).toMatch(/data-ws-schema-css="callout"/);           // 标 schema baseline（U4 head 白名单认它合规）
  expect(html).toMatch(/\.ws-callout\s*\{[^}]*border/);           // 真有边框（修 C1：不是无样式纯文本）
});

// 行首 markdown 触发：在一个空正文块里打 marker+空格 → 转成对应块。
test('markdown 行首触发：1. / - / [] / > / # 转对应块', async () => {
  await launch();
  await openDoc(SIMPLE);
  // 在 #q 后造一个空正文块、打 marker
  const mk = async (marker) => {
    await frame.locator('#q').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter'); // 空正文块进编辑
    await page.keyboard.type(marker);
    await page.waitForTimeout(180);
    await clearUI();
  };
  await mk('1. ');
  expect(await frame.locator('ol').count()).toBeGreaterThan(0); // 编号列表
  await mk('- ');
  expect(await frame.locator('ul:not(.ws-todo)').count()).toBeGreaterThan(0); // 无序列表
  await mk('[] ');
  expect(await frame.locator('ul.ws-todo').count()).toBe(1); // 待办列表
  const h1Before = await frame.locator('h1').count();
  await mk('# ');
  expect(await frame.locator('h1').count()).toBe(h1Before + 1); // 标题
  const bqBefore = await frame.locator('blockquote').count();
  await mk('> ');
  expect(await frame.locator('blockquote').count()).toBe(bqBefore + 1); // 引用
});

// 待办：勾选切换 data-checked + 勾选框 CSS 烤进存盘文件（在 app 外也渲染成 checklist）。
test('待办：勾选切换 + 样式与 data-checked 随存盘保留', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#q').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] '); // → 待办列表
  await page.waitForTimeout(180);
  await page.keyboard.type('买牛奶');
  await page.waitForTimeout(120);
  expect(await frame.locator('ul.ws-todo').count()).toBe(1);
  // 勾选框样式块已注入 head
  const hasStyle = await page.evaluate(() => !!document.getElementById('doc-frame').contentDocument.getElementById('ws-todo-style'));
  expect(hasStyle).toBe(true);
  // 点 li 左侧勾选框 gutter → data-checked=true（dispatch 精确命中，避开 ⋮⋮ 手柄等覆盖层 z 序干扰）
  await frame.locator('body').evaluate(() => {
    const li = document.querySelector('ul.ws-todo > li');
    const r = li.getBoundingClientRect();
    li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: r.left - 8, clientY: r.top + 5 }));
  });
  await page.waitForTimeout(150);
  expect(await frame.locator('ul.ws-todo > li').first().getAttribute('data-checked')).toBe('true');
  // 存盘：勾选框样式 + data-checked + ws-todo 都在（文件自包含、任何浏览器渲染成 checklist）
  const html = await serialize();
  expect(html).toMatch(/id="ws-todo-style"/);
  expect(html).toMatch(/class="ws-todo"/);
  expect(html).toMatch(/data-checked="true"/);
});

// Tab 缩进：列表第二项按 Tab → 嵌进第一项的子列表。
test('Tab 缩进：列表项嵌套成子列表', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#q').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- 第一项'); // → 无序列表，第一项
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter'); // 原生新 <li>
  await page.keyboard.type('第二项');
  await page.waitForTimeout(120);
  await page.keyboard.press('Tab'); // 第二项缩进进第一项
  await page.waitForTimeout(180);
  // 出现嵌套：某个 li 里又有一个 ul，其中含「第二项」
  const nested = await frame.locator('body').evaluate(() => {
    const sub = document.querySelector('li > ul, li > ol');
    return sub ? (sub.textContent || '').includes('第二项') : false;
  });
  expect(nested).toBe(true);
});

// 「转为」菜单 → 编号列表（正文转 <ol><li>，内容保留）。
test('转为编号列表：<ol><li> 且原文保留', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  await frame.locator('#p1').selectText();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await frame.locator('.ws-fmtbar-menu-item', { hasText: '编号列表' }).click();
  await page.waitForTimeout(200);
  expect(await tagOf('p1')).toBe('OL');
  expect(await htmlOf('p1')).toMatch(/<li>[^<]*第一段/); // 原文进了 <li>
});

test('存盘保真：编辑后无编辑器标记泄漏；简单 + 复杂文档结构保留', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click(); await page.keyboard.type('改一下');
  await page.waitForTimeout(150);
  let html = await serialize();
  expect(html).not.toMatch(/data-ws2-/);
  expect(html).not.toMatch(/contenteditable/i);
  expect(html).not.toMatch(/ws-grip|ws-fmtbar|ws-slashmenu|ws-blockmenu/);
  expect(html).toMatch(/季度|标题/); // 原内容在
  // 复杂文档：div/table/section 原样保留
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>.card{padding:10px}</style></head><body>'
    + '<h1 id="h">复杂</h1><div id="card" class="card"><h3>卡片</h3><p>内文</p></div>'
    + '<table id="tb"><tbody><tr><td>A</td></tr></tbody></table><section><p>区块</p></section></body></html>');
  await frame.locator('#card').click(); await page.waitForTimeout(150);
  html = await serialize();
  expect(html).not.toMatch(/data-ws2-/);
  expect(html).toMatch(/<table/);
  expect(html).toMatch(/class="card"/);
  expect(html).toMatch(/<section/);
  expect(html).toMatch(/卡片/);
});

test('安全红线：javascript: 链接被拒，不进文档、不写盘', async () => {
  await launch();
  await openDoc(SIMPLE);
  await page.evaluate(() => { window.prompt = () => 'javascript:alert(document.cookie)'; });
  await frame.locator('#p1').click();
  await frame.locator('#p1').selectText();
  await frame.locator('.ws-fmtbar [title="链接"]').click();
  await page.waitForTimeout(250);
  // 不生成链接
  expect(await frame.locator('#p1 a').count()).toBe(0);
  // 不写盘
  const html = await serialize();
  expect(html.toLowerCase()).not.toContain('javascript:');
});

// 取色门（普通文档，回归保护）：选区取色 → 包进 span、getComputedStyle 真画出该色。
// 注意（已知限制）：若**文档自身**声明了严格 style-src（无 unsafe-inline），其 inline 样式会被该文档
// 的 CSP 拦掉 → 取色/高亮在那类文档里不生效（现代 Chromium 对经 CSSOM 设的 style 属性同样按
// style-src 约束，实测推翻了旧 KTD2「CSSOM 不受 CSP 管」的假设）。绝大多数本地 HTML 无此 CSP，取色正常。
// 不改 class+注入样式表绕开：那样存盘后离开注入样式表颜色会丢，inline 才能随文件持久化。
test('取色：选区→CSSOM span、getComputedStyle 真渲染该色（回归保护）', async () => {
  await launch();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><p id="m">给我上色</p></body></html>');
  await frame.locator('#m').click();
  await frame.locator('#m').selectText();
  await frame.locator('.ws-fmtbar [title="文字色"]').click();
  await frame.locator('.ws-fmtbar-swatches .ws-fmtbar-swatch').nth(1).click(); // 第二个色 = #d93025
  await page.waitForTimeout(200);
  // span 存在 + 真画出该色（若有人把取色改坏/改回被 CSP 丢的写法 → computed 变默认色 → 红）
  expect(await frame.locator('#m span').count()).toBeGreaterThan(0);
  const color = await frame.locator('#m span').first().evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe('rgb(217, 48, 37)');
  // 真 JS 错误才算（排除 Playwright 在 no-allow-scripts 沙箱 iframe 里执行脚本被挡的良性提示——
  // 那正是沙箱安全在生效，fidelity.spec 已专门验证脚本被挡）
  const real = errs.filter((t) => !/sandboxed and the 'allow-scripts'|blocked script execution|content security policy/i.test(t));
  expect(real, real.join('\n')).toEqual([]);
});

// 用户亲手抓到的两个 bug 的永久回归门：① 选文字后气泡不能闪退（点选的尾随 click 不能折叠选区）；
// ② 改完格式后气泡要粘住、不马上关。用真 shift+点击造选区（触发尾随 click = bug 路径），不用合成 selectText。
test('格式气泡：拖选不闪退 + 改完粘住（bug 回归门）', async () => {
  await launch();
  await openDoc(SIMPLE);
  const barVis = () => frame.locator('body').evaluate((bd) => { const x = bd.ownerDocument.querySelector('.ws-fmtbar'); return !!x && getComputedStyle(x).display !== 'none'; });
  const b = await frame.locator('#p1').boundingBox();
  const y = b.y + b.height / 2;
  await page.mouse.click(b.x + 6, y); await page.waitForTimeout(80);              // 真点击进编辑
  await page.keyboard.down('Shift'); await page.mouse.click(b.x + b.width * 0.6, y); await page.keyboard.up('Shift'); // shift+点击扩选（尾随 click）
  await page.waitForTimeout(150);
  const sel = await frame.locator('body').evaluate((bd) => { const s = bd.ownerDocument.getSelection(); return { collapsed: s.isCollapsed, t: s.toString().length }; });
  expect(sel.collapsed, '选区被尾随 click 折叠了(bug1 回归)').toBe(false);
  expect(await barVis(), '选区后格式气泡未显示/闪退(bug1 回归)').toBe(true);
  await frame.locator('.ws-fmtbar [title="加粗"]').click(); await page.waitForTimeout(120);
  expect(await htmlOf('p1')).toMatch(/<(b|strong)>/i);
  expect(await barVis(), '改完格式气泡马上关了(bug2 回归)').toBe(true);
});

// 位移回归门：点进块编辑时，正文不能往右平移（高亮只能用 box-shadow/bg，不能用 padding/margin）。
// 量的是文字位置（range rect），不是元素 border 盒——padding 推文字、但 border 盒 left 不变，量盒量不出来。
test('编辑块不让正文位移（issue 回归门）', async () => {
  await launch();
  await openDoc(SIMPLE);
  const textLeft = () => frame.locator('#p1').evaluate((e) => { const r = e.ownerDocument.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().left; });
  const before = await textLeft();
  const b = await frame.locator('#p1').boundingBox();
  await page.mouse.click(b.x + 20, b.y + b.height / 2); // 真点击进编辑
  await page.waitForTimeout(150);
  const after = await textLeft();
  expect(Math.abs(after - before), `文字位移了 ${(after - before).toFixed(1)}px`).toBeLessThanOrEqual(1);
});

// 整篇内容包在一个居中/限宽的容器 <div> 里（绝大多数「像样」文档的写法）。修复前 <body> 底下只有这一个
// 子元素 → 整篇塌成单个不可编辑块，点哪都进不去（Wendi 拿真模板实测翻车）。修复=穿透包裹容器找真块根。
const WRAPPED = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>
<style>*{box-sizing:border-box;margin:0;padding:0}.wrap{max-width:760px;margin:0 auto;padding:96px 32px}</style></head>
<body><div class="wrap">
<h1 id="t">[文档标题]</h1>
<p id="lead">导言段落。</p>
<h2 id="h2a">章节一</h2>
<p id="p1">第一段正文。</p>
<ul><li id="li1">要点</li></ul>
<table><tbody><tr><td id="cell">单元</td></tr></tbody></table>
<h4 id="h4a">A1 小项</h4>
<p id="p2">小项正文。</p>
</div></body></html>`;

test('回归：整篇包在 <div class="wrap"> 里仍能逐块编辑（Wendi 文件根因）', async () => {
  await launch();
  await openDoc(WRAPPED);
  // 点包裹容器内的段落 → 直接进编辑态（修复前：整篇=一个灰选中的不可编辑块，进不去）
  await frame.locator('#p1').click();
  await expect(frame.locator('[data-ws2-editing]')).toHaveCount(1);
  // 编辑态落在被点的那个 <p> 上，证明块根穿透到了 .wrap、而不是把整篇当一块
  expect(await frame.locator('[data-ws2-editing]').evaluate((e) => e.id)).toBe('p1');
  // 容器内的 h4 子项也可编辑（h4 在 TEXT_EDITABLE_TAGS）
  await clearUI();
  await frame.locator('#h4a').click();
  expect(await frame.locator('[data-ws2-editing]').evaluate((e) => e.id)).toBe('h4a');
  // 打字真的落进被点的块
  await clearUI();
  await frame.locator('#p2').click();
  await page.keyboard.type('改了');
  await page.waitForTimeout(120);
  expect(await htmlOf('p2')).toContain('改了');
  // 存盘保真：包裹容器及其样式原样保留，没被塌平
  const out = await serialize();
  expect(out).toContain('class="wrap"');
  expect(out).toContain('max-width:760px');
  expect(out).toContain('改了');
});

// Bug3 回归门（Wendi）：文件名一长，顶栏面包屑会顶到右上角绝对定位的「保存」按钮上、把它切成两半。
// 修复=面包屑 nowrap+ellipsis 截断 + doc-header 右侧给按钮留位。窄窗 + 长文件名下断言：不重叠、不撑高。
test('回归：长文件名不顶到保存按钮、不撑高顶栏（Bug3）', async () => {
  await launch();
  await page.setViewportSize({ width: 760, height: 700 }); // 窄窗放大碰撞
  const longName = '这是一个相当长的中文文档文件名用来回归顶栏文件名过长与保存按钮重叠的布局问题测试.html';
  const docPath = path.join(tmpDir, longName);
  await fs.writeFile(docPath, '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><h1>标题</h1><p>正文。</p></body></html>', 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, docPath);
  // 顶栏在父 renderer（不在 iframe）：等文档头露出、文件名填上
  await page.waitForFunction(() => { const n = document.getElementById('doc-name'); return n && n.textContent.trim().length > 0; }, { timeout: 5000 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const crumb = document.getElementById('doc-name'); const save = document.getElementById('save-btn');
    const a = crumb.getBoundingClientRect(); const b = save.getBoundingClientRect();
    return { overlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top, crumbH: a.height, truncated: crumb.scrollWidth > crumb.clientWidth + 1 };
  });
  expect(m.overlap, '长文件名与保存按钮重叠（Bug3 回归）').toBe(false);
  expect(m.crumbH, '文件名换行撑高了顶栏').toBeLessThanOrEqual(22);
  expect(m.truncated, '窄窗长文件名应被省略号截断').toBe(true);
});

// Bug1 回归门（Wendi）：内层包裹 div（自己没直接文字、只裹 <p>）此前被当 designed 整块、点不进去编辑。
// v0.3.1 修的是最外层包裹；这是夹在兄弟块里的内层透明内容容器（<div class="lead"><p>…</p></div>）。
const INNER_WRAP = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>价值观</title></head>
<body><div class="wrap">
<h1 id="t">价值观</h1>
<div class="lead" id="lead"><p id="leadp">这是一段导言，应当可以直接编辑。</p></div>
<p id="body1">正文一段。</p>
<div><table id="tb"><tbody><tr><td>结构块</td></tr></tbody></table></div>
</div></body></html>`;

test('回归：内层包裹 div（div.lead>p）里的文字可编辑、含表格的结构 div 仍不可（Wendi Bug1）', async () => {
  await launch();
  await openDoc(INNER_WRAP);
  // 点 lead 里的文字 → 进编辑态（修复前：div.lead 整块灰选、进不去）
  await frame.locator('#leadp').click();
  await expect(frame.locator('[data-ws2-editing]')).toHaveCount(1);
  expect(await frame.locator('[data-ws2-editing]').evaluate((e) => e.className)).toContain('lead');
  // 打字真的落进文档（内层 p）
  await page.keyboard.type('改了');
  await page.waitForTimeout(120);
  expect(await htmlOf('lead')).toContain('改了');
  // 存盘保真：lead 容器 + 内层 p 保留、无编辑器 marker 泄漏
  const out = await serialize();
  expect(out).toContain('class="lead"');
  expect(out).not.toMatch(/data-ws2-/);
  expect(out).toContain('改了');
  // 含 <table> 的结构 div 仍是不可编辑 designed 块（点它进不了编辑、是整块灰选）
  await clearUI();
  await frame.locator('#tb').click({ force: true });
  await page.waitForTimeout(120);
  expect(await frame.locator('[data-ws2-editing]').count(), '含表格的结构 div 不该变成可编辑').toBe(0);
  // h1 仍可编辑（没误伤）
  await clearUI();
  await frame.locator('#t').click();
  expect(await frame.locator('[data-ws2-editing]').evaluate((e) => e.id)).toBe('t');
});

// Bug2 功能门（Wendi）：用 Claude 等外部工具改完磁盘文件后，app 自动重载渲染。
const OLD_DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="m">旧内容OLD标记</p></body></html>';
const NEW_DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><h1 id="h">外部改了</h1><p id="m">新内容NEW标记</p></body></html>';

test('功能：外部改动磁盘文件后自动重载渲染（Bug2，无未保存改动）', async () => {
  await launch();
  const docPath = await openDoc(OLD_DOC);
  await expect(frame.locator('body')).toContainText('旧内容OLD标记');
  // 模拟外部工具（Claude）直接改盘——不经 app 的保存通道
  await fs.writeFile(docPath, NEW_DOC, 'utf8');
  // watcher 去抖 + doc-changed + 重导航 → 应自动显示新内容
  await expect(frame.locator('body')).toContainText('新内容NEW标记', { timeout: 5000 });
  expect(await frame.locator('body').textContent()).not.toContain('旧内容OLD标记');
  expect(await frame.locator('#h').textContent()).toBe('外部改了'); // 新增的块也在
});

test('功能：有未保存改动时外部改动先征求确认、拒绝则不重载（Bug2 脏态守卫）', async () => {
  await launch();
  const docPath = await openDoc(OLD_DOC);
  // 编辑使其变脏
  await frame.locator('#m').click();
  await page.keyboard.type('我的编辑');
  await page.waitForTimeout(150);
  // 用户拒绝重载（保留自己的改动）；记录 confirm 是否真被问到——强断言，删掉 onDocChanged 就会是 0 → 红
  await page.evaluate(() => { window.__confirmCount = 0; window.confirm = () => { window.__confirmCount++; return false; }; });
  await fs.writeFile(docPath, NEW_DOC, 'utf8');
  await page.waitForTimeout(1500);
  // watcher 确实触发了、脏态守卫确实弹了 confirm（否则「没重载」可能只是 watcher 根本没 fire 的假绿）
  expect(await page.evaluate(() => window.__confirmCount), 'doc-changed 未触发或脏态守卫没问 confirm（假绿）').toBeGreaterThanOrEqual(1);
  // 没有重载：自己的编辑还在、外部新内容没盖进来
  expect(await frame.locator('#m').textContent()).toContain('我的编辑');
  expect(await frame.locator('body').textContent()).not.toContain('新内容NEW标记');
});

test('功能：app 自己保存不触发外部重载（Bug2 自存盘抑制，否则每次保存都闪一下丢光标）', async () => {
  await launch();
  await openDoc(OLD_DOC);
  await frame.locator('#m').click();
  await page.keyboard.type('改一下');
  await page.waitForTimeout(150);
  await expect(frame.locator('[data-ws2-editing]')).toHaveCount(1); // 处于编辑态
  // 走菜单保存（不抢 iframe 焦点）：写盘会触发目录 watcher，但自存盘应被抑制、不重载
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  await page.waitForTimeout(1500);
  // 若自存盘没被抑制 → doc-changed → 重载 → 编辑态被清空（count=0）。抑制生效则仍在编辑态。
  expect(await frame.locator('[data-ws2-editing]').count(), '自存盘触发了重载（编辑态被清）').toBe(1);
  expect(await frame.locator('#m').textContent()).toContain('改一下');
});

// Bug4/5/6 回归门（Wendi）：鼠标拖出来的「跨块 / 无编辑态」选区，原生删不掉（选区横跨多个各自独立的
// contenteditable 块、或没有 contenteditable 宿主）→ 用户只能一字一字删。真鼠标拖拽在 Playwright+iframe
// 里会触发原生拖拽循环卡死、自动化不了，所以用程序化设选区还原「拖完的选区状态」，再驱动 Backspace/Cmd+X。
// 先 click 聚焦 iframe（模拟拖拽 mouseup 的聚焦），keydown 才会路由到编辑器的 onKeyDown。
const DEL_DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="p1">AAA111</p><p id="p2">BBB222</p><p id="p3">CCC</p></body></html>';
const layoutOf = () => frame.locator('body').evaluate(() => [...document.body.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui')).map((c) => c.tagName + ':' + (c.textContent || '').trim()));
// 设跨块选区并等它真就位（非折叠）——click→进编辑 是异步的，直接按键会和选区设置竞态（CI 慢更易踩）。
async function setCrossSel(a, b, c, d) {
  await frame.locator('body').evaluate((body, [a, b, c, d]) => {
    const r = document.createRange(); r.setStart(document.getElementById(a).firstChild, b); r.setEnd(document.getElementById(c).firstChild, d);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  }, [a, b, c, d]);
  await frame.locator('body').evaluate(() => new Promise((res) => {
    let n = 0; const chk = () => { const s = document.getSelection(); if (s && s.rangeCount && !s.isCollapsed) res(); else if (n++ > 90) res(); else requestAnimationFrame(chk); }; chk();
  }));
}

test('回归：跨块选区 Backspace 能删并合并（Wendi Bug4/5）', async () => {
  await launch();
  await openDoc(DEL_DOC);
  await frame.locator('#p1').click();          // 聚焦 iframe（模拟拖拽 mouseup）
  await setCrossSel('p1', 3, 'p2', 3);          // 选 "111"+换行+"BBB"（跨 p1/p2）
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await layoutOf()).join('|')).toBe('P:AAA222|P:CCC'); // 起末裁剪+合并；p3 留
});

test('回归：跨块 Cmd+X 剪切——删除 + 复制进剪贴板（Wendi Bug6）', async () => {
  await launch();
  await openDoc(DEL_DOC);
  await app.evaluate(({ clipboard }) => clipboard.writeText('__sentinel__'));
  await frame.locator('#p1').click();
  await setCrossSel('p1', 3, 'p2', 3);
  await page.keyboard.press('Meta+x');
  await expect.poll(async () => (await layoutOf()).join('|'), { message: '跨块剪切没删掉选区' }).toBe('P:AAA222|P:CCC');
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(clip, '剪切没把内容写进剪贴板').not.toBe('__sentinel__');
  expect(clip).toContain('111');
});

// 跨块拖选顺滑（去掉「选区被钉死在单块里」那道墙）的配套门：拖选出来的是「无编辑态的跨块选区」，
// 它必须能弹格式气泡、且气泡上的操作（加粗等）对跨块生效——否则跨块选完没法格式化。
// 注：真拖拽手势自动化不了（会卡死测试框架），这里用程序化设「无编辑态跨块选区」验收尾逻辑（气泡+格式）。
test('回归：无编辑态跨块选区弹气泡、且跨块加粗生效（拖选顺滑配套）', async () => {
  await launch();
  await openDoc(DEL_DOC);
  // 不 click 进编辑（editingEl=null）→ 程序化设跨块选区 → selectionchange → 气泡分支④
  await frame.locator('body').evaluate(() => {
    const r = document.createRange(); r.setStart(document.getElementById('p1').firstChild, 1); r.setEnd(document.getElementById('p2').firstChild, 2);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(200);
  const st = await frame.locator('body').evaluate(() => {
    const bar = document.querySelector('.ws-fmtbar');
    return { editing: !!document.querySelector('[data-ws2-editing]'), barVisible: !!bar && getComputedStyle(bar).display !== 'none' };
  });
  expect(st.editing, '应是无编辑态 homeless 选区').toBe(false);
  expect(st.barVisible, 'homeless 跨块选区没弹气泡（分支④失效）').toBe(true);
  await frame.locator('.ws-fmtbar [title="加粗"]').click(); await page.waitForTimeout(150);
  expect(await frame.locator('body').evaluate(() => document.querySelectorAll('b,strong').length > 0), '跨块加粗没生效').toBe(true);
});

// ===== Wendi Bug8：块边界的左右方向键跨块（原生光标被各块各自的 contenteditable 钉死，跨不过去）=====
test('回归：块末按→进下一块、块首按←进上一块（Wendi Bug8 跨块光标）', async () => {
  await launch();
  await openDoc(DEL_DOC); // p1 AAA111 / p2 BBB222 / p3 CCC
  // 块末按 → 进下一块
  await frame.locator('#p2').click(); await page.waitForTimeout(120);
  await setCaret('p2', 6); // "BBB222" 末尾
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => await editingId(), { message: '块末按→没进下一块（Bug8）' }).toBe('p3');
  // 块首按 ← 进上一块
  await frame.locator('#p2').click(); await page.waitForTimeout(120);
  await setCaret('p2', 0);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => await editingId(), { message: '块首按←没进上一块（Bug8）' }).toBe('p1');
});

// ===== Wendi Bug7：换段/合并段（在一个 block 里换行 vs 新建 block）=====
test('回归：段落中间按 Enter 劈成两个同类型块、不产生嵌套 <p>（Bug7 换段）', async () => {
  await launch();
  await openDoc(DEL_DOC);
  const before = await blockCount();
  await frame.locator('#p2').click(); await page.waitForTimeout(120);
  await setCaret('p2', 3); // "BBB|222"
  await page.keyboard.press('Enter');
  await expect.poll(async () => await blockCount(), { message: '中间回车没劈块' }).toBe(before + 1);
  expect((await layoutOf()).join('|'), '劈块内容/顺序不对').toBe('P:AAA111|P:BBB|P:222|P:CCC');
  const html = await serialize();
  expect(html, '劈块产生了嵌套 <p>（原生回车的坏行为）').not.toMatch(/<p[^>]*>[^<]*<p[\s>]/i);
});

test('回归：块末按 Delete 把下一段并入当前（Bug7 前向合并）', async () => {
  await launch();
  await openDoc(DEL_DOC);
  const before = await blockCount();
  await frame.locator('#p1').click(); await page.waitForTimeout(120);
  await setCaret('p1', 6); // "AAA111" 末尾
  await page.keyboard.press('Delete');
  await expect.poll(async () => await blockCount(), { message: '块末 Delete 没合并下一段' }).toBe(before - 1);
  expect((await layoutOf()).join('|'), 'p2 应并入 p1 末尾').toBe('P:AAA111BBB222|P:CCC');
});

test('回归：Shift+Enter 软换行（块内 <br>、不新建块）+ 段末 Enter 新建块（Bug7 对照）', async () => {
  await launch();
  await openDoc(DEL_DOC);
  let before = await blockCount();
  await frame.locator('#p1').click(); await page.waitForTimeout(120);
  await setCaret('p1', 3);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(120);
  expect(await blockCount(), 'Shift+Enter 不应新建块').toBe(before);
  expect(await htmlOf('p1'), 'Shift+Enter 应插入 <br>').toMatch(/<br>/i);
  before = await blockCount();
  await frame.locator('#p3').click(); await page.waitForTimeout(120);
  await setCaret('p3', 3); // "CCC" 末尾
  await page.keyboard.press('Enter');
  await expect.poll(async () => await blockCount(), { message: '段末 Enter 应新建块' }).toBe(before + 1);
});

const STYLED = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
  + '<h2 id="h" class="lead">大标题文字</h2><p id="b">前<b>加粗</b>后</p></body></html>';
test('回归：劈块保留标签+class，且劈在行内标签里两边都不丢格式（Bug7）', async () => {
  await launch();
  await openDoc(STYLED);
  // 劈标题中间 → 两个 H2、都带 class="lead"
  await frame.locator('#h').click(); await page.waitForTimeout(120);
  await setCaret('h', 2); // "大标|题文字"
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const headings = await frame.locator('body').evaluate(() =>
    [...document.body.children].filter((c) => c.tagName === 'H2').map((c) => (c.className || '') + ':' + c.textContent));
  expect(headings, '标题劈块应得两个 H2、都带 class=lead').toEqual(['lead:大标', 'lead:题文字']);
  // 劈在 <b> 内部 → 两个块各自仍含 <b>（extractContents 正确劈开行内标签）
  await frame.locator('#b').click(); await page.waitForTimeout(120);
  await frame.locator('body').evaluate(() => {
    const bb = document.getElementById('b').querySelector('b');
    const r = document.createRange(); r.setStart(bb.firstChild, 1); r.collapse(true); // "加|粗"
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const withB = await frame.locator('body').evaluate(() =>
    [...document.body.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui') && c.querySelector && c.querySelector('b')).length);
  expect(withB, '在 <b> 里劈块后两边都该保留 <b>').toBe(2);
});

// ===== 对抗验证暴露的边界（A/B/C 组）回归门 =====
// 透明包裹块 div.lead>p 跟普通块当兄弟（pickBlockRoot 不下钻 → 它是顶层块）；合并它会平搬块级子节点 → 非法嵌套。
const WRAP_MERGE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
  + '<p id="a">First</p><div class="lead"><p id="inner">Inner</p></div><p id="c">Last</p></body></html>';

test('回归(A)：透明包裹块参与合并被拒、不写出 <p><p>/容器直挂裸文本（前向 Delete + 块首 Backspace）', async () => {
  await launch();
  await openDoc(WRAP_MERGE);
  // 前向：p#a 末尾按 Delete，下一块是 div.lead（包裹块）→ 拒绝合并、不破坏
  await frame.locator('#a').click(); await page.waitForTimeout(120);
  await setCaret('a', 5); // "First" 末尾
  await page.keyboard.press('Delete');
  await page.waitForTimeout(120);
  expect(await blockCount(), '不该把包裹块合并掉').toBe(3);
  let html = await serialize();
  expect(html, '产生了 <p> 套 <p> 非法嵌套').not.toMatch(/<p[^>]*>[^<]*<p[\s>]/i);
  expect(html, 'div.lead 内层 <p> 被破坏').toMatch(/<div class="lead"><p[^>]*>Inner<\/p><\/div>/);
  // 块首：p#c 块首按 Backspace，上一块是 div.lead（包裹块）→ 拒绝合并、不破坏
  await frame.locator('#c').click(); await page.waitForTimeout(120);
  await setCaret('c', 0);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  expect(await blockCount(), 'Backspace 不该把包裹块合并掉').toBe(3);
  html = await serialize();
  expect(html, 'Backspace 产生了非法嵌套/裸文本').not.toMatch(/<p[^>]*>[^<]*<p[\s>]/i);
  expect(html).toMatch(/<div class="lead"><p[^>]*>Inner<\/p><\/div>/);
});

const WRAP_ID = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
  + '<h1 id="t">标题</h1><div class="lead"><p id="inner">大标题文字</p></div></body></html>';
test('回归(A)：劈透明包裹块时后块剥 id、不产生重复 id', async () => {
  await launch();
  await openDoc(WRAP_ID);
  await frame.locator('#inner').click(); await page.waitForTimeout(120); // editingEl=div.lead，光标下钻进内层 p
  await setCaret('inner', 2); // "大标|题文字"
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const idCount = await frame.locator('body').evaluate(() => document.querySelectorAll('[id="inner"]').length);
  expect(idCount, '劈块后出现重复 id=inner').toBe(1);
  const html = await serialize();
  expect(html, '存盘含重复 id').not.toMatch(/id="inner"[\s\S]*id="inner"/);
});

const TRAIL = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
  + '<p id="a">Hello   </p><p id="b">World</p></body></html>';
test('回归(B)：尾随空格时段内 Delete/→ 不误判块末、不跨块吞并/跳块', async () => {
  await launch();
  await openDoc(TRAIL);
  // → 在「Hello」后（右边还有 3 空格）：应交原生在块内移光标，不跳到下一块
  await frame.locator('#a').click(); await page.waitForTimeout(120);
  await setCaret('a', 5);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  expect(await editingId(), '尾随空格被误判块末、→ 越界跳块').toBe('a');
  // Delete 同理：应交原生删一个空格，不把下一段吞进来
  await frame.locator('#a').click(); await page.waitForTimeout(120);
  await setCaret('a', 5);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(120);
  expect(await blockCount(), '尾随空格被误判块末、Delete 误合并下一段').toBe(2);
  expect(await editingId()).toBe('a');
});

test('回归(C)：Cmd+→/Cmd+← 不被跨块逻辑吞掉（带修饰键交原生、不跳块）', async () => {
  await launch();
  await openDoc(DEL_DOC); // p1/p2/p3
  await frame.locator('#p2').click(); await page.waitForTimeout(120);
  await setCaret('p2', 6); // 块末
  await page.keyboard.press('Meta+ArrowRight'); // mac 行尾 / 别的平台无操作——都不该跨块
  await page.waitForTimeout(120);
  expect(await editingId(), 'Cmd+→ 被误当跨块跳转').toBe('p2');
  await setCaret('p2', 0); // 块首
  await page.keyboard.press('Meta+ArrowLeft');
  await page.waitForTimeout(120);
  expect(await editingId(), 'Cmd+← 被误当跨块跳转').toBe('p2');
});

// 保存正向反馈（Lucinda 反馈）：脏态「● 未保存」→ 保存成功原地闪「✓ 已保存」→ ~1.6s 后淡出隐藏。
// dirty-dot 在父层 shell（不在 iframe），用 page.locator。
test('保存成功原地闪「✓ 已保存」确认、随后淡出（Lucinda 反馈）', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click(); await page.keyboard.type('改一下');
  await page.waitForTimeout(150);
  await expect(page.locator('#dirty-dot'), '改动后应显示未保存').toContainText('未保存');
  await page.locator('#save-btn').click();
  await expect(page.locator('#dirty-dot'), '保存成功应闪「已保存」').toContainText('已保存');
  await expect(page.locator('#save-btn'), '保存后按钮应禁用').toBeDisabled();
  await expect(page.locator('#dirty-dot'), '「已保存」应在 ~1.6s 后淡出隐藏').toBeHidden({ timeout: 3500 });
});

// 文档视图缩放（Lucinda 反馈：触控板捏合放大）：捏合（ctrl+wheel）几何放大 body 内容；放大后坐标自洽
// （点击/打字仍落对块）；经 adoptedStyleSheets 注入、不写进存盘；Cmd+0 复位。
test('文档视图缩放：捏合放大 + 放大后仍正确编辑 + 不写盘 + Cmd+0 复位（Lucinda 反馈）', async () => {
  await launch();
  await openDoc(SIMPLE); // h1#t p1 p2 p3 q
  await frame.locator('#p2').click(); await page.waitForTimeout(100); // 聚焦 iframe
  // 验放大用 height 不用 width：§0 删 canvas max-width 后块全宽充满 viewport，width 在 body{zoom} 下恒等
  // viewport（测不出 zoom，是假门）；height 由内容驱动、随 zoom 真实 ×factor，是可靠证据。
  const h0 = await frame.locator('#p2').evaluate((e) => e.getBoundingClientRect().height);
  // 捏合放大：Chromium 把捏合映射成带 ctrlKey 的 wheel，deltaY<0 = 放大
  await frame.locator('body').evaluate((b) => b.ownerDocument.dispatchEvent(
    new WheelEvent('wheel', { ctrlKey: true, deltaY: -50, bubbles: true, cancelable: true })));
  await page.waitForTimeout(150);
  const h1 = await frame.locator('#p2').evaluate((e) => e.getBoundingClientRect().height);
  expect(h1 / h0, '捏合后内容没放大').toBeGreaterThan(1.3); // -50 → ×1.5
  // 放大后坐标自洽：点别的块仍正确进编辑、打字落对块
  await frame.locator('#p1').click();
  await page.keyboard.type('缩放测试');
  await page.waitForTimeout(120);
  expect(await frame.locator('#p1').evaluate((e) => e.textContent), '放大后打字落错块').toContain('缩放测试');
  // 保真：缩放经构造样式表、不进序列化，存盘 HTML 不含 zoom
  expect(await serialize(), '缩放泄漏进了存盘 HTML').not.toMatch(/zoom/i);
  // Cmd+0 复位 100%
  await frame.locator('#p2').click();
  await page.keyboard.press('Meta+0');
  await page.waitForTimeout(150);
  const h2 = await frame.locator('#p2').evaluate((e) => e.getBoundingClientRect().height);
  expect(Math.abs(h2 / h0 - 1), 'Cmd+0 没复位到 100%').toBeLessThan(0.1);
});

// ===== 对抗验证暴露的缩放/保存反馈边界（A/B/C/D/E）回归门 =====
const NOZOOM = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="p1">同一段</p></body></html>';
const USERZOOM = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title><style>body{zoom:1.5}</style></head><body><p id="p1">同一段</p></body></html>';
test('回归(缩放A)：不覆盖用户文档自带的 body{zoom}（factor=1 写空规则、渲染保真）', async () => {
  await launch();
  await openDoc(NOZOOM);
  await page.waitForTimeout(120);
  const h0 = await frame.locator('#p1').evaluate((e) => e.getBoundingClientRect().height); // 用 height：全宽块 width 在 zoom 下恒等 viewport（见捏合放大测试注释）
  await openDoc(USERZOOM); // 自带 body{zoom:1.5}，我们没主动缩放（factor=1）→ 应保留用户的 1.5
  await page.waitForTimeout(150);
  const h1 = await frame.locator('#p1').evaluate((e) => e.getBoundingClientRect().height);
  expect(h1 / h0, '用户自带 body{zoom:1.5} 被 factor=1 的 body{zoom:1} 压平了').toBeGreaterThan(1.3);
});

test('回归(缩放B)：编辑态缩放后 ⋮⋮ 手柄跟随重定位、不漂在旧坐标', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p2').click(); await page.waitForTimeout(120); // 编辑态，手柄定到 p2
  await frame.locator('body').evaluate((b) => b.ownerDocument.dispatchEvent(
    new WheelEvent('wheel', { ctrlKey: true, deltaY: -40, bubbles: true, cancelable: true })));
  // 轮询等手柄重定位稳定（满负载下 wheel→reposition 可能晚于一次固定等待，用 poll 去 flake）
  await expect.poll(async () => frame.locator('body').evaluate(() => {
    const g = document.querySelector('.ws-grip'), b = document.getElementById('p2');
    if (!g || !b) return 999;
    return Math.abs(g.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }), { message: '缩放后手柄没跟随编辑块（reposition 漏了 hoverEl）' }).toBeLessThan(30);
});

test('回归(缩放C)：保存「✓已保存」淡出期间切文档，旧确认不串到新文档', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click(); await page.keyboard.type('改'); await page.waitForTimeout(120);
  await page.locator('#save-btn').click();
  await expect(page.locator('#dirty-dot')).toContainText('已保存'); // flash 起来了（savedTimer 跑着）
  // 1.6s 内切到另一个文档：新文档没保存过，面包屑不该挂着旧的「✓已保存」
  await openDoc(NOZOOM);
  await page.waitForTimeout(150);
  await expect(page.locator('#dirty-dot'), '旧「✓已保存」串到了新文档').toBeHidden();
});

test('回归(缩放D)：单次大 deltaY（鼠标滚轮）被限幅、不一步砸到最小档', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p2').click(); await page.waitForTimeout(100);
  const w0 = await frame.locator('#p2').evaluate((e) => e.getBoundingClientRect().width);
  const pinch = (dy) => frame.locator('body').evaluate((b, d) => b.ownerDocument.dispatchEvent(
    new WheelEvent('wheel', { ctrlKey: true, deltaY: d, bubbles: true, cancelable: true })), dy);
  await pinch(-50); await pinch(-50); await page.waitForTimeout(120); // 放大到约 ×2.25
  await pinch(200); await page.waitForTimeout(120);                   // 一格大 deltaY 缩小：限幅后约 ×0.5（→约 1.1x），不限会算出负乘子砸到 0.5x 地板
  const w1 = await frame.locator('#p2').evaluate((e) => e.getBoundingClientRect().width);
  expect(w1 / w0, '大 deltaY 没限幅、一步砸到最小档').toBeGreaterThan(0.65); // 地板 0.5x→比值≈0.5；限幅后明显更高
});

test('回归(缩放E)：焦点在父层 shell（非 iframe）时 Cmd+= 仍能缩放', async () => {
  await launch();
  await openDoc(SIMPLE);
  const h0 = await frame.locator('#p2').evaluate((e) => e.getBoundingClientRect().height); // 用 height：全宽块 width 在 zoom 下恒等 viewport（见捏合放大测试注释）
  await page.locator('#open-btn').focus(); // 焦点移出 iframe，到父层按钮
  await page.keyboard.press('Meta+=');
  await page.keyboard.press('Meta+=');
  await page.waitForTimeout(150);
  const h1 = await frame.locator('#p2').evaluate((e) => e.getBoundingClientRect().height);
  expect(h1 / h0, '父层焦点下 Cmd+= 没生效（缩放键没挂父层 window）').toBeGreaterThan(1.05);
});

// 空块连按 Enter 能连续换行：块确实建出来了，但非编辑态空块塌成 0 高 → 空白行全叠在一处、看着「换不了行」。
// 修：给空块 min-height（占一行）。门同时验「块数连增」+「编辑块 Y 每次下移」（后者才是用户看到的症状）。
test('回归：空块连按 Enter 能连续换行（空块占行高、不塌成 0 高）', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click(); await page.keyboard.press('End');
  const edTop = () => frame.locator('body').evaluate(() => {
    const e = document.querySelector('[data-ws2-editing]'); return e ? Math.round(e.getBoundingClientRect().top) : null;
  });
  const before = await blockCount();
  // 编辑块的 Y 每次 Enter 都往下走（空白行能堆叠）——修复前都塌在同一处。
  // 用 poll 等每次 Enter 的效果落地（满负载下 layout 可能晚于固定等待），避免 flake。
  let prev = await edTop();
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press('Enter');
    const last = prev;
    await expect.poll(async () => await edTop(), { message: `第${i}次 Enter 编辑块没下移（空块塌成 0 高？）` }).toBeGreaterThan(last);
    prev = await edTop();
  }
  expect(await blockCount(), '连按 Enter 没连续建块').toBe(before + 3);
});

// 导出 PDF（MVP：连续单页、直印源文件）。WS2_PDF_OUT 已在 launch env 设好（跳过原生保存对话框）。
const PDF_DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>'
  + '<style>body{background:#eef;font-family:serif;padding:40px;color:#123}</style></head><body>'
  + Array.from({ length: 60 }, (_, i) => `<p style="margin:0 0 10px">第 ${i + 1} 段，长文档用来验证连续单页不被切断。</p>`).join('')
  + '</body></html>';
test('导出 PDF：连续单页 + 合法 PDF（MVP 直印源文件）', async () => {
  await launch();
  const docPath = await openDoc(PDF_DOC);
  const res = await page.evaluate((dp) => window.ws2.exportPdf(dp), docPath);
  expect(res && res.ok, '导出没成功：' + JSON.stringify(res)).toBe(true);
  const buf = await fs.readFile(path.join(tmpDir, 'export.pdf'));
  expect(buf.slice(0, 5).toString('latin1'), '不是合法 PDF').toBe('%PDF-');
  expect(buf.length, 'PDF 太小、可能是空的').toBeGreaterThan(1000);
  const s = buf.toString('latin1');
  // 连续单页：长内容也只 1 页（被纸张分页则 /Count > 1）
  expect((s.match(/\/Count\s+(\d+)/) || [])[1], '没印成连续单页').toBe('1');
  // 页高随内容长 → 远超「退到视口高」兜底的固定 842pt（A4_HEIGHT_PX 1123px × 0.75）。
  // 阈值取 1000：稳在 842 兜底之上（仍强力区分「量到内容」vs「退兜底」），又不写死会踩
  // 跨平台字体渲染差异的高数值（CI Linux serif 比 macOS 矮，本 60 段文档实测 ~1467pt）。
  const mediaH = parseFloat((s.match(/\/MediaBox\s*\[[^\]]*?\s([\d.]+)\]/) || [])[1] || '0');
  expect(mediaH, '页高没跟内容走（疑似没量到高/退兜底 842pt）').toBeGreaterThan(1000);
});

// 超长文档（内容高 > Chromium 单页上限 ~200in）：退标准 A4 分页，内容一段不丢，而非钳成一页把底部静默截断。
test('导出 PDF：超长文档退 A4 分页、不静默截断', async () => {
  await launch();
  const LONG = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + Array.from({ length: 800 }, (_, i) => `<p style="margin:0 0 10px">第 ${i + 1} 段</p>`).join('') // ~23000px ≈ 240in > 200in
    + '</body></html>';
  const docPath = await openDoc(LONG);
  const res = await page.evaluate((dp) => window.ws2.exportPdf(dp), docPath);
  expect(res && res.ok, '导出没成功：' + JSON.stringify(res)).toBe(true);
  const buf = await fs.readFile(path.join(tmpDir, 'export.pdf'));
  expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-');
  // 撑不进单页 → 退 A4 分页（多页），而不是钳成一页把底部丢掉
  const count = parseInt((buf.toString('latin1').match(/\/Count\s+(\d+)/) || [])[1] || '0', 10);
  expect(count, '超长文档没退 A4 分页（疑似钳成一页、底部被截断）').toBeGreaterThan(1);
});

// Wordspace 样式（Mode 2）：烤进编辑器排版 → 与「原 HTML 样式」渲染不同；走 UI（点导出按钮→选样式）；临时打印文件清理。
// 真·裸文档（无任何自带样式）：这是「编辑器会套 Notion 排版」的唯一情形——只有这种文档
// Wordspace 样式 ≠ 原样式才成立。自带样式的文档（哪怕裸挂 body）编辑器尊重原样、两种导出相同
// （渲染保真：见 fidelity.spec.js「作者样式不被编辑器排版覆盖」+ docHasAuthorStyles）。
const PDF_BARE_DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
  + Array.from({ length: 60 }, (_, i) => `<p>第 ${i + 1} 段，裸文档，编辑器套排版后与直印源文件不同。</p>`).join('')
  + '</body></html>';
test('导出 PDF（Wordspace 样式）：烤进编辑器排版、与原样式不同、临时文件清理', async () => {
  await launch();
  const docPath = await openDoc(PDF_BARE_DOC); // 真·裸文档：编辑器会套 820 居中栏/字体 → 两种样式必然不同
  // 先 raw 导出（直接 IPC）
  const rawRes = await page.evaluate((dp) => window.ws2.exportPdf(dp, 'raw', null), docPath);
  expect(rawRes && rawRes.ok, 'raw 导出失败：' + JSON.stringify(rawRes)).toBe(true);
  const rawBuf = await fs.readFile(path.join(tmpDir, 'export.pdf'));
  // 再走 UI：点导出按钮直接导出 Wordspace 样式（覆盖同一输出路径）
  await page.click('#export-btn'); // 单按钮直接导出 Wordspace 样式（无样式菜单）
  await expect.poll(async () => {
    try { const b = await fs.readFile(path.join(tmpDir, 'export.pdf')); return !b.equals(rawBuf); } catch (e) { return false; }
  }, { message: 'Wordspace 样式没生成、或渲染跟 raw 一样（编辑器排版没烤进去）' }).toBe(true);
  const wsBuf = await fs.readFile(path.join(tmpDir, 'export.pdf'));
  expect(wsBuf.slice(0, 5).toString('latin1'), 'Wordspace 导出不是合法 PDF').toBe('%PDF-');
  // 临时打印文件已清理（源目录无 .ws-export-* 残留）
  const leftover = (await fs.readdir(tmpDir)).filter((f) => f.startsWith('.ws-export-'));
  expect(leftover, '临时打印文件没清理').toEqual([]);
});

// Wordspace 样式 + 文档自带严格 CSP：必须剥掉 CSP，否则内联 EDITOR_CSS 被 style-src 拦 → 样式失效退回原样。
// 验证手段：带 CSP 的裸文档，Wordspace 导出应仍与 raw 不同（= 编辑器排版生效 = CSP 真被剥了）。
const CSP_DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">'
  + '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' file:; style-src \'self\' file:">'
  + '<title>t</title><style>body{padding:5px;font-family:serif;color:#222}</style></head><body>'
  + Array.from({ length: 20 }, (_, i) => `<p>第 ${i + 1} 段，CSP 文档。</p>`).join('') + '</body></html>';
test('导出 PDF（Wordspace 样式）：文档自带严格 CSP 也能套上编辑器排版（CSP 被剥）', async () => {
  await launch();
  const docPath = await openDoc(CSP_DOC);
  const rawRes = await page.evaluate((dp) => window.ws2.exportPdf(dp, 'raw', null), docPath);
  expect(rawRes && rawRes.ok).toBe(true);
  const rawBuf = await fs.readFile(path.join(tmpDir, 'export.pdf'));
  await page.click('#export-btn'); // 单按钮直接导出 Wordspace 样式（无样式菜单）
  await expect.poll(async () => {
    try { const b = await fs.readFile(path.join(tmpDir, 'export.pdf')); return !b.equals(rawBuf); } catch (e) { return false; }
  }, { message: 'CSP 文档 Wordspace 样式没生效（疑似 CSP 没剥、内联 EDITOR_CSS 被拦）' }).toBe(true);
});

// Wordspace 导出前清掉历史残留的临时打印文件（上次 SIGKILL/崩溃跳过 finally 留下的）。
test('导出 PDF（Wordspace 样式）：导出前清掉历史残留临时文件 + 本次也自清', async () => {
  await launch();
  const docPath = await openDoc(PDF_DOC);
  const stale = path.join(tmpDir, '.ws-export-stale-999.html'); // 伪造上次崩溃残留
  await fs.writeFile(stale, '<html>old</html>', 'utf8');
  await page.click('#export-btn'); // 单按钮直接导出 Wordspace 样式（无样式菜单）
  await expect.poll(async () => { try { return (await fs.readFile(path.join(tmpDir, 'export.pdf'))).length > 1000; } catch (e) { return false; } }).toBe(true);
  const leftover = (await fs.readdir(tmpDir)).filter((f) => f.startsWith('.ws-export-'));
  expect(leftover, '历史残留没清 / 本次临时文件没自清').toEqual([]);
});
