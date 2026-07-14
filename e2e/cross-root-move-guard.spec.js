// U-CR0 跨根移动守卫 e2e 真门：跨根自动重写(C 阶段)落地前，把「移去别的根会静默断链」拦一道。
//
// 覆盖：入向引用触发守卫 + 取消不移 / 确认移动后旧引用真断(红虚线) / 出向链接(被移文档自己的链接)触发守卫 /
// 无任何会断链接时无守卫直移(不打扰)。
// 强断言口径：磁盘操作断言落真实 fs；断链断言读真实 CSS.highlights('ws-broken') size（不查 JS class）。
// 拖拽走仓内既有的树内 DnD 合成事件测法（MR-11/12/13 同款；树内移动的既定管线，非 file→editor 建链那条）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DOC = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body || ''}</body></html>`;

let app, page, tmp, wsA, wsB, userData;

async function launch(env) {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: userData, ...env },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  app = a; page = p;
  return { a, p };
}
const setFolderSeam = (dir) => app.evaluate(({ }, d) => { process.env.WS2_FOLDER_IN = d; }, dir);
const rootHeads = () => page.locator('.sb-root-head:not(.sb-root-missing)');
const fileRow = (rootId, rel) => page.locator(`.sb-file[data-root="${rootId}"][data-rel="${rel}"]`);
const onDisk = (p) => fs.stat(p).then(() => true, () => false);

async function dndTo(srcRootId, srcRel, destSelector) {
  await page.evaluate(({ srcRootId, srcRel, destSelector }) => {
    const src = document.querySelector(`.sb-file[data-root="${srcRootId}"][data-rel="${srcRel}"]`);
    const dst = document.querySelector(destSelector);
    if (!src || !dst) throw new Error('dnd 节点没找到: ' + srcRel + ' → ' + destSelector);
    const dt = new DataTransfer();
    const ev = (t, el) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    ev('dragstart', src); ev('dragover', dst); ev('drop', dst); ev('dragend', src);
  }, { srcRootId, srcRel, destSelector });
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-xroot-guard-'));
  userData = path.join(tmp, 'userdata');
  wsA = path.join(tmp, '工作笔记');
  wsB = path.join(tmp, '项目资料');
  await fs.mkdir(wsA, { recursive: true });
  await fs.mkdir(wsB, { recursive: true });
  // A 根：周报 链到 报价单（报价单=入向 1 / 出向 0；周报=入向 0 / 出向 1）；孤单=零引用
  await fs.writeFile(path.join(wsA, '周报.html'), DOC('周报', '<p>本周进展见 <a href="报价单.html">报价单</a> 附件。</p>'), 'utf8');
  await fs.writeFile(path.join(wsA, '报价单.html'), DOC('报价单', '<p>金额若干。</p>'), 'utf8');
  await fs.writeFile(path.join(wsA, '孤单.html'), DOC('孤单', '<p>没有任何链接进出。</p>'), 'utf8');
  await fs.writeFile(path.join(wsB, 'b.html'), DOC('B文档'), 'utf8');
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app?.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

async function openTwoRoots() {
  await launch({ WS2_FOLDER_IN: wsA });
  await page.click('#home-open-folder');
  await expect(rootHeads()).toHaveCount(1);
  await setFolderSeam(wsB);
  await page.click('#sb-add-root');
  await expect(rootHeads()).toHaveCount(2);
  return page.$$eval('.sb-root-head', (els) => els.map((e) => e.dataset.root));
}
const guard = () => page.locator('.ws-delguard').filter({ hasText: '仍要移动' });
const brokenSize = () => page.evaluate(() => {
  const w = document.getElementById('doc-frame').contentWindow;
  const hl = w.CSS && w.CSS.highlights && w.CSS.highlights.get('ws-broken');
  return hl ? hl.size : 0;
});

test('CR0-1 入向引用触发守卫 + 取消 → 文件纹丝不动', async () => {
  const [ra, rb] = await openTwoRoots();
  await dndTo(ra, '报价单.html', `.sb-root-head[data-root="${rb}"]`);
  // 守卫弹窗：入向计数 + 来源列表
  await expect(guard()).toBeVisible();
  await expect(guard()).toContainText('1 篇文档里指向它的链接');
  await expect(guard().locator('.ws-delguard-item-title')).toHaveText('周报'); // 来源列出，取标题
  // 取消 → 什么都不动
  await guard().locator('.ws-delguard-btn', { hasText: '取消' }).click();
  await expect(guard()).toHaveCount(0);
  expect(await onDisk(path.join(wsA, '报价单.html'))).toBe(true);
  expect(await onDisk(path.join(wsB, '报价单.html'))).toBe(false);
  await expect(fileRow(ra, '报价单.html')).toBeVisible();
  await expect(fileRow(rb, '报价单.html')).toHaveCount(0);
});

test('CR0-2 确认移动 → 落盘换根 + 旧引用真断(红虚线)', async () => {
  const [ra, rb] = await openTwoRoots();
  await dndTo(ra, '报价单.html', `.sb-root-head[data-root="${rb}"]`);
  await expect(guard()).toBeVisible();
  await guard().locator('.ws-delguard-btn', { hasText: '仍要移动' }).click();
  // 磁盘真相：源没了、目标有了
  await expect.poll(() => onDisk(path.join(wsB, '报价单.html'))).toBe(true);
  await expect.poll(() => onDisk(path.join(wsA, '报价单.html'))).toBe(false);
  await expect(fileRow(rb, '报价单.html')).toBeVisible();
  // 打开留在 A 根的 周报 → 它指向 报价单.html 的链接现在解析不到（跨根不自动重写）→ 红虚线
  await fileRow(ra, '周报.html').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('周报');
  await expect.poll(brokenSize, { timeout: 5000 }).toBe(1); // ws-broken 高亮真断（这正是守卫警告的后果）
});

test('CR0-3 出向链接触发守卫（被移文档自己的链接会断，无入向来源列表）', async () => {
  const [ra, rb] = await openTwoRoots();
  await dndTo(ra, '周报.html', `.sb-root-head[data-root="${rb}"]`); // 周报 入向 0、出向 1
  await expect(guard()).toBeVisible();
  await expect(guard()).toContainText('它内部的 1 条链接');
  await expect(guard().locator('.ws-delguard-list')).toHaveCount(0); // 无入向来源 → 不渲染列表
  await guard().locator('.ws-delguard-btn', { hasText: '取消' }).click();
  expect(await onDisk(path.join(wsA, '周报.html'))).toBe(true); // 取消未移
});

test('CR0-4 零引用文件 → 无守卫直移（不打扰）', async () => {
  const [ra, rb] = await openTwoRoots();
  await dndTo(ra, '孤单.html', `.sb-root-head[data-root="${rb}"]`);
  // 没有守卫弹窗冒出来（给它一点时间，确保不是竞态误判）
  await page.waitForTimeout(300);
  await expect(page.locator('.ws-delguard')).toHaveCount(0);
  // 直接移动落盘
  await expect.poll(() => onDisk(path.join(wsB, '孤单.html'))).toBe(true);
  await expect.poll(() => onDisk(path.join(wsA, '孤单.html'))).toBe(false);
  await expect(fileRow(rb, '孤单.html')).toBeVisible();
});
