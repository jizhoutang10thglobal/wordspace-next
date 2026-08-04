// 报告用实机截图探针（非门，CI 不跑）。同一份脚本跑两遍：干净版=修后，打上变异=修前。
// 输出目录由 WS2_SHOTDIR 指定。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.WS2_SHOTDIR || path.join(os.tmpdir(), 'b3shots');
let app, page, frame, tmpDir;

async function launch() {
  await fs.mkdir(OUT, { recursive: true });
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2b3shot-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 700 });
}
async function openDoc(body, head) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>${head || ''}</head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(500);
}
const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') });
// 鼠标位置标记：CSP 禁 setAttribute('style')，必须走 CSSOM 逐条 setProperty，并自检真被画出来
const mark = (sel, where) => page.evaluate((q) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const t = d.querySelector(q.sel); if (!t) return 'no-target';
  const r = t.getBoundingClientRect();
  const x = r.left + 40, y = q.where === 'upper' ? r.top + r.height * 0.25 : r.top + r.height / 2;
  const old = d.getElementById('__cursor'); if (old) old.remove();
  const m = d.createElement('div'); m.id = '__cursor'; m.setAttribute('data-ws2-ui', 'ws2-overlay');
  const S = { position: 'fixed', left: (x - 9) + 'px', top: (y - 9) + 'px', width: '18px', height: '18px',
    border: '3px solid #E5484D', 'border-radius': '50%', 'z-index': '2147483647', 'pointer-events': 'none',
    'box-shadow': '0 0 0 2px rgba(255,255,255,.85)', 'box-sizing': 'border-box', margin: '0', padding: '0', flex: 'none' };
  for (const k in S) m.style.setProperty(k, S[k]);
  d.body.appendChild(m);
  const mr = m.getBoundingClientRect();
  if (Math.round(mr.width) !== 18 || Math.round(mr.height) !== 18) return 'DUMB-MARKER:' + JSON.stringify(mr);
  return 'ok';
}, { sel, where });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAABQCAYAAADmpNIzAAAAV0lEQVR4nO3QMQ0AMAwEsZ/QMEjpMEjZoDIcgSU/DgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgLQuFAAGXW2AsAAAAAElFTkSuQmCC';

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('I4 手柄作用域', async () => {
  await launch();
  await openDoc(`<p id="p1">上面这段是正常段落。</p><img id="pic" src="${PNG}" alt="图"><p id="after">鼠标现在停在这一段上，手柄也画在这一段旁边。</p>`);
  await frame.locator('#pic').click();
  await page.waitForTimeout(200);
  expect(await mark('#pic', 'mid')).toBe('ok');
  await shot('i4-1-图片被选中');
  await frame.locator('#after').hover();
  await page.waitForTimeout(250);
  expect(await mark('#after', 'mid')).toBe('ok');
  await shot('i4-2-鼠标移到段落上手柄跟过来');
  await frame.locator('.ws-grip').click();
  await page.waitForTimeout(300);
  await shot('i4-3-点手柄之后');
});

test('C8 多段 callout 首行退格', async () => {
  await launch();
  const CSS = '<style id="ws-callout-style" data-ws-schema-css="callout">.ws-callout{background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px;margin:14px 0}.ws-callout>p{margin:6px 0}</style>';
  // 真实磁盘形态：带缩进换行
  await openDoc('<p id="up">上面这一块。</p>\n<div class="ws-callout" id="C">\n  <p id="c1">框里第一段</p>\n  <p id="c2">框里第二段</p>\n</div>', CSS);
  await shot('c8-1-退格前');
  await frame.locator('#c1').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Home');
  await page.waitForTimeout(80);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  await shot('c8-2-在框内第一行行首按一次退格');
});

test('I10 拖图落点线', async () => {
  await launch();
  await openDoc('<p id="p1">第一段</p><p id="p2">第二段</p><p id="p3">第三段</p>');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const t = d.querySelector('#p2'); const r = t.getBoundingClientRect();
    const c = d.createElement('canvas'); c.width = 8; c.height = 8;
    const bin = atob(c.toDataURL('image/png').split(',')[1]);
    const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u8], 'drop.png', { type: 'image/png' }));
    d.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 20), clientY: Math.round(r.bottom - 3) }));
  });
  expect(await mark('#p2', 'mid')).toBe('ok');
  await page.waitForTimeout(150);
  await shot('i10-1-拖文件经过第二段下缘');
});
