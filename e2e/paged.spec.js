// 分页文档 e2e 真门（断言口径对齐 ui-demo scripts/verify-paged-v4.mjs；CI 用 xvfb 真启动 Electron 跑）：
//  A) 页高统一：全部灰缝（块级 + 块内）纵向间距 ≈ 纸高（A4 竖 1122.5px @96dpi）±4；
//  B) 页界真空带：每条灰缝上下「内容底 → 内容顶」的空隙 ≥ 页底边距+灰缝+页顶边距 − 容差（204px），
//     且无内容元素被页界横穿；
//  C) 编辑稳定（Colin 复现）：点进被推挤 li 正文连按 5 次回车——推挤不累积（推挤痕迹数 == 灰缝数）、
//     无「贼大」空行、A/B 仍全过；
//  D) 磁盘字节零污染（strip-on-persist P0）：编辑 → 自动保存 → 读磁盘原始字节，断言无
//     data-ws-pushed / ws-page-spacer / style 属性里的 padding-top·margin-top，且 reparse 后仍 conform、
//     page 块仍可解析（漏一个推挤样式进盘 = 块级 style = 文档瞬间非合规）；
//  E) 表格：spacer 行数 == 表内页界数；编辑落盘同样零污染；
//  F) 关分页还原：页面设置关掉分页 → 灰缝清空、page 块移除、落盘后磁盘无 @page、仍 conform。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { JSDOM } = require('jsdom');
const registry = require('../src/lib/schema-registry.js');
const schemaPage = require('../src/lib/schema-page.js');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'paged-fixtures');
const PAPER_H = 1122.5; // A4 纵向 297mm @96dpi
const MB = 96, MT = 96, GAP = 24; // normal 边距 25.4mm=96px + 灰缝
const VOID_MIN = MB + GAP + MT - 12; // 内容真空带下限（容差 12px：行距/边框）

let app, page, frame, tmpDir;

test.beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2e2e-paged-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
});
test.afterAll(async () => {
  try { if (app) await app.close(); } catch (e) {}
  try { if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }); } catch (e) {}
});

// fixture 拷进 tmp 再打开（编辑会触发自动保存写盘，绝不能写回仓库里的 fixture）
async function openFixture(name) {
  const src = path.join(FIX, name);
  const dst = path.join(tmpDir, name);
  await fs.copyFile(src, dst);
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, dst);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(900); // 等分页引擎 rAF/RO 收敛
  return dst;
}

// 页界几何（iframe 内实测）：灰缝 rel 顶序列 → 页高 spans；真空带 = 缝上内容底 → 缝下内容顶。
// contentSel = 叶子内容元素选择器（li / tr…）。被推挤元素的 paddingTop 是留白不是内容——内容顶从
// content-box 起算（同 verify-paged-v4 口径）。
const geometry = (contentSel) => frame.locator('body').evaluate((body, sel) => {
  const doc = body.ownerDocument;
  const pr = body.getBoundingClientRect();
  const rel = (v) => +(v - pr.top).toFixed(1);
  const contents = [...doc.querySelectorAll(sel)]
    .filter((e) => !e.closest('.ws-page-spacer') && !e.querySelector(sel)) // 只取叶子内容元素
    .map((e) => {
      const r = e.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(e).paddingTop) || 0;
      return { top: rel(r.top + pad), bottom: rel(r.bottom) };
    });
  const bands = [...doc.querySelectorAll('.ws-page-gutter')].map((g) => {
    const r = g.getBoundingClientRect();
    return { top: rel(r.top), bottom: rel(r.bottom) };
  }).sort((a, b) => a.top - b.top);
  const voids = bands.map((b) => {
    const above = Math.max(0, ...contents.filter((c) => c.bottom <= b.top + 2).map((c) => c.bottom));
    const belows = contents.filter((c) => c.top >= b.bottom - 2).map((c) => c.top);
    const below = belows.length ? Math.min(...belows) : Infinity;
    const crossed = contents.filter((c) => c.top < b.top - 2 && c.bottom > b.bottom + 2).length;
    return { void: +(below - above).toFixed(1), crossed };
  });
  const spans = [];
  let prev = 0;
  for (const b of bands) { spans.push(+(b.top - prev).toFixed(1)); prev = b.top + 24; }
  return { bandCount: bands.length, voids, spans, paperW: +pr.width.toFixed(1), bodyH: +pr.height.toFixed(1) };
}, contentSel);

// 推挤痕迹统计：每个页界恰对应一个推挤（data-ws-pushed 元素或 spacer 节点），1:1 才叫「不累积」。
const pushedStats = () => frame.locator('body').evaluate((body) => {
  const doc = body.ownerDocument;
  const pushed = doc.querySelectorAll('[data-ws-pushed]').length;
  const spacers = doc.querySelectorAll('.ws-page-spacer').length;
  const gutters = doc.querySelectorAll('.ws-page-gutter').length;
  // 「贼大」空行：无内容却超高、且不是被推挤元素（推挤元素的 padding 即留白，允许高）
  const emptyBig = [...doc.querySelectorAll('li')].filter(
    (e) => !(e.textContent || '').trim() && e.getBoundingClientRect().height > 60
      && (parseFloat(getComputedStyle(e).paddingTop) || 0) < 50,
  ).length;
  return { pushed, spacers, gutters, emptyBig };
});

// 点进 iframe 内某元素（视口坐标 = iframe 偏移 + 元素内坐标；先 scrollIntoView 保证在视口内）
async function clickInFrame(selector, dxRatio, dyPx) {
  const box = await frame.locator('body').evaluate((body, sel) => {
    const el = body.ownerDocument.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
    return { left: r.left, top: r.top + pad, width: r.width };
  }, selector);
  if (!box) return false;
  const fr = await page.locator('#doc-frame').boundingBox();
  await page.mouse.click(fr.x + box.left + Math.min(60, box.width * dxRatio), fr.y + box.top + dyPx);
  return true;
}

test('列表：开分页即每页一张纸——页高统一 + 页界真空带 + 无内容被横穿', async () => {
  await openFixture('nested-list.html');
  const g = await geometry('li');
  expect(g.bandCount).toBeGreaterThan(0);
  expect(Math.abs(g.paperW - 794)).toBeLessThan(2); // 纸宽 = A4 794px（引擎纸面接管 baseline 820px）
  for (const v of g.voids) {
    expect(v.void).toBeGreaterThanOrEqual(VOID_MIN); // 页界真空带 ≥ 204px
    expect(v.crossed).toBe(0);                        // 无 li 被页界横穿
  }
  expect(g.spans.length).toBeGreaterThan(1);
  for (const s of g.spans) expect(Math.abs(s - PAPER_H)).toBeLessThan(4); // 页高统一 ±4
});

test('列表：点进被推挤 li 打字 + 连按 5 次回车——推挤不累积、无巨隙、页高仍统一', async () => {
  const clicked = await clickInFrame('li[data-ws-pushed]', 0.3, 10);
  expect(clicked).toBe(true);
  await page.waitForTimeout(250);
  await page.keyboard.press('End');
  await page.keyboard.type('编辑稳定验证');
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(320); }
  await page.waitForTimeout(700);
  const st = await pushedStats();
  expect(st.pushed + st.spacers).toBe(st.gutters); // 推挤痕迹 == 页界数（回车分裂克隆已被扫荡，不累积）
  expect(st.emptyBig).toBe(0);                     // 无「贼大」空行
  const g = await geometry('li');
  for (const v of g.voids) { expect(v.void).toBeGreaterThanOrEqual(VOID_MIN); expect(v.crossed).toBe(0); }
  for (const s of g.spans) expect(Math.abs(s - PAPER_H)).toBeLessThan(4);
});

test('列表：磁盘字节零污染（strip-on-persist P0）——自动保存后 reparse 仍 conform', async () => {
  // 上一个测试已编辑并触发自动保存（1.2s 静默）；再补一次编辑确保最新推挤态之后有落盘
  await page.keyboard.type('落盘前再敲一笔');
  await page.waitForTimeout(2000); // > 1.2s 自动保存窗口
  const raw = await fs.readFile(path.join(tmpDir, 'nested-list.html'), 'utf8');
  expect(raw.includes('data-ws-pushed')).toBe(false);
  expect(raw.includes('ws-page-spacer')).toBe(false);
  expect(/style="[^"]*padding-top/.test(raw)).toBe(false); // 块内推挤 paddingTop 绝不入盘
  expect(/style="[^"]*margin-top/.test(raw)).toBe(false);  // 块级推挤 marginTop 绝不入盘
  expect(raw.includes('编辑稳定验证')).toBe(true);          // 编辑内容真的保存了（不是没存所以干净）
  const r = registry.classify(new JSDOM(raw).window.document);
  expect(r.conform).toBe(true); // 漏推挤样式进盘 = 块级 style = 非合规——这里必须还是 conform
  const m = raw.match(/<style data-ws-schema-css="page">([\s\S]*?)<\/style>/);
  expect(m).toBeTruthy();
  expect(schemaPage.parsePageCss(m[1])).toBeTruthy(); // page 块仍是可解析 canonical
});

test('表格：spacer 行数 == 表内页界数；编辑落盘零污染', async () => {
  const dst = await openFixture('long-table.html');
  const g = await geometry('tr:not(.ws-page-spacer)');
  expect(g.bandCount).toBeGreaterThan(0);
  for (const v of g.voids) { expect(v.void).toBeGreaterThanOrEqual(VOID_MIN); expect(v.crossed).toBe(0); }
  for (const s of g.spans) expect(Math.abs(s - PAPER_H)).toBeLessThan(4);
  const st = await pushedStats();
  const innerBands = await frame.locator('body').evaluate((b) => b.ownerDocument.querySelectorAll('.ws-inner-gutter').length);
  expect(st.spacers).toBe(innerBands); // 表内每个页界恰一根 spacer 行
  // 编辑正文段落触发自动保存（表格单元格编辑走既有块模型，能力差异不算漂移——spec 有意分歧）
  const clicked = await clickInFrame('p', 0.3, 8);
  expect(clicked).toBe(true);
  await page.waitForTimeout(250);
  await page.keyboard.press('End');
  await page.keyboard.type('——表格分页落盘验证');
  await page.waitForTimeout(2000);
  const raw = await fs.readFile(dst, 'utf8');
  expect(raw.includes('ws-page-spacer')).toBe(false);
  expect(raw.includes('data-ws-pushed')).toBe(false);
  expect(/style="[^"]*(padding-top|margin-top)/.test(raw)).toBe(false);
  expect(raw.includes('表格分页落盘验证')).toBe(true);
  expect(registry.classify(new JSDOM(raw).window.document).conform).toBe(true);
});

test('关分页还原：灰缝清空、page 块移除、磁盘无 @page、仍 conform', async () => {
  // 长表格文档还开着。⋯ 菜单 → 页面设置… → 关掉「分页文档」→ 完成
  await page.click('#doc-menu-btn');
  const disabled = await page.locator('#page-setup-btn').isDisabled();
  expect(disabled).toBe(false); // 合规 html → 入口可用
  await page.click('#page-setup-btn');
  await page.click('#pgs-on'); // 取消勾选 = 关分页（改动即时生效）
  await page.waitForTimeout(400);
  await page.click('#pgs-done');
  const state = await frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    return {
      gutters: doc.querySelectorAll('.ws-page-gutter').length,
      overlay: doc.querySelectorAll('.ws-pgn-overlay').length,
      pushed: doc.querySelectorAll('[data-ws-pushed]').length,
      spacers: doc.querySelectorAll('.ws-page-spacer').length,
      pageStyle: doc.querySelectorAll('style[data-ws-schema-css="page"]').length,
      maxW: getComputedStyle(body).maxWidth,
    };
  });
  expect(state.gutters).toBe(0);
  expect(state.overlay).toBe(0);
  expect(state.pushed).toBe(0);
  expect(state.spacers).toBe(0);
  expect(state.pageStyle).toBe(0);
  expect(state.maxW).toBe('820px'); // baseline 版式还原（纸面接管解除）
  await page.waitForTimeout(2000); // markDirty → 自动保存
  const raw = await fs.readFile(path.join(tmpDir, 'long-table.html'), 'utf8');
  expect(raw.includes('@page')).toBe(false);
  expect(raw.includes('data-ws-schema-css="page"')).toBe(false);
  expect(registry.classify(new JSDOM(raw).window.document).conform).toBe(true);
});

// PR-A 拆分核心：Schema 身份随「页面设置」转换在 schema-1(流式) ↔ schema-2(分页) 往返，内容无损。
// 磁盘字节归类只认内容（page 块存在与否），验证转换真的改了身份、且不吞内容。
test('身份往返：分页文档 关分页→schema-1、再开→schema-2，内容无损', async () => {
  const dst = await openFixture('nested-list.html');
  const diskState = async () => {
    const raw = await fs.readFile(dst, 'utf8');
    return { id: registry.classify(new JSDOM(raw).window.document).schemaId, hasTitle: raw.includes('深嵌套列表') };
  };
  // 内存态身份探针：既读 docSchemaId（PR-B/C 路由的载荷变量），又验不变式 schemaId==='schema-2' ⟺ paged。
  // 磁盘态只能证「落盘字节变了」；内存态才能证 routeDoc/applyPageSetup 真把 docSchemaId 设对（否则它是哑变量）。
  const memState = () => page.evaluate(() => window.__ws2DocSchema());
  const assertInvariant = (m) => expect(m.schemaId === 'schema-2').toBe(m.paged);

  let mem = await memState();
  expect(mem.schemaId).toBe('schema-2'); // 打开分页文档 → 内存身份即 schema-2（gate routeDoc 的 docSchemaId 赋值）
  assertInvariant(mem);
  expect((await diskState()).id).toBe('schema-2'); // 磁盘态一致

  // 关分页（页面设置取消勾选）→ 身份翻到流式
  await page.click('#doc-menu-btn');
  await page.click('#page-setup-btn');
  await page.click('#pgs-on');
  await page.waitForTimeout(400);
  await page.click('#pgs-done');
  mem = await memState();
  expect(mem.schemaId).toBe('schema-1'); // 内存身份翻到流式（gate applyPageSetup 的 docSchemaId 同步）
  assertInvariant(mem);                   // 不变式：关分页后 !paged 且 !=schema-2
  await page.waitForTimeout(2000);        // 自动保存
  let s = await diskState();
  expect(s.id).toBe('schema-1');
  expect(s.hasTitle).toBe(true);          // 内容存活

  // 再开分页 → 引擎重挂 + 身份翻回分页
  await page.click('#doc-menu-btn');
  await page.click('#page-setup-btn');
  await page.click('#pgs-on');
  await page.waitForTimeout(400);
  await page.click('#pgs-done');
  const overlay = await frame.locator('body').evaluate((b) => b.ownerDocument.querySelectorAll('.ws-pgn-overlay').length);
  expect(overlay).toBeGreaterThan(0);     // 分页引擎重新挂上
  mem = await memState();
  expect(mem.schemaId).toBe('schema-2');  // 内存身份翻回分页
  assertInvariant(mem);
  await page.waitForTimeout(2000);
  s = await diskState();
  expect(s.id).toBe('schema-2');
  expect(s.hasTitle).toBe(true);
});

// PR-C：页眉/页脚文字（屏显每页画一行 + 几何在边距区 + 转义安全 + 不入盘）。
test('页眉页脚：每页纸顶/纸底画一行、几何在内容之外、编辑落盘只留 meta 不留覆盖层', async () => {
  await openFixture('nested-list.html'); // 多页分页文档
  // 页面设置里填页眉页脚（真用户流程）
  await page.click('#doc-menu-btn');
  await page.click('#page-setup-btn');
  await page.fill('#pgs-header', '公司机密 · 第一版');
  await page.fill('#pgs-footer', '内部资料');
  await page.waitForTimeout(500); // 覆盖层重画
  await page.click('#pgs-done');
  await page.waitForTimeout(400);

  const g = await frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const heads = [...doc.querySelectorAll('.ws-page-header')];
    const foots = [...doc.querySelectorAll('.ws-page-footer')];
    const content = [...doc.querySelectorAll('li')].filter((e) => !e.closest('.ws-page-spacer'));
    const firstContentTop = Math.min(...content.map((e) => e.getBoundingClientRect().top));
    return {
      headCount: heads.length, footCount: foots.length,
      headText: heads[0] ? heads[0].textContent : '', footText: foots[0] ? foots[0].textContent : '',
      // 首页页眉整体在首个内容之上（= 在纸顶边距区、不侵内容）
      headAboveContent: heads[0] ? heads[0].getBoundingClientRect().bottom <= firstContentTop + 1 : false,
    };
  });
  expect(g.headCount).toBeGreaterThan(1);   // 多页 → 多行页眉
  expect(g.footCount).toBe(g.headCount);    // 页眉页脚每页各一
  expect(g.headText).toBe('公司机密 · 第一版');
  expect(g.footText).toBe('内部资料');
  expect(g.headAboveContent).toBe(true);    // 几何：页眉在内容之外（非代理断言）

  // 编辑触发自动保存，读磁盘：meta 在 head、覆盖层元素绝不入盘
  await clickInFrame('li', 0.3, 8);
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.type('落盘验证');
  await page.waitForTimeout(2000);
  const raw = await fs.readFile(path.join(tmpDir, 'nested-list.html'), 'utf8');
  expect(raw.includes('name="ws-page-header"')).toBe(true);   // meta 持久化（下次开重画）
  expect(raw.includes('公司机密')).toBe(true);
  expect(raw.includes('ws-page-hf')).toBe(false);             // 覆盖层元素 strip 掉
  expect(raw.includes('class="ws-page-header"')).toBe(false);
  expect(registry.classify(new JSDOM(raw).window.document).schemaId).toBe('schema-2'); // 仍是分页文档
});

test('页眉转义：输入 <img onerror> → 屏显按字面文本、不生成 img 元素（防注入）', async () => {
  await openFixture('nested-list.html');
  await page.click('#doc-menu-btn');
  await page.click('#page-setup-btn');
  const payload = '<img src=x onerror=alert(1)>';
  await page.fill('#pgs-header', payload);
  await page.waitForTimeout(500);
  await page.click('#pgs-done');
  await page.waitForTimeout(300);
  const r = await frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const h = doc.querySelector('.ws-page-header');
    return { text: h ? h.textContent : '', imgCount: doc.querySelectorAll('.ws-page-header img').length };
  });
  expect(r.text).toBe(payload);   // 按字面文本呈现
  expect(r.imgCount).toBe(0);     // 没有真的生成 <img>（textContent 转义）= 不可注入
  await page.waitForTimeout(2000); // 让自动保存落定，afterAll app.close 不卡在脏文档上
});

// PR-C：分页专属 meta 关分页保留（页码/页眉/页脚三兄弟一致，Word 直觉）。
test('分页 meta 关分页保留：设页眉+页码→关分页→meta 仍在→再开分页 页眉读回来', async () => {
  await openFixture('nested-list.html');
  await page.click('#doc-menu-btn');
  await page.click('#page-setup-btn');
  await page.fill('#pgs-header', '保留测试页眉');
  await page.check('#pgs-nums');
  await page.waitForTimeout(300);
  await page.uncheck('#pgs-on');   // 关分页 → 转回流式
  await page.waitForTimeout(300);
  await page.click('#pgs-done');
  await page.waitForTimeout(300);
  const afterOff = await frame.locator('body').evaluate((b) => {
    const h = b.ownerDocument.head;
    const g = (n) => { const m = h.querySelector('meta[name="' + n + '"]'); return m ? m.getAttribute('content') : null; };
    return { header: g('ws-page-header'), nums: g('ws-page-numbers'), paged: b.ownerDocument.querySelector('style[data-ws-schema-css="page"]') != null };
  });
  expect(afterOff.paged).toBe(false);            // 分页关了（page 块删干净）→ schema-1 流式
  expect(afterOff.header).toBe('保留测试页眉');    // 页眉 meta 保留（不随关分页删）
  expect(afterOff.nums).toBe('true');             // 页码 meta 也保留（三兄弟一致）
  // 再开分页 → 弹窗读回保留的页眉
  await page.click('#doc-menu-btn');
  await page.click('#page-setup-btn');
  await page.check('#pgs-on');
  await page.waitForTimeout(300);
  expect(await page.inputValue('#pgs-header')).toBe('保留测试页眉');
  await page.click('#pgs-done');
  await page.waitForTimeout(2000); // autosave settle（teardown 清爽）
});

// PR-C：页面设置输入框 value= 属性转义（最高权限 sink——渲染层文档；page.fill 绕不到它，专测重开弹窗的属性渲染）。
test('页眉输入框 value= 转义：含 " < & 的页眉重开弹窗读回原样（防属性 breakout 注入）', async () => {
  await openFixture('nested-list.html');
  const tricky = 'a"b<c>d&e';
  await page.click('#doc-menu-btn');
  await page.click('#page-setup-btn');
  await page.fill('#pgs-header', tricky);
  await page.waitForTimeout(300);
  await page.click('#pgs-done');
  await page.waitForTimeout(300);
  // 重开弹窗：输入框从 meta 经 value="escapeHtml(...)" 渲染 → 读回必须完整（属性没被 " 顶破 / < 没注入元素）
  await page.click('#doc-menu-btn');
  await page.click('#page-setup-btn');
  expect(await page.inputValue('#pgs-header')).toBe(tricky);
  const injected = await page.evaluate(() =>
    document.querySelectorAll('.ws-pgs-modal c, .ws-pgs-modal script, .ws-pgs-modal img').length);
  expect(injected).toBe(0); // < 没被解析成元素 = value 属性没破
  await page.click('#pgs-done');
  await page.waitForTimeout(2000); // settle
});
