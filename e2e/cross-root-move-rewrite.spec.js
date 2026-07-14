// C 跨根维护面 e2e 真门：文件动了,跨「文件夹空间」的引用自动跟(字节保真、fan-out 所有根)。
// C2 已把 U-CR0 的「移动守卫」换成自动重写——跨根移动不再弹警告,而是像同根移动一样自动修好引用 + 撤销。
//
// 覆盖：跨根移动→入向引用自动重写(变同根短形式)/被移文档自身出链重算/同根改名→跨根入向引用也跟(C1 fan-out)/
// 撤销往返/零引用无守弹直移。强断言：磁盘字节(重写后 href 精确 + 无 .ws-delguard 守卫弹窗)。
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
    const src = document.querySelector(`.sb-file[data-root="${srcRootId}"][data-rel="${srcRel}"]`);
    const dst = document.querySelector(destSelector);
    if (!src || !dst) throw new Error('dnd 节点没找到');
    const dt = new DataTransfer();
    const ev = (t, el) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    ev('dragstart', src); ev('dragover', dst); ev('drop', dst); ev('dragend', src);
  }, { srcRootId, srcRel, destSelector });
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-xroot-rw-'));
  userData = path.join(tmp, 'userdata');
  wsA = path.join(tmp, '工作笔记');
  wsB = path.join(tmp, '项目资料');
  await fs.mkdir(wsA, { recursive: true });
  await fs.mkdir(wsB, { recursive: true });
  // A/周报 跨根链到 B/报价单；A/doc 跨根链到 B/target；A/孤单 无链接
  await fs.writeFile(path.join(wsA, '周报.html'), DOC('周报', '<p>见 <a href="../项目资料/报价单.html">报价单</a>。</p>'), 'utf8');
  await fs.writeFile(path.join(wsA, 'doc.html'), DOC('doc', '<p>见 <a href="../项目资料/target.html">目标</a>。</p>'), 'utf8');
  await fs.writeFile(path.join(wsA, '孤单.html'), DOC('孤单', '<p>无链接。</p>'), 'utf8');
  await fs.writeFile(path.join(wsB, '报价单.html'), DOC('报价单', '<p>金额。</p>'), 'utf8');
  await fs.writeFile(path.join(wsB, 'target.html'), DOC('目标', '<p>x。</p>'), 'utf8');
  await fs.mkdir(path.join(wsB, '存档'), { recursive: true }); // C1：把 报价单 移进这里（同根移动）
  await fs.writeFile(path.join(wsB, '存档', '.keep.html'), DOC('keep'), 'utf8'); // 占位让空夹显示
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
const noGuard = async () => { await page.waitForTimeout(200); await expect(page.locator('.ws-delguard')).toHaveCount(0); };

test('C2-1 跨根移动 B/报价单→A：无守卫弹窗 + A/周报 的跨根链接自动改成同根短形式', async () => {
  const [ra, rb] = await openTwoRoots();
  await dndTo(rb, '报价单.html', `.sb-root-head[data-root="${ra}"]`); // 报价单 从 B 移到 A
  await noGuard(); // C2：不再弹「移动会断链」守卫
  await expect.poll(() => onDisk(path.join(wsA, '报价单.html'))).toBe(true);
  await expect.poll(() => onDisk(path.join(wsB, '报价单.html'))).toBe(false);
  // 周报（在 A）原来跨根 ../项目资料/报价单.html → 现在报价单也在 A → 自动重写成同根短形式 报价单.html
  await expect.poll(async () => await read(path.join(wsA, '周报.html')), { timeout: 5000 })
    .toMatch(/<a href="报价单\.html">报价单<\/a>/);
  await expect(page.locator('.sb-toast')).toContainText('已更新');
});

test('C2-2 被移文档自身的跨根出链重算：A/doc→B 后，它指向 B/target 的链接变同根短形式', async () => {
  const [ra, rb] = await openTwoRoots();
  await dndTo(ra, 'doc.html', `.sb-root-head[data-root="${rb}"]`); // doc 从 A 移到 B（target 也在 B）
  await expect.poll(() => onDisk(path.join(wsB, 'doc.html'))).toBe(true);
  // doc 原来 ../项目资料/target.html（跨根）→ 现在 doc 也在 B → 同根短形式 target.html
  await expect.poll(async () => await read(path.join(wsB, 'doc.html')), { timeout: 5000 })
    .toMatch(/<a href="target\.html">目标<\/a>/);
});

test('C1 同根移动 B/报价单→B/存档：A/周报 的跨根入向引用也自动跟（fan-out 到 A 根，文件仍在 B）', async () => {
  const [ra, rb] = await openTwoRoots();
  await dndTo(rb, '报价单.html', `.sb-dir[data-root="${rb}"][data-rel="存档"]`); // 同根移动（B 内）
  await expect.poll(() => onDisk(path.join(wsB, '存档', '报价单.html'))).toBe(true);
  // 报价单 仍在 B、只是进了子夹；周报（在 A，跨根指向它）→ href 从 ../项目资料/报价单.html 跟到 ../项目资料/存档/报价单.html
  await expect.poll(async () => await read(path.join(wsA, '周报.html')), { timeout: 5000 })
    .toMatch(/<a href="\.\.\/项目资料\/存档\/报价单\.html">报价单<\/a>/);
});

test('C2-3 零引用文件跨根移动：无守卫、直移', async () => {
  const [ra, rb] = await openTwoRoots();
  await dndTo(ra, '孤单.html', `.sb-root-head[data-root="${rb}"]`);
  await noGuard();
  await expect.poll(() => onDisk(path.join(wsB, '孤单.html'))).toBe(true);
  await expect.poll(() => onDisk(path.join(wsA, '孤单.html'))).toBe(false);
});

test('C2-4 撤销跨根移动：文件移回原根 + 引用反向重写回跨根形式', async () => {
  const [ra, rb] = await openTwoRoots();
  await dndTo(rb, '报价单.html', `.sb-root-head[data-root="${ra}"]`);
  await expect.poll(async () => await read(path.join(wsA, '周报.html')), { timeout: 5000 }).toMatch(/<a href="报价单\.html">/);
  await expect(page.locator('.sb-toast')).toContainText('已更新');
  await page.locator('.sb-toast .sb-toast-action, .sb-toast button', { hasText: '撤销' }).first().click();
  // 撤销：报价单 移回 B + 周报 的链接反向重写回 ../项目资料/报价单.html
  await expect.poll(() => onDisk(path.join(wsB, '报价单.html')), { timeout: 5000 }).toBe(true);
  await expect.poll(async () => await read(path.join(wsA, '周报.html')), { timeout: 5000 })
    .toMatch(/<a href="\.\.\/项目资料\/报价单\.html">报价单<\/a>/);
});
