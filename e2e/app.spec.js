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
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
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
  await frame.locator('.ws-fmtbar-menu-item', { hasText: '列表' }).click();
  await page.waitForTimeout(200);
  expect(await tagOf('p1')).toBe('UL');
  expect(await htmlOf('p1')).toMatch(/<li>/);
  // 存盘：列表合法（ul 内是 li，没有裸文本直挂 ul）
  const html = await serialize();
  expect(html).not.toMatch(/<ul[^>]*>\s*[^<\s]/); // <ul> 后紧跟非标签文本 = 裸文本，禁止
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
  // 用户拒绝重载（保留自己的改动）
  await page.evaluate(() => { window.confirm = () => false; });
  await fs.writeFile(docPath, NEW_DOC, 'utf8');
  await page.waitForTimeout(1500);
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
