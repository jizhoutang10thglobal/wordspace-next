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

test('Cmd+Z 撤销（基础编辑，Colin 2026-07-02）：打字 → 菜单 undo 还原 → redo 恢复 → 重挂后还能编辑', async () => {
  await launch();
  await openDoc('wild.html', WILD);
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_插入_');
  await expect(frame.locator('#p1')).toContainText('_插入_');
  // 真实用户 Cmd+Z 走菜单加速器（sendMenu('undo')），不走 doc keydown——按真实路径触发
  const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
  await menu('undo');
  await expect(frame.locator('#p1'), '基础编辑 undo 没还原').not.toContainText('_插入_');
  await menu('redo');
  await expect(frame.locator('#p1'), 'redo 没恢复').toContainText('_插入_');
  // 撤销 = body.innerHTML 整体重写，基础编辑器必须重挂——undo 后再编辑一次证明内核还活着
  await menu('undo');
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('X2');
  await expect(frame.locator('#p1'), 'undo 后基础编辑器没重挂、编辑失灵').toContainText('X2');
  await menu('save'); // 清脏收尾：脏文档会让 afterEach 的 app.close() 被关窗守卫卡死（本套件惯例=存了再关）
  await page.waitForTimeout(300);
});

test('T5 视觉对齐：焦点框 accent 蓝（非珊瑚橙）+ 格式条画布同款壳（真 computed style）', async () => {
  await launch();
  await openDoc('wild.html', WILD);
  await frame.locator('#p1').click();
  await page.keyboard.press('Escape'); // → 块模式出焦点框
  await expect(page.locator('.nce-focus')).toBeVisible();
  const st = await page.locator('.nce-focus').evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(st, '焦点框应是 accent 蓝（ui-demo nce-focus）').toBe('rgb(26, 115, 232)'); // #1a73e8
  // 格式条壳：选中文字出条 → surface 底、无实体边框（shadow-menu 描边）、32 高
  await frame.locator('#p1').click();
  await frame.locator('#p1').selectText();
  await expect(page.locator('.ws-fmtbar')).toBeVisible();
  const bar = await page.locator('.ws-fmtbar').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { h: el.getBoundingClientRect().height, border: cs.borderTopWidth, bg: cs.backgroundColor };
  });
  expect(Math.round(bar.h), '格式条高度应 32（画布同款）').toBe(32);
  expect(bar.border, '格式条不应再有实体边框').toBe('0px');
  expect(bar.bg).toBe('rgb(255, 255, 255)');
});

// Colin 2026-07-03 报的 bug：关掉最后一个非合规标签后，降级条留在空白页上（陈旧 frame.onload
// 晚到、把 attachBasic 跑在空 iframe 上）。守：空态绝无降级条（关标签 + 外部删除两条路）。
test('回归：关掉最后一个非合规标签 / 文件被外部删 → 空白页不残留降级条', async () => {
  await launch();
  const tmpWs = path.join(tmpDir, 'ws-empty');
  await fs.mkdir(tmpWs, { recursive: true });
  await fs.writeFile(path.join(tmpWs, 'wild.html'), WILD, 'utf8');
  // 用工作区打开（有标签栏才能「关标签」）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'ud2'), WS2_NO_CLOSE_DIALOG: '1', WS2_FOLDER_IN: tmpWs } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  await page.click('#home-open-folder');
  await page.click('.sb-file[data-rel="wild.html"]');
  await expect(page.locator('#ws-degrade-notice')).toBeVisible(); // 开着野文件：条在
  // ① 关掉唯一标签 → 空白页无条
  const tab = page.locator('#sb-tabs .sb-tab[data-rel="wild.html"]');
  await tab.hover();
  await tab.locator('.sb-tab-close').click();
  await expect(page.locator('#home')).toBeVisible();
  await page.waitForTimeout(600); // 给陈旧 onload 晚到的窗口（修前正是它把条挂回来）
  await expect(page.locator('#ws-degrade-notice'), '空白页残留降级条（关标签路）').toBeHidden();
  // ② 再开 → 外部删除 → 回空态无条
  await page.click('.sb-file[data-rel="wild.html"]');
  await expect(page.locator('#ws-degrade-notice')).toBeVisible();
  await fs.rm(path.join(tmpWs, 'wild.html'));
  await expect(page.locator('#home')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(600);
  await expect(page.locator('#ws-degrade-notice'), '空白页残留降级条（外部删除路）').toBeHidden();
});
