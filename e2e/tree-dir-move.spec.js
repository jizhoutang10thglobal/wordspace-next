// 文件树目录拖拽移动（p2-1）+ 吸顶祖先行拖放不再死区（p2-5）的 e2e 真门。
//
// p2-1：目录行开 draggable + 复用文件行 dragNode / dir 行既有 drop → 目录可拖进兄弟目录 / 跨根 /
//        拖进自己子孙被拒（前端 dropWouldNest 守卫 + 后端兜底）；目录里打开的标签移动后 rel 跟随。
// p2-5：renderSticky 克隆行照 oncontextmenu 的转发模式补 ondragover/ondrop → 拖到吸顶行 = 拖到真行。
//
// 强断言口径（S4）：移动结果断言落真实磁盘 + 标签 data-rel；被拒断言磁盘纹丝不动。DnD 走合成 DragEvent
// 管线（同 cross-root-move-rewrite 的 dndTo，共享 DataTransfer 串起 dragstart→over→drop→end）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsA, wsB, userData;

async function launch(env) {
  const a = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: userData, ...env } });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  app = a; page = p;
}
const setFolderSeam = (dir) => app.evaluate(({ }, d) => { process.env.WS2_FOLDER_IN = d; }, dir);
const rootHeads = () => page.locator('.sb-root-head:not(.sb-root-missing)');
const dirRow = (rootId, rel) => page.locator(`.sb-dir[data-root="${rootId}"][data-rel="${rel}"]`);
const fileRow = (rootId, rel) => page.locator(`.sb-file[data-root="${rootId}"][data-rel="${rel}"]`);
const onDisk = (p) => fs.stat(p).then(() => true, () => false);

// 合成 DnD：源/目标各按 CSS 选择器取；共享一个 DataTransfer 串 dragstart→dragover→drop→dragend。
async function dnd(srcSel, dstSel) {
  await page.evaluate(({ srcSel, dstSel }) => {
    const src = document.querySelector(srcSel);
    const dst = document.querySelector(dstSel);
    if (!src) throw new Error('dnd 源没找到: ' + srcSel);
    if (!dst) throw new Error('dnd 目标没找到: ' + dstSel);
    const dt = new DataTransfer();
    const ev = (t, el) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    ev('dragstart', src); ev('dragover', dst); ev('drop', dst); ev('dragend', src);
  }, { srcSel, dstSel });
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-dirmove-'));
  userData = path.join(tmp, 'userdata');
  wsA = path.join(tmp, '甲');
  wsB = path.join(tmp, '乙');
  await fs.mkdir(wsA, { recursive: true });
  await fs.mkdir(wsB, { recursive: true });
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app?.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

async function openOne() {
  await launch({ WS2_FOLDER_IN: wsA });
  await page.click('#home-open-folder');
  await expect(rootHeads()).toHaveCount(1);
  return page.$eval('.sb-root-head', (e) => e.dataset.root);
}
async function openTwo() {
  const ra = await openOne();
  await setFolderSeam(wsB);
  await page.click('#sb-add-root');
  await expect(rootHeads()).toHaveCount(2);
  const ids = await page.$$eval('.sb-root-head', (els) => els.map((e) => e.dataset.root));
  return ids;
}
// 目录默认收起——点一下展开露出子行
async function expandDir(rootId, rel) {
  await dirRow(rootId, rel).click();
  await expect(dirRow(rootId, rel).locator('.sb-caret.is-open')).toBeVisible();
}

test('P2-1a 目录拖进兄弟目录：磁盘落到目标里、原位消失', async () => {
  await fs.mkdir(path.join(wsA, '素材'), { recursive: true });
  await fs.writeFile(path.join(wsA, '素材', 'x.html'), HTML('x'), 'utf8');
  await fs.mkdir(path.join(wsA, '归档'), { recursive: true });
  const ra = await openOne();
  await dnd(`.sb-dir[data-root="${ra}"][data-rel="素材"]`, `.sb-dir[data-root="${ra}"][data-rel="归档"]`);
  await expect.poll(() => onDisk(path.join(wsA, '归档', '素材', 'x.html')), { timeout: 4000 }).toBe(true);
  expect(await onDisk(path.join(wsA, '素材'))).toBe(false); // 原位没了
});

test('P2-1b 目录拖进自己的子孙：被拒，磁盘纹丝不动（前端 dropWouldNest 守卫）', async () => {
  await fs.mkdir(path.join(wsA, '父', '子'), { recursive: true });
  await fs.writeFile(path.join(wsA, '父', '子', 'k.html'), HTML('k'), 'utf8');
  await fs.writeFile(path.join(wsA, '父', 'note.html'), HTML('note'), 'utf8'); // 让 父 有两个孩子，别被 compact 链吞成一行
  const ra = await openOne();
  await expandDir(ra, '父'); // 露出 父/子
  await dnd(`.sb-dir[data-root="${ra}"][data-rel="父"]`, `.sb-dir[data-root="${ra}"][data-rel="父/子"]`);
  // 拒绝：结构原样（父/子/k.html 仍在，没冒出 父/子/父/…）
  await expect(page.locator('.sb-toast', { hasText: '不能把文件夹移动到它自己里面' })).toBeVisible();
  expect(await onDisk(path.join(wsA, '父', '子', 'k.html'))).toBe(true);
  expect(await onDisk(path.join(wsA, '父', '子', '父'))).toBe(false);
});

test('P2-1c 目录里打开的标签：移动后标签 rel 跟随', async () => {
  await fs.mkdir(path.join(wsA, '素材'), { recursive: true });
  await fs.writeFile(path.join(wsA, '素材', 'doc.html'), HTML('doc'), 'utf8');
  await fs.mkdir(path.join(wsA, '归档'), { recursive: true });
  const ra = await openOne();
  await expandDir(ra, '素材');
  await fileRow(ra, '素材/doc.html').click(); // 打开 → 建标签
  await expect(page.locator(`#sb-tabs .sb-tab[data-root="${ra}"][data-rel="素材/doc.html"]`)).toBeVisible();
  await dnd(`.sb-dir[data-root="${ra}"][data-rel="素材"]`, `.sb-dir[data-root="${ra}"][data-rel="归档"]`);
  // 标签 rel 变成新路径（不是查 class：直接断言 data-rel 真值）
  await expect(page.locator(`#sb-tabs .sb-tab[data-root="${ra}"][data-rel="归档/素材/doc.html"]`)).toBeVisible({ timeout: 4000 });
  await expect(page.locator(`#sb-tabs .sb-tab[data-root="${ra}"][data-rel="素材/doc.html"]`)).toHaveCount(0);
});

test('P2-1d 跨根拖动目录：从甲移到乙的顶层（同盘 rename）', async () => {
  await fs.mkdir(path.join(wsA, '素材'), { recursive: true });
  await fs.writeFile(path.join(wsA, '素材', 'y.html'), HTML('y'), 'utf8');
  const [ra, rb] = await openTwo();
  await dnd(`.sb-dir[data-root="${ra}"][data-rel="素材"]`, `.sb-root-head[data-root="${rb}"]`);
  await expect.poll(() => onDisk(path.join(wsB, '素材', 'y.html')), { timeout: 4000 }).toBe(true);
  expect(await onDisk(path.join(wsA, '素材'))).toBe(false);
});

test('P2-5 拖到吸顶祖先行 = 拖到真行：文件真的移进该文件夹（变异敏感）', async () => {
  // 造长树：档案 里塞 40 个文件，撑到滚动出吸顶
  await fs.mkdir(path.join(wsA, '档案'), { recursive: true });
  for (let i = 0; i < 40; i++) await fs.writeFile(path.join(wsA, '档案', `f${String(i).padStart(2, '0')}.html`), HTML('f' + i), 'utf8');
  await fs.writeFile(path.join(wsA, '外部.html'), HTML('外部'), 'utf8');
  const ra = await openOne();
  await expandDir(ra, '档案');
  // 滚到「档案」标题被吸顶（它的子行在顶、它自己滚出可视区）
  await page.evaluate(() => { const b = document.getElementById('sb-body'); b.scrollTop = 400; b.dispatchEvent(new Event('scroll')); });
  const sticky = page.locator(`.sb-sticky-row[data-root="${ra}"][data-rel="档案"]`);
  await expect(sticky).toBeVisible({ timeout: 4000 });
  // ondragover 的门（对抗审查：合成 drop 无视 dragover 照样命中,单靠下面 dnd 测不出 clone.ondragover 被删/坏）：
  // 真行 ondragover 会 preventDefault 让吸顶克隆行成为合法 drop 靶——先 dragstart 设 dragNode,再 dispatch
  // dragover 到吸顶行,被 cancel（dispatchEvent 返回 false）才说明转发生效。删掉 clone.ondragover 这条必翻红。
  const overCanceled = await page.evaluate(([srcSel, stkSel]) => {
    const src = document.querySelector(srcSel); const stk = document.querySelector(stkSel);
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const canceled = !stk.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return canceled;
  }, [`.sb-file[data-root="${ra}"][data-rel="外部.html"]`, `.sb-sticky-row[data-root="${ra}"][data-rel="档案"]`]);
  expect(overCanceled).toBe(true);
  // 把 外部.html 拖到吸顶的「档案」行 → 应移进 档案/
  await dnd(`.sb-file[data-root="${ra}"][data-rel="外部.html"]`, `.sb-sticky-row[data-root="${ra}"][data-rel="档案"]`);
  await expect.poll(() => onDisk(path.join(wsA, '档案', '外部.html')), { timeout: 4000 }).toBe(true);
  expect(await onDisk(path.join(wsA, '外部.html'))).toBe(false);
});
