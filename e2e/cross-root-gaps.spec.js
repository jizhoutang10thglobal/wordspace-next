// 跨根互链 robustness 补测：两条之前没专门覆盖的真代码路径。
// G1 打开中文档被跨根移动影响 → __wsApplyMovesToOpenDoc 的 abs 内存改（+ 自动保存不写坏）。
// G2 跨根移动整个文件夹（子树）→ 夹外引用 fan-out 重写。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DOC = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body || ''}</body></html>`;

let app, page, tmp, wsA, wsB, userData;
async function launch(env) {
  const a = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: userData, ...env } });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  app = a; page = p;
}
const setFolderSeam = (dir) => app.evaluate(({ }, d) => { process.env.WS2_FOLDER_IN = d; }, dir);
const rootHeads = () => page.locator('.sb-root-head:not(.sb-root-missing)');
const fileRow = (rootId, rel) => page.locator(`.sb-file[data-root="${rootId}"][data-rel="${rel}"]`);
const onDisk = (p) => fs.stat(p).then(() => true, () => false);
const read = (p) => fs.readFile(p, 'utf8');
async function dndTo(srcRootId, srcRel, destSelector) {
  await page.evaluate(({ srcRootId, srcRel, destSelector }) => {
    const src = document.querySelector(`.sb-file[data-root="${srcRootId}"][data-rel="${srcRel}"]`) || document.querySelector(`.sb-dir[data-root="${srcRootId}"][data-rel="${srcRel}"]`);
    const dst = document.querySelector(destSelector);
    if (!src || !dst) throw new Error('dnd 节点没找到: ' + srcRel);
    const dt = new DataTransfer();
    const ev = (t, el) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    ev('dragstart', src); ev('dragover', dst); ev('drop', dst); ev('dragend', src);
  }, { srcRootId, srcRel, destSelector });
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-xrgap-'));
  userData = path.join(tmp, 'userdata');
  wsA = path.join(tmp, '工作笔记'); wsB = path.join(tmp, '项目资料');
  await fs.mkdir(wsA, { recursive: true }); await fs.mkdir(wsB, { recursive: true });
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

test('G1 打开中的文档引用了被跨根移动的文件 → 内存里链接实时更新 + 保存不写坏', async () => {
  await fs.writeFile(path.join(wsA, '周报.html'), DOC('周报', '<p>见 <a href="../项目资料/报价单.html">报价单</a>。</p>'), 'utf8');
  await fs.writeFile(path.join(wsB, '报价单.html'), DOC('报价单', '<p>金额。</p>'), 'utf8');
  const [ra, rb] = await openTwoRoots();
  // 打开 周报（它就是引用方）——移动时主进程会跳过它、交 renderer 内存改
  await fileRow(ra, '周报.html').click();
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('周报');
  await expect(frame.locator('a')).toHaveAttribute('href', '../项目资料/报价单.html');
  // 把 报价单 从 B 移到 A（现在和 周报 同根了）
  await dndTo(rb, '报价单.html', `.sb-root-head[data-root="${ra}"]`);
  // 打开中的 周报：iframe DOM 里的 href 实时更新成同根短形式
  await expect(frame.locator('a')).toHaveAttribute('href', '报价单.html', { timeout: 5000 });
  // 自动保存后磁盘也是对的（没把旧的/坏的写回去）
  await page.waitForTimeout(1700);
  const disk = await read(path.join(wsA, '周报.html'));
  expect(disk).toMatch(/<a href="报价单\.html">报价单<\/a>/);
  expect(disk).not.toContain('项目资料'); // 旧跨根路径已消失、没残留
});

test('G2 文件夹改名（子树）→ 别的空间对夹内文件的跨根引用 fan-out 重写', async () => {
  // 注：文件夹在本 app 不可拖拽移动（只文件可拖），文件夹的「移动」= 改名（同根子树），走同一套 abs fan-out 机器。
  await fs.mkdir(path.join(wsB, '资料'), { recursive: true });
  await fs.writeFile(path.join(wsB, '资料', '报价单.html'), DOC('报价单', '<p>金额。</p>'), 'utf8');
  await fs.writeFile(path.join(wsA, '周报.html'), DOC('周报', '<p>见 <a href="../项目资料/资料/报价单.html">报价单</a>。</p>'), 'utf8');
  const [ra, rb] = await openTwoRoots();
  const dir = page.locator(`.sb-dir[data-root="${rb}"][data-rel="资料"]`);
  await expect(dir).toBeVisible();
  await dir.click({ button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: /^重命名$/ }).click();
  const input = page.locator('input.sb-rename');
  await expect(input).toBeVisible();
  await input.fill('存档');
  await input.press('Enter');
  await expect.poll(() => onDisk(path.join(wsB, '存档', '报价单.html'))).toBe(true);
  // 周报（在 A，跨根指向 B/资料 夹内）→ 文件夹改名后 href 从 ../项目资料/资料/... 跟到 ../项目资料/存档/...
  await expect.poll(async () => await read(path.join(wsA, '周报.html')), { timeout: 5000 })
    .toMatch(/<a href="\.\.\/项目资料\/存档\/报价单\.html">报价单<\/a>/);
});
