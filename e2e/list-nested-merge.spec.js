// Colin 2026-08-04 实机试玩抓到的 bug：「一行里出现两个勾选框」。
// 盘上真实结构是 <li>（自己没文字）<ul class=ws-todo><li>21341</li></ul></li> —— 空壳宿主行自己画一个
// 勾选框、嵌套首项再画一个，而空 li 高度几乎为 0，两个绝对定位的 ::before 落到同一个 y 上。
// 复现矩阵还查出第二个缺陷：嵌套行行首退格原来交原生处理，Chromium 会把「打字样式」包成
// <span style="font-family: -apple-system, …"> 写进磁盘。
// 两条都修：① 空壳宿主行在 markDirty 出口归一（补占位 <br> 让它占住自己那一行）；
//          ② 嵌套行行首退格自己接管，不再落回原生。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2nest-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc-' + Date.now() + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(450);
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
// ⚠ 只能查 <body> 段：入盘的基线语义 CSS 本身就含 font-family，整篇查会恒真（第一版断言就栽在这）
const diskBody = async () => (await serialize()).split('<body')[1] || '';
const conform = async () => page.evaluate((x) => { const d = new DOMParser().parseFromString(x, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, await serialize());
const BS = async () => { await page.keyboard.press('Backspace'); await page.waitForTimeout(300); };
async function caretAtRowStart(sel) {
  await frame.locator(sel).click({ position: { x: 12, y: 8 } });
  await page.keyboard.press('Home');
  await page.waitForTimeout(140);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('G1 空壳宿主行必须占住自己那一行——宿主与嵌套首项的勾选框绝不同一行（Colin 实机症状）', async () => {
  await launch();
  // Colin 盘上的真实结构：宿主 li 自己没有任何文字，只裹着一个嵌套列表
  await openDoc('<ul class="ws-todo" id="L"><li id="host"><ul class="ws-todo"><li id="kid">21341</li></ul></li><li>124123</li></ul>');
  const geo = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const host = d.getElementById('host');
    const sub = host.querySelector(':scope > ul');
    const kid = d.getElementById('kid');
    return { hostTop: Math.round(host.getBoundingClientRect().top), subTop: Math.round(sub.getBoundingClientRect().top), kidTop: Math.round(kid.getBoundingClientRect().top) };
  });
  // 勾选框是 ::before 绝对定位在各自 li 的 top 附近，量不到伪元素就量它们的宿主行 —— 症状等价：
  // 修前 hostTop === kidTop（两个框同一 y）；修后宿主行先占一行，差出一个行高
  expect(geo.kidTop - geo.hostTop, '宿主行与嵌套首项必须错开至少一个行高（修前两者相等 = 两个勾选框挤一行）').toBeGreaterThanOrEqual(16);
  expect(await conform()).toBe(true);
});

test('G2 嵌套行行首退格：并入前兄弟、磁盘绝不出现原生的 style 垃圾', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li>父<ul class="ws-todo"><li id="a">子甲</li><li id="b">子乙</li></ul></li></ul>');
  await caretAtRowStart('#b');
  await BS();
  const rows = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#L > li > ul > li')].map((li) => li.textContent.trim());
  });
  expect(rows, '子乙并入子甲').toEqual(['子甲子乙']);
  const disk = await diskBody();
  expect(disk, '绝不把 Chromium 的「打字样式」<span style="font-family…"> 写进正文').not.toMatch(/font-family/);
  expect(disk, '正文里不该冒出任何 style 属性').not.toMatch(/\sstyle="/);
  expect(disk, '也不该冒出 <span> 包裹').not.toMatch(/<span/);
  expect(await conform()).toBe(true);
});

test('G3 嵌套行、前兄弟是空行：并入后不留空壳宿主行、不留幽灵空 ul', async () => {
  await launch();
  // 复现矩阵里的 case B —— Colin 那份文档就是这么长出来的
  await openDoc('<ul class="ws-todo" id="L"><li>父<ul class="ws-todo"><li id="a"><br></li><li id="b">21341</li></ul></li></ul>');
  await caretAtRowStart('#b');
  await BS();
  const out = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const ghosts = [...d.querySelectorAll('li')].filter((li) => {
      const sub = li.querySelector(':scope > ul, :scope > ol');
      if (!sub) return false;
      let own = ''; for (const n of li.childNodes) { if (n === sub) break; own += (n.textContent || ''); if (n.nodeType === 1 && n.tagName === 'BR') own += 'X'; }
      return own === '';
    }).length;
    return { ghosts, kid: (d.querySelector('#L > li > ul > li') || {}).textContent };
  });
  expect(out.ghosts, '不得留下「自己没内容、只裹嵌套列表」的空壳行').toBe(0);
  expect((out.kid || '').trim(), '内容并进空的前兄弟').toBe('21341');
  expect(await serialize()).not.toMatch(/<ul[^>]*>\s*<\/ul>/);
  // ⚠ 这条断言必须放在**这个**前置结构上：变异自检实测，只有「前兄弟是空行」这一种才会让
  //   Chromium 吐出打字样式 span。放在 G2 那种「前兄弟非空」的用例上是哑的（把接管改回原生，G2 照绿）。
  const disk = await diskBody();
  expect(disk, '正文绝不出现 Chromium 的打字样式 <span style="font-family…">').not.toMatch(/font-family/);
  expect(disk, '正文不该冒出 <span> 包裹').not.toMatch(/<span/);
  expect(await conform()).toBe(true);
});

test('G4 嵌套【首】行行首退格：并入宿主行文字，后续兄弟仍留在父下（Notion 第②步）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="host">宿主<ul class="ws-todo"><li id="a">子甲</li><li id="b">子乙</li></ul></li></ul>');
  await caretAtRowStart('#a');
  await BS();
  const out = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const host = d.getElementById('host');
    const sub = host.querySelector(':scope > ul');
    let own = ''; for (const n of host.childNodes) { if (n === sub) break; own += (n.textContent || ''); }
    return { own: own.trim(), rest: sub ? [...sub.children].map((li) => li.textContent.trim()) : [] };
  });
  expect(out.own, '并进宿主行【文字末尾】，不是吊到子项下面').toBe('宿主子甲');
  expect(out.rest, '后续兄弟原地不动、仍在父下').toEqual(['子乙']);
  expect(await diskBody(), '正文不得含原生打字样式垃圾').not.toMatch(/font-family/);
  expect(await conform()).toBe(true);
});

test('G5 归一化不乱动正常宿主行（有文字的父行不该被塞占位）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="host">我有文字<ul><li>子一</li></ul></li></ul>');
  await frame.locator('#host').click({ position: { x: 12, y: 8 } });
  await page.keyboard.type('X');
  await page.waitForTimeout(300);
  const own = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const host = d.getElementById('host');
    const sub = host.querySelector(':scope > ul');
    let s = ''; for (const n of host.childNodes) { if (n === sub) break; s += (n.nodeType === 1 && n.tagName === 'BR') ? '<br>' : (n.textContent || ''); }
    return s;
  });
  expect(own, '有文字的宿主行不得被插入占位 <br>').not.toContain('<br>');
  expect(await conform()).toBe(true);
});
