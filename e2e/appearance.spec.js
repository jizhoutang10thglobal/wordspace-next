// 外观三态验收门（U7）。CI 用 xvfb 真启动 Electron 跑。覆盖三条红线 + 强断言：
//   · chrome 暗色亮度门（AE1）——真 surface 的 computed 背景，不查 class（S4 强断言）
//   · 对比度门——遍历 test/appearance-contrast-pairs.js 对 rendered dark token 跑 WCAG
//   · 文档反色滤镜（AE2/AE3）——iframe html 有 invert、媒体反反色、已暗文档跳过、UI 在滤镜子树内
//   · 零污染（AE4）——深/浅两态同样编辑，磁盘字节完全一致
//   · PDF 恒浅（AE5/R8）——自适暗 + 自分页自适暗 fixture，深色态导出仍浅色
//   · 显式态无视系统（AE6）——机制级断言 themeSource（视觉断言在 CI 恒真=假门）
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { contrastRatio, relativeLuminance } = require('../src/lib/luminance');
const pairs = require('../test/appearance-contrast-pairs');

const ROOT = path.join(__dirname, '..');
let app, page, tmpDir;

async function launch(extraEnv) {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2appearance-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_PDF_OUT: path.join(tmpDir, 'export.pdf'), ...extraEnv },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}
test.afterEach(async () => { if (app) await app.close().catch(() => {}); });

// 走真实入口 setAppearance（→ main applyAppearance → 广播 effective → renderer 挂 data-theme），
// 等 data-theme 落到 documentElement 再继续。只用 light/dark（system 的 effective 依赖 OS，不在 CI 测）。
async function setTheme(pref) {
  await page.evaluate((p) => window.ws2.setAppearance(p), pref);
  await page.waitForFunction((want) => {
    const dt = document.documentElement.getAttribute('data-theme');
    return want === 'dark' ? dt === 'dark' : dt !== 'dark';
  }, pref, { timeout: 4000 });
  await page.waitForTimeout(120);
}
async function openDoc(html) {
  const docPath = path.join(tmpDir, 'doc.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, docPath);
  await expect(page.frameLocator('#doc-frame').locator('body')).toBeVisible();
  await page.waitForTimeout(500);
  return docPath;
}
const cssVar = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const bgOf = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).backgroundColor : null; }, sel);

test('AE1 chrome 暗色亮度门：深色下真 surface 变暗、浅色态变亮（不查 class）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="background:#fff"><p>x</p></body></html>');
  await setTheme('light');
  const bodyLight = relativeLuminance(await bgOf('body'));   // chrome 底(--c-bg-chrome),opaque,token 驱动
  const canvasLight = relativeLuminance(await bgOf('.ws-canvas')); // 编辑区 chrome 底(--c-bg)
  await setTheme('dark');
  const bodyDark = relativeLuminance(await bgOf('body'));
  const canvasDark = relativeLuminance(await bgOf('.ws-canvas'));
  expect(bodyLight, 'body 浅态应亮').toBeGreaterThan(0.8);
  expect(canvasLight, '编辑区浅态应亮').toBeGreaterThan(0.8);
  expect(bodyDark, 'body 深态应暗').toBeLessThan(0.2);
  expect(canvasDark, '编辑区深态应暗').toBeLessThan(0.2);
  expect(bodyDark, '深态必须严格暗于浅态').toBeLessThan(bodyLight);
});

// 解码 Playwright 元素截图（PNG,8-bit,非隔行,colorType 2/6）→ {亮像素占比, 暗像素占比}。
// 强断言不查 CSS filter 字符串（invert(0) 也含 "invert"=哑门,S4），直接看渲染出来的像素。
// logo 背景透明→截图里大片是透出的页脚底色,均值被背景主导没判别力；改数「logo 笔画那批像素」的极性：
// 暗态反相→出现一批亮像素(白笔画+白框)；浅态→一批暗像素(黑笔画+黑框)。
function pngPolarity(buf) {
  const zlib = require('zlib');
  let p = 8, width, height, colorType, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;      // 6=RGBA,2=RGB
  const stride = width * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)], row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const rv = raw[row + x];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[(y - 1) * stride + x - ch] : 0;
      let v;
      if (ft === 0) v = rv; else if (ft === 1) v = rv + a; else if (ft === 2) v = rv + b;
      else if (ft === 3) v = rv + ((a + b) >> 1); else v = rv + paeth(a, b, c);
      out[y * stride + x] = v & 255;
    }
  }
  let max = 0, min = 1, n = 0, f40 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * stride + x * ch;
    const L = relativeLuminance({ r: out[i], g: out[i + 1], b: out[i + 2] });
    if (L > max) max = L; if (L < min) min = L; n++;
    if (L > 0.4) f40++;                 // 明显偏亮的像素占比
  }
  return { max, min, brightFrac: f40 / n };
}

test('页脚 wordmark 暗态反相：像素级——深色下 logo 变亮、浅色下变暗（纯灰度 logo 不至埋进暗底）', async () => {
  // 页脚 wordmark 只在侧栏展开（.sb-on）时可见——先开个工作区。
  const wsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2appearance-ws-'));
  await fs.writeFile(path.join(wsDir, 'a.html'), '<!DOCTYPE html><html><body><p>x</p></body></html>', 'utf8');
  await launch({ WS2_FOLDER_IN: wsDir });
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-foot-logo')).toBeVisible();
  const logoShot = async () => Buffer.from(await page.locator('.sb-foot-logo').screenshot());
  await setTheme('dark');
  await page.waitForTimeout(300);
  const dark = pngPolarity(await logoShot());
  await setTheme('light');
  await page.waitForTimeout(300);
  const light = pngPolarity(await logoShot());
  // 强断言直接看渲染像素（不查 filter 字符串——invert(0) 也含 "invert"=哑门，S4）。
  // 实测（15px logo, opacity .82）：修复 dark max=0.59/brightFrac=0.12；哑门 invert(0) dark max=0.01/brightFrac=0。
  // 暗态：反相把纯黑墨迹翻成亮色 → 必有一批明显偏亮的像素。哑门/删规则时整块埋进暗底 → max~0.01 翻红。
  expect(dark.max, `深态 logo 应有亮像素(墨迹反白),实测 max=${dark.max.toFixed(3)}`).toBeGreaterThan(0.25);
  expect(dark.brightFrac, `深态反白应覆盖可观面积,实测 brightFrac=${dark.brightFrac.toFixed(3)}`).toBeGreaterThan(0.04);
  // 浅态：不该反相 → 墨迹仍是深色（存在暗像素）。若误把规则漏进浅态,墨迹变白 → 无暗像素 → 翻红。
  expect(light.min, `浅态 logo 墨迹应仍为深色(未被误反),实测 min=${light.min.toFixed(3)}`).toBeLessThan(0.15);
});

test('对比度门：暗色 palette 文本×背景配对全部达标（body≥4.5 / large≥3）', async () => {
  await launch();
  await setTheme('dark');
  const THRESH = { body: 4.5, large: 3 };
  const fails = [];
  for (const p of pairs) {
    if (p.level === 'exempt') continue;
    const fg = await cssVar(p.text);
    const bg = await cssVar(p.bg);
    const ratio = contrastRatio(fg, bg);
    if (!(ratio >= THRESH[p.level])) fails.push(`${p.text}(${fg}) on ${p.bg}(${bg}) = ${ratio && ratio.toFixed(2)} < ${THRESH[p.level]}`);
  }
  expect(fails, fails.join('\n')).toEqual([]);
});

const LIGHT_DOC = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="background:#fff;color:#111"><h1 id="h">标题</h1><p id="p">正文一段</p><img id="pic" width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs="></body></html>';
const DARK_DOC = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="background:#101010;color:#eee"><p id="p">本身深色的文档</p></body></html>';
const TRANSPARENT_DOC = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p id="p">不设 body 背景的浅色文档</p></body></html>';

// iframe 内计算：html 的 computed filter + img 的 computed filter
const frameFilter = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = s === ':root' ? d.documentElement : d.querySelector(s);
  return el ? getComputedStyle(el).filter : null;
}, sel);

test('AE2 深色 + 浅色文档：iframe html 有 invert 滤镜、img 反反色', async () => {
  await launch();
  await setTheme('dark');
  await openDoc(LIGHT_DOC);
  const htmlFilter = await frameFilter(':root');
  const imgFilter = await frameFilter('#pic');
  expect(htmlFilter, 'html 应有反色滤镜').toContain('invert');
  expect(imgFilter, 'img 应有反反色滤镜').toContain('invert');
});

test('AE3 深色 + 本身深色的文档：不施滤镜（启发式命中，不二次反转）', async () => {
  await launch();
  await setTheme('dark');
  await openDoc(DARK_DOC);
  const htmlFilter = await frameFilter(':root');
  expect(htmlFilter === 'none' || htmlFilter === '' || htmlFilter == null, '深色文档不该被反色: ' + htmlFilter).toBe(true);
});

test('透明 body 的浅色文档：仍施滤镜（透明=浅色，启发式不误判为已暗）', async () => {
  await launch();
  await setTheme('dark');
  await openDoc(TRANSPARENT_DOC);
  const htmlFilter = await frameFilter(':root');
  expect(htmlFilter, '透明 body 应被判浅色并施滤镜').toContain('invert');
});

test('切回浅色：iframe 滤镜完全摘除（live 切换不重挂）', async () => {
  await launch();
  await setTheme('dark');
  await openDoc(LIGHT_DOC);
  expect(await frameFilter(':root')).toContain('invert');
  await setTheme('light');
  const f = await frameFilter(':root');
  expect(f === 'none' || f === '' || f == null, '切回浅色应无滤镜残留: ' + f).toBe(true);
});

test('AE4 零污染：深/浅两态同样编辑，磁盘字节完全一致', async () => {
  // 固定 doc-id：保存时不再注入随机 UUID（那是与主题无关的非确定性，会以主题之名报假 flake）。
  const EDIT_DOC = '<!DOCTYPE html><html><head><meta name="wordspace-doc-id" content="ae4-fixed-id"><meta charset="utf-8"></head><body style="background:#fff"><p id="p">原文</p></body></html>';
  // 浅色态编辑保存
  await launch();
  await setTheme('light');
  const p1 = await openDoc(EDIT_DOC);
  const frame1 = page.frameLocator('#doc-frame');
  await frame1.locator('#p').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_改_');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  await page.waitForTimeout(500);
  const lightBytes = await fs.readFile(p1, 'utf8');
  await app.close();

  // 深色态同样编辑保存
  await launch();
  await setTheme('dark');
  const p2 = await openDoc(EDIT_DOC);
  const frame2 = page.frameLocator('#doc-frame');
  await frame2.locator('#p').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_改_');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  await page.waitForTimeout(500);
  const darkBytes = await fs.readFile(p2, 'utf8');

  expect(darkBytes, '深色态保存的字节必须与浅色态完全一致（滤镜只显示不入盘）').toBe(lightBytes);
});

test('AE6 显式浅色无视系统：机制级断言 themeSource === light', async () => {
  await launch();
  await page.evaluate(() => window.ws2.setAppearance('light')); // 真实入口
  await page.waitForTimeout(300);
  const src = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
  // ⚠ 机制级断言：CI runner 系统本就浅色，「切 light 后 chrome 仍亮」恒真=假门（S4）。断 themeSource 本身。
  expect(src, '显式选浅色后 themeSource 必须是 light（而非 system，否则系统暗时会跟随=假门）').toBe('light');
});

// PDF 恒浅（R8）：nativeTheme 进程级会把导出窗口 prefers-color-scheme 也翻暗——
// 自带 @media(dark) 的文档可能把暗色印进 PDF。fixture 分自适暗（连续单页分支）与自分页自适暗（分页分支）。
const PDF_SELFDARK = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
  + 'body{background:#fff;color:#111;padding:40px}@media (prefers-color-scheme: dark){body{background:#000;color:#fff}}'
  + '</style></head><body>' + Array.from({ length: 20 }, (_, i) => `<p>第 ${i + 1} 段</p>`).join('') + '</body></html>';
const PDF_SELFPAGED_DARK = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
  + 'html{background:#eee}.page{width:210mm;min-height:297mm;box-sizing:border-box;padding:30mm;margin:0 auto;background:#fff;color:#111}'
  + '@media (prefers-color-scheme: dark){html{background:#000}.page{background:#000;color:#fff}}'
  + '@media print{.page{break-after:page}.page:last-child{break-after:auto}@page{size:A4;margin:0}}'
  + '</style></head><body><div class="page"><p>第一页</p></div><div class="page"><p>第二页</p></div></body></html>';

// PDF 首页背景是否浅色:printBackground 下,黑底页会在内容流里嵌满页黑矩形填充,白底不会。
// 稳的信号=深色态导出与浅色态导出同文档 → 页数/MediaBox 一致 + 字节长度相近(都渲染浅色→内容近同)。
async function exportInTheme(theme, docPath) {
  await setTheme(theme);
  const res = await page.evaluate((dp) => window.ws2.exportPdf(dp), docPath);
  expect(res && res.ok, '导出失败: ' + JSON.stringify(res)).toBe(true);
  return fs.readFile(path.join(tmpDir, 'export.pdf'));
}
const pdfCount = (buf) => (buf.toString('latin1').match(/\/Count\s+(\d+)/) || [])[1];

test('AE5 PDF 恒浅（自适暗 fixture）：深色态导出与浅色态一致（强制 light）', async () => {
  await launch();
  const docPath = await openDoc(PDF_SELFDARK);
  const light = await exportInTheme('light', docPath);
  const dark = await exportInTheme('dark', docPath);
  expect(light.slice(0, 5).toString('latin1')).toBe('%PDF-');
  expect(dark.slice(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdfCount(dark), '深色态页数应与浅色一致').toBe(pdfCount(light));
  // 都渲染浅色 → 内容近同;若深色态误渲染黑底(满页黑填充),字节长度会明显偏离。tol 25%。
  const ratio = dark.length / light.length;
  expect(ratio, `深/浅态导出字节长度应相近(渲染同为浅色),实测比 ${ratio.toFixed(3)}`).toBeGreaterThan(0.75);
  expect(ratio).toBeLessThan(1.33);
});

test('AE5 PDF 恒浅（自分页自适暗 fixture，打分页导出分支）：2 页 + 深浅一致', async () => {
  await launch();
  const docPath = await openDoc(PDF_SELFPAGED_DARK);
  const light = await exportInTheme('light', docPath);
  const dark = await exportInTheme('dark', docPath);
  expect(pdfCount(dark), '自分页应 2 页').toBe('2');
  expect(pdfCount(dark)).toBe(pdfCount(light));
  const ratio = dark.length / light.length;
  expect(ratio, `分页分支深/浅字节应相近,实测比 ${ratio.toFixed(3)}`).toBeGreaterThan(0.75);
  expect(ratio).toBeLessThan(1.33);
});
