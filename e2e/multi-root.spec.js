// 多根工作区 e2e 真门（「多文件夹同时打开」移植进真 app 的验收）。
//
// 覆盖：多根渲染与隔离 / 同 rel 不同根不串键 / 嵌套智能检测(same/child/parent+吸收 rebase) /
// 移除根撤销原位回 / 失联根灰态+重新定位复活(rootId 不变→置顶原样回) / v1 store 迁移 /
// 冷启动 open-file 归属到正确根 / per-root watcher 只刷对应根。
//
// 强断言口径（S4）：树/标签行都带 data-root + data-rel，断言两者组合；磁盘操作断言落真实 fs；
// 吸收/迁移断言标签 data-rel 真变成新 rel（不是查 class）。
// WS2_FOLDER_IN / WS2_RELOCATE_IN seam 在测试中经 electronApp.evaluate 改 process.env 换目标。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

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
  app = a;
  page = p;
  return { a, p };
}
const setFolderSeam = (dir) => app.evaluate(({ }, d) => { process.env.WS2_FOLDER_IN = d; }, dir);
const rootHeads = () => page.locator('.sb-root-head:not(.sb-root-missing)');
const fileRow = (rootId, rel) => page.locator(`.sb-file[data-root="${rootId}"][data-rel="${rel}"]`);
const tabRow = (rootId, rel) => page.locator(`#sb-tabs .sb-tab[data-root="${rootId}"][data-rel="${rel}"]`);

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-multiroot-'));
  userData = path.join(tmp, 'userdata');
  wsA = path.join(tmp, '甲方项目');
  wsB = path.join(tmp, '资料库');
  await fs.mkdir(path.join(wsA, '素材'), { recursive: true });
  await fs.mkdir(wsB, { recursive: true });
  await fs.writeFile(path.join(wsA, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(wsA, '素材', '同名.html'), HTML('A素材'), 'utf8');
  await fs.writeFile(path.join(wsB, '同名.html'), HTML('B同名'), 'utf8');
  await fs.writeFile(path.join(wsB, 'b.html'), HTML('BBB'), 'utf8');
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app?.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

// 启动 + 打开 A 根，再经「添加文件夹…」加 B 根；返回 [rootIdA, rootIdB]。
async function openTwoRoots() {
  await launch({ WS2_FOLDER_IN: wsA });
  await page.click('#home-open-folder');
  await expect(rootHeads()).toHaveCount(1);
  await setFolderSeam(wsB);
  await page.click('#sb-add-root');
  await expect(rootHeads()).toHaveCount(2);
  return page.$$eval('.sb-root-head', (els) => els.map((e) => e.dataset.root));
}

test('MR-1 两根两节：树行/根标题都带 data-root，灰字完整路径真渲染', async () => {
  const [ra, rb] = await openTwoRoots();
  await expect(fileRow(ra, 'a.html')).toBeVisible();
  await expect(fileRow(rb, 'b.html')).toBeVisible();
  // 根标题行灰字完整路径（computed 宽度>0 = 真渲染，不是只有 title）
  const pathW = await page.locator(`.sb-root-head[data-root="${ra}"] .sb-root-path`).evaluate((el) => el.getBoundingClientRect().width);
  expect(pathW).toBeGreaterThan(20);
  // 树底常驻「添加文件夹…」
  await expect(page.locator('#sb-add-root')).toBeVisible();
});

test('MR-2 同 rel 不同根不串键：各开各的、内容不串、关一个不伤另一个', async () => {
  const [ra, rb] = await openTwoRoots();
  await page.click(`.sb-dir[data-root="${ra}"][data-rel="素材"]`);
  await fileRow(ra, '素材/同名.html').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('A素材');
  await fileRow(rb, '同名.html').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('B同名'); // 内容是 B 的，没串
  await expect(tabRow(ra, '素材/同名.html')).toBeVisible();
  await expect(tabRow(rb, '同名.html')).toBeVisible();
  // 关 B 的同名 → A 的同名标签不受影响，且回落激活到它
  await tabRow(rb, '同名.html').hover();
  await tabRow(rb, '同名.html').locator('.sb-tab-close').click();
  await expect(tabRow(rb, '同名.html')).toHaveCount(0);
  await expect(tabRow(ra, '素材/同名.html')).toBeVisible();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('A素材'); // 编辑器回落到 A 的
});

test('MR-3 嵌套检测：same/child 不重复加（toast 解释），parent 弹「并入并添加」+ 标签 rebase 不关', async () => {
  const [ra] = await openTwoRoots();
  // same：再选 A → toast、节数不变
  await setFolderSeam(wsA);
  await page.click('#sb-add-root');
  await expect(page.locator('.sb-toast')).toContainText('已经打开');
  await expect(rootHeads()).toHaveCount(2);
  // child：选 A/素材 → toast、节数不变
  await setFolderSeam(path.join(wsA, '素材'));
  await page.click('#sb-add-root');
  await expect(page.locator('.sb-toast')).toContainText('里了');
  await expect(rootHeads()).toHaveCount(2);
  // parent：先在 A 里开个标签，再选 tmp（包住 A 和 B）→ 确认框 → 并入
  await fileRow(ra, 'a.html').click();
  await expect(tabRow(ra, 'a.html')).toBeVisible();
  await setFolderSeam(tmp);
  await page.click('#sb-add-root');
  await expect(page.locator('.sb-modal-confirm')).toContainText('并入');
  await page.click('.sb-modal-confirm .sb-btn-primary');
  // 两个子根都被吸收，只剩父根一节
  await expect(rootHeads()).toHaveCount(1);
  const parentId = await page.locator('.sb-root-head').getAttribute('data-root');
  // 标签 rebase：a.html → 甲方项目/a.html、归属换到父根、不关闭；点击还能打开正确内容
  const rebased = tabRow(parentId, '甲方项目/a.html');
  await expect(rebased).toBeVisible();
  await rebased.click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
});

test('MR-4 移除根：标签整组撤走，撤销原位放回（含中间位序）+ 标签回来', async () => {
  const [ra, rb] = await openTwoRoots();
  // 再加第三根 C，让 B 处在中间（撤销要回中间、不是末尾）
  const wsC = path.join(tmp, '第三库');
  await fs.mkdir(wsC, { recursive: true });
  await fs.writeFile(path.join(wsC, 'c.html'), HTML('CCC'), 'utf8');
  await setFolderSeam(wsC);
  await page.click('#sb-add-root');
  await expect(rootHeads()).toHaveCount(3);
  await fileRow(rb, 'b.html').click();
  await expect(tabRow(rb, 'b.html')).toBeVisible();
  // 右键 B 根标题 → 移除
  await page.click(`.sb-root-head[data-root="${rb}"]`, { button: 'right' });
  await page.locator('#sb-ctx .sb-ctx-item.is-danger').click();
  await expect(page.locator(`.sb-root-head[data-root="${rb}"]`)).toHaveCount(0);
  await expect(tabRow(rb, 'b.html')).toHaveCount(0); // 标签撤走
  // 磁盘不动
  expect(await fs.stat(path.join(wsB, 'b.html')).then(() => true, () => false)).toBe(true);
  // 撤销 → B 回到中间位置（第 2 节）+ 标签回来
  await page.click('.sb-toast-action');
  await expect(page.locator(`.sb-root-head[data-root="${rb}"]`)).toBeVisible();
  const order = await page.$$eval('.sb-root-head', (els) => els.map((e) => e.dataset.root));
  expect(order[1]).toBe(rb); // 原位（A, B, C）
  await expect(tabRow(rb, 'b.html')).toBeVisible();
});

test('MR-5 失联根：重启灰态不悄丢 + 重新定位复活（rootId 不变 → 置顶原样回）', async () => {
  const [, rb] = await openTwoRoots();
  // 在 B 里置顶一个文件（复活后要原样回来 = rootId 稳定身份的收益）
  await fileRow(rb, 'b.html').click({ button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: /^置顶$/ }).click();
  await expect(page.locator(`#sb-pinned .sb-tab[data-root="${rb}"][data-rel="b.html"]`)).toBeVisible();
  // 等 persist 落盘（fire-and-forget）
  await expect.poll(async () => {
    try { return (await fs.readFile(path.join(userData, 'workspace.json'), 'utf8')).includes('b.html'); } catch { return false; }
  }, { timeout: 4000 }).toBe(true);
  await app.close();
  // 外部把 B 挪走（模拟外置盘拔了/被移动）
  const moved = path.join(tmp, '资料库-挪走了');
  await fs.rename(wsB, moved);
  await launch({});
  // 失联节出现：灰态 + 说明 + 两个动作；不是整个消失
  const missing = page.locator(`.sb-root-head.sb-root-missing[data-root="${rb}"]`);
  await expect(missing).toBeVisible();
  await expect(missing).toContainText('失联');
  await expect(page.locator('.sb-root-miss-note')).toContainText('不可达');
  // 重新定位到新位置 → 树回来、置顶原样复活（同 rootId 同 rel）
  await app.evaluate(({ }, d) => { process.env.WS2_RELOCATE_IN = d; }, moved);
  await page.locator('.sb-root-miss-act', { hasText: '重新定位' }).click();
  await expect(fileRow(rb, 'b.html')).toBeVisible();
  await expect(page.locator(`#sb-pinned .sb-tab[data-root="${rb}"][data-rel="b.html"]`)).toBeVisible();
  await expect(page.locator('.sb-root-missing')).toHaveCount(0);
});

test('MR-6 v1 store 迁移：老单根格式(root+tabsByRoot)启动后根+标签+激活全恢复', async () => {
  // 手写 v0.4.5 时代的 v1 workspace.json（真实老用户升级场景）
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(
    path.join(userData, 'workspace.json'),
    JSON.stringify({
      root: wsA,
      savedAt: 1,
      tabsByRoot: {
        [wsA]: {
          entries: [
            { rel: 'a.html', kind: 'html', title: 'a.html', open: true, pinned: false },
            { rel: '素材/同名.html', kind: 'html', title: '同名.html', open: false, pinned: true },
          ],
          activeRel: 'a.html',
        },
      },
    }, null, 2),
    'utf8',
  );
  await launch({});
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(rootHeads()).toHaveCount(1); // 老根迁成唯一一节
  const rid = await page.locator('.sb-root-head').getAttribute('data-root');
  await expect(tabRow(rid, 'a.html')).toBeVisible(); // 开着的标签迁过来
  await expect(page.locator(`#sb-pinned .sb-tab[data-root="${rid}"][data-rel="素材/同名.html"]`)).toBeVisible(); // 置顶迁过来
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA'); // 上次激活恢复进编辑器
});

test('MR-7 冷启动 open-file 归属第二根：标签建在正确的根下', async () => {
  // 直接写 v2 store 预置两根（不经 UI），再冷启动双击 B 里的文件
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(
    path.join(userData, 'workspace.json'),
    JSON.stringify({
      version: 2,
      roots: [{ id: 'r1', path: wsA }, { id: 'r2', path: wsB }],
      nextRootId: 3,
      tabs: { entries: [], activeRel: null },
    }, null, 2),
    'utf8',
  );
  await launch({ WS2_OPEN_FILE: path.join(wsB, 'b.html'), WS2_SLOW_TREE_MS: '400' });
  await expect(page.locator('#doc-name')).toHaveText('b.html', { timeout: 8000 });
  await expect(tabRow('r2', 'b.html')).toBeVisible({ timeout: 8000 }); // 归属 r2、不是 r1/外部
  await expect(fileRow('r2', 'b.html')).toHaveClass(/is-active/); // 树里也定位到 B 根下高亮
});

test('MR-9 根全移除后外部标签保留 + 0 根重启仍恢复（MR-ADV-2 回归门）', async () => {
  await launch({ WS2_FOLDER_IN: wsA });
  await page.click('#home-open-folder');
  await expect(rootHeads()).toHaveCount(1);
  // 开一个任何根之外的文件 → 外部标签（abs 身份、↗）
  const outside = path.join(tmp, '外部.html');
  await fs.writeFile(outside, HTML('OUT'), 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', p), outside);
  const extTab = page.locator(`#sb-tabs .sb-tab.sb-tab-ext[data-rel="${outside}"]`);
  await expect(extTab).toBeVisible();
  // 移除唯一的根 → 外部标签仍在（不随根撤走）
  await page.click('.sb-root-head', { button: 'right' });
  await page.locator('#sb-ctx .sb-ctx-item.is-danger').click();
  await expect(rootHeads()).toHaveCount(0);
  await expect(extTab).toBeVisible();
  // 等 persist 落盘再重启 → 0 根启动也要恢复外部标签（修复前 loadTabs 只在有根分支跑 → 重启即丢 + 被后续 persist 抹盘）
  await expect.poll(async () => {
    try { return (await fs.readFile(path.join(userData, 'workspace.json'), 'utf8')).includes('外部.html'); } catch { return false; }
  }, { timeout: 4000 }).toBe(true);
  await app.close();
  await launch({});
  await expect(page.locator('#sidebar.sb-on')).toBeVisible({ timeout: 8000 }); // 外部标签点亮侧栏
  await expect(page.locator(`#sb-tabs .sb-tab.sb-tab-ext[data-rel="${outside}"]`)).toBeVisible();
});

test('MR-10 软链形态吸收：根用软链路径打开、父目录用真路径 → rebase 前缀仍正确（MR-ADV-1 回归门）', async () => {
  // real/proj 是真目录，lk → real 是软链。根以 lk/proj（字面软链形态）打开，父目录以 real（真形态）添加。
  // classify 用 realpath 判出 parent；修复前 rebase 前缀却拿字面 path 切 → 空串/乱串 → 标签指向不存在的 rel。
  // ⚠ 软链名必须和真名不同长度（'lk' 2 字符 vs 'real' 4 字符）：同长度时字面切片会碰巧切出正确前缀，
  // 这道门就成了哑门（变异自检实测抓的——第一版用 'link' 恰好 4 字符，变异照绿）。
  const realDir = path.join(tmp, 'real');
  await fs.mkdir(path.join(realDir, 'proj'), { recursive: true });
  await fs.writeFile(path.join(realDir, 'proj', 'doc.html'), HTML('DOC'), 'utf8');
  const link = path.join(tmp, 'lk');
  await fs.symlink(realDir, link);
  await launch({ WS2_FOLDER_IN: path.join(link, 'proj') });
  await page.click('#home-open-folder');
  await expect(rootHeads()).toHaveCount(1);
  const projId = await page.locator('.sb-root-head').getAttribute('data-root');
  await fileRow(projId, 'doc.html').click();
  await expect(tabRow(projId, 'doc.html')).toBeVisible();
  // 添加 real（真形态父目录）→ 确认并入
  await setFolderSeam(realDir);
  await page.click('#sb-add-root');
  await expect(page.locator('.sb-modal-confirm')).toContainText('并入');
  await page.click('.sb-modal-confirm .sb-btn-primary');
  await expect(rootHeads()).toHaveCount(1);
  const parentId = await page.locator('.sb-root-head').getAttribute('data-root');
  // 标签 rebase 到正确前缀 proj/doc.html（修复前是 '' 或乱串 → 这条选择器找不到）
  const rebased = tabRow(parentId, 'proj/doc.html');
  await expect(rebased).toBeVisible();
  await rebased.click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('DOC');
  // 触发一次树同步（watcher/聚焦路径）：rebase 后的标签不能被 reconcile 误清（修复前的终局症状）
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(400);
  await expect(tabRow(parentId, 'proj/doc.html')).toBeVisible();
});

// 合成 DragEvent 驱动真实跨根拖拽链（同 sidebar.spec 技法，绕开 Electron 里出名地飘的真实鼠标拖拽时序）：
// 源文件行 → 目标(目录行 / 根标题行)。dragstart 设 dragNode，drop 触发 doMove/doMoveAcross 分流。
// ⚠ 目录行不是拖拽源（只有 .sb-file 可拖），跨根移动目录经此路不可达——目录逻辑由单测覆盖，e2e 只测文件。
async function dndTo(srcRootId, srcRel, destSelector) {
  await page.evaluate(({ srcRootId, srcRel, destSelector }) => {
    const src = document.querySelector(`.sb-file[data-root="${srcRootId}"][data-rel="${srcRel}"]`);
    const dst = document.querySelector(destSelector);
    if (!src || !dst) throw new Error('dnd 节点没找到: ' + srcRel + ' → ' + destSelector);
    const dt = new DataTransfer();
    const ev = (t, el) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    ev('dragstart', src);
    ev('dragover', dst);
    ev('drop', dst);
    ev('dragend', src);
  }, { srcRootId, srcRel, destSelector });
}
const onDisk = (p) => fs.stat(p).then(() => true, () => false);

test('MR-16 增量渲染：展开 A 的文件夹不重建 B 的 DOM（性能修复回归门；变异敏感）', async () => {
  const [ra, rb] = await openTwoRoots();
  // 给 B 的 b.html 树行打一个 DOM 标记（重建会造新元素、标记丢失）
  await expect(fileRow(rb, 'b.html')).toBeVisible();
  await page.evaluate((id) => {
    const row = document.querySelector(`.sb-file[data-root="${id}"][data-rel="b.html"]`);
    row.dataset.probe = 'INTACT';
  }, rb);
  // 展开/折叠 A 的 素材 文件夹（触发 renderRoot(A)）
  await page.locator(`.sb-dir[data-root="${ra}"][data-rel="素材"]`).click();
  await expect(fileRow(ra, '素材/同名.html')).toBeVisible(); // A 的子树确实展开了（renderRoot 生效）
  // 关键:B 的行还是同一个 DOM 元素（标记还在）→ 证明 renderRoot(A) 没碰 B 的 DOM
  await expect(page.locator(`.sb-file[data-root="${rb}"][data-rel="b.html"][data-probe="INTACT"]`)).toHaveCount(1);
  // 折叠回去也只碰 A
  await page.evaluate((id) => { document.querySelector(`.sb-file[data-root="${id}"][data-rel="b.html"]`).dataset.probe2 = 'STILL'; }, rb);
  await page.locator(`.sb-dir[data-root="${ra}"][data-rel="素材"]`).click();
  await expect(fileRow(ra, '素材/同名.html')).toHaveCount(0); // A 折叠了
  await expect(page.locator(`.sb-file[data-root="${rb}"][data-rel="b.html"][data-probe2="STILL"]`)).toHaveCount(1);
  // 区间替换没删掉末尾的「添加文件夹…」按钮（renderRoot 边界守卫；变异删守卫或算错区间→翻红）
  await expect(page.locator('#sb-add-root')).toHaveCount(1);
});

test('MR-17 关标签相邻回落到失联根的标签 → 跳过失联的、落到可开标签，不停在已关文档（对抗审查 finding 1）', async () => {
  // 三个标签 [A:a.html, B:b.html, A:素材/同名.html]，让 B 失联后，关 A:a.html 的相邻是失联的 B:b.html
  await launch({ WS2_FOLDER_IN: wsA });
  await page.click('#home-open-folder');
  await expect(rootHeads()).toHaveCount(1);
  await setFolderSeam(wsB);
  await page.click('#sb-add-root');
  await expect(rootHeads()).toHaveCount(2);
  const [ra, rb] = await page.$$eval('.sb-root-head', (els) => els.map((e) => e.dataset.root));
  await fileRow(ra, 'a.html').click(); // tab A:a.html
  await fileRow(rb, 'b.html').click(); // tab B:b.html（标签序里在 a 之后）
  await page.click(`.sb-dir[data-root="${ra}"][data-rel="素材"]`);
  await fileRow(ra, '素材/同名.html').click(); // tab A:素材/同名.html，序 [a, b, 素材/同名]
  await expect(tabRow(ra, 'a.html')).toBeVisible();
  await expect(tabRow(rb, 'b.html')).toBeVisible();
  // 等 persist 落盘再重启，外部挪走 B → B 失联但标签仍在
  await expect.poll(async () => {
    try { return (await fs.readFile(path.join(userData, 'workspace.json'), 'utf8')).includes('b.html'); } catch { return false; }
  }, { timeout: 4000 }).toBe(true);
  await app.close();
  await fs.rename(wsB, path.join(tmp, 'B-挪走了'));
  await launch({});
  await expect(page.locator(`.sb-root-head.sb-root-missing[data-root="${rb}"]`)).toBeVisible({ timeout: 8000 });
  await expect(tabRow(rb, 'b.html')).toHaveClass(/sb-tab-missing/); // B 的标签灰态还在
  // 激活 A:a.html，关掉它 → 相邻是失联的 B:b.html（打不开）→ 应跳过它、落到可开的 素材/同名.html
  await tabRow(ra, 'a.html').click();
  await expect(tabRow(ra, 'a.html')).toHaveClass(/is-active/);
  await tabRow(ra, 'a.html').hover();
  await tabRow(ra, 'a.html').locator('.sb-tab-close').click();
  await expect(tabRow(ra, 'a.html')).toHaveCount(0);
  // 关键:没停在已关的 a.html（AAA），也没激活打不开的 B:b.html，而是落到可开的 素材/同名.html（A素材）
  await expect(tabRow(ra, '素材/同名.html')).toHaveClass(/is-active/);
  await expect(tabRow(rb, 'b.html')).not.toHaveClass(/is-active/);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('A素材');
});

test('MR-11 跨根移动文件：同盘 rename、置顶标签换根保持、reconcile 不误清', async () => {
  const [ra, rb] = await openTwoRoots();
  // 在 A 里置顶 a.html（复活/换根后要原样跟过去 = 置顶身份也换根的收益）
  await fileRow(ra, 'a.html').click({ button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: /^置顶$/ }).click();
  await expect(page.locator(`#sb-pinned .sb-tab[data-root="${ra}"][data-rel="a.html"]`)).toBeVisible();
  // 拖 a.html 到 B 根标题行 → 移到 B 顶层
  await dndTo(ra, 'a.html', `.sb-root-head[data-root="${rb}"]`);
  // 磁盘真相：源没了、目标有了
  await expect.poll(() => onDisk(path.join(wsB, 'a.html'))).toBe(true);
  await expect.poll(() => onDisk(path.join(wsA, 'a.html'))).toBe(false);
  // 树行搬到 B 根下
  await expect(fileRow(rb, 'a.html')).toBeVisible();
  await expect(fileRow(ra, 'a.html')).toHaveCount(0);
  // 置顶标签换根、pinned 保持
  await expect(page.locator(`#sb-pinned .sb-tab[data-root="${rb}"][data-rel="a.html"]`)).toBeVisible();
  await expect(page.locator(`#sb-pinned .sb-tab[data-root="${ra}"][data-rel="a.html"]`)).toHaveCount(0);
  // 两根 watcher 同步不误清（源根 reconcile 时该 entry 已属 rb → 跳过；目标根 relSet 有它 → 保留）
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(400);
  await expect(page.locator(`#sb-pinned .sb-tab[data-root="${rb}"][data-rel="a.html"]`)).toBeVisible();
});

test('MR-12 跨根移入撞名文件夹：去重不覆盖 + 打开中文档跟随重指向', async () => {
  const [ra, rb] = await openTwoRoots();
  // B 里建 存档/，先放一个同名占位（拖过去要去重成「同名 2.html」，绝不覆盖）
  await fs.mkdir(path.join(wsB, '存档'), { recursive: true });
  await fs.writeFile(path.join(wsB, '存档', '同名.html'), HTML('B存档占位'), 'utf8');
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // 让 B 树看见 存档/
  await expect(page.locator(`.sb-dir[data-root="${rb}"][data-rel="存档"]`)).toBeVisible({ timeout: 8000 });
  // 展开 A/素材、打开 素材/同名.html（成为激活文档）
  await page.click(`.sb-dir[data-root="${ra}"][data-rel="素材"]`);
  await fileRow(ra, '素材/同名.html').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('A素材');
  // 拖它到 B 的 存档 目录 → 撞名去重成 存档/同名 2.html
  await dndTo(ra, '素材/同名.html', `.sb-dir[data-root="${rb}"][data-rel="存档"]`);
  await expect.poll(() => onDisk(path.join(wsB, '存档', '同名 2.html'))).toBe(true);
  await expect.poll(() => onDisk(path.join(wsA, '素材', '同名.html'))).toBe(false);
  // B 占位没被覆盖
  expect(await fs.readFile(path.join(wsB, '存档', '同名.html'), 'utf8')).toBe(HTML('B存档占位'));
  // 标签换根+去重后新 rel；编辑器重指向到新文件（内容仍是搬过去的 A素材，没被占位串掉）
  await expect(tabRow(rb, '存档/同名 2.html')).toBeVisible();
  await expect(tabRow(rb, '存档/同名 2.html')).toHaveClass(/is-active/);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('A素材');
});

test('MR-13 跨盘(EXDEV seam)：toast 提示、文件纹丝不动、标签不变（变异敏感门）', async () => {
  const [ra, rb] = await openTwoRoots();
  await fileRow(ra, 'a.html').click(); // 开着 a.html
  await expect(tabRow(ra, 'a.html')).toBeVisible();
  await app.evaluate(() => { process.env.WS2_FORCE_EXDEV = '1'; }); // 强制走 EXDEV 分支
  await dndTo(ra, 'a.html', `.sb-root-head[data-root="${rb}"]`);
  await expect(page.locator('.sb-toast')).toContainText('不同的磁盘');
  // 文件没动、标签还在 A、B 没冒出来
  expect(await onDisk(path.join(wsA, 'a.html'))).toBe(true);
  expect(await onDisk(path.join(wsB, 'a.html'))).toBe(false);
  await expect(tabRow(ra, 'a.html')).toBeVisible();
  await expect(tabRow(rb, 'a.html')).toHaveCount(0);
  await app.evaluate(() => { delete process.env.WS2_FORCE_EXDEV; });
});

test('MR-14 竞态守卫：移动落盘后、标签 retarget 前触发 onTreeChanged → 标签不被误清（P2 回归门）', async () => {
  const [ra, rb] = await openTwoRoots();
  // 落盘后拖延 600ms（reply 前），制造「reconcile 可抢跑」的窗口
  await app.evaluate(() => { process.env.WS2_SLOW_MOVE_MS = '600'; });
  await fileRow(ra, 'a.html').click(); // 打开 a.html（激活）
  await expect(tabRow(ra, 'a.html')).toBeVisible();
  // 触发拖动：doMoveAcross 开始 await wsMoveAcross，rename 落盘后卡在 600ms sleep
  await dndTo(ra, 'a.html', `.sb-root-head[data-root="${rb}"]`);
  await page.waitForTimeout(200);
  await expect.poll(() => onDisk(path.join(wsB, 'a.html'))).toBe(true); // 确认已落盘到 B（源根树里没了）
  // 手动触发两根 onTreeChanged（模拟源根 watcher 抢跑）——crossMoveGuard 应让它跳过 reconcile
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(150);
  // 守卫生效：a.html 标签没被误清（移动还没完成，标签仍在但没被 removeEntry 销毁）
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toHaveCount(1);
  // 移动完成 → 标签换到 B 根、仍存活，编辑器仍指向它
  await expect(tabRow(rb, 'a.html')).toBeVisible({ timeout: 8000 });
  await expect(tabRow(ra, 'a.html')).toHaveCount(0);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await app.evaluate(() => { delete process.env.WS2_SLOW_MOVE_MS; });
});

test('MR-8 per-root watcher：外部往 B 加文件 → B 树跟随；A 的展开状态不被打扰', async () => {
  const [ra, rb] = await openTwoRoots();
  await page.click(`.sb-dir[data-root="${ra}"][data-rel="素材"]`); // 展开 A/素材
  await expect(fileRow(ra, '素材/同名.html')).toBeVisible();
  await fs.writeFile(path.join(wsB, '新来的.html'), HTML('NEW'), 'utf8'); // 外部写入 B
  // watcher 推送（mac FSEvents；确定性兜底 = 窗口聚焦刷新，两条路殊途同归）
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(fileRow(rb, '新来的.html')).toBeVisible({ timeout: 8000 });
  await expect(fileRow(ra, '素材/同名.html')).toBeVisible(); // A 的展开状态没被重置
});
