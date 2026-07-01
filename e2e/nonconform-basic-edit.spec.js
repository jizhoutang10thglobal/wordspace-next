// Feature 3 e2e 真门：非合规 HTML 的基础编辑（分流 + A/B/C + 结构保真 + 剥除契约 + 🔒）。
// CI 用 xvfb 真启动 Electron。断言锚在真实 fs（reparse 后结构/属性比对，不做字节 diff——首存必规范化）
// + 真实渲染几何。基础编辑器的 chrome（.ws-fmtbar/.nce-*）在**宿主**文档（page.locator），非 iframe 内。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');

let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2nce-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}
test.afterEach(async () => { if (app) await app.close().catch(() => {}); if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); });

async function openDoc(name, html) {
  const p = path.join(tmpDir, name);
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, fp) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp), p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(450);
  return p;
}
const saveToDisk = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
const readDisk = (p) => fs.readFile(p, 'utf8');

// seed：合规文档（无 style/无 script）→ 走完整块编辑
const CONFORM = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>' +
  '<h1>标题</h1><p>第一段。</p><p>第二段。</p></body></html>';
// seed：非合规（块级 style + script + 内联定位 + 图片）→ 走基础编辑
const WILD = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>野</title></head><body>' +
  '<h1 style="color:#c00">野文件标题</h1>' +
  '<p id="p1">第一段可编辑文字。</p>' +
  '<p id="p2">第二段要被删掉。</p>' +
  '<p id="p3">第三段。</p>' +
  '<div id="card" style="position:absolute;top:10px;right:10px;border:1px solid #ccc">角标</div>' +
  '<img id="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" width="40" height="40">' +
  '<script>window.x=1</' + 'script></body></html>';
// seed：仅块级 style 的温和文档（高频非合规路径）
const GENTLE = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>g</title></head><body>' +
  '<h1 style="color:#333">带色标题</h1><p>正文一切正常。</p></body></html>';

test('分流：合规→完整编辑无降级条；非合规/仅块style→降级条 + 基础编辑', async () => {
  await launch();
  await openDoc('ok.html', CONFORM);
  await expect(page.locator('#ws-degrade-notice')).toBeHidden();
  await openDoc('wild.html', WILD);
  await expect(page.locator('#ws-degrade-notice')).toBeVisible();
  await openDoc('gentle.html', GENTLE);
  await expect(page.locator('#ws-degrade-notice')).toBeVisible(); // 仅块级 style 也走基础编辑（高频路径）
});

test('剥除契约：非合规编辑保存 → 磁盘 body 不含 contenteditable/编辑标记（编辑态没漏进磁盘）', async () => {
  await launch();
  const p = await openDoc('wild.html', WILD);
  await frame.locator('#p1').click();
  await page.keyboard.type('Z'); // 确定性一次真实编辑 → 必 dirty
  await saveToDisk();
  await expect.poll(async () => /Z/.test((await readDisk(p)).match(/<p id="?p1"?>[\s\S]*?<\/p>/i)[0])).toBe(true); // 先确认真存了
  const disk = await readDisk(p);
  expect(disk).not.toMatch(/contenteditable/i);       // 剥除契约：编辑态属性没漏进文件
  expect(disk).not.toMatch(/data-ws2-basic-ce/i);
  expect(disk.match(/<body[^>]*>/i)[0]).toBe('<body>'); // body 依然干净
});

test('A 富文字：选中 → 宿主格式条 → 加粗 → 保存后磁盘那段带 <b>/<strong>', async () => {
  await launch();
  const p = await openDoc('wild.html', WILD);
  await frame.locator('#p1').click();
  await frame.locator('body').evaluate(() => {
    const el = document.getElementById('p1');
    const r = document.createRange(); r.selectNodeContents(el);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.locator('.ws-fmtbar')).toBeVisible(); // 宿主浮层格式条
  await page.locator('.ws-fmtbar-btn[title="加粗"]').click();
  await saveToDisk();
  await expect.poll(async () => /<(b|strong)[ >]/i.test((await readDisk(p)).match(/<p id="?p1"?>[\s\S]*?<\/p>/i)[0])).toBe(true);
});

test('B 删块：Esc 选块 → Delete → 保存后该块从磁盘消失、其余块保留', async () => {
  await launch();
  const p = await openDoc('wild.html', WILD);
  await frame.locator('#p2').click();          // 光标进 p2
  await page.keyboard.press('Escape');          // → 块模式，焦点落 p2
  await expect(page.locator('.nce-focus')).toBeVisible();
  await page.keyboard.press('Delete');          // 删 p2
  await saveToDisk();
  await expect.poll(async () => (await readDisk(p)).includes('第二段要被删掉')).toBe(false);
  const disk = await readDisk(p);
  expect(disk).toContain('第一段可编辑文字'); // 未触及块保留
  expect(disk).toContain('第三段');
});

test('结构保真：编辑一段 → 未触及的绝对定位角标 style 逐字保留 + 二次保存幂等', async () => {
  await launch();
  const p = await openDoc('wild.html', WILD);
  await frame.locator('#p1').click();
  await page.keyboard.type('改了');
  await saveToDisk();
  await expect.poll(async () => (await readDisk(p)).includes('改了')).toBe(true);
  const once = await readDisk(p);
  // 未触及的 #card 绝对定位 style 逐字保留
  const card = /<div id="?card"?[^>]*>/i.exec(once)[0];
  expect(card).toContain('position:absolute;top:10px;right:10px;border:1px solid #ccc');
  // 二次保存幂等：再存一次（无新编辑，但制造 dirty 再存）应与首存字节一致
  await frame.locator('#p3').click();
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await saveToDisk();
  await page.waitForTimeout(200);
  const twice = await readDisk(p);
  expect(twice).toBe(once); // 首存已规范化，此后稳定
});

test('🔒 只读：悬停图片 → 出 🔒（不是可编辑文字）', async () => {
  await launch();
  await openDoc('wild.html', WILD);
  // 在图片位置派发 mousemove（text 模式的悬停路径）
  const box = await frame.locator('#pic').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await expect(page.locator('.nce-lock')).toBeVisible();
});
