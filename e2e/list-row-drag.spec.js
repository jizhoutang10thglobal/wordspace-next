// U2 行级拖拽重排（粒度对齐 B，plan 2026-08-03-002）：
// 同列表重排 / 跨同类列表迁移 / 拆出成独立块 / 源列表掏空清理 / 跨类型拒收 / 取消零变更 /
// 勾选态与 id 保真 / undo 一步还原。合成 DragEvent 驱动（行拖拽起点=真实 hover 后的 grip）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2rowdrag-'));
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
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
const bodyOrder = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].map((el) => el.tagName + (el.id ? '#' + el.id : ''));
});
const rowTexts = (listSel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelector(s).children].filter((x) => x.tagName === 'LI').map((li) => li.firstChild ? (li.firstChild.textContent || '').trim() : '');
}, listSel);
// 行拖拽合成序列：真实 hover 起点（置 hoverRow）→ grip dragstart → 目标 dragover/drop（clientY 按半区）→ dragend
// ⚠ E4 之后 **clientX 是有语义的**：落点相对「内容列左缘」每右移 26px 深一层（对拍 Notion 实测）。
// 所以基准点锚在内容列左缘、用 dx 显式表达意图；不传 = 0 = 同级兄弟。
//（E4 之前这里写死「目标行 rect.x + 20」——按新规则那个位置本来就该嵌套，既有用例的预期迁移即源于此。）
async function dragRowTo(srcSel, tgtSel, place, dropToo = true, dx = 0) {
  await frame.locator(srcSel).hover();
  await page.waitForTimeout(150);
  return page.evaluate((q) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const tgt = d.querySelector(q.tgtSel);
    if (!grip || !tgt) return 'missing';
    const root = d.querySelector('[data-ws2-root]') || d.body;
    const rr = root.getBoundingClientRect();
    const x = Math.round(rr.left + (parseFloat(getComputedStyle(root).paddingLeft) || 0) + q.dx);
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    const y = q.place === 'top' ? r.top + 3 : r.bottom - 3;
    tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    const mark = tgt.getAttribute('data-ws2-drop');
    // 指示线三属性在 dragend 时会被 clearDrop 一起清掉——必须**在这里**抓拍，事后再读只会读到 null
    const par = d.querySelector('[data-ws2-dropparent]');
    window.__ws2DropProbe = { mark, indent: tgt.getAttribute('data-ws2-dropindent'), parent: par ? par.id : null };
    if (q.dropToo) tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return mark;
  }, { tgtSel, place, dropToo, dx });
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('同列表重排：第二行拖到第一行上方 + undo 一步还原', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li><li id="r3">三</li></ul>');
  const mark = await dragRowTo('#r2', '#r1', 'top');
  expect(mark, '目标行上半区指示线=top').toBe('top');
  expect((await rowTexts('#L')).join(''), '行序变为 二一三').toBe('二一三');
  expect(await conformOf(await serialize()), '磁盘合规').toBe(true);
  await menu('undo');
  await expect.poll(async () => (await rowTexts('#L')).join(''), { message: 'undo 一步回原序' }).toBe('一二三');
});

test('指示线半区 + 取消拖拽零变更', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  const markTop = await dragRowTo('#r2', '#r1', 'top', false);
  expect(markTop, '上半区=top').toBe('top');
  const markBottom = await dragRowTo('#r2', '#r1', 'bottom', false);
  expect(markBottom, '下半区=bottom').toBe('bottom');
  const cleared = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return d.querySelectorAll('[data-ws2-drop]').length;
  });
  expect(cleared, 'dragend 后指示线清除').toBe(0);
  expect((await rowTexts('#L')).join(''), '没 drop=零变更').toBe('一二');
});

test('跨列表迁移（同类 todo）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="A"><li id="a1">甲</li><li id="a2">乙</li></ul><p>隔断</p><ul class="ws-todo" id="B"><li id="b1">丙</li></ul>');
  await dragRowTo('#a2', '#b1', 'bottom');
  expect((await rowTexts('#A')).join(''), '源列表剩 甲').toBe('甲');
  expect((await rowTexts('#B')).join(''), '目标列表变 丙乙').toBe('丙乙');
  expect(await conformOf(await serialize())).toBe(true);
});

test('拖到列表外：拆出成独立同类型单行列表', async () => {
  await launch();
  await openDoc('<p id="pre">上</p><ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li></ul><p id="post">下</p>');
  await dragRowTo('#r2', '#post', 'bottom');
  expect((await bodyOrder()).join(','), '新列表块落段落之后').toBe('P#pre,UL#L,P#post,UL');
  const split = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const nl = d.body.lastElementChild;
    return { cls: nl.className, rows: nl.querySelectorAll('li').length, text: nl.textContent.trim() };
  });
  expect(split.cls, '拆出列表继承 ws-todo').toBe('ws-todo');
  expect(split.rows).toBe(1);
  expect(split.text).toBe('二');
  expect((await rowTexts('#L')).join(''), '源列表剩 一').toBe('一');
  expect(await conformOf(await serialize())).toBe(true);
});

test('唯一行拆出：源列表整块消失、无空 ul 残留', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">独苗</li></ul><p id="p1">段落</p>');
  await dragRowTo('#r1', '#p1', 'bottom');
  expect((await bodyOrder()).join(','), '源 ul 消失、新 ul 在段落后').toBe('P#p1,UL');
  const emptyUl = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('ul')].filter((u) => !u.querySelector('li')).length;
  });
  expect(emptyUl, '无空 ul').toBe(0);
  expect(await conformOf(await serialize())).toBe(true);
});

test('嵌套行拖到顶层：嵌套 ul 移除、宿主行保留', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">父项<ul class="ws-todo"><li id="n1">嵌套甲</li></ul></li><li id="r2">第二项</li></ul>');
  await dragRowTo('#n1', '#r2', 'bottom');
  expect((await rowTexts('#L')).join('|'), '嵌套行升为顶层末行').toBe('父项|第二项|嵌套甲');
  const nested = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { subUl: d.querySelectorAll('#L ul').length, host: d.getElementById('r1').textContent.trim() };
  });
  expect(nested.subUl, '掏空的嵌套 ul 已移除').toBe(0);
  expect(nested.host, '宿主行文字完好').toBe('父项');
  expect(await conformOf(await serialize())).toBe(true);
});

// E3（2026-08-04）预期迁移：跨类型从「拒收」改成「允许且**被拖的行类型不变**」。
// **为什么新预期才是对的**：Notion 实测跨类型拖拽允许，且拖过去类型不变（它每块自带类型、没有列表容器）。
// Colin 拍板「Notion 怎么做我们怎么做」。我们是 <ul> 容器模型 → 保住类型只能在落点把目标列表劈开，
// 插一张源类型的列表；视觉终态（一个待办行夹在两个圆点行之间）与 Notion 一致。
// 旧断言「零变更/不亮指示线」整条作废——它守的是一个已被推翻的决策，不是一条被削弱的护栏。
test('E3 跨类型拖拽：允许、类型不变、在落点把目标列表劈开', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="T"><li id="t1">待办</li><li id="t2">待办二</li></ul><ul id="P"><li id="p1">普通甲</li><li id="p2">普通乙</li></ul>');
  const mark = await dragRowTo('#t2', '#p1', 'bottom');
  expect(mark, '跨类型现在亮指示线').toBe('bottom');
  expect((await rowTexts('#T')).join(''), '源列表剩「待办」').toBe('待办');
  // 目标列表被劈开：普通甲 / 待办二(ws-todo) / 普通乙，三张顶层列表
  const shape = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.children].map((el) => el.tagName + (el.classList.contains('ws-todo') ? '.todo' : '') + '[' + [...el.children].filter((c) => c.tagName === 'LI').map((li) => li.textContent.trim()).join(',') + ']').join(' ');
  });
  expect(shape, '被拖的行保住 ws-todo 类型，目标列表在落点劈成两张').toBe('UL.todo[待办] UL[普通甲] UL.todo[待办二] UL[普通乙]');
  expect(await conformOf(await serialize()), '磁盘合规').toBe(true);
});

test('E3 跨类型落在目标列表末尾：不产生空列表残段', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="T"><li id="t1">待办</li><li id="t2">待办二</li></ul><ul id="P"><li id="p1">普通甲</li></ul>');
  await dragRowTo('#t2', '#p1', 'bottom');
  const shape = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.children].map((el) => el.tagName + (el.classList.contains('ws-todo') ? '.todo' : '') + '[' + [...el.children].filter((c) => c.tagName === 'LI').map((li) => li.textContent.trim()).join(',') + ']').join(' ');
  });
  expect(shape, '落在末尾 → 新列表接在目标列表之后，不留空 <ul>').toBe('UL.todo[待办] UL[普通甲] UL.todo[待办二]');
  expect(await serialize()).not.toMatch(/<ul[^>]*>\s*<\/ul>/);
  expect(await conformOf(await serialize())).toBe(true);
});

test('E4 落点右移一个缩进单位 → 成为上一行的子项（类型仍不变）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="T"><li id="t1">待办</li><li id="t2">待办二</li></ul><ul id="P"><li id="p1">普通甲</li></ul>');
  const mark = await dragRowTo('#t2', '#p1', 'bottom', true, 26);
  expect(mark, '亮指示线').toBe('bottom');
  const nested = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const sub = d.querySelector('#p1 > ul, #p1 > ol');
    return sub ? { tag: sub.tagName, todo: sub.classList.contains('ws-todo'), txt: [...sub.children].map((li) => li.textContent.trim()).join(',') } : null;
  });
  expect(nested, '成为「普通甲」的子项，且保住 ws-todo 类型').toEqual({ tag: 'UL', todo: true, txt: '待办二' });
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.body.children.length), '顶层块数：源列表 + 目标列表 = 2').toBe(2);
  expect(await conformOf(await serialize())).toBe(true);
});

test('E4 层级被「上一行深度 + 1」钳死：落点极右也只嵌一层（Notion 实测同款）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">甲</li><li id="b">乙</li></ul>');
  await dragRowTo('#b', '#a', 'bottom', true, 26 * 8); // 理论 8 层
  const depth = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const li = [...d.querySelectorAll('li')].find((x) => x.textContent.trim() === '乙');
    let n = 0; for (let p = li.parentElement; p && p !== d.body; p = p.parentElement) if (p.tagName === 'LI') n++;
    return n;
  });
  expect(depth, '只嵌一层，不是 8 层').toBe(1);
  expect(await conformOf(await serialize())).toBe(true);
});

test('E4 指示线的缩进量与落位一致（画的和做的必须是同一层）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">甲</li><li id="b">乙</li><li id="c">丙</li></ul>');
  // 只 dragover 不 drop，读指示线属性
  await dragRowTo('#c', '#a', 'bottom', false, 26);
  // 抓拍存在【外层 window】（helper 的 evaluate 跑在外层页面上下文，不是 iframe 里）
  const ind = await page.evaluate(() => window.__ws2DropProbe);
  expect(ind.indent, '缩进量=1 级').toBe('1');
  expect(ind.parent, '父行「甲」高亮（告诉用户进的是它下面）').toBe('a');
  // 再真 drop，落位必须与刚才画的一致
  await dragRowTo('#c', '#a', 'bottom', true, 26);
  const sub = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.querySelector('#a > ul');
    return s ? [...s.children].map((li) => li.textContent.trim()).join(',') : null;
  });
  expect(sub, '落位=指示线画的那一层').toBe('丙');
});

test('E4 落点回到内容列左缘 → 同级兄弟（不嵌套）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">甲<ul><li id="n1">子一</li></ul></li><li id="b">乙</li></ul>');
  await dragRowTo('#b', '#n1', 'bottom', true, 0);
  const top = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#L > li')].map((li) => (li.firstChild ? li.firstChild.textContent.trim() : ''));
  });
  expect(top, '落在内容列左缘 → 升回顶层，排在「甲」之后').toEqual(['甲', '乙']);
  expect(await conformOf(await serialize())).toBe(true);
});

test('勾选态与 id 随行迁移保真', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="k1" data-checked="true">已勾</li><li id="r2">未勾</li></ul>');
  await dragRowTo('#k1', '#r2', 'bottom');
  const kept = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const li = d.getElementById('k1');
    return { checked: li.getAttribute('data-checked'), pos: [...li.parentElement.children].indexOf(li) };
  });
  expect(kept.checked, 'data-checked 保真').toBe('true');
  expect(kept.pos, '移到第二位').toBe(1);
  const html = await serialize();
  expect(html.includes('data-checked="true"'), '入盘勾选保真').toBe(true);
  expect(await conformOf(html)).toBe(true);
});

test('拖进自己子树拒收：带嵌套的行拖到自己的嵌套子行上零变更', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">父项<ul class="ws-todo" id="S"><li id="n1">嵌套甲</li></ul></li></ul>');
  await dragRowTo('#r1', '#n1', 'bottom');
  expect((await rowTexts('#L')).join(''), '顶层不变').toBe('父项');
  expect((await rowTexts('#S')).join(''), '嵌套不变').toBe('嵌套甲');
  expect(await conformOf(await serialize())).toBe(true);
});
