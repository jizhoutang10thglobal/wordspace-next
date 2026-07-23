// 本地文件侧栏（F06）综合 UX e2e 真门 —— 把侧栏的「手势」逐个测出来。
//
// 跟 workspace.spec.js（9 个冒烟级）互补：这里覆盖之前没测的整理手势与边界——
// 文件夹右键菜单 / 文件夹删除+撤销整棵子树 / 拖拽移动 / 改名移动当前打开的文件后编辑器重指向 /
// 模板台只剩空文档卡 / 内联改名取消 / 收起按钮 / 重启恢复工作区 / 侧栏默认隐藏 / 非 html 走系统程序。
//
// 强断言锚在真实 fs（fs.stat / fs.readFile 那份 seed 工作区）与真实编辑器内容（serialize / #doc-frame），
// 不查 JS 直接设的 DOM class（CLAUDE.md S4：「能想出 CSS/操作全废但断言还过」= 弱门）。
//
// 拖拽用合成 DragEvent 驱动真实 ondragstart/ondragover/ondrop 处理链（→ doMove → wsMove → fs.rename），
// 断言落在真实 fs。这样跑的是 100% 真实代码路径，只是不靠 Playwright 的鼠标拖拽时序（在 Electron 里出名地飘）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsDir;

const exists = async (p) => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};
const read = (p) => fs.readFile(p, 'utf8');

// seed 工作区：
//   a.html(AAA)  README(无扩展名)  数据/(b.html(BBB), c.png)  空目录/(空)
async function seedWorkspace(dir) {
  await fs.mkdir(path.join(dir, '数据'), { recursive: true });
  await fs.mkdir(path.join(dir, '空目录'), { recursive: true });
  await fs.writeFile(path.join(dir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(dir, 'README'), '我是一个无扩展名文件', 'utf8');
  await fs.writeFile(path.join(dir, '数据', 'b.html'), HTML('BBB'), 'utf8');
  await fs.writeFile(path.join(dir, '数据', 'c.png'), 'png', 'utf8');
}

async function launch(env) {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', ...env },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => {
    window.confirm = () => true; // 删除/丢弃改动等确认一律放行
    window.alert = () => {};
  });
  return { a, p };
}

// 打开工作区（首页空态「打开文件夹」→ WS2_FOLDER_IN seam 返回 wsDir）。
async function openWorkspace() {
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
}

// 合成 DragEvent 驱动真实拖拽处理链。toHead=true 时拖到根标题行（= 移到该根顶层；多根后侧栏头不再是落点）。
async function dnd(srcRel, destDirRel, toHead = false) {
  await page.evaluate(
    ({ srcRel, destDirRel, toHead }) => {
      const src = document.querySelector(`.sb-file[data-rel="${srcRel}"]`);
      const dst = toHead
        ? document.querySelector('.sb-root-head')
        : document.querySelector(`.sb-dir[data-rel="${destDirRel}"]`);
      if (!src || !dst) throw new Error('dnd 节点没找到: ' + srcRel + ' → ' + (toHead ? 'head' : destDirRel));
      const dt = new DataTransfer();
      const ev = (t, el) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
      ev('dragstart', src);
      ev('dragover', dst);
      ev('drop', dst);
      ev('dragend', src);
    },
    { srcRel, destDirRel, toHead },
  );
}

const menuSave = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-sidebar-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  await seedWorkspace(wsDir);
  ({ a: app, p: page } = await launch({
    WS2_USERDATA: path.join(tmp, 'userdata'),
    WS2_FOLDER_IN: wsDir,
  }));
});

test.afterEach(async () => {
  // 有未保存的临时文档时主进程关窗守卫会让 app.close() 卡住 → 先 destroy 强制关（纯测试收尾）。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

// ============================ 显示与导航 ============================

test('侧栏默认隐藏；打开工作区后才显示（单文件编辑保持全宽，守缩放回归）', async () => {
  // 还没打开工作区：侧栏不显示，编辑器首页可见
  await expect(page.locator('#sidebar')).not.toBeVisible();
  await expect(page.locator('#sidebar.sb-on')).toHaveCount(0);
  await expect(page.locator('#home-open-folder')).toBeVisible();
  // 打开后：侧栏显示
  await openWorkspace();
  await expect(page.locator('#sidebar')).toBeVisible();
});

test('打开工作区后文件夹默认收起：只露顶层、子文件不铺开', async () => {
  await openWorkspace();
  await expect(page.locator('.sb-dir[data-rel="数据"]')).toBeVisible(); // 顶层文件夹显示
  await expect(page.locator('.sb-dir[data-rel="空目录"]')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible(); // 顶层文件显示
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toHaveCount(0); // 嵌套子文件默认不显示
  await expect(page.locator('.sb-tree-empty', { hasText: '空文件夹' })).toHaveCount(0); // 空目录占位也收着
});

test('文件夹卡尺点击：展开/收起子节点（默认收起）', async () => {
  await openWorkspace();
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toHaveCount(0); // 默认收起
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 展开
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 再收起
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toHaveCount(0);
});

test('空文件夹展开后显示「空文件夹」', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="空目录"]').click(); // 默认收起，点开
  await expect(page.locator('.sb-tree-empty', { hasText: '空文件夹' })).toBeVisible();
});

test('筛选无命中 → 「没有匹配的文件」；清空 → 树回来', async () => {
  await openWorkspace();
  await page.fill('#sb-filter-input', 'zzz不存在');
  await expect(page.locator('.sb-tree-empty', { hasText: '没有匹配的文件' })).toBeVisible();
  await page.fill('#sb-filter-input', '');
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
});

test('筛选命中子文件 → 保留其祖先文件夹', async () => {
  await openWorkspace();
  await page.fill('#sb-filter-input', 'b.html');
  await expect(page.locator('.sb-dir[data-rel="数据"]')).toBeVisible(); // 祖先文件夹保留
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toHaveCount(0);
});

test('点 .html 切换文件 → 高亮跟着当前文件走', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(page.locator('.sb-file[data-rel="a.html"].is-active')).toBeVisible();
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 展开 数据 才点得到 b.html
  await page.click('.sb-file[data-rel="数据/b.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('BBB');
  await expect(page.locator('.sb-file[data-rel="数据/b.html"].is-active')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"].is-active')).toHaveCount(0); // 旧的取消高亮
});

test('文件名带 title：截断时悬停显全名（文件树文件/文件夹、面包屑）', async () => {
  await openWorkspace();
  // 文件树文件：name span 的 title = 全名（ws-truncate 截断时浏览器原生悬停浮出）
  await expect(page.locator('.sb-file[data-rel="a.html"] .sb-name')).toHaveAttribute('title', 'a.html');
  // 文件树文件夹：title = 文件夹名
  await expect(page.locator('.sb-dir[data-rel="数据"] .sb-name')).toHaveAttribute('title', '数据');
  // 打开文档后，文档头面包屑也带 title = 文件名
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.locator('#doc-name')).toHaveAttribute('title', 'a.html');
});

test('点非 .html（README）→ 编辑区出外部打开卡片，点按钮才走系统程序', async () => {
  await openWorkspace();
  // window.ws2 是 contextBridge 冻结对象、改不了，所以在主进程桩掉 shell.openPath（同时避免真启动宿主程序）。
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openPath = (p) => {
      globalThis.__opened.push(p);
      return Promise.resolve('');
    };
  });
  await page.click('.sb-file[data-rel="README"]');
  // 编辑区出卡片，不进编辑器，且此时还没外部打开
  await expect(page.locator('#viewer .efp-card')).toBeVisible();
  await expect(page.locator('#doc-frame')).toBeHidden();
  expect(await app.evaluate(() => globalThis.__opened || [])).toEqual([]);
  // 点「用默认程序打开」才调 shell.openPath（真实 abs，经 assertInsideWorkspace 解析）
  await page.locator('.efp-open').click();
  await expect.poll(() => app.evaluate(() => globalThis.__opened || [])).toContain(path.join(wsDir, 'README'));
});

test('点图片（数据/c.png）→ 编辑区内置图片预览（真实 file:// img + T3 影院观感）', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 展开才点得到 c.png
  await page.click('.sb-file[data-rel="数据/c.png"]');
  await expect(page.locator('#viewer .fv-bar')).toBeVisible();
  const img = page.locator('#viewer img.imgv-img');
  await expect(img).toHaveCount(1);
  const src = await img.getAttribute('src');
  expect(src).toMatch(/^file:\/\//); // 真文件 URL，不是占位
  expect(decodeURIComponent(src)).toContain('c.png');
  await expect(page.locator('#doc-frame')).toBeHidden();
  // T3 对齐 ui-demo：深色影院背景 + 画框投影 + 文件名标题（真 computed style，不查 class）
  expect(await page.locator('#viewer .imgv-scroll').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(43, 45, 49)'); // #2b2d31
  expect(await img.evaluate((el) => getComputedStyle(el).boxShadow), '画框缺大投影').toContain('44px');
  await expect(page.locator('#viewer .imgv-cap')).toHaveText('c.png'); // 文件名标题
});

test('B9: 侧栏头加号已删；Cmd+T → 模板台 → 建临时文档（不落盘，手动保存才写）', async () => {
  await openWorkspace();
  await expect(page.locator('#sb-new-doc')).toHaveCount(0); // B9：侧栏头「+新建文档」加号已删（跟标签页加号重复）
  // 新建入口 = 标签页区加号 / Cmd+T（同 openCreateModal，temp 模式）。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
  await expect(page.locator('.sb-modal')).toBeVisible();
  await page.locator('.sb-card', { hasText: '空文档' }).click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('未命名');
  // 临时文档：不落盘（对齐 ui-demo：手动保存才进文件夹）
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveCount(1);
  await page.waitForTimeout(200);
  expect(await exists(path.join(wsDir, '未命名.html'))).toBe(false);
});

test('品牌页脚在左侧栏底部：logo + 版本号；面包屑「本地」状态标', async () => {
  await openWorkspace();
  await expect(page.locator('#sidebar .sb-foot')).toBeVisible(); // 在左侧栏里，不在编辑区
  await expect(page.locator('#sidebar .sb-foot .sb-foot-logo')).toBeVisible(); // 真 logo
  await expect(page.locator('#ws-ver')).toHaveText(/^v\d+\.\d+\.\d+$/); // 真实 app 版本（package.json/tag）
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(page.locator('#doc-status')).toHaveText('本地'); // 面包屑状态标
});

// ============================ 新建（模板台） ============================

test('文件夹 + → 模板台只剩「空文档」一张卡（会议纪要/项目方案/周计划 已撤）→ 点它建空白文档、默认名「未命名」', async () => {
  await openWorkspace();
  const folder = page.locator('.sb-dir[data-rel="数据"]');
  await folder.hover();
  await folder.locator('.sb-add').click();
  await expect(page.locator('.sb-modal')).toBeVisible();
  // Wendi 2026-07-23：内置模板收敛为只留空文档——台里有且仅有一张卡，已撤模板一张不剩。
  await expect(page.locator('.sb-card')).toHaveCount(1);
  await expect(page.locator('.sb-card', { hasText: '会议纪要' })).toHaveCount(0);
  await expect(page.locator('.sb-card', { hasText: '项目方案' })).toHaveCount(0);
  await expect(page.locator('.sb-card', { hasText: '周计划' })).toHaveCount(0);
  await page.locator('.sb-card', { hasText: '空文档' }).click();
  const f = path.join(wsDir, '数据', '未命名.html'); // Colin 拍板：新建一律默认名「未命名」
  await expect.poll(() => exists(f)).toBe(true);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('未命名');
});

test('新建弹窗 = 左范式轨 + 右模板 pane（对齐 ui-demo）：Notion 范式激活显空文档卡；点未上线范式 → 占位、无卡', async () => {
  await openWorkspace();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
  await expect(page.locator('.sb-modal')).toBeVisible();
  // 左：范式轨 3 档，第一档「类 Notion」激活（对齐 ui-demo，不再是横排 pill）
  await expect(page.locator('.sb-cm-rail')).toBeVisible();
  await expect(page.locator('.sb-cm-para')).toHaveCount(3);
  await expect(page.locator('.sb-cm-para.is-active')).toHaveCount(1);
  await expect(page.locator('.sb-cm-para.is-active')).toContainText('类 Notion');
  // 右：Notion 范式下 = 模板网格 + 唯一空文档卡（blank-only）
  await expect(page.locator('.sb-cm-pane .sb-modal-grid')).toBeVisible();
  await expect(page.locator('.sb-card')).toHaveCount(1);
  await expect(page.locator('.sb-cm-soon')).toHaveCount(0);
  // 点「范式 2」（灰态未上线）→ 右侧换成占位、卡片消失
  await page.locator('.sb-cm-para.is-soon').first().click();
  await expect(page.locator('.sb-cm-soon')).toBeVisible();
  await expect(page.locator('.sb-card')).toHaveCount(0);
  await expect(page.locator('.sb-cm-para.is-active')).toContainText('范式 2');
  // 切回「类 Notion」→ 卡片回来
  await page.locator('.sb-cm-para').first().click();
  await expect(page.locator('.sb-card')).toHaveCount(1);
  await expect(page.locator('.sb-cm-soon')).toHaveCount(0);
});

test('同名新建去重：连建两次空文档 → 「未命名.html」+「未命名 2.html」', async () => {
  await openWorkspace();
  const folder = page.locator('.sb-dir[data-rel="数据"]');
  for (let i = 0; i < 2; i++) {
    await folder.hover();
    await folder.locator('.sb-add').click();
    await page.locator('.sb-card', { hasText: '空文档' }).click();
    await expect(page.locator('.sb-modal')).toHaveCount(0);
  }
  await expect.poll(() => exists(path.join(wsDir, '数据', '未命名.html'))).toBe(true);
  await expect.poll(() => exists(path.join(wsDir, '数据', '未命名 2.html'))).toBe(true);
});

test('模板台 Escape 关闭、不建文件', async () => {
  await openWorkspace();
  const folder = page.locator('.sb-dir[data-rel="数据"]');
  await folder.hover();
  await folder.locator('.sb-add').click();
  await expect(page.locator('.sb-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sb-modal')).toHaveCount(0);
  // 没有任何 .html 在 数据/ 里新增（仍只有 b.html）
  const names = await fs.readdir(path.join(wsDir, '数据'));
  expect(names.filter((n) => n.endsWith('.html'))).toEqual(['b.html']);
});

test('模板台点遮罩关闭、不建文件', async () => {
  await openWorkspace();
  const folder = page.locator('.sb-dir[data-rel="数据"]');
  await folder.hover();
  await folder.locator('.sb-add').click();
  await expect(page.locator('.sb-modal')).toBeVisible();
  await page.locator('.sb-modal-overlay').click({ position: { x: 5, y: 5 } }); // 点遮罩空白处
  await expect(page.locator('.sb-modal')).toHaveCount(0);
});

// ============================ 文件夹整理（右键菜单） ============================

test('右键文件夹 → 菜单含 新建文档/新建子文件夹/重命名/删除', async () => {
  await openWorkspace();
  await page.click('.sb-dir[data-rel="数据"]', { button: 'right' });
  for (const label of ['新建文档', '新建子文件夹', '重命名', '删除']) {
    await expect(page.locator('.sb-ctx-item', { hasText: label })).toBeVisible();
  }
});

test('右键文件夹 → 新建子文件夹 → 真建目录', async () => {
  await openWorkspace();
  await page.click('.sb-dir[data-rel="数据"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '新建子文件夹' }).click();
  await expect.poll(() => exists(path.join(wsDir, '数据', '新建文件夹'))).toBe(true);
});

test('右键文件夹 → 重命名 → 目录在盘上改名、子文件跟着走', async () => {
  await openWorkspace();
  await page.click('.sb-dir[data-rel="数据"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '重命名' }).click();
  const input = page.locator('.sb-rename');
  await input.fill('资料');
  await input.press('Enter');
  await expect.poll(() => exists(path.join(wsDir, '资料'))).toBe(true);
  await expect.poll(() => exists(path.join(wsDir, '数据'))).toBe(false);
  expect(await exists(path.join(wsDir, '资料', 'b.html'))).toBe(true);
});

test('右键文件夹 → 删除整棵子树 → 撤销整棵回来', async () => {
  await openWorkspace();
  await page.click('.sb-dir[data-rel="数据"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect.poll(() => exists(path.join(wsDir, '数据'))).toBe(false);
  await expect.poll(() => exists(path.join(wsDir, '数据', 'b.html'))).toBe(false);
  await page.locator('.sb-toast-action', { hasText: '撤销' }).click();
  await expect.poll(() => exists(path.join(wsDir, '数据', 'b.html'))).toBe(true); // 子文件也回来了
  await expect.poll(() => exists(path.join(wsDir, '数据', 'c.png'))).toBe(true); // poll：撤销恢复是异步的，别用即时断言（flaky）
});

test('P2-2 连删两个文件：两条撤销 toast 并存，各撤各的（变异敏感）', async () => {
  await openWorkspace();
  // 删 a.html
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(false);
  // 紧接着删 README（旧行为：这一步会把 a 的撤销 toast 顶掉）
  await page.click('.sb-file[data-rel="README"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect.poll(() => exists(path.join(wsDir, 'README'))).toBe(false);
  // 两条撤销 toast 同时在（旧行为只剩 1 条）
  await expect(page.locator('.sb-toast-action', { hasText: '撤销' })).toHaveCount(2);
  // 先撤 a.html（含「已删除「a.html」」文案的那条），另一条不受影响
  await page.locator('.sb-toast', { hasText: 'a.html' }).locator('.sb-toast-action').click();
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(true);
  await expect.poll(() => exists(path.join(wsDir, 'README'))).toBe(false); // README 仍删着
  await expect(page.locator('.sb-toast-action', { hasText: '撤销' })).toHaveCount(1); // 只剩 README 那条
  // 再撤 README
  await page.locator('.sb-toast', { hasText: 'README' }).locator('.sb-toast-action').click();
  await expect.poll(() => exists(path.join(wsDir, 'README'))).toBe(true);
});

test('P2-2 toast 上限：撤销条占满时新信息条不被自己吞掉、撤销条也不被挤走（对抗审查 P2 变异敏感）', async () => {
  await openWorkspace();
  // 场景一：4 条撤销条（占满 cap=4）+ 1 条无撤销信息条 → 信息条必须显形。
  //   旧逻辑 find(非撤销条) 会把「唯一的非撤销条=刚建的这条信息条本身」挑出来挤掉 → 报错凭空消失。
  const s1 = await page.evaluate(() => {
    document.querySelector('.sb-toast-host')?.replaceChildren();
    for (let i = 1; i <= 4; i++) window.__wsToast('删除' + i, '撤销', () => {});
    window.__wsToast('保存失败_ERRTOAST'); // 无撤销信息条
    const toasts = [...document.querySelectorAll('.sb-toast')];
    return { hasErr: toasts.some((t) => t.textContent.includes('保存失败_ERRTOAST')),
             undo: toasts.filter((t) => t.dataset.action === '1').length };
  });
  expect(s1.hasErr).toBe(true); // 新信息条显形——没被清理逻辑当场吞掉
  expect(s1.undo).toBe(4);      // 4 条撤销条一条没少
  // 场景二：5 条撤销条 → 撤销条保命，一条不挤（暂时超限、各自 15s 超时收）。
  //   旧逻辑无非撤销条可挤时走 || firstElementChild 兜底 → 挤掉最旧撤销条 → 撤销机会丢失（4 条）。
  const undo5 = await page.evaluate(() => {
    document.querySelector('.sb-toast-host')?.replaceChildren();
    for (let i = 1; i <= 5; i++) window.__wsToast('删' + i, '撤销', () => {});
    return [...document.querySelectorAll('.sb-toast')].filter((t) => t.dataset.action === '1').length;
  });
  expect(undo5).toBe(5);
});

// ============================ 内联改名取消 ============================

test('内联改名 Escape 取消 → 文件名不变', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '重命名' }).click();
  const input = page.locator('.sb-rename');
  await input.fill('改名后');
  await input.press('Escape');
  await expect(page.locator('.sb-rename')).toHaveCount(0);
  expect(await exists(path.join(wsDir, 'a.html'))).toBe(true); // 原名还在
  expect(await exists(path.join(wsDir, '改名后.html'))).toBe(false);
});

test('内联改名失焦且未改动 → 不触发改名、不生成 a 2.html', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '重命名' }).click();
  await expect(page.locator('.sb-rename')).toBeVisible();
  await page.click('#sb-filter-input'); // 失焦但值没改
  await expect(page.locator('.sb-rename')).toHaveCount(0);
  expect(await exists(path.join(wsDir, 'a.html'))).toBe(true);
  expect(await exists(path.join(wsDir, 'a 2.html'))).toBe(false); // 没把未改动当成新建去重
});

test('删除当前打开的文件 → 回空态 → 撤销 → 文件回磁盘且能重开渲染', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect(page.locator('#home')).toBeVisible(); // 回空态
  await page.locator('.sb-toast-action', { hasText: '撤销' }).click();
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(true);
  await page.click('.sb-file[data-rel="a.html"]'); // 重开
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
});

// ============================ 拖拽移动 ============================

test('拖文件到文件夹 → 真实移动到该目录', async () => {
  await openWorkspace();
  await dnd('a.html', '数据');
  await expect.poll(() => exists(path.join(wsDir, '数据', 'a.html'))).toBe(true);
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(false);
});

test('拖嵌套文件到根标题行 → 移回该根顶层', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 展开 数据 才有 b.html 行可拖
  await dnd('数据/b.html', '', true);
  await expect.poll(() => exists(path.join(wsDir, 'b.html'))).toBe(true);
  await expect.poll(() => exists(path.join(wsDir, '数据', 'b.html'))).toBe(false);
});

// ============================ 操作命中「当前打开的文件」的边界同步（KTD5） ============================

test('改名当前打开的文件 → 编辑器重指向：保存写到新路径、面包屑更新', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');

  // 右键改名当前打开的 a.html
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '重命名' }).click();
  const input = page.locator('.sb-rename');
  await input.fill('改名后');
  await input.press('Enter');

  // 保存目标已指向新文件（app 内部真相），面包屑显示新名
  await expect.poll(() => page.evaluate(() => window.__shellDocPath())).toBe(path.join(wsDir, '改名后.html'));
  await expect(page.locator('#doc-name')).toHaveText('改名后.html');

  // 金标准：在编辑器里改一笔 → 保存 → 内容落到「新」文件，旧文件不存在
  await page.frameLocator('#doc-frame').locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('ZZZ');
  await menuSave();
  await expect.poll(() => read(path.join(wsDir, '改名后.html')).catch(() => '')).toContain('ZZZ');
  expect(await exists(path.join(wsDir, 'a.html'))).toBe(false);
});

test('移动当前打开的文件 → 编辑器重指向到新目录、高亮跟随', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');

  await dnd('a.html', '数据');
  await expect.poll(() => exists(path.join(wsDir, '数据', 'a.html'))).toBe(true);

  await expect.poll(() => page.evaluate(() => window.__shellDocPath())).toBe(path.join(wsDir, '数据', 'a.html'));
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 默认收起，展开才看得到高亮行
  await expect(page.locator('.sb-file[data-rel="数据/a.html"].is-active')).toBeVisible();
});

// ============================ 收起按钮 + 重启恢复 ============================

test('点头部收起按钮 → 侧栏真收起（全隐藏、零可见 chrome），Cmd/Ctrl+\\ 再展开', async () => {
  await openWorkspace();
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  expect(await page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(5); // 真收起 = 宽 0
  // 沉浸收起：sb-reopen 浮钮已删（纯 Arc 式，零可见 chrome）；热区就位，重开=hover peek / Cmd+\
  expect(await page.locator('#sb-reopen').count()).toBe(0);
  await expect(page.locator('#sb-edge-hot')).toBeVisible();
  await page.keyboard.press('Control+\\'); // 主层 keydown fallback（e2e CDP 按键绕过原生菜单）
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('#sb-edge-hot')).toBeHidden(); // 展开后热区退场
});

test('置顶：右键树文件→进置顶区（不必先打开），重启仍在，取消置顶移除', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: /^置顶$/ }).click();
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="a.html"]')).toBeVisible(); // 没打开也进置顶区

  // 等置顶落盘再关（持久化是 fire-and-forget IPC）
  const wsJson = path.join(tmp, 'userdata', 'workspace.json');
  await expect
    .poll(async () => {
      try {
        const raw = await fs.readFile(wsJson, 'utf8'); // v2：全局 tabs 单集合（不再是 tabsByRoot 分桶）
        return raw.includes('"tabs"') && raw.includes('a.html');
      } catch {
        return false;
      }
    }, { timeout: 4000 })
    .toBe(true);
  // 重启 app（同 WS2_USERDATA）→ 置顶持久化恢复
  await app.close();
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata') }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="a.html"]')).toBeVisible();

  // 取消置顶（点该行的 📌）→ 没开过 → 该项销毁 → 置顶区变空（区恒在，显示占位提示，不再整个消失）
  await page.locator('#sb-pinned .sb-tab[data-rel="a.html"]').hover();
  await page.locator('#sb-pinned .sb-tab[data-rel="a.html"] .sb-tab-pin').click();
  await expect(page.locator('#sb-pinned .sb-tab')).toHaveCount(0); // 没有置顶项了
  await expect(page.locator('#sb-pinned')).toBeVisible(); // 但置顶区恒在
  await expect(page.locator('#sb-pinned .sb-zone-hint')).toHaveText('把标签页拖到这里置顶'); // 文案对齐 ui-demo（T2）
});

test('P3-05 置顶→删除→撤销：置顶状态一起回来（变异敏感）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: /^置顶$/ }).click();
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="a.html"]')).toBeVisible();
  // 删除 a.html（置顶随文件消失）
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(false);
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="a.html"]')).toHaveCount(0);
  // 撤销 → 文件回树 + 置顶也回来
  await page.locator('.sb-toast-action', { hasText: '撤销' }).click();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="a.html"]')).toBeVisible();
});

test('P3-05 目录级联：置顶的文件在被删目录里 → 撤销后置顶回来', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 展开
  await page.click('.sb-file[data-rel="数据/b.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: /^置顶$/ }).click();
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="数据/b.html"]')).toBeVisible();
  // 删整个 数据 目录
  await page.click('.sb-dir[data-rel="数据"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect.poll(() => exists(path.join(wsDir, '数据'))).toBe(false);
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="数据/b.html"]')).toHaveCount(0);
  // 撤销 → 子文件的置顶恢复
  await page.locator('.sb-toast-action', { hasText: '撤销' }).click();
  await expect.poll(() => exists(path.join(wsDir, '数据', 'b.html'))).toBe(true);
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="数据/b.html"]')).toBeVisible();
});

test('P3-05 撤销不抢激活：删一个非激活的打开文档→撤销,激活标签/编辑器不被拽走（对抗审查 P2 变异敏感）', async () => {
  await fs.writeFile(path.join(wsDir, 'c.html'), HTML('CCC'), 'utf8'); // 第二个顶层文档
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // 打开 a
  await page.click('.sb-file[data-rel="c.html"]'); // 再打开 c（激活=c，a 仍开着但非激活）
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="c.html"].is-active')).toBeVisible();
  // 删 a.html（非激活的打开文档）
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(false);
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toHaveCount(0);
  // 撤销 → a 标签回来(open)，但激活仍是 c（编辑器没被拽到 a）。旧逻辑 openEntry 会把激活抢给 a →
  // applyTabs 不载入编辑器 → 高亮的激活标签≠编辑器内容。
  await page.locator('.sb-toast-action', { hasText: '撤销' }).click();
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toBeVisible();          // a 回来了
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="c.html"].is-active')).toBeVisible(); // 激活仍是 c
  await expect(page.locator('#doc-name')).toHaveAttribute('title', 'c.html');               // 编辑器面包屑仍是 c
});

test('P3-05 撤销去重改名：原位被占时置顶跟到真实恢复位置,不落错文件/不丢（对抗审查 P2 变异敏感）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: /^置顶$/ }).click();
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="a.html"]')).toBeVisible();
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(false);
  // 撤销前：原位被一个**新** a.html 占了 → 撤销时恢复的文件会去重改名成「a 2.html」
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('新A'), 'utf8');
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // 让树看见新 a.html
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
  // 撤销 → 恢复文件落到「a 2.html」；置顶要跟到 a 2.html（旧逻辑用旧 rel → 置顶落到 a.html=新文件 或丢失）
  await page.locator('.sb-toast-action', { hasText: '撤销' }).click();
  await expect(page.locator('.sb-file[data-rel="a 2.html"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="a 2.html"]')).toBeVisible(); // 置顶跟到真实恢复位置
  await expect(page.locator('#sb-pinned .sb-tab[data-rel="a.html"]')).toHaveCount(0);   // 没落到新文件上
});

test('P3-07 展开的子文件夹重启后仍展开（变异敏感）', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 展开 数据
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
  const wsJson = path.join(tmp, 'userdata', 'workspace.json');
  await expect.poll(async () => {
    try { const j = JSON.parse(await fs.readFile(wsJson, 'utf8')); return !!j.treeState && Object.values(j.treeState.expandedByRoot || {}).some((a) => a.includes('数据')); } catch { return false; }
  }, { timeout: 4000 }).toBe(true);
  await app.close();
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata') }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible(); // 无需再点，展开态自动恢复
});

test('P3-07 收起的根重启后仍收起', async () => {
  await openWorkspace();
  await page.click('.sb-root-head'); // 收起整个根
  await expect(page.locator('.sb-root-head .sb-caret.is-open')).toHaveCount(0);
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toHaveCount(0); // 收起 → 文件隐藏
  const wsJson = path.join(tmp, 'userdata', 'workspace.json');
  await expect.poll(async () => {
    try { const j = JSON.parse(await fs.readFile(wsJson, 'utf8')); return !!(j.treeState && (j.treeState.collapsedRoots || []).length); } catch { return false; }
  }, { timeout: 4000 }).toBe(true);
  await app.close();
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata') }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-root-head .sb-caret.is-open')).toHaveCount(0); // 仍收起
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toHaveCount(0);
});

test('P3-07 缓存语义：磁盘上已展开的目录被删 → 重启无残留报错（rel 失效即弃）', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click();
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
  const wsJson = path.join(tmp, 'userdata', 'workspace.json');
  await expect.poll(async () => {
    try { const j = JSON.parse(await fs.readFile(wsJson, 'utf8')); return !!j.treeState && Object.values(j.treeState.expandedByRoot || {}).some((a) => a.includes('数据')); } catch { return false; }
  }, { timeout: 4000 }).toBe(true);
  await app.close();
  await fs.rm(path.join(wsDir, '数据'), { recursive: true, force: true }); // 外部删掉已持久化展开的目录
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata') }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible(); // 树正常渲染
  await expect(page.locator('.sb-dir[data-rel="数据"]')).toHaveCount(0); // 死 rel 被弃、不残留
});

test('收起态不再有竖排图标轨（Wendi B2：去掉）', async () => {
  await openWorkspace();
  await page.keyboard.press('Control+\\'); // 收起（真收起）
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  // 收起态：不再渲染任何竖排迷你图标（rail 已删）
  await expect(page.locator('.sb-rail-ico')).toHaveCount(0);
  await expect(page.locator('#sb-rail')).toHaveCount(0);
  // 仍能用 Cmd+\ 展开回来
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#sidebar.is-collapsed')).toHaveCount(0);
});

test('重启 app → 自动恢复上次工作区（读 workspace.json，不靠 seam）', async () => {
  await openWorkspace(); // 这一步把 wsDir 存进 workspace.json
  await app.close();

  // 重启：同一 WS2_USERDATA，但去掉 WS2_FOLDER_IN —— 必须靠持久化恢复，而不是 seam
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata') }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
  await expect(page.locator('.sb-dir[data-rel="数据"]')).toBeVisible(); // 顶层文件夹恢复（默认收起）
});

test('T8 文件类型图标形状 + 筛选清除钮', async () => {
  await openWorkspace();
  // 类型换形状：image 图标带 <circle>（FileImage），html 图标不带（FileText）——不只靠颜色区分
  await page.locator('.sb-dir[data-rel="数据"]').click();
  expect(await page.locator('.sb-file[data-rel="数据/c.png"] .sb-ico').innerHTML()).toContain('circle');
  expect(await page.locator('.sb-file[data-rel="a.html"] .sb-ico').innerHTML()).not.toContain('circle');
  // 筛选清除钮：输入非空出现，点击清空 + 树回全量
  await expect(page.locator('#sb-filter-clear')).toBeHidden();
  await page.fill('#sb-filter-input', 'zzz不存在');
  await expect(page.locator('#sb-filter-clear')).toBeVisible();
  await expect(page.locator('.sb-tree-empty', { hasText: '没有匹配的文件' })).toBeVisible();
  await page.click('#sb-filter-clear');
  await expect(page.locator('#sb-filter-clear')).toBeHidden();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
  expect(await page.locator('#sb-filter-input').inputValue()).toBe('');
});
