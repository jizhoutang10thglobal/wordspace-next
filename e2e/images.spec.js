// 图片块（doc-images Phase 1）e2e 真门：CI 用 xvfb 真启动 Electron 跑。
// 强断言纪律（S4）：判「图真渲染出来」用 naturalWidth>0 + boundingBox 非零 + src=data:image/，
// 不查 DOM 存在性（存在≠显示）。同一 checkImg 谓词既当正门又当变异探针——打坏 src 后必翻红，
// 否则本门是哑门。覆盖：斜杠/粘贴两入口、文本优先(①)、空段落原地替换(②)、降采样≤1600、
// 磁盘字节过校验器判 conform、figcaption canonical、说明里退格不删块、重开仍渲染、变异自检。
// （OS 文件拖放入口靠宿主手测——Electron 里 OS drop 的 dataTransfer.files 难在 e2e 合成。）
//
// 时序纪律：真 app 有磁盘 watcher，自动保存(1.2s)写盘会触发一次 reload（导航）。故 ①图片尺寸
// 从被 poll 的 checkImg 自身读（naturalWidth = 存盘 data: 的解码尺寸，无独立 evaluate 竞态）；
// ②读磁盘/conform 一律先等过自动保存窗口；③afterEach 吸收挂起的保存+reload，防跨测试串扰。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { JSDOM } = require('jsdom');
const registry = require('../src/lib/schema-registry.js');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, bigPng;

test.beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2e2e-img-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  // fixture：2400×1500 渐变 PNG（长边 >1600 逼出降采样），页内 canvas 生成 → 写临时文件（IPC 真读它的字节）
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1500;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 2400, 1500);
    grad.addColorStop(0, '#1a73e8'); grad.addColorStop(1, '#d93025');
    g.fillStyle = grad; g.fillRect(0, 0, 2400, 1500);
    g.fillStyle = '#fff'; g.font = 'bold 200px sans-serif'; g.fillText('WS', 980, 820);
    return c.toDataURL('image/png').split(',')[1];
  });
  bigPng = path.join(tmpDir, 'big-photo.png');
  await fs.writeFile(bigPng, Buffer.from(b64, 'base64'));
});

test.beforeEach(() => { test.setTimeout(70000); });
// 吸收上一个测试挂起的自动保存(1.2s)+reload，防串扰下一个测试的 evaluate（共享 app）
test.afterEach(async () => { if (page) await page.waitForTimeout(2600).catch(() => {}); });
test.afterAll(async () => { if (page) await page.waitForTimeout(500).catch(() => {}); if (app) await app.close().catch(() => {}); });

const SIMPLE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>
<h1 id="t">标题</h1><p id="p1">第一段文字。</p><p id="p2">第二段。</p><blockquote id="q">引用。</blockquote></body></html>`;

async function openDoc(html) {
  const docPath = path.join(tmpDir, 'doc.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
  return docPath;
}

// stub 主进程 dialog.showOpenDialog（原生对话框 e2e 点不了）；真 handler 仍去读 files 字节 → base64。
async function stubPickImages(paths) {
  await app.evaluate(({ dialog }, ps) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ps }); }, paths);
}
async function clickSlashImage() {
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu-item', { hasText: '图片' })).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: '图片' }).click();
}
// 斜杠插入图片：点块进编辑末尾 → 输 '/' → 点「图片」项。
async function insertViaSlash(blockId, files) {
  await stubPickImages(files || [bigPng]);
  await frame.locator('#' + blockId).click();
  await page.keyboard.press('End');
  await clickSlashImage();
}

// 强断言谓词（正门 + 变异探针共用）：真渲染 = naturalWidth>0 + 可见尺寸 + data:image/ src。
// 顺带回 naturalWidth/Height —— 即存盘 data: 的解码尺寸，降采样断言直接读它、免独立 evaluate 竞态。
const checkImg = () => frame.locator('body').evaluate((b) => {
  const img = b.ownerDocument.querySelector('img');
  if (!img) return { pass: false, why: 'no <img>', w: 0, h: 0 };
  const r = img.getBoundingClientRect();
  const src = img.getAttribute('src') || '';
  const pass = img.naturalWidth > 0 && img.naturalHeight > 0 && r.width > 40 && r.height > 40 && /^data:image\//.test(src);
  return { pass, why: pass ? '' : `nw=${img.naturalWidth} box=${Math.round(r.width)}x${Math.round(r.height)} src=${src.slice(0, 22)}`, w: img.naturalWidth, h: img.naturalHeight };
});
const imgCount = () => frame.locator('body').evaluate((b) => b.ownerDocument.querySelectorAll('img').length);
const blockCount = () => frame.locator('body').evaluate((b) => [...b.ownerDocument.body.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui')).length);
async function pollImg(msg) {
  let ci;
  await expect.poll(async () => { ci = await checkImg(); return ci.pass; }, { timeout: 6000, message: msg }).toBe(true);
  return ci; // 通过时的快照（含 w/h），无额外 evaluate
}

test('斜杠插入：图真渲染 + 降采样≤1600 + 磁盘字节过校验器判 conform', async () => {
  const docPath = await openDoc(SIMPLE);
  await insertViaSlash('p1');
  const ci = await pollImg('插入后图未真渲染');
  // 降采样：naturalWidth/Height = 存盘 data: 的解码尺寸；fixture 2400×1500 → 逼真触发（非哑断言）
  expect(Math.max(ci.w, ci.h), `降采样后 ${ci.w}×${ci.h} 长边应≤1600`).toBeLessThanOrEqual(1600);
  // 磁盘字节 conform（比活 DOM serialize 强一档）：等过自动保存 → readFile → JSDOM → classify.conform
  await page.waitForTimeout(2200);
  const raw = await fs.readFile(docPath, 'utf8');
  expect(/<img[^>]+src="data:image\//.test(raw), '磁盘字节应内联 data:image').toBe(true);
  expect(registry.classify(new JSDOM(raw).window.document).conform, '图片文档必须判 conform（否则外部 reload 掉进基础编辑）').toBe(true);
});

test('空段落原地替换（已拍板②）：在空段落上插图 → 块数不变', async () => {
  await openDoc(SIMPLE);
  // 造空段落：标题末尾按 Enter 得新空正文块
  await frame.locator('#t').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const before = await blockCount();
  await stubPickImages([bigPng]);
  await clickSlashImage();
  await pollImg('空段落插图未渲染');
  expect(await blockCount(), '空段落应被图片原地替换、块数不变').toBe(before);
});

test('粘贴文本优先（已拍板①）：文本+图并存不插图；纯图粘贴插一张', async () => {
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  // 全同步（无 await）：避免 evaluate 中途被自动保存触发的 reload 导航销毁执行上下文。
  const paste = (withText) => frame.locator('body').evaluate((b, hasText) => {
    const doc = b.ownerDocument;
    const c = doc.createElement('canvas'); c.width = 320; c.height = 200;
    const g = c.getContext('2d'); g.fillStyle = '#1e8e3e'; g.fillRect(0, 0, 320, 200);
    const b64 = c.toDataURL('image/png').split(',')[1];
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    if (hasText) dt.setData('text/plain', '一段文本');
    dt.items.add(new File([u8], 'pasted.png', { type: 'image/png' }));
    const target = doc.querySelector('[contenteditable="true"]') || doc.body;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, withText);

  await paste(true);
  await page.waitForTimeout(600);
  expect(await imgCount(), '文本+图并存时文本优先、不插图').toBe(0);
  await paste(false);
  await expect.poll(async () => await imgCount(), { timeout: 6000, message: '纯图粘贴应插一张' }).toBe(1);
  expect((await checkImg()).pass, '粘贴的图应真渲染').toBe(true);
});

test('加说明：figure/figcaption canonical + 磁盘 conform；说明里退格不删整块', async () => {
  const docPath = await openDoc(SIMPLE);
  await insertViaSlash('p1');
  await pollImg('插入后图未渲染');
  // 选中图 → 开块菜单（⋮⋮）→ 加说明
  await frame.locator('img').click();
  await page.waitForTimeout(120);
  await frame.locator('.ws-grip').click().catch(() => {});
  await frame.locator('.ws-blockmenu-item', { hasText: '加说明' }).click();
  await page.waitForTimeout(150);
  // 说明里输入 + 退格：绝不能删掉整张图（ui-demo 踩过）
  await page.keyboard.type('海报配图xx');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  expect(await imgCount(), '在说明里退格绝不能删掉图片').toBe(1);
  await page.keyboard.press('Escape'); // 失焦 persist
  await page.waitForTimeout(200);
  const shape = await frame.locator('body').evaluate((b) => {
    const fig = b.ownerDocument.querySelector('figure');
    const cap = fig && fig.querySelector('figcaption');
    return { hasFigure: !!fig, imgs: fig ? fig.querySelectorAll('img').length : 0, cap: cap ? cap.textContent : null };
  });
  expect(shape.hasFigure && shape.imgs === 1, 'canonical = figure 恰含一个 img').toBe(true);
  expect(shape.cap, '说明文本落库').toBe('海报配图');

  await page.waitForTimeout(2200);
  const raw = (await fs.readFile(docPath, 'utf8')).replace(/\n/g, '');
  expect(/<figure><img[^>]+><figcaption>海报配图<\/figcaption><\/figure>/.test(raw), '入盘 figure canonical').toBe(true);
  expect(/contenteditable/i.test(raw), '入盘字节不得残留 contenteditable').toBe(false);
  expect(registry.classify(new JSDOM(raw).window.document).conform, '带说明图仍 conform').toBe(true);
});

test('重开文档：内联 data: 图冷启动仍真渲染（持久化）', async () => {
  const docPath = await openDoc(SIMPLE);
  await insertViaSlash('p1');
  await pollImg('插入后图未渲染');
  await page.waitForTimeout(2200); // 落盘
  await openDoc(await fs.readFile(docPath, 'utf8')); // 重开同一内容
  await pollImg('重开后图未渲染（data: 持久化坏了）');
});

test('选中框 accent 蓝（暗色可见）：选中图的 box-shadow 是蓝环、不是暗色下隐身的黑环', async () => {
  // 暗色文档对 img 施双反色滤镜会把黑阴影翻回黑→暗底隐身；选中框改 accent 蓝规避（明暗两态可见）。
  // getComputedStyle 返回作者值（滤镜前），断言蓝环规则命中 + 特异度压过通用黑环即可。
  await openDoc(SIMPLE);
  await insertViaSlash('p1');
  await pollImg('插入后图未渲染');
  await frame.locator('img').click();
  await page.waitForTimeout(150);
  const bs = await frame.locator('body').evaluate((b) => {
    const img = b.ownerDocument.querySelector('img[data-ws2-selected]');
    return img ? getComputedStyle(img).boxShadow : null;
  });
  expect(bs, '选中的图应有 box-shadow 选中框').toBeTruthy();
  expect(bs, '选中框应是 accent 蓝环(26,115,232)、不是暗色下隐身的黑环').toContain('26, 115, 232');
});

test('变异自检（门有牙）：把 img.src 打坏后，同一 checkImg 谓词必翻红', async () => {
  await openDoc(SIMPLE);
  await insertViaSlash('p1');
  await pollImg('插入后图未渲染');
  // 破坏：src 换成解不出的 data → naturalWidth 归零
  await frame.locator('body').evaluate((b) => { b.ownerDocument.querySelectorAll('img').forEach((i) => { i.src = 'data:image/png;base64,AAAA'; }); });
  await page.waitForTimeout(400);
  expect((await checkImg()).pass, '坏 src 下 checkImg 仍判过 = 哑门').toBe(false);
});
