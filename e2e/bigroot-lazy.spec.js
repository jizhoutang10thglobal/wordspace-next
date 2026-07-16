// P0b 大根懒加载（简化模式）e2e 真门。plan docs/plans/2026-07-16-002-feat-lazy-tree-big-roots-plan.md。
// 覆盖 V1 按层读取 lazy 浏览 / V2 lazy watcher 交集 / V3 枚举降级（筛选/Cmd+P/链接索引）/ 普通根零回归。
//
// 强断言口径（CLAUDE.md S4）：断言用户可感知结果（简化模式徽标真渲染、逐层展开真出文件、打开文档真进标签、
// 未展开层变化不触发扫描=diag 计数为证），不查内部实现 class 代理。
//
// ⚠ 变异自检（CLAUDE.md 铁律，**先 commit 再变异**，`git checkout --` 会连修复一起冲掉）：
//   (A) V1 lazy 触发：src/main/workspace.js walk 把 `if (count >= budget)` 改 `if (false)`（或 treeBudget()
//       return 1e9）→ 根不再进 lazy →「V1 简化模式徽标」「V3 筛选/Cmd+P 提示」全翻红（根走了全量、没徽标）。
//   (B) V2 交集过滤：src/renderer/sidebar.js doLazyScan 把 `dirs.filter((d) => loaded.has(d))` 改成 `dirs`
//       （不过滤）→「V2 未展开层变化不扫描」翻红（dirReads 会涨）。
//   还原后复绿才算门有牙。fixture 条目数 66 **刻意 != 预算 50**（同数会让预算门变哑门）。
//
// seam：WS2_FOLDER_IN 选目录 / WS2_TREE_BUDGET 覆盖「整根走 lazy」阈值 / WS2_LINK_BUDGET 覆盖链接索引降级阈值。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;
const BUDGET = 50; // 整根 lazy 阈值：> 它就进简化模式
const W = 8000;

let app, page, tmp, userData, bigDir, smallDir;

async function launch(env) {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: userData, ...env },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  app = a; page = p;
  return { a, p };
}
const nudge = async () => { await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(120); };
// 全部根的 lazy 单层读取次数之和（perf-diag dirReads）——V2「未展开层变化不扫描」的证据。
const totalDirReads = () => page.evaluate(async () => {
  const rs = (await window.ws2.wsDiag()) || [];
  return rs.reduce((s, r) => s + (r.dirReads || 0), 0);
});

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-lazy-'));
  userData = path.join(tmp, 'userdata');
  bigDir = path.join(tmp, '海量文件夹');
  smallDir = path.join(tmp, '小工作区');
  // bigDir：66 条目（> 预算 50 → lazy），带可逐层展开的结构 + 一个可打开的深层文档。
  await fs.mkdir(path.join(bigDir, '子1', '深'), { recursive: true });
  await fs.mkdir(path.join(bigDir, '子2'), { recursive: true });
  await fs.mkdir(path.join(bigDir, 'pad'), { recursive: true });
  await fs.writeFile(path.join(bigDir, '子1', 'inner1.html'), HTML('IN1'), 'utf8');
  await fs.writeFile(path.join(bigDir, '子1', '深', 'deep.html'), HTML('DEEP'), 'utf8');
  await fs.writeFile(path.join(bigDir, '子2', 'inner2.html'), HTML('IN2'), 'utf8');
  for (let i = 0; i < 60; i++) await fs.writeFile(path.join(bigDir, 'pad', `p${i}.html`), HTML('x'), 'utf8'); // 撑过预算
  // smallDir：2 文件（< 预算 50 → 即便同一 app 用小预算也走全量，普通根零回归）。
  await fs.mkdir(smallDir, { recursive: true });
  await fs.writeFile(path.join(smallDir, 'a.html'), HTML('A'), 'utf8');
  await fs.writeFile(path.join(smallDir, 'b.html'), HTML('B'), 'utf8');
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app?.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

async function openBigLazy(extraEnv) {
  await launch({ WS2_FOLDER_IN: bigDir, WS2_TREE_BUDGET: String(BUDGET), ...extraEnv });
  await page.click('#home-open-folder');
  await expect(page.locator('.sb-root-lazy')).toBeVisible({ timeout: W });
}

test('V1 简化模式：超预算根进 lazy——徽标 + 顶层可浏览（非终态过大行），app 可交互', async () => {
  await openBigLazy();
  // 「简化模式」徽标真渲染
  await expect(page.locator('.sb-root-lazy .sb-root-miss-tag', { hasText: '简化模式' })).toBeVisible();
  // 顶层逐个可见（子1/子2/pad 都是目录），不是 P0a 的终态「过大」行
  await expect(page.locator('.sb-dir[data-rel="子1"]')).toBeVisible({ timeout: W });
  await expect(page.locator('.sb-dir[data-rel="子2"]')).toBeVisible();
  await expect(page.locator('.sb-dir[data-rel="pad"]')).toBeVisible();
  await expect(page.locator('.sb-root-oversize')).toHaveCount(0); // 终态过大行已被 lazy 取代
  // 顶层默认全收起：深层文件还没渲染
  await expect(page.locator('.sb-file[data-rel="子1/inner1.html"]')).toHaveCount(0);
  // app 可交互：树底「添加文件夹…」在
  await expect(page.locator('#sb-add-root')).toBeVisible();
});

test('V1 逐层展开 + 打开深层文档：展开子1→深→打开 deep.html 进编辑器', async () => {
  await openBigLazy();
  await page.locator('.sb-dir[data-rel="子1"]').click();
  await expect(page.locator('.sb-file[data-rel="子1/inner1.html"]')).toBeVisible({ timeout: W }); // 按层加载到货
  await expect(page.locator('.sb-dir[data-rel="子1/深"]')).toBeVisible();
  await page.locator('.sb-dir[data-rel="子1/深"]').click();
  await expect(page.locator('.sb-file[data-rel="子1/深/deep.html"]')).toBeVisible({ timeout: W });
  await page.locator('.sb-file[data-rel="子1/深/deep.html"]').click();
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="子1/深/deep.html"]')).toBeVisible({ timeout: W }); // 打开进标签
});

test('V1 可移除：lazy 根右键「移除」→ 恢复空态（诊断 D4 红线：永远可移除）', async () => {
  await openBigLazy();
  const rootId = (await page.$$eval('.sb-root-lazy', (els) => els.map((e) => e.dataset.root)))[0];
  await page.locator(`.sb-root-head[data-root="${rootId}"]`).click({ button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '移除' }).click();
  await expect(page.locator('.sb-root-lazy')).toHaveCount(0);
  await expect(page.locator('#sidebar.sb-on')).toHaveCount(0);
});

test('V1 普通根零回归：< 预算的小根走全量树，无简化模式徽标', async () => {
  await launch({ WS2_FOLDER_IN: smallDir, WS2_TREE_BUDGET: String(BUDGET) }); // 同一小预算，2 文件仍走全量
  await page.click('#home-open-folder');
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible({ timeout: W });
  await expect(page.locator('.sb-file[data-rel="b.html"]')).toBeVisible();
  await expect(page.locator('.sb-root-lazy')).toHaveCount(0); // 没有简化模式徽标
  await expect(page.locator('.sb-root-miss-tag')).toHaveCount(0);
});

test('V2 lazy watcher：已展开层的外部新增实时到货；未展开层的变化不触发任何扫描（dirReads 不涨）', async () => {
  await openBigLazy();
  await page.locator('.sb-dir[data-rel="子1"]').click();
  await expect(page.locator('.sb-file[data-rel="子1/inner1.html"]')).toBeVisible({ timeout: W });
  // (a) 已展开层：往 子1 外部加文件 → 到货
  await fs.writeFile(path.join(bigDir, '子1', 'added-in-loaded.html'), HTML('L'), 'utf8');
  await nudge();
  await expect(page.locator('.sb-file[data-rel="子1/added-in-loaded.html"]')).toBeVisible({ timeout: W });
  // (b) 未展开层：往 子2（没展开）外部加文件 → 不该触发任何单层读取
  const before = await totalDirReads();
  await fs.writeFile(path.join(bigDir, '子2', 'added-in-unloaded.html'), HTML('U'), 'utf8');
  await nudge();
  await page.waitForTimeout(1200); // 给足去抖 + 潜在重扫充分机会露头
  await nudge();
  await page.waitForTimeout(300);
  const after = await totalDirReads();
  expect(after).toBe(before); // 交集为空 → 永不扫描（变异 B 会让它涨）
  // 且未展开层的新文件确实没被渲染（没被偷偷加载）
  await expect(page.locator('.sb-file[data-rel="子2/added-in-unloaded.html"]')).toHaveCount(0);
});

test('V3 筛选降级：lazy 根筛选出行尾提示「仅搜索已浏览过的目录」', async () => {
  await openBigLazy();
  const filter = page.locator('#sb-filter-input');
  await filter.fill('inner');
  await expect(page.locator('.sb-tree-empty', { hasText: '仅搜索已浏览过的目录' })).toBeVisible({ timeout: W });
});

test('V3 Cmd+P 降级：lazy 根不纳入快速打开，面板底注提示', async () => {
  await openBigLazy();
  await page.evaluate(() => window.__sbHooks && window.__sbHooks.findPalette && window.__sbHooks.findPalette());
  await expect(page.locator('#fp-overlay')).toBeVisible({ timeout: W });
  await expect(page.locator('#fp-lazy-note')).toBeVisible();
  await expect(page.locator('#fp-lazy-note')).toContainText('简化模式');
});

test('V3 链接索引降级：超大 lazy 根 @候选返回 degraded（链接功能不可用）', async () => {
  await openBigLazy({ WS2_LINK_BUDGET: '5' }); // 链接扫描预算 5 << 66 条目 → 降级
  const rootId = (await page.$$eval('.sb-root-lazy', (els) => els.map((e) => e.dataset.root)))[0];
  const res = await page.evaluate((id) => window.ws2.linksCandidates(id), rootId);
  expect(res.degraded).toBe(true);
  const groups = await page.evaluate((id) => window.ws2.linksCandidatesAll(id), rootId);
  expect(groups.find((g) => g.rootId === rootId).degraded).toBe(true);
});

test('V1 文件操作不抹树：lazy 根已展开层内删文件 → 该文件消失但同层其它节点还在（refreshRoot 不拿空树盖 lazy 树）', async () => {
  await openBigLazy();
  await page.locator('.sb-dir[data-rel="子1"]').click();
  await expect(page.locator('.sb-file[data-rel="子1/inner1.html"]')).toBeVisible({ timeout: W });
  await expect(page.locator('.sb-dir[data-rel="子1/深"]')).toBeVisible();
  // 删 inner1.html（无引用 → 直接删 + 撤销 toast）→ refreshRoot。若 refreshRoot 走 wsReadTree（超预算返回空树）
  // 会把整棵 lazy 树抹空——那样 子1/深 也会消失。
  await page.locator('.sb-file[data-rel="子1/inner1.html"]').click({ button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect(page.locator('.sb-file[data-rel="子1/inner1.html"]')).toHaveCount(0, { timeout: W }); // 删掉了
  await expect(page.locator('.sb-dir[data-rel="子1/深"]')).toBeVisible(); // 同层其它节点还在 = lazy 树没被空树抹掉
  await expect(page.locator('.sb-root-lazy')).toBeVisible();
});

test('V3 inode 跟随降级不崩：lazy 根内已展开文件被外部改名，app 仍可交互', async () => {
  await openBigLazy();
  await page.locator('.sb-dir[data-rel="子1"]').click();
  await expect(page.locator('.sb-file[data-rel="子1/inner1.html"]')).toBeVisible({ timeout: W });
  await fs.rename(path.join(bigDir, '子1', 'inner1.html'), path.join(bigDir, '子1', 'inner1-renamed.html'));
  await nudge();
  await expect(page.locator('.sb-file[data-rel="子1/inner1-renamed.html"]')).toBeVisible({ timeout: W }); // 新名到货
  await expect(page.locator('#sb-add-root')).toBeVisible(); // 没崩，仍可交互
});
