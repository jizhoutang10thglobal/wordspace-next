// Wendi 2026-07-22 报「点击的时候，测试文档在（上下）跳」。根因＝块编辑器 enterEdit 的 el.focus() 无 preventScroll：
// 点一个部分露在视口外的块，浏览器原生「聚焦滚进视野」把整块对齐、一把顶进来 → 文档大跳。
// 修：focus 不滚 + 只在光标真落到视口外时最小滚动露出光标（键盘导航到屏外块仍可见）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2sj-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}
async function openDoc(html) {
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, fp) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp), p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
  return p;
}
test.afterEach(async () => { if (app) await app.close().catch(() => {}); if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); });

// 高于视口的合规文档。target 是很长、会换成几十行的高段落，可被顶部部分裁切、下半仍有大片可见可点。
const LONG = '这是一个很长的段落，用来把这个块撑到很多行高，这样它可以部分露在视口外，下半部分还留在视口里可以点击到它的可见文字。'.repeat(20);
const TALL = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
  + '<p id="empty1"></p><p id="target">' + LONG + '</p>'
  + Array.from({ length: 50 }, (_, i) => '<p id="fill' + i + '">填充段落 ' + i + '，让文档比视口高、可滚动。</p>').join('')
  + '<p id="emptyLast"></p></body></html>';

test('点块不跳：点部分露在视口外的块的【可见处】→ enterEdit 不把文档滚动跳动', async () => {
  await launch();
  await openDoc(TALL);
  const r = await page.evaluate(() => {
    const w = document.getElementById('doc-frame').contentWindow;
    const d = w.document;
    const el = d.getElementById('target');
    // 把 target 顶部滚到视口上边缘外 150px：上半裁切、下半在视口里
    w.scrollTo(0, el.offsetTop + 150);
    const before = w.scrollY;
    // 在 target 可见部分合成点击（clientY=200 在视口内、落在该块下半）——
    // 用 elementFromPoint 取坐标处真实元素当事件 target（真实点击口径，不硬派在 el 上造错位）
    const cx = el.getBoundingClientRect().left + 40, cy = 200;
    const hit = d.elementFromPoint(cx, cy) || el;
    for (const type of ['mousedown', 'mouseup', 'click']) hit.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: cx, clientY: cy }));
    const after = w.scrollY;
    const cr = d.querySelector('[data-ws2-editing]');
    return { before, after, editing: !!cr, editId: cr ? cr.id : null };
  });
  console.log('scrollY before/after:', r.before, r.after, 'editing:', r.editId);
  expect(r.editing, '合成点击应让某块进入编辑态').toBe(true);
  expect(Math.abs(r.after - r.before), '点块可见处不应引起文档滚动跳动').toBeLessThan(3);
});

test('不丢光标：光标落到视口外的块 → 最小滚动露出（键盘导航到屏外块的保底，别被过度修复砍掉）', async () => {
  await launch();
  await openDoc(TALL);
  const r = await page.evaluate(() => {
    const w = document.getElementById('doc-frame').contentWindow;
    const d = w.document;
    w.scrollTo(0, 0);
    // 找一个当前在视口【下方外】的块，模拟键盘导航落到它（合成点击进编辑）
    const vh = w.innerHeight;
    const blocks = [...d.body.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui') && c.id);
    const off = blocks.find((b) => b.getBoundingClientRect().top > vh + 20);
    const beforeTop = off.getBoundingClientRect().top;
    for (const type of ['mousedown', 'mouseup', 'click']) off.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: off.getBoundingClientRect().left + 20, clientY: beforeTop }));
    const afterTop = off.getBoundingClientRect().top;
    return { vh, beforeTop, afterTop, id: off.id };
  });
  console.log('off-screen block top before/after:', r.beforeTop, r.afterTop, 'vh:', r.vh, 'id:', r.id);
  expect(r.beforeTop, '目标块起初应在视口下方外').toBeGreaterThan(r.vh);
  expect(r.afterTop, '进编辑后该块应被滚回视口内（光标可见）').toBeLessThan(r.vh);
});
