// 探针三（非门）：E4 重做——用程序化 Range 走真实 selectionchange 链路（page.mouse 拖选在 iframe 里会卡）
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2probe3-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title><style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}
// 程序化造跨块选区：从 startSel 的文本起点 到 endSel 的文本终点
const setRange = (startSel, endSel) => frame.locator('body').evaluate((b, [ss, es]) => {
  const d = b.ownerDocument;
  const a = d.querySelector(ss), c = d.querySelector(es);
  const tn = (el) => { const w = d.createTreeWalker(el, NodeFilter.SHOW_TEXT); return w.nextNode(); };
  const r = d.createRange();
  r.setStart(tn(a), 0);
  const et = tn(c); r.setEnd(et, et.textContent.length);
  const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
}, [startSel, endSel]);

const marks = () => frame.locator('body').evaluate((b) => {
  const d = b.ownerDocument;
  return {
    rangesel: [...d.querySelectorAll('[data-ws2-rangesel]')].map((e) => {
      const r = e.getBoundingClientRect();
      return { tag: e.tagName, id: e.id || null, text: e.textContent.trim().slice(0, 14), h: +r.height.toFixed(1) };
    }),
    rowsCovered: [...d.querySelectorAll('#lst > li')].map((l) => ({ t: l.textContent.trim(), inRangesel: !!l.closest('[data-ws2-rangesel]') })),
  };
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; }
});

test('E4 重做：只想带上第 2-3 行，拖到列表外时第 1/4 行会不会被一起算进去', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="r1">第一行</li><li id="r2">第二行</li><li id="r3">第三行</li><li id="r4">第四行</li></ul><p id="pp">后面的段落</p>');

  await frame.locator('#r2').click();
  await page.waitForTimeout(200);

  // (a) 列表内 2→3 行
  await setRange('#r2', '#r3');
  await page.waitForTimeout(350);
  console.log('=== E4a 列表内选 2→3 行:', JSON.stringify(await marks()));

  // (b) 第 2 行 → 列表外段落（用户意图：带上 2/3/4 行 + 段落）
  await setRange('#r2', '#pp');
  await page.waitForTimeout(350);
  const b = await marks();
  console.log('=== E4b 第 2 行 → 列表外段落:', JSON.stringify(b));
  const r1 = b.rowsCovered.find((x) => x.t === '第一行');
  console.log(`>>> 用户没选第一行，它是否被算进 rangesel: ${r1.inRangesel ? '是 —— 整张列表被罩' : '否'}`);
  await page.screenshot({ path: 'probe-E4b-fixed.png' });
});

test('E6 延伸：跨块选区里含列表时，改颜色/删除作用到哪些行', async () => {
  await launch();
  await openDoc('<p id="p0">前面段落</p><ul id="lst" class="ws-todo"><li id="r1">第一行</li><li id="r2">第二行</li><li id="r3">第三行</li></ul>');
  await frame.locator('#p0').click();
  await page.waitForTimeout(200);
  // 从前面段落选到第 2 行（用户意图：段落 + 第 1、2 行，不含第 3 行）
  await setRange('#p0', '#r2');
  await page.waitForTimeout(350);
  const m = await marks();
  console.log('=== E6 段落 → 第 2 行:', JSON.stringify(m));
  const r3 = m.rowsCovered.find((x) => x.t === '第三行');
  console.log(`>>> 用户没选第三行，它是否被算进 rangesel: ${r3.inRangesel ? '是 —— 会被一起改/删' : '否'}`);
  await page.screenshot({ path: 'probe-E6.png' });
});
