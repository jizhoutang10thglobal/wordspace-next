// 独立嫌疑探针：格内行内格式是不是死按钮。
// 背景：fmtbar 的 B/I/U/S 走 execText()（有 cell 分支），但 行内代码 wrapCode() / 文字色 applyColor() /
// 高亮 wrapMark() / 链接 addLink() 四个都没有 cell 分支，走 nearestBlock 判块——在 TD 里可能上卷到 TABLE 后静默失败。
// **每条都带正对照（同一动作在普通段落里必须成功）**，否则「格里没变化」分不清是死按钮还是哑探针。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.PROBE_OUT || path.join(os.tmpdir(), 'cellfmt.json');
let app, page, frame, tmpDir;
const out = [];

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2fmt-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function openDoc(body, sentinel) {
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>' + body + '</body></html>';
  const p = path.join(tmpDir, 'd-' + sentinel + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('#' + sentinel)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(420);
}
// 在指定元素内选中全部文字（用 DOM Range，别信 caret 快捷键）
async function selectAllIn(sel) {
  await page.evaluate((s) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.querySelector(s);
    el.focus();
    const r = d.createRange(); r.selectNodeContents(el);
    const sn = d.getSelection(); sn.removeAllRanges(); sn.addRange(r);
    d.dispatchEvent(new Event('selectionchange'));
  }, sel);
  await page.waitForTimeout(320);
}
const fmtVisible = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const f = d.querySelector('.ws-fmtbar');
  return !!f && f.style.display !== 'none';
});
// 点 fmtbar 上 title=<t> 的按钮
async function clickFmt(title) {
  return page.evaluate((t) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const b = [...d.querySelectorAll('.ws-fmtbar [title]')].find((n) => n.getAttribute('title') === t);
    if (!b) return false;
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    b.click();
    return true;
  }, title);
}
// 打开色板 holder 后点第 i 个色块
async function clickSwatch(holderTitle, i) {
  const ok = await clickFmt(holderTitle);
  if (!ok) return false;
  await page.waitForTimeout(220);
  return page.evaluate((idx) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const pops = [...d.querySelectorAll('.ws-fmtbar-swatches')].filter((p) => p.style.display !== 'none');
    if (!pops.length) return false;
    const sw = pops[0].querySelectorAll('.ws-fmtbar-swatch')[idx];
    if (!sw) return false;
    sw.click();
    return true;
  }, i);
}
const innerOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s);
  return el ? el.innerHTML : null;
}, sel);

const DOC =
  '<p id="ctl">正对照段落文字</p>' +
  '<table class="ws-table"><thead><tr><th scope="col" id="th1">列一</th></tr></thead>' +
  '<tbody><tr><td id="c11">格内文字</td></tr></tbody></table>' +
  '<p id="tail">尾段</p>';

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null;
});
test.afterAll(async () => { await fs.writeFile(OUT, JSON.stringify(out, null, 2), 'utf8'); });

const CASES = [
  { name: '行内代码', run: async () => clickFmt('行内代码'), expect: 'code' },
  // applyColor 走 fmt.wrapInlineStyle → CSSOM span（<span style="color:…">），不是块级 ws-color- class
  { name: '文字色', run: async () => clickSwatch('文字色', 1), expect: 'color' },
  { name: '高亮', run: async () => clickSwatch('高亮', 0), expect: 'mark' },
];

test('格内行内格式 vs 正对照段落', async () => {
  await launch();
  for (const c of CASES) {
    // --- 正对照：普通段落 ---
    await openDoc(DOC, 'ctl');
    await frame.locator('#ctl').click();
    await page.waitForTimeout(200);
    await selectAllIn('#ctl');
    const ctlBar = await fmtVisible();
    const ctlClicked = await c.run();
    await page.waitForTimeout(320);
    const ctlHtml = await innerOf('#ctl');
    const ctlOk = !!ctlHtml && ctlHtml.includes(c.expect);

    // --- 目标：表格单元格 ---
    await openDoc(DOC, 'ctl');
    await frame.locator('#c11').click();
    await page.waitForTimeout(260);
    await selectAllIn('#c11');
    const cellBar = await fmtVisible();
    const cellClicked = await c.run();
    await page.waitForTimeout(320);
    const cellHtml = await innerOf('#c11');
    const cellOk = !!cellHtml && cellHtml.includes(c.expect);

    out.push({
      按钮: c.name,
      正对照_段落: { 气泡出现: ctlBar, 按钮点到: ctlClicked, 生效: ctlOk, html: ctlHtml },
      目标_表格格内: { 气泡出现: cellBar, 按钮点到: cellClicked, 生效: cellOk, html: cellHtml },
      判定: !ctlOk ? '探针无效（正对照都没生效，不能下结论）' : (cellOk ? '格内也生效' : '**格内死按钮**（正对照生效、格内不生效）'),
    });
  }
  console.log('CELLFMT=' + JSON.stringify(out.map((o) => ({ 按钮: o.按钮, 判定: o.判定 })), null, 1));
});
