// 列表编辑态底色 = **行级**（Wendi 2026-08-05：「回车换行后第二行的选中深色还是和上一行连成一起」）。
// 病灶：列表的 editingEl 是整个 <ul>（存储单元），[data-ws2-editing] 的底色画的是它的整个盒子。
// v0.12.2 只下沉了 Esc 的 data-ws2-selected，编辑态这半漏了——因为全仓 e2e 对 data-ws2-editing
// 只有存在性断言、从无几何断言（grip-scope-consistency E-1 的操作序列跟用户复现逐字相同，
// 却只在按完 Esc 之后才开始看）。本 spec 补的就是那道几何门。
//
// ⚠ 断言口径：**读真实 computed background 找出到底谁被染色，再量它的盒子**——不查 class、不查属性。
// 查属性的门在「属性设对了但 CSS 规则写错/被覆盖」时照样绿（S4 血泪：className 断言过而主题全废）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2editrow-'));
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

// 真实着色元素 + 它的几何。全文档扫，谁的 computed background 真是那层底色，谁就是「被染的」。
// ⚠ 两个坑，都是实测栽出来的：
// ① 底色写的是 rgba(0,0,0,.015)，Chrome 吐回来是 **0.016**（舍入）——拿字面量比字符串会 0 命中、假红。
// ② alpha 窗口必须**上封顶到 .025**，把编辑态(.015→.016)与灰选态 [data-ws2-selected] 的 .03 分开。
//    第一版写成 a<0.05，Esc 之后灰选的底色被当成编辑底色收进来，ER-6「退出清零」直接假红。
const tinted = () => frame.locator('body').evaluate((b) => {
  const d = b.ownerDocument, win = d.defaultView;
  const isTint = (s) => {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(s);
    if (!m) return false;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    return m[1] === '0' && m[2] === '0' && m[3] === '0' && a > 0.005 && a < 0.025;
  };
  const hits = [];
  for (const el of [b, ...d.querySelectorAll('*')]) {
    if (isTint(win.getComputedStyle(el).backgroundColor)) {
      const r = el.getBoundingClientRect();
      hits.push({ tag: el.tagName, text: (el.textContent || '').trim().slice(0, 8), h: +r.height.toFixed(1), top: +r.top.toFixed(1) });
    }
  }
  const rows = [...d.querySelectorAll('#lst > li')].map((l) => +l.getBoundingClientRect().height.toFixed(1));
  return { hits, rows };
});

const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);
const caretInto = (sel) => frame.locator(sel).evaluate((el) => {
  const d = el.ownerDocument, r = d.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; frame = null; }
});

test('ER-1 几何正身：编辑三行列表的第 2 行，底色只罩那一行（修前罩 3.3 行）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li><li>第三行</li></ul>');
  await frame.locator('#lst > li').nth(1).click();
  await page.waitForTimeout(250);

  const t = await tinted();
  expect(t.hits.length, '恰有一个元素被染上编辑底色').toBe(1);
  expect(t.hits[0].tag, '被染的是行（LI），不是整张列表（UL）').toBe('LI');
  expect(t.hits[0].text).toContain('第二行');
  // 几何才是这条的实质：修前 = 整个 ul 的高（三行之和 ~93.6），修后 = 单行高（~28）
  expect(t.hits[0].h, '底色高度必须等于单行高，不能罩住兄弟行').toBeLessThanOrEqual(t.rows[1] + 2);
  expect(t.hits[0].h).toBeGreaterThanOrEqual(t.rows[1] - 2);
});

test('ER-2 对照不回归：段落的编辑底色仍是它自己（非列表块一字不改）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li></ul><p id="pp">一个段落</p>');
  await frame.locator('#pp').click();
  await page.waitForTimeout(250);

  const t = await tinted();
  expect(t.hits.length).toBe(1);
  expect(t.hits[0].tag, '段落自身被染').toBe('P');
  const ph = await frame.locator('#pp').evaluate((el) => +el.getBoundingClientRect().height.toFixed(1));
  expect(t.hits[0].h, '底色高度 == 段落自身高度').toBeCloseTo(ph, 0);
});

test('ER-3 跟随光标：换行后底色跟着走，任一时刻恰好一行被染', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="r1">第一行</li><li id="r2">第二行</li><li id="r3">第三行</li></ul>');
  await frame.locator('#r1').click();
  await page.waitForTimeout(250);
  let t = await tinted();
  expect(t.hits.length).toBe(1);
  expect(t.hits[0].text).toContain('第一行');

  await caretInto('#r3');
  await page.waitForTimeout(250);
  t = await tinted();
  expect(t.hits.length, '仍然恰好一行（旧行必须被清掉）').toBe(1);
  expect(t.hits[0].text, '底色跟到第三行').toContain('第三行');
});

test('ER-4 用户原路径：一行 todo → 回车 → 打字，新行不与上一行连成一片', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="r1">第一行</li></ul>');
  await frame.locator('#r1').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.type('第二行');
  await page.waitForTimeout(300);

  const t = await tinted();
  expect(t.hits.length).toBe(1);
  expect(t.hits[0].tag).toBe('LI');
  expect(t.hits[0].text).toContain('第二行');
  expect(t.rows.length, '确实建出了第二行').toBe(2);
  expect(t.hits[0].h, '底色只罩新行，不含第一行').toBeLessThanOrEqual(t.rows[1] + 2);
});

test('ER-5 嵌套取最深：光标在子项时染的是子项那一行', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>父行<ul><li id="sub">子项乙</li></ul></li></ul>');
  await frame.locator('#sub').click();
  await page.waitForTimeout(250);
  const t = await tinted();
  expect(t.hits.length).toBe(1);
  expect(t.hits[0].text, '染的是最深那个 li，不是宿主父行').toContain('子项乙');
});

test('ER-6 退出清零 + 清得掉陈旧标记（只清引用的实现过不去）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="r1">第一行</li><li id="r2">第二行</li></ul><p id="pp">段落</p>');
  await frame.locator('#r2').click();
  await page.waitForTimeout(250);
  expect((await tinted()).hits.length).toBe(1);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  expect((await tinted()).hits.length, '退出编辑后一个都不剩').toBe(0);

  // 第二层：往一个**不是** editRowEl 记着的元素上强行盖标记，再触发选区变化。
  // 只清引用数组的实现清不掉它（这正是 2026-08-05「清不掉的蓝底」的失败画像）。
  await frame.locator('#r1').evaluate((el) => el.setAttribute('data-ws2-editrow', ''));
  await frame.locator('#pp').click();
  await page.waitForTimeout(300);
  const t = await tinted();
  expect(t.hits.every((h) => h.tag !== 'LI'), '陈旧的行标记必须被扫掉').toBe(true);
});

test('ER-7 零入盘：编辑态标记不进磁盘字节，reparse 仍合规', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li></ul>');
  await frame.locator('#lst > li').nth(1).click();
  await page.waitForTimeout(250);
  await page.keyboard.type('改一下');
  await page.waitForTimeout(300);

  const html = await serialize();
  expect(html, '磁盘字节不含行级编辑标记').not.toContain('data-ws2-editrow');
  expect(html, '也不含别的交互标记').not.toContain('data-ws2-editing');
  expect(await conformOf(html), 'reparse 后仍合规').toBe(true);
});
