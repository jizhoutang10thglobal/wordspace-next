// 相邻同类列表合并归一门（2026-08-07 todo 深扫 S1）：退格剥出再并回 / 拖走分隔段 之后，
// 一张列表被永久拆成并排两张同类 <ul>——看着是一条连续清单，但 Esc 阶梯 / ⌘A 二档的「整张列表」
// 只圈到前半截，磁盘也是两张。coalesceLists 此前只在 turnIntoMany 被调；修=挂 markDirty/attach
// 总出口全局归一（同类=同 tag+同 class；后表带显式 start 不吞——那是它自己的编号语义）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, docPath, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2co-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.waitForTimeout(250);
}
async function openDoc(body) {
  const tag = 'co' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title></head><body>${body}</body></html>`;
  docPath = path.join(tmpDir, 'd' + seq + '.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(400);
}
const shape = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].filter((e) => !e.hasAttribute('data-ws2-ui'))
    .map((e) => e.tagName + (e.tagName === 'UL' || e.tagName === 'OL'
      ? '(' + e.querySelectorAll(':scope>li').length + (e.classList.contains('ws-todo') ? ',todo' : '') + (e.hasAttribute('start') ? ',start=' + e.getAttribute('start') : '') + ')' : ''));
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); app = null; }
});

const FOUR = '<p id="up">上方段落</p><ul id="L" class="ws-todo"><li id="r1">待办一</li><li id="r2">待办二</li><li id="r3">待办三</li><li id="r4">待办四</li></ul><p id="dn">下方段落</p>';

test('CO-1 剥出再并回：列表必须重新合成一张（S1 主复现）', async () => {
  await launch(); await openDoc(FOUR);
  // r3 行首退格 → 剥成段落（列表劈成两半，设计如此）
  await frame.locator('#r3').click(); await page.waitForTimeout(150);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace'); await page.waitForTimeout(300);
  expect((await shape()).join('|'), '剥出后是 [半张][段落][半张]').toBe('P|UL(2,todo)|P|UL(1,todo)|P');
  // 再退一次 → 段落并回上一行 → 两半必须重新合一
  await page.keyboard.press('Backspace'); await page.waitForTimeout(400);
  expect((await shape()).join('|'), 'S1 主症状：并回后留成并排两张').toBe('P|UL(3,todo)|P'); // 3 行：「待办三」文字并进了 r2
  // 落盘也必须是一张
  await page.waitForTimeout(1800);
  const disk = await fs.readFile(docPath, 'utf8');
  expect((disk.match(/<ul[^>]*ws-todo/g) || []).length, '磁盘上的 ws-todo 列表张数').toBe(1);
});

test('CO-2 Esc 阶梯二档在合并后圈到整张（用户感知面）', async () => {
  await launch(); await openDoc(FOUR);
  await frame.locator('#r3').click(); await page.waitForTimeout(150);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace'); await page.waitForTimeout(250);
  await page.keyboard.press('Backspace'); await page.waitForTimeout(400);
  await frame.locator('#r1').click(); await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const sel = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.querySelector('[data-ws2-selected]');
    return s ? { tag: s.tagName, rows: s.querySelectorAll('li').length } : null;
  });
  expect(sel && sel.tag, '二档=整张列表').toBe('UL');
  expect(sel && sel.rows, '整张 = 并回后的全部 3 行（不是前半截 2 行）').toBe(3);
});

test('CO-3 删掉夹在两张同类列表中间的段落 → 合一（键盘路径）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo"><li id="a1">甲</li><li id="a2">乙</li></ul><p id="mid">夹层段落</p><ul class="ws-todo"><li id="b1">丙</li><li id="b2">丁</li></ul>');
  await frame.locator('#mid').click(); await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.keyboard.press('Backspace'); await page.waitForTimeout(400);
  expect((await shape()).join('|'), '删掉夹层后两张合一').toBe('UL(4,todo)');
});

test('CO-4 负例：不同类不合（todo vs 普通 ul；ol 带显式 start 不吞）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="A"><li>甲</li></ul><ul id="B"><li>乙</li></ul><ol id="C"><li>一</li></ol><ol id="D" start="5"><li>五</li></ol>');
  // 触发一次编辑（归一走 markDirty）
  await frame.locator('#A li').click(); await page.waitForTimeout(150);
  await page.keyboard.press('End'); await page.keyboard.type('X'); await page.waitForTimeout(400);
  expect((await shape()).join('|'), 'todo≠普通 ul 不合；ol[start=5] 有自己的编号语义不吞').toBe('UL(1,todo)|UL(1)|OL(1)|OL(1,start=5)');
});

test('CO-5 合并时光标存活：并回后接着打字落在接合行', async () => {
  await launch(); await openDoc(FOUR);
  await frame.locator('#r3').click(); await page.waitForTimeout(150);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace'); await page.waitForTimeout(250);
  await page.keyboard.press('Backspace'); await page.waitForTimeout(400);
  await page.keyboard.type('续');
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('ul li')].map((li) => li.textContent.trim());
  });
  expect(rows, '光标在接合点（待办二与待办三之间），打字直接生效').toEqual(['待办一', '待办二续待办三', '待办四']);
});
