// 报告用实机截图（非门，CI 不跑）：第三批三个最可见的新交互。WS2_SHOTDIR 指定输出目录。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.WS2_SHOTDIR || path.join(os.tmpdir(), 'b3batch');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  await fs.mkdir(OUT, { recursive: true });
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2shot3-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 700 });
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
  await page.waitForTimeout(350);
}
const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') });

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('容器化：段手柄 + 段菜单', async () => {
  await launch();
  await openDoc('<p id="up">提示框现在框里每一段都是独立的一行。</p><div class="ws-callout" id="C"><p id="c1">框里第一段（悬停它给整框的手柄）</p><p id="c2">框里第二段（悬停给这一段自己的手柄）</p><p id="c3">框里第三段</p></div><p id="z">下面一段。</p>');
  await frame.locator('#c2').hover();
  await page.waitForTimeout(250);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  await page.waitForTimeout(150);
  await shot('b3-callout-rowmenu');
});

test('表格：行/列手柄 + 行菜单', async () => {
  await launch();
  await openDoc('<p id="a">表格现在有独立的行手柄（左侧药丸）和列手柄（顶上药丸）。</p><table id="T"><tbody><tr><td>一甲</td><td>一乙</td><td>一丙</td></tr><tr id="r2"><td id="c21">二甲</td><td>二乙</td><td>二丙</td></tr><tr><td>三甲</td><td>三乙</td><td>三丙</td></tr></tbody></table><p id="z">行菜单只装行操作，列菜单只装列操作。</p>');
  await frame.locator('#c21').hover();
  await page.waitForTimeout(250);
  await frame.locator('.ws-rowsel').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  await page.waitForTimeout(150);
  await shot('b3-table-rowmenu');
});

test('图片：说明常驻 + 罩图态', async () => {
  await launch();
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAABQCAYAAADmpNIzAAAAV0lEQVR4nO3QMQ0AMAwEsZ/QMEjpMEjZoDIcgSU/DgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgLQuFAAGXW2AsAAAAAElFTkSuQmCC';
  await openDoc(`<p id="a">跨块选中时整张图呈被蓝罩态（以前蓝色被图片自己盖住）。</p><figure><img src="${PNG}" alt="图"><figcaption>说明文字是键盘停靠位</figcaption></figure><p id="z">下面文字。</p>`);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const r = d.createRange();
    r.setStart(d.querySelector('#a').firstChild, 0);
    r.setEnd(d.querySelector('#z').firstChild, 4);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(300);
  await shot('b3-image-rangesel');
});
