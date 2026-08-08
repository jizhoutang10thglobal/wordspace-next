// E1/E2 行首退格「逐层剥离」门（2026-08-04，Colin 拍板「Notion 怎么做我们怎么做」）
// Notion 对拍实证（fixture「对拍fixture-E1补测-v2」，每条都用哨兵字符自证过光标落点）：
//   顶层列表行 ① 剥掉列表格式、原地变文本块、列表在此劈开、**不合并**；② 才并入上一块
//   空行 / 唯一行 / 已勾选待办  → 同一条规则（勾选态随格式一并丢弃）
//   嵌套行 ① 是「嵌套的文本块」→ 我们文法表达不了，压成 Notion 的 ②（并入前兄弟 / 宿主行文字）= 现有行为
//   标题块 → **不剥格式，直接合并**（与列表/toggle 不同，别一起改）
//   折叠块标题 ① toggle→文本块（体内块跟着）；我们 <p> 不能有子 → 一步到位提升为其后的兄弟
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, docPath;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2peel-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>${body}</body></html>`;
  docPath = path.join(tmpDir, 'doc-' + Date.now() + '.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(450);
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conform = async () => page.evaluate((x) => { const d = new DOMParser().parseFromString(x, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, await serialize());
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
// 形态串：顶层块的标签 + 文字（含标签自身属性无关），足以判「劈开 / 位置 / 合并」三件事
const shape = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].map((el) => el.tagName + '[' + (el.textContent || '').trim().replace(/\s+/g, '') + ']').join(' ');
});
// 光标落到某行行首：点进该行再 Home（走真实导航路径，不用程序化 range——那会绕过 enterEdit）
// ⚠ 带嵌套子树的行：元素几何中心落在【子列表】上，默认 click() 会把光标丢进子项（本文件 E1-7 踩过）。
//   对这类行必须传 pos 瞄父行自己那条文字行。
async function caretAtRowStart(sel, pos) {
  await frame.locator(sel).click(pos ? { position: pos } : undefined);
  await page.keyboard.press('Home');
  await page.waitForTimeout(140);
}
const TXTROW = { x: 20, y: 8 };
const BS = async () => { await page.keyboard.press('Backspace'); await page.waitForTimeout(260); };

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('E1-1 顶层圆点【中间】行：① 原地剥成文本、列表劈成两段、不合并；② 才并入上一块末项文字', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L"><li id="a">甲</li><li id="b">乙</li><li id="c">丙</li></ul>');
  await caretAtRowStart('#b');
  await BS();
  expect(await shape(), '① 劈成「前段 / 甲 / 段落乙 / 丙」，乙原地不动').toBe('P[前段] UL[甲] P[乙] UL[丙]');
  expect(await conform(), '① 中间态合规（会被自动保存写盘）').toBe(true);
  await BS();
  // ⚠ 只断言 shape() 是【哑门】：块级 textContent 里，「一项『甲乙』」和「两项『甲』『乙』」长得一模一样
  //   （变异自检实测：把并入改回「追加成新 li」，只看 shape 的断言照样全绿）。必须逐项查 li。
  const lis = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.querySelectorAll(':scope > ul')].map((u) => [...u.children].filter((c) => c.tagName === 'LI').map((l) => l.textContent.trim()));
  });
  // S1（2026-08-08）起两半在并回后由 coalesceAdjacentLists 重新合成**一张**（磁盘正本=一张 canonical
  // 列表；E1 契约原文「终态与旧的一次性合并完全一致」——旧一次性合并从不劈表）。旧期望 [['甲乙'],['丙']]
  // 是把 S1 bug 的产物形状（并排两张）钉成了门。
  expect(lis, '② 并入上一块的【末项文字】拼成一项，不是多出一个列表项（Notion 实测同款）；两半合回一张').toEqual([['甲乙', '丙']]);
  expect(await shape()).toBe('P[前段] UL[甲乙丙]');
  expect(await conform()).toBe(true);
});

test('E1-1b 段落行首退格并入上一列表：并进末项文字，不追加成新项（与剥离后再退一次同款）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">甲</li><li id="b">乙</li></ul><p id="p1">段落</p>');
  await caretAtRowStart('#p1');
  await BS();
  const lis = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#L > li')].map((l) => l.textContent.trim());
  });
  expect(lis, 'Notion 实测：父后行 + 分隔二 → 一项「父后行分隔二」，不是两项').toEqual(['甲', '乙段落']);
  expect(await conform()).toBe(true);
});

test('E1-2 顶层【首】行：① 剥离后前面没有列表残段；② 并入上一段落', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L"><li id="a">甲</li><li id="b">乙</li></ul>');
  await caretAtRowStart('#a');
  await BS();
  expect(await shape(), '① 首行剥出成段落、剩余行留在原列表').toBe('P[前段] P[甲] UL[乙]');
  await BS();
  expect(await shape(), '② 并入上一段落').toBe('P[前段甲] UL[乙]');
  expect(await conform()).toBe(true);
});

test('E1-3 编号列表：剥离【中间】行后，前段序号不变（保 start），后段从 1 重排', async () => {
  await launch();
  await openDoc('<ol id="L" start="5"><li id="a">五</li><li id="b">六</li><li id="c">七</li></ol>');
  await caretAtRowStart('#b');
  await BS();
  const ols = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.querySelectorAll(':scope > ol')].map((o) => ({ start: o.getAttribute('start'), txt: o.textContent.trim() }));
  });
  expect(ols.length, '劈成两张 ol').toBe(2);
  expect(ols[0].start, '前段必须继承 start=5（分割点之前的序号一个都不该变）').toBe('5');
  expect(ols[1].start, '后段不带 start = 从 1 重排').toBeNull();
  expect(await shape()).toBe('OL[五] P[六] OL[七]');
  // 反哑门：产物段落不许把 start 属性带走（曾把 start 搬到 <p> 上写进磁盘 = 垃圾属性）
  expect(await serialize(), '产物段落不得携带 start 属性').not.toMatch(/<p[^>]*\sstart=/);
  expect(await conform()).toBe(true);
});

test('E1-4 已勾选待办行剥离：变成普通段落、勾选态随格式一并丢弃（Notion 同款）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L" class="ws-todo"><li data-checked="true" id="a">已勾</li><li data-checked="false" id="b">未勾</li></ul>');
  await caretAtRowStart('#a');
  await BS();
  expect(await shape()).toBe('P[前段] P[已勾] UL[未勾]');
  const html = await serialize();
  expect(html, '产物段落不得残留 data-checked').not.toMatch(/<p[^>]*data-checked/);
  expect(html, '剩下那项的勾选态不受影响').toMatch(/data-checked="false"/);
  expect(await conform()).toBe(true);
});

test('E1-5 顶层【空】行剥离：变空段落、绝不留 <ul></ul> ghost、光标不丢（Wendi bug4 护栏）', async () => {
  await launch();
  // 空项带 <br>：编辑器自己造的空行就是这个形态；写成 <li></li> 高度为 0、Playwright 判定不可见点不到
  await openDoc('<ul id="L" class="ws-todo"><li id="a">甲</li><li id="b"><br></li><li id="c">丙</li></ul>');
  await frame.locator('#b').click();
  await page.waitForTimeout(140);
  await BS();
  expect(await shape()).toBe('UL[甲] P[] UL[丙]');
  expect(await serialize(), '绝不留无 li 的空列表').not.toMatch(/<ul[^>]*>\s*<\/ul>/);
  const ed = await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; const e = d.querySelector('[contenteditable="true"]'); return e ? e.tagName : null; });
  expect(ed, '光标落在剥出来的段落里').toBe('P');
  expect(await conform()).toBe(true);
});

test('E1-6 唯一行列表：一次剥离即整块 de-list 成段落', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L"><li id="a">独苗</li></ul>');
  await caretAtRowStart('#a');
  await BS();
  expect(await shape()).toBe('P[前段] P[独苗]');
  expect(await serialize()).not.toMatch(/<ul/);
  expect(await conform()).toBe(true);
});

test('E1-7 带子项的顶层行剥离：子项一个都不能丢（降级成顶层列表接在产物后）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">甲</li><li id="b">乙<ul><li>乙1</li><li>乙2</li></ul></li><li id="c">丙</li></ul>');
  // 带子树的行：几何中心落在【子列表】上，click() 默认点中心会把光标丢进子项 → 必须瞄父行那条文字行
  await frame.locator('#b').click({ position: { x: 20, y: 8 } });
  await page.keyboard.press('Home');
  await page.waitForTimeout(140);
  await BS();
  // S1（2026-08-08）起降级出来的子项列表与后半张同类相邻 → 合成一张（Notion：这些就是连续的顶层行）。
  expect(await shape(), '子项作为条目仍存在，不是被拍成文字塞进段落').toBe('UL[甲] P[乙] UL[乙1乙2丙]');
  // 反哑门：必须是真 <li> 节点，不是文字里恰好含「乙1乙2」
  const subCount = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.querySelectorAll(':scope > ul')].map((u) => u.querySelectorAll(':scope > li').length);
  });
  expect(subCount, '两张顶层 ul 的直接 li 数：甲=1 / 子树+丙=3').toEqual([1, 3]);
  expect(await conform()).toBe(true);
});

test('E1-8 嵌套行【不走剥离】：一次退格直接并入前兄弟（= Notion 的第②步，文法所限压成一步）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">父<ul><li id="n1">子甲</li><li id="n2">子乙</li><li id="n3">子丙</li></ul></li></ul>');
  await caretAtRowStart('#n2');
  await BS();
  const nested = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#L > li > ul > li')].map((li) => li.textContent.trim());
  });
  expect(nested, '子乙并入子甲，子丙原地不动、仍在父下').toEqual(['子甲子乙', '子丙']);
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.body.children.length), '顶层块数不变（绝不把嵌套行抽成顶层块）').toBe(1);
  expect(await conform()).toBe(true);
});

test('E1-9 标题块行首退格：直接合并、**不剥格式**（与列表/toggle 分道，别一起改）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><h2 id="h">标题</h2>');
  await caretAtRowStart('#h');
  await BS();
  expect(await shape(), '一次按键就并入上一块（没有「先变成 P[标题]」这个中间态）').toBe('P[前段标题]');
  expect(await conform()).toBe(true);
});

test('E1-10 连按不出死键：剥离 → 删空段落 → 光标回列表末项 → 还能继续剥（今日引入的回归）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L" class="ws-todo"><li id="a"></li><li id="b">乙</li></ul>');
  await frame.locator('#b').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(140);
  const seq = [];
  for (let i = 0; i < 5; i++) { await BS(); seq.push(await shape()); }
  expect(seq, '五次退格必须步步有变化，绝不出现「连按纹丝不动」的死键').toEqual([
    'P[前段] UL[]',        // 删掉「乙」
    'P[前段] UL[] P[]',    // 空行剥成空段落
    'P[前段] UL[]',        // 空段落被删，光标回到列表末项【内】（这一步曾把光标停在 <ul> 层 → 后续全哑）
    'P[前段] P[]',         // 末项也是空的顶层行 → 整块 de-list
    'P[前段]',             // 空段落并入前段
  ]);
  expect(await conform()).toBe(true);
});

test('E1-11 剥离可一步 undo 还原（不留中间态）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">甲</li><li id="b">乙</li><li id="c">丙</li></ul>');
  await caretAtRowStart('#b');
  await BS();
  expect(await shape()).toBe('UL[甲] P[乙] UL[丙]');
  await menu('undo');
  await page.waitForTimeout(420);
  expect(await shape(), 'undo 一步回到原列表').toBe('UL[甲乙丙]');
  expect(await conform()).toBe(true);
});

test('E2-1 折叠块标题行首退格：① 降级成段落、体内块提升为其后兄弟（不再是零反馈死胡同）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><details open id="D"><summary id="S">标题</summary><p id="b1">体一</p><p id="b2">体二</p></details>');
  await frame.locator('#S').click();
  await page.keyboard.press('Home');
  await page.waitForTimeout(140);
  await BS();
  expect(await shape(), '① toggle 消失，标题成段落，体内两块按序提到其后').toBe('P[前段] P[标题] P[体一] P[体二]');
  expect(await serialize(), '磁盘不再有 details').not.toMatch(/<details/);
  expect(await conform()).toBe(true);
  await BS();
  expect(await shape(), '② 再退一次并入上一块').toBe('P[前段标题] P[体一] P[体二]');
  expect(await conform()).toBe(true);
});

test('E2-2 折叠【态】下按也降级（内容不会因为收着就丢）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><details id="D"><summary id="S">标题</summary><p id="b1">藏起来的正文</p></details>');
  await frame.locator('#S').click();
  await page.keyboard.press('Home');
  await page.waitForTimeout(140);
  await BS();
  expect(await shape()).toBe('P[前段] P[标题] P[藏起来的正文]');
  expect(await conform()).toBe(true);
});

test('E2-3 空折叠块标题退格：解包成空段落、光标落得进去（逃生路径不回归）', async () => {
  await launch();
  await openDoc('<details open id="D"><summary id="S"></summary><p id="b1"></p></details>');
  await frame.locator('#S').click();
  await page.waitForTimeout(140);
  await BS();
  expect(await serialize(), '不再有 details').not.toMatch(/<details/);
  const ed = await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; const e = d.querySelector('[contenteditable="true"]'); return e ? e.tagName : null; });
  expect(ed, '光标落进解包出来的段落（空产物必须带 <br> 才装得住 selection）').toBe('P');
  expect(await shape(), 'W-3：空 toggle 只解包成【一个】空段落，不能凭空多一行').toBe('P[]');
  await page.keyboard.type('还能打字');
  await expect.poll(async () => await shape()).toContain('还能打字');
  expect(await conform()).toBe(true);
});

// ===== 对抗审查 findings 的回归门（2026-08-04，每条先复现再修）=====

test('ADV-1 唯一顶层行 + 带子树：剥离绝不能把整棵子树拍成一个段落（丢内容）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="L"><li id="a">父<ul><li>子一</li><li>子二<ul><li>孙</li></ul></li></ul></li></ul>');
  await caretAtRowStart('#a', TXTROW);
  await BS();
  // 反哑门：必须查真 <li> 节点数，不能只看文字——被拍平后文字仍在，只是全成了一个段落里的 <br>
  const struct = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return {
      shape: [...d.body.children].map((el) => el.tagName).join(' '),
      liCount: d.body.querySelectorAll('li').length,
      liTexts: [...d.body.querySelectorAll('li')].map((li) => (li.firstChild ? li.firstChild.textContent.trim() : '')),
    };
  });
  expect(struct.liCount, '子一/子二/孙 必须仍是三个真列表项（被拍平时这里会变 0）').toBe(3);
  expect(struct.liTexts).toEqual(['子一', '子二', '孙']);
  expect(await shape(), '产物段落 + 子树降级成顶层列表').toBe('P[前段] P[父] UL[子一子二孙]');
  expect(await conform()).toBe(true);
});

test('ADV-1b 待办版：唯一顶层行剥离不得抹掉子项的勾选态', async () => {
  await launch();
  await openDoc('<ul id="L" class="ws-todo"><li id="a">父<ul class="ws-todo"><li data-checked="true">已勾子</li><li>未勾子</li></ul></li></ul>');
  await caretAtRowStart('#a', TXTROW);
  await BS();
  const checked = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.querySelectorAll('li')].map((li) => li.getAttribute('data-checked'));
  });
  expect(checked, '两个子项都还在，勾选态保真').toEqual(['true', null]);
  expect(await conform()).toBe(true);
});

test('ADV-1c 级联：剥完中间行后，剩下的单行列表再退一次也不能炸', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">甲</li><li id="b">乙<ul><li>乙1</li><li>乙2</li></ul></li></ul>');
  await caretAtRowStart('#a');
  await BS(); // 剥「甲」→「乙」成了它那张 ul 的唯一顶层行
  await caretAtRowStart('#b', TXTROW);
  await BS(); // 再剥「乙」
  const liCount = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.body.querySelectorAll('li').length);
  expect(liCount, '乙1/乙2 必须仍是列表项（E1 自己制造的触发条件）').toBe(2);
  expect(await conform()).toBe(true);
});

test('ADV-7 剥离要保住行上的 id（跨文档锚点链接不能被一次退格打断）', async () => {
  await launch();
  // ul 不带 id：产物若已从 <ul> 继承到块锚点 id 就不该被行 id 覆盖，那是既有语义；这里测的是行 id 不该凭空消失
  await openDoc('<p id="p0">前段</p><ul><li id="anchor-a">锚点行</li><li>其它</li></ul>');
  await caretAtRowStart('#anchor-a');
  await BS();
  const found = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.getElementById('anchor-a');
    return el ? { tag: el.tagName, txt: el.textContent.trim() } : null;
  });
  expect(found, 'id 必须迁到产物块上，锚点仍解析得到同一段内容').toEqual({ tag: 'P', txt: '锚点行' });
  expect(await conform()).toBe(true);
});

test('ADV-残余 剥离产物是空块时必须带 <br>（否则光标落不进去 = 死键）', async () => {
  await launch();
  await openDoc('<ul id="L"><li>甲</li><li id="b"></li></ul>');
  await frame.locator('#L').click({ position: { x: 12, y: 8 } });
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const li = d.getElementById('b');
    const r = d.createRange(); r.setStart(li, 0); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(120);
  await BS();
  await page.keyboard.type('还能打字');
  await expect.poll(async () => await shape(), { message: '剥离出的空块必须能落光标继续打字' }).toContain('还能打字');
  expect(await conform()).toBe(true);
});

test('ADV-4 并入上一列表时，目标是【视觉上的上一行】而不是最后一个直接子项', async () => {
  await launch();
  // Notion 实测（fixture 对拍fixture-ADV4）：`- A / 　- A1 / 　- A2 / 段落文字` → 段落并进 A2
  await openDoc('<ul id="L"><li id="a">A<ul><li>A1</li><li id="a2">A2</li></ul></li></ul><p id="p1">段落文字</p>');
  await caretAtRowStart('#p1');
  await BS();
  const out = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const a = d.getElementById('a');
    const sub = a.querySelector(':scope > ul');
    let own = ''; for (const n of a.childNodes) { if (n === sub) break; own += (n.textContent || ''); }
    return { parentOwn: own.trim(), kids: [...sub.children].map((li) => li.textContent.trim()) };
  });
  expect(out.parentOwn, '绝不能并进父行 A（那样文字会跳到 A1/A2 上方）').toBe('A');
  expect(out.kids, '并进最深的那一行 A2').toEqual(['A1', 'A2段落文字']);
  expect(await conform()).toBe(true);
});

test('ADV-4b 删掉空块后，光标也要落到视觉上的上一行（不是父行）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">A<ul><li id="a1">A1</li></ul></li></ul><p id="p1"><br></p>');
  await frame.locator('#p1').click();
  await page.waitForTimeout(140);
  await BS();
  await page.keyboard.type('X');
  await page.waitForTimeout(300);
  const kid = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.getElementById('a1').textContent.trim());
  expect(kid, '接着打的字要落在 A1（视觉上的上一行），不是跑到 A 那一行').toBe('A1X');
  expect(await conform()).toBe(true);
});
