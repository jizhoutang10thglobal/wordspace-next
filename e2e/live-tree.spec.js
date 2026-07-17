// 实时文件浏览器 e2e：工作区根被外部（非 app）增删改/改名 → 侧栏树自动跟随 + 标签 reconcile。
// 直接用 fs 改磁盘（绕过 app 的 IPC），靠 workspace-watcher（fs.watch recursive）触发；
// Playwright 的 toBeVisible/toHaveCount 自带轮询重试，等去抖（200ms）+ 重读落地。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;
const W = 6000; // 等监听落地的宽限（去抖 + 重读 + 重渲染）

let app, page, tmp, wsDir;

async function launch(env) {
  const a = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', ...env } });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  return { a, p };
}
async function openWorkspace() {
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
}
// 改完磁盘后主动派一次窗口 focus，确定性触发「聚焦兜底刷新」→ onTreeChanged。
// 这样测试不依赖递归 fs.watch 的平台支持（Linux CI 需 Node 20.13+；mac 主机已单独验过真 watch 路径），
// 验的是真正复杂的「重读树 + 标签 reconcile + 编辑器同步」逻辑。
async function nudge() {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-live-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(path.join(wsDir, '数据'), { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(wsDir, '数据', 'b.html'), HTML('BBB'), 'utf8');
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir }));
});
test.afterEach(async () => {
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('外部新增文件 → 侧栏树自动出现（不用重开）', async () => {
  await openWorkspace();
  await fs.writeFile(path.join(wsDir, 'new-external.html'), HTML('NEW'), 'utf8');
  await nudge();
  await expect(page.locator('.sb-file[data-rel="new-external.html"]')).toBeVisible({ timeout: W });
});

test('外部删除文件 → 侧栏树自动消失', async () => {
  await openWorkspace();
  await fs.rm(path.join(wsDir, 'a.html'));
  await nudge();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toHaveCount(0, { timeout: W });
});

test('外部在子文件夹里新增 → 展开后能看到（递归监听）', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 先展开
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
  await fs.writeFile(path.join(wsDir, '数据', 'sub-new.html'), HTML('SUB'), 'utf8');
  await nudge();
  await expect(page.locator('.sb-file[data-rel="数据/sub-new.html"]')).toBeVisible({ timeout: W });
});

// 大根性能（Wendi 卡顿修复）的负断言门：噪音磁盘事件（.DS_Store / node_modules 内部——扫描本来就
// 看不见的路径）必须在 watcher 层被丢弃，不换来任何重扫；watcher 活着时聚焦也不再全量重扫。
// 判定用主进程诊断探针（perf-diag）的扫描计数：全量 reads + 子树 scopedReads 前后必须一个没涨。
// 这是 F0（噪音丢弃）+F2（聚焦收口）唯一的行为门——没有它，isNoisePath 全废/聚焦重扫回归都测不出来。
test('噪音事件（.DS_Store / node_modules）不触发重扫；watcher 活着时聚焦也不重扫', async () => {
  await openWorkspace();
  const scans = async () => (await page.evaluate(() => window.ws2.wsDiag()))
    .reduce((n, r) => n + r.reads + (r.scopedReads || 0), 0);
  const before = await scans();
  await fs.writeFile(path.join(wsDir, '.DS_Store'), 'x', 'utf8');
  await fs.mkdir(path.join(wsDir, 'node_modules', 'pkg'), { recursive: true });
  await fs.writeFile(path.join(wsDir, 'node_modules', 'pkg', 'index.js'), 'x', 'utf8');
  await page.waitForTimeout(1200); // 给足去抖窗口——假阳性（噪音没被丢、排了重扫）有充分机会露头
  await nudge(); // watcher 活着 + 无在途去抖 → 聚焦必须是 no-op（旧行为是全量重扫所有根）
  await page.waitForTimeout(300);
  expect(await scans()).toBe(before);
  // 门自身没坏的对照：真文件变化照常触发重扫
  await fs.writeFile(path.join(wsDir, '数据', 'real.html'), HTML('R'), 'utf8');
  await nudge();
  await expect.poll(scans, { timeout: W }).toBeGreaterThan(before);
});

test('外部改名一个打开的文件 → 树更新 + 标签跟随到新名（inode 匹配）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // 打开 a → 标签
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toBeVisible();
  await fs.rename(path.join(wsDir, 'a.html'), path.join(wsDir, 'a-renamed.html')); // 外部改名
  await nudge();
  await expect(page.locator('.sb-file[data-rel="a-renamed.html"]')).toBeVisible({ timeout: W }); // 树更新
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a-renamed.html"]')).toBeVisible({ timeout: W }); // 标签跟随
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toHaveCount(0); // 旧标签没了
  await expect(page.locator('#doc-name')).toHaveText('a-renamed.html', { timeout: W }); // 编辑器面包屑也重指向
});

test('外部删除一个打开的文件 → 树更新 + 标签消失', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toBeVisible();
  await fs.rm(path.join(wsDir, 'a.html'));
  await nudge();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toHaveCount(0, { timeout: W }); // 树
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toHaveCount(0, { timeout: W }); // 标签
  await expect(page.locator('#home')).toBeVisible({ timeout: W }); // 唯一打开的文档被删 → 编辑器回空态
});

test('P3-04 外部新建的文件夹默认收起（与 app 内建/重启一致，变异敏感）', async () => {
  await openWorkspace();
  await fs.mkdir(path.join(wsDir, '新夹'), { recursive: true });
  await fs.writeFile(path.join(wsDir, '新夹', 'inside.html'), HTML('IN'), 'utf8');
  await nudge();
  // 目录行出现，但收起态：caret 非 is-open + 子文件行没渲染
  await expect(page.locator('.sb-dir[data-rel="新夹"]')).toBeVisible({ timeout: W });
  await expect(page.locator('.sb-dir[data-rel="新夹"] .sb-caret.is-open')).toHaveCount(0);
  await expect(page.locator('.sb-file[data-rel="新夹/inside.html"]')).toHaveCount(0);
});

test('P3-04 外部改名一个已展开的目录 → 仍展开（不误收改名来的目录）', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 展开 数据
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
  await fs.rename(path.join(wsDir, '数据'), path.join(wsDir, '数据档')); // 外部改名（b.html 的 ino 带过来）
  await nudge();
  await expect(page.locator('.sb-dir[data-rel="数据档"]')).toBeVisible({ timeout: W });
  await expect(page.locator('.sb-dir[data-rel="数据档"] .sb-caret.is-open')).toBeVisible(); // 仍展开
  await expect(page.locator('.sb-file[data-rel="数据档/b.html"]')).toBeVisible(); // 子行照显
});

test('P2-6 外部删除「打开中且脏」的文档 → 弹挽救式 SaveModal，能把未保存改动存下（变异敏感）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toBeVisible();
  // 打字让它变脏（未保存改动）
  const frame = page.frameLocator('#doc-frame');
  await frame.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_RESCUE_');
  await expect(frame.locator('h1')).toContainText('_RESCUE_');
  // 外部删掉这个正开着的脏文档
  await fs.rm(path.join(wsDir, 'a.html'));
  await nudge();
  // 别静默丢——弹「保存到哪里」挽救框
  await expect(page.locator('.sb-modal-save')).toBeVisible({ timeout: W });
  await page.locator('.sb-modal-save .sb-btn-primary').click(); // 存回根目录
  // 文件回到盘上且含刚打的字（改动没丢）
  await expect.poll(() => fs.stat(path.join(wsDir, 'a.html')).then(() => true, () => false), { timeout: W }).toBe(true);
  const saved = await fs.readFile(path.join(wsDir, 'a.html'), 'utf8');
  expect(saved).toContain('_RESCUE_');
});

test('P2-6 对照：外部删除「非 dirty」打开文档 → 无挽救框、直接回空态', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // 打开但不打字（不脏）
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toBeVisible();
  await fs.rm(path.join(wsDir, 'a.html'));
  await nudge();
  await expect(page.locator('#home')).toBeVisible({ timeout: W }); // 回空态
  await expect(page.locator('.sb-modal-save')).toHaveCount(0); // 没有挽救框
});

test('P2-6 挽救用对序列化器：非合规(基础编辑)脏文档被外部删,存下的字节不含编辑标记(不泄漏,变异敏感)', async () => {
  // 工作区放一个非合规文档（块级 style → 走基础编辑，DOM 里才会有 contenteditable 等编辑标记可能泄漏）。
  // 这是 p2-6 挽救「序列化器分派」的针对性门：rescue 若 hardcode WS2Serialize（而非 basicEdit 分派）,
  // 会把编辑态属性泄漏进磁盘。合规文档没有这些标记 → 那种 fixture 测不到本 bug（会变哑门）。
  const WILD = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>野</title></head><body>'
    + '<h1 style="color:#c00">野标题</h1><p id="p1">正文一段。</p></body></html>';
  await fs.writeFile(path.join(wsDir, 'wild.html'), WILD, 'utf8');
  await openWorkspace();
  await page.click('.sb-file[data-rel="wild.html"]');
  await expect(page.locator('#ws-degrade-notice')).toBeVisible({ timeout: W }); // 确认真走了基础编辑
  // 打字让它脏
  const frame = page.frameLocator('#doc-frame');
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_RESCUE_');
  await expect(frame.locator('#p1')).toContainText('_RESCUE_');
  // 外部删掉这个正开着的非合规脏文档 → 弹挽救框 → 存回根
  await fs.rm(path.join(wsDir, 'wild.html'));
  await nudge();
  await expect(page.locator('.sb-modal-save')).toBeVisible({ timeout: W });
  await page.locator('.sb-modal-save .sb-btn-primary').click();
  // 存下的字节：改动在 + 编辑态标记没泄漏（剥除契约——rescue 走 basicEdit 序列化）
  await expect.poll(() => fs.stat(path.join(wsDir, 'wild.html')).then(() => true, () => false), { timeout: W }).toBe(true);
  const saved = await fs.readFile(path.join(wsDir, 'wild.html'), 'utf8');
  expect(saved).toContain('_RESCUE_');            // 改动没丢
  expect(saved).not.toMatch(/contenteditable/i);  // 编辑标记没泄漏
  expect(saved).not.toMatch(/data-ws2-basic-ce/i);
});

// 滚动条不许挤跳内容(Colin 2026-07-07):自定义 ::-webkit-scrollbar 让滚动条变占位式,
// 树变长跨过溢出临界时侧栏内容会被挤窄 11px「跳一下」。修法 = .sb-body 预留 scrollbar-gutter。
// 这个门量的是行为不变式(有无滚动条 clientWidth 恒等),不是照抄 CSS 值——没修就红。
test('侧栏滚动条出现/消失时内容宽度不跳', async () => {
  await openWorkspace();
  const widths = await page.locator('#sb-body').evaluate((el) => {
    const out = {};
    el.style.overflowY = 'hidden';  // 无滚动条
    out.noBar = el.clientWidth;
    el.style.overflowY = 'scroll';  // 强制滚动条
    out.withBar = el.clientWidth;
    el.style.overflowY = '';
    return out;
  });
  expect(widths.withBar).toBe(widths.noBar);
});
