// I10（Notion 粒度对拍第二批）：从 Finder 拖图片进来，此前 dragover 只设 dropEffect 就 return ——
// 全程零落点反馈，用户松手前不知道图会落在哪；而 docs/features/doc-images.md 早写了「落点 = 块间插入线」。
// 铁则（I4 刚用血换的）：指示线必须由 dropAnchor 本人算 —— 复制一份坐标逻辑就是又一个「画的≠做的」。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2dropind-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}
const DOC = '<p id="p1">第一段</p><p id="p2">第二段</p><p id="p3">第三段</p>';

// 合成一次「OS 图片文件」dragover：真造 File 进 DataTransfer，dt.types 才含 'Files'。
// where: 'upper'|'lower' —— 目标块的上半/下半（dropAnchor 的翻转点是块的垂直中线）
const fileDragOver = (sel, where) => page.evaluate((q) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const t = d.querySelector(q.sel);
  const r = t.getBoundingClientRect();
  const y = q.where === 'upper' ? r.top + r.height * 0.25 : r.bottom - r.height * 0.25;
  const c = d.createElement('canvas'); c.width = 8; c.height = 8;
  const bin = atob(c.toDataURL('image/png').split(',')[1]);
  const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([u8], 'drop.png', { type: 'image/png' }));
  d.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 20), clientY: Math.round(y) }));
  const marked = d.querySelector('[data-ws2-drop]');
  // ⚠ 这里原本只读 `getComputedStyle(marked,'::after').backgroundImage !== none` —— 是哑门（gate 审计实证）：
  // `[data-ws2-drop]::after{background:linear-gradient(...)}` 是**无条件**规则，样式表在就恒真，
  // 跟线有没有生成、有多高、画在哪一律无关。三个变异都能让旧判据保持绿：
  //   ① 删掉 `[data-ws2-drop]{position:relative}` → 线改相对初始包含块定位，永久画在**视口底部**；
  //   ② `content:''` 改 `content:none` → 伪元素根本不生成，Chrome 仍返回级联出的 background-image；
  //   ③ 加 `height:0` → 零像素。
  // 判据必须同时咬住「伪元素真生成」「有高度」「锚块是定位上下文」，才是它声称的那道门。
  // （替换元素 <img> 走 box-shadow 兜底、不生成 ::after，另有 imgLineOf + 像素对照，见 I10-7。）
  const cs = marked ? getComputedStyle(marked, '::after') : null;
  const bg = cs ? cs.backgroundImage : null;
  const drawn = !!cs && cs.content !== 'none' && parseFloat(cs.height) > 0
    && !!bg && bg !== 'none' && bg.indexOf('gradient') !== -1
    && getComputedStyle(marked).position !== 'static';
  return { markedId: marked ? marked.id : null, place: marked ? marked.getAttribute('data-ws2-drop') : null, hasLine: drawn, dropY: Math.round(y) };
}, { sel, where });

const dropFileAt = (dropY) => page.evaluate((y) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const c = d.createElement('canvas'); c.width = 8; c.height = 8;
  const g = c.getContext('2d'); g.fillStyle = '#1e8e3e'; g.fillRect(0, 0, 8, 8);
  const bin = atob(c.toDataURL('image/png').split(',')[1]);
  const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([u8], 'drop.png', { type: 'image/png' }));
  d.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 100, clientY: y }));
}, dropY);

const order = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].filter((el) => !el.hasAttribute('data-ws2-ui')).map((el) => el.tagName + (el.id ? '#' + el.id : ''));
});
const dropMarks = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelectorAll('[data-ws2-drop]')].map((el) => (el.id || el.tagName) + ':' + el.getAttribute('data-ws2-drop'));
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('I10-1 拖文件经过时出现落点插入线（此前全程零反馈）', async () => {
  await launch();
  await openDoc(DOC);
  const r = await fileDragOver('#p2', 'lower');
  expect(r.markedId).toBe('p2');
  expect(r.place).toBe('bottom');
  expect(r.hasLine).toBe(true);
});

test('I10-2 翻转点在块的垂直中线：上半区 = 插在这一块之前', async () => {
  await launch();
  await openDoc(DOC);
  // 【断言迁移，逐条论证】此前这里断的是 markedId === 'p1'（线画在**上一块**下缘）。dropAnchor 改成
  // 返回位置 {el,before} 之后，同一个视觉缝隙改由「p2 的上缘」表达 → markedId 'p2' + place 'top'。
  // 迁移理由：旧表示法里的 `best.i > 0` 短路让「首块之前」这个位置**对任意 clientY 都无解**，
  // 用户没法把图片拖到全文开头（见 I10-8）。线的像素位置与落点结果都不变，变的只是挂在谁身上。
  // 断言强度只增不减：原来只断 markedId，现在 markedId + place 一起断（place 是新增的中间态断言）。
  const up = await fileDragOver('#p2', 'upper');
  expect([up.markedId, up.place]).toEqual(['p2', 'top']);
  const lo = await fileDragOver('#p2', 'lower');
  expect([lo.markedId, lo.place]).toEqual(['p2', 'bottom']);
});

test('I10-3 画的就是做的：线画在谁下面，图就落在谁后面', async () => {
  await launch();
  await openDoc(DOC);
  const r = await fileDragOver('#p2', 'upper');
  expect([r.markedId, r.place]).toEqual(['p2', 'top']); // 迁移同 I10-2：同一条缝隙，改由 p2 上缘表达
  await dropFileAt(r.dropY);
  await expect.poll(async () => (await order()).length, { timeout: 8000 }).toBe(4);
  expect(await order()).toEqual(['P#p1', 'IMG', 'P#p2', 'P#p3']); // 终态断言一字未改：线在这条缝 → 图落这条缝
  expect(await dropMarks()).toEqual([]); // 落完线要收
});

test('I10-4 拖出窗口不松手：幽灵线自己收', async () => {
  await launch();
  await openDoc(DOC);
  expect((await fileDragOver('#p2', 'lower')).markedId).toBe('p2');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    d.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: null }));
  });
  expect(await dropMarks()).toEqual([]);
});

test('I10-6 块间移动的 dragleave 不收线（负向：只认离开窗口那一半判据）', async () => {
  await launch();
  await openDoc(DOC);
  expect((await fileDragOver('#p2', 'lower')).markedId).toBe('p2');
  // 合成事件的 relatedTarget 默认恒为 null，所以 I10-4 那条正向用例其实测不到判据本身
  //（对抗审查 I10 testing gap）。这条显式给 relatedTarget 一个块元素 = 「还在窗口里」，线必须留着。
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    d.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: d.querySelector('#p3') }));
  });
  expect(await dropMarks()).toEqual(['p2:bottom']);
});

test('I10-5 非图片文件被拒时不留线', async () => {
  await launch();
  await openDoc(DOC);
  expect((await fileDragOver('#p2', 'lower')).markedId).toBe('p2');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' }));
    const r = d.querySelector('#p2').getBoundingClientRect();
    d.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 100, clientY: Math.round(r.bottom - 4) }));
  });
  await page.waitForTimeout(300);
  expect(await dropMarks()).toEqual([]);
  expect(await order()).toEqual(['P#p1', 'P#p2', 'P#p3']); // 非图片不插东西
  // 「拒绝」不等于「静默」——实现里那句注释写的是「维持拒绝但**要说出来**」，而在此之前
  // 全仓 `grep -rn dropImagesOnly e2e/` 零命中：把 __wsToast 那行删掉，六条门全绿，
  // 拖个 PDF 进来就成了实现注释明令禁止的静默死路（gate 审计 #3）。
  await expect(page.locator('.sb-toast', { hasText: '图片' })).toBeVisible();
});

// ── 以下为 2026-08-05 对抗审查 + gate 审计的处置（P2 两条、P3 两条）──────────────────

// 1×1 之上的真实尺寸 png：图片必须真解码出高度，「线画在它下缘」的像素断言才有意义
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAAC4wJK5AAAAHElEQVRoge3BAQ0AAADCoPdPbQ43oAAAAAAAAHgaHkAAAcHf9WEAAAAASUVORK5CYII=';
const IMGDOC = `<p id="p1">前段</p><img id="pic" src="${PNG}" alt="图"><p id="p3">后段</p>`;

// 替换元素上的线走 box-shadow（<img> 不生成 ::after），所以判据也换一套
const imgLineOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s);
  const sh = getComputedStyle(el).boxShadow;
  return { shadow: sh, drop: el.getAttribute('data-ws2-drop'), pseudo: getComputedStyle(el, '::after').content };
}, sel);

// 截一条横带（视口坐标，FrameLocator 的 boundingBox 已是主 frame 视口坐标系）
const strip = (x, y, w, h) => page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) } });

test('I10-7 落点锚是图片块时线**真被画出来**（像素对照，不是读样式表）', async () => {
  await launch();
  await openDoc(IMGDOC);
  // 病灶：Blink 不给成功加载的 <img> 生成 ::after，而顶层裸 <img> 是本仓 canonical 的图片块 ——
  // 「往已有图片旁边再拖一张」是这功能最高频的场景，靠伪元素画线在这里 100% 是零像素：
  // 属性设上了、线没有，正是 I10 立论要消灭的「做对了画是空的」。旧 fixture 三块全是 <p>，碰不到。
  const box = await frame.locator('#pic').boundingBox();
  const lineBefore = await strip(box.x, box.y + box.height - 1, box.width, 5); // 图片下缘那条带
  const ctrlBefore = await strip(box.x, box.y + box.height / 2 - 2, box.width, 5); // 图片正中的对照带
  const r = await fileDragOver('#pic', 'lower');
  expect([r.markedId, r.place]).toEqual(['pic', 'bottom']);
  const st = await imgLineOf('#pic');
  // ⚠ 别在这里断 getComputedStyle(img,'::after').content === 'none' —— 实测它返回的是 '""'：
  // **伪元素的 computed style 照样算得出来，哪怕 Blink 根本不给替换元素生成这个盒子**。
  // 这恰恰是 gate 审计说「读 ::after 的 computed style 判有没有线」是哑门的直接证据，
  // 所以这条门只信两样东西：box-shadow 这个真的会渲染的属性，和下面的像素对照。
  expect(st.shadow).toContain('rgb(26, 115, 232)');
  const lineAfter = await strip(box.x, box.y + box.height - 1, box.width, 5);
  const ctrlAfter = await strip(box.x, box.y + box.height / 2 - 2, box.width, 5);
  // 正向：下缘像素必须变（线画出来了）
  expect(Buffer.compare(lineBefore, lineAfter), '图片下缘应出现落点线（像素必须变化）').not.toBe(0);
  // 负向：图片正中必须**不变**。少了这半条，「线跑到视口底部/画在别处」的变异照样能让正向那条绿。
  expect(Buffer.compare(ctrlBefore, ctrlAfter), '对照带不该变——变了说明线没画在该画的地方').toBe(0);
});

test('I10-8 首块上半区：线画在首块上缘，图片真能落到全文开头', async () => {
  await launch();
  await openDoc(DOC);
  // 旧 dropAnchor 的 `best.i > 0` 短路让「首块之前」对任意 clientY 都无解（穷举已证）——
  // h1 之上放封面图这种真实需求，一次拖放做不到；线也只会画在首块下缘，与 spec 的「块间插入线」对不上。
  const r = await fileDragOver('#p1', 'upper');
  expect([r.markedId, r.place]).toEqual(['p1', 'top']);
  expect(r.hasLine).toBe(true);
  await dropFileAt(r.dropY);
  await expect.poll(async () => (await order()).length, { timeout: 8000 }).toBe(4);
  expect(await order()).toEqual(['IMG', 'P#p1', 'P#p2', 'P#p3']); // 修前恒为 ['P#p1','IMG',...]
  expect(await dropMarks()).toEqual([]);
});

test('I10-9 dragover 认了 Files、drop 却给不出文件：线必须自己收', async () => {
  await launch();
  await openDoc(DOC);
  // 画线的门是 `dt.types 含 'Files'`、收线的门是 `dataTransfer.files.length`，两者不同源。
  // 有些拖放源（拖网页里的图、跨 app 的伪文件项）在 dragover 阶段声明 Files、drop 时却给不出文件，
  // 于是两个分支都不进、走到 `if (!dragFrom) return` —— 线留在页面上，下次拖拽前一直挂着。
  expect((await fileDragOver('#p2', 'lower')).markedId).toBe('p2');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const dt = new DataTransfer(); // 空 DataTransfer：types 里没有 Files，files.length === 0
    d.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 100, clientY: 300 }));
  });
  await page.waitForTimeout(200);
  expect(await dropMarks()).toEqual([]);
  expect(await order()).toEqual(['P#p1', 'P#p2', 'P#p3']); // 什么也别插
});
