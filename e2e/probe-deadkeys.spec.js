// 探针（非门）：专找「死键」—— 按下去文档一字未变、连 dirty 都不亮的按键。
// ⚠ 判「没变化」必须剥掉 contenteditable：点进块会加这个属性，不剥的话每个操作看起来都「变了」，
// 死键会被整批漏掉（上一轮扫描就栽在这，引用块的死键没被抓出来）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  if (!tmpDir) tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2dead-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
}
async function closeApp() {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null; page = null; frame = null;
}
const HEAD = '<style id="ws-callout-style" data-ws-schema-css="callout">.ws-callout{background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px}</style>'
  + '<style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style>';
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
  await page.waitForTimeout(300);
}
const readState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const dot = document.querySelector('#dirty-dot');
  return {
    body: (d.body.innerHTML || '')
      .replace(/ ?data-ws2-[a-z]+(="[^"]*")?/g, '')
      .replace(/ ?contenteditable="[^"]*"/g, '')
      .replace(/\s*\n\s*/g, '').replace(/>\s+</g, '><').trim(),
    conform: (() => { try { return WS2SchemaRegistry.classify(d).conform; } catch (e) { return null; } })(),
    degraded: !!document.querySelector('.ws-degrade-bar'),
    dirty: dot ? !dot.hidden : null,
  };
});
async function caretStart(sel) { await frame.locator(sel).click(); await page.waitForTimeout(160); await page.keyboard.press('Home'); await page.waitForTimeout(60); }
async function caretEnd(sel) { await frame.locator(sel).click(); await page.waitForTimeout(160); await page.keyboard.press('End'); await page.waitForTimeout(60); }
const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(300); };

// 容器块（引用/提示框/折叠块）× 首行退格 / 末行 Delete / 中间回车；外加几组对照
const CASES = [
  ['引用块 首行退格', '<p id="a">上一块</p><blockquote id="Q"><p id="q1">引甲</p><p id="q2">引乙</p></blockquote>', () => caretStart('#q1').then(() => key('Backspace'))],
  ['引用块 末行 Delete', '<blockquote id="Q"><p id="q1">引甲</p><p id="q2">引乙</p></blockquote><p id="z">下一块</p>', () => caretEnd('#q2').then(() => key('Delete'))],
  ['提示框 首行退格', '<p id="a">上一块</p><div class="ws-callout" id="C"><p id="c1">框甲</p><p id="c2">框乙</p></div>', () => caretStart('#c1').then(() => key('Backspace'))],
  ['提示框 末行 Delete', '<div class="ws-callout" id="C"><p id="c1">框甲</p><p id="c2">框乙</p></div><p id="z">下一块</p>', () => caretEnd('#c2').then(() => key('Delete'))],
  ['单段引用块 首行退格', '<p id="a">上一块</p><blockquote id="Q">引用一段</blockquote>', () => caretStart('#Q').then(() => key('Backspace'))],
  ['单段引用块 末行 Delete', '<blockquote id="Q">引用一段</blockquote><p id="z">下一块</p>', () => caretEnd('#Q').then(() => key('Delete'))],
  ['折叠块 体内首块退格', '<p id="a">上一块</p><details id="D" open><summary id="S">标题</summary><p id="d1">体内</p></details>', () => caretStart('#d1').then(() => key('Backspace'))],
  ['折叠块 后一块行首退格（上一块是折叠块）', '<details id="D" open><summary id="S">标题</summary><p id="d1">体内</p></details><p id="z">下一块</p>', () => caretStart('#z').then(() => key('Backspace'))],
  ['表格后一块行首退格', '<table id="T"><tbody><tr><td>甲</td></tr></tbody></table><p id="z">下一块</p>', () => caretStart('#z').then(() => key('Backspace'))],
  ['表格前一块末尾 Delete', '<p id="a">上一块</p><table id="T"><tbody><tr><td>甲</td></tr></tbody></table>', () => caretEnd('#a').then(() => key('Delete'))],
  ['引用块中间回车', '<blockquote id="Q"><p id="q1">引甲</p></blockquote>', async () => { await frame.locator('#q1').click(); await page.waitForTimeout(160); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60); await key('Enter'); }],
  ['对照组：普通段落行首退格（应当有反应）', '<p id="a">上一块</p><p id="b">这一块</p>', () => caretStart('#b').then(() => key('Backspace'))],
];

test.afterEach(async () => { await closeApp(); });

test('死键扫描', async () => {
  test.setTimeout(300000);
  const rows = [];
  for (const [name, body, run] of CASES) {
    await closeApp(); await launch();
    await openDoc(body);
    const b = await readState();
    let err = null;
    try { await run(); } catch (e) { err = String(e).split('\n')[0]; }
    const a = await readState();
    rows.push({ name, dead: b.body === a.body && !a.dirty, conform: b.conform, degraded: b.degraded, err,
      before: b.body.slice(0, 90), after: a.body.slice(0, 90) });
  }
  console.log('=== DEADKEY ===\n' + JSON.stringify(rows, null, 1));
  console.log('=== 死键 ' + rows.filter((r) => r.dead).length + ' / ' + rows.length + ' ===');
});
