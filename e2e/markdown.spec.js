// Markdown 后端 e2e 真门：宿主真启动 Electron，证明「.md 在真 app 里 = 一等公民文档」。
// 断言锚在真实磁盘字节（保存后必须是 md 语法、不是 html）+ 真实渲染（srcdoc 路径，KD-1）。
// 同时兜住本 feature 的头号打包风险：unified(ESM) 在真 Electron 主进程里动态 import 可用
// （read-doc 一跑转换，import 失败整条链路当场红）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');

const CONFORM_MD = [
  '# 会议纪要',
  '',
  '正文段落 **重点** 和 <mark>高亮</mark>。',
  '',
  '- [x] 已完成事项',
  '- [ ] 待办事项',
  '',
  '| 项目 | 状态 |',
  '| --- | --- |',
  '| 甲 | 完成 |',
  '',
  '> 引用一句话',
  '',
  '<div class="ws-callout"><p>提示：这是 callout</p></div>',
  '',
].join('\n');

// 非合规 md：script HTML 岛 → 校验器判非合规 → 基础编辑（分流靠校验器，转换器不 sanitize）
const WILD_MD = ['# 野生页面', '', '<script>window.__x=1</' + 'script>', '', '这段文字可以基础编辑。', ''].join('\n');

const REG_HTML = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>对照</title></head><body>'
  + '<h1>对照文档</h1><p>html 的正文。</p></body></html>';

let app, page, tmp, wsDir;

async function seedWorkspace(dir) {
  await fs.writeFile(path.join(dir, '笔记.md'), CONFORM_MD, 'utf8');
  await fs.writeFile(path.join(dir, '野生.md'), WILD_MD, 'utf8');
  await fs.writeFile(path.join(dir, '对照.html'), REG_HTML, 'utf8');
}

async function launch(env) {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', ...env },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  return { a, p };
}
async function openWorkspace() {
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="笔记.md"]')).toBeVisible();
}
const frame = () => page.frameLocator('#doc-frame');
const menuSave = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-md-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  await seedWorkspace(wsDir);
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir }));
});
test.afterEach(async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('打开合规 .md → 块编辑器（无降级条）：GFM 全渲染 + todo canonical 形态 + 面包屑', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="笔记.md"]');
  await expect(frame().locator('h1')).toHaveText('会议纪要');
  await expect(page.locator('#ws-degrade-notice')).toBeHidden(); // 合规 → 不降级
  await expect(page.locator('#doc-name')).toHaveText('笔记.md');
  // GFM → Schema canonical：todo 是 ws-todo + data-checked（不是 GFM 原生 <input>）
  await expect(frame().locator('ul.ws-todo li[data-checked="true"]')).toHaveText('已完成事项');
  await expect(frame().locator('ul.ws-todo input[type="checkbox"]')).toHaveCount(0);
  await expect(frame().locator('table td').first()).toHaveText('甲');
  await expect(frame().locator('mark')).toHaveText('高亮');
  await expect(frame().locator('div.ws-callout p')).toContainText('callout');
  // 真是块编辑器：点进段落出现编辑态（基础编辑器不会有 data-ws2-editing）
  await frame().locator('p', { hasText: '正文段落' }).click();
  await expect(frame().locator('[data-ws2-editing]')).toHaveCount(1);
  // 打开 md 也进标签页（kind 分流没把 md 丢给查看器）
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="笔记.md"]')).toHaveClass(/is-active/);
});

test('编辑 → 保存 → 磁盘字节真是 md（不是 html）+ 哨兵保留 + 重开 round-trip', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="笔记.md"]');
  await expect(frame().locator('h1')).toHaveText('会议纪要');
  await frame().locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('追加XYZ');
  await expect(frame().locator('h1')).toHaveText('会议纪要追加XYZ');
  await menuSave();
  const mdPath = path.join(wsDir, '笔记.md');
  await expect.poll(async () => (await fs.readFile(mdPath, 'utf8')).includes('会议纪要追加XYZ')).toBe(true);
  const disk = await fs.readFile(mdPath, 'utf8');
  expect(disk.startsWith('# 会议纪要追加XYZ'), '磁盘应以 md 标题语法开头：\n' + disk.slice(0, 120)).toBe(true);
  expect(disk.toLowerCase()).not.toContain('<!doctype');
  expect(disk).not.toContain('<h1'); // 后端真是 md，不是换了后缀的 html
  expect(disk).toContain('- [x] 已完成事项'); // 没编辑到的哨兵内容原样保留
  expect(disk).toContain('| 项目 | 状态 |');
  expect(disk).toContain('<div class="ws-callout">'); // HTML 岛存回
  // round-trip：切走再切回，重新走 read-doc 转换渲染，内容一致
  await page.click('.sb-file[data-rel="对照.html"]');
  await expect(frame().locator('h1')).toHaveText('对照文档');
  await page.click('#sb-tabs .sb-tab[data-rel="笔记.md"]');
  await expect(frame().locator('h1')).toHaveText('会议纪要追加XYZ');
  await expect(frame().locator('ul.ws-todo li[data-checked="true"]')).toHaveText('已完成事项');
});

test('非合规 .md（script 岛）→ 基础编辑 + 降级条；改文字保存 → 磁盘仍是 md 且 script 岛保留', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="野生.md"]');
  await expect(frame().locator('h1')).toHaveText('野生页面');
  await expect(page.locator('#ws-degrade-notice')).toBeVisible(); // 校验器分流 → 降级
  await expect(frame().locator('[data-ws2-editing]')).toHaveCount(0); // 不是块编辑器
  // 基础编辑：点进文字直接改
  await frame().locator('p', { hasText: '基础编辑' }).click();
  await page.keyboard.type('已修改');
  await menuSave();
  const mdPath = path.join(wsDir, '野生.md');
  await expect.poll(async () => (await fs.readFile(mdPath, 'utf8')).includes('已修改')).toBe(true);
  const disk = await fs.readFile(mdPath, 'utf8');
  expect(disk.startsWith('# 野生页面'), '非合规 md 保存后也得还是 md：\n' + disk.slice(0, 120)).toBe(true);
  expect(disk).toContain('<script>window.__x=1</' + 'script>'); // script 岛保真存回、不静默丢
  expect(disk.toLowerCase()).not.toContain('<!doctype');
});

test('外部改动 .md（模拟 Claude 改盘）→ 自动重载渲染新内容（watch 链路对 md 生效）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="笔记.md"]');
  await expect(frame().locator('h1')).toHaveText('会议纪要');
  await fs.writeFile(path.join(wsDir, '笔记.md'), '# 外部改了\n\n新内容NEW标记\n', 'utf8');
  await expect(frame().locator('h1')).toHaveText('外部改了', { timeout: 5000 });
  await expect(frame().locator('body')).toContainText('新内容NEW标记');
});

test('另存为（WS2_SAVE_AS_OUT seam）→ 落盘 .md 保持格式', async () => {
  // 用带 seam 的环境重启（原生保存框 e2e 点不了；非打包态 seam 直给输出路径）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  const outPath = path.join(tmp, 'outside', '副本.md');
  await fs.mkdir(path.join(tmp, 'outside'), { recursive: true });
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata2'), WS2_FOLDER_IN: wsDir, WS2_SAVE_AS_OUT: outPath }));
  await openWorkspace();
  await page.click('.sb-file[data-rel="笔记.md"]');
  await expect(frame().locator('h1')).toHaveText('会议纪要');
  await page.click('#doc-menu-btn'); // ⋯ 菜单 → 另存为…
  await page.click('#save-btn');
  await expect.poll(async () => { try { await fs.access(outPath); return true; } catch { return false; } }).toBe(true);
  const out = await fs.readFile(outPath, 'utf8');
  expect(out.startsWith('# 会议纪要'), '另存为的副本应是 md 字节：\n' + out.slice(0, 120)).toBe(true);
  expect(out.toLowerCase()).not.toContain('<!doctype');
  await expect(page.locator('#doc-name')).toHaveText('副本.md'); // 标准另存为语义：切到副本
});

test('回归哨兵：.html 文档保存后磁盘仍是 html（md 分流没串到 html 链路）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="对照.html"]');
  await expect(frame().locator('h1')).toHaveText('对照文档');
  await frame().locator('p', { hasText: '正文' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('哨兵句');
  await menuSave();
  const htmlPath = path.join(wsDir, '对照.html');
  await expect.poll(async () => (await fs.readFile(htmlPath, 'utf8')).includes('哨兵句')).toBe(true);
  const disk = await fs.readFile(htmlPath, 'utf8');
  expect(disk.toLowerCase().startsWith('<!doctype html>'), 'html 文档必须还是 html：\n' + disk.slice(0, 120)).toBe(true);
  expect(disk).toContain('<h1');
});
