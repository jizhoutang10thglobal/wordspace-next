// 本地文件侧栏（F06）综合 UX e2e 真门 —— 把侧栏的「手势」逐个测出来。
//
// 跟 workspace.spec.js（9 个冒烟级）互补：这里覆盖之前没测的整理手势与边界——
// 文件夹右键菜单 / 文件夹删除+撤销整棵子树 / 拖拽移动 / 改名移动当前打开的文件后编辑器重指向 /
// 模板台非空模板 / 内联改名取消 / 收起按钮 / 重启恢复工作区 / 侧栏默认隐藏 / 非 html 走系统程序。
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
    env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', ...env },
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

// 合成 DragEvent 驱动真实拖拽处理链。toHead=true 时拖到侧栏头（= 移到工作区根）。
async function dnd(srcRel, destDirRel, toHead = false) {
  await page.evaluate(
    ({ srcRel, destDirRel, toHead }) => {
      const src = document.querySelector(`.sb-file[data-rel="${srcRel}"]`);
      const dst = toHead
        ? document.querySelector('.sb-head')
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

test('点图片（数据/c.png）→ 编辑区内置图片预览（真实 file:// img）', async () => {
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
});

test('侧栏头「+新建文档」→ 模板台 → 在工作区根建文档并打开', async () => {
  await openWorkspace();
  await page.click('#sb-new-doc');
  await expect(page.locator('.sb-modal')).toBeVisible();
  await page.locator('.sb-card', { hasText: '空文档' }).click();
  await expect.poll(() => exists(path.join(wsDir, '无标题文档.html'))).toBe(true);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('无标题文档');
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

test('文件夹 + → 模板台选「会议纪要」→ 该模板内容真落盘并打开', async () => {
  await openWorkspace();
  const folder = page.locator('.sb-dir[data-rel="数据"]');
  await folder.hover();
  await folder.locator('.sb-add').click();
  await expect(page.locator('.sb-modal')).toBeVisible();
  await page.locator('.sb-card', { hasText: '会议纪要' }).click();
  const f = path.join(wsDir, '数据', '会议纪要.html');
  await expect.poll(() => exists(f)).toBe(true);
  expect(await read(f)).toContain('决议'); // 是会议纪要模板正文，不是空文档
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('会议纪要');
});

test('同名新建去重：连建两次空文档 → 「无标题文档.html」+「无标题文档 2.html」', async () => {
  await openWorkspace();
  const folder = page.locator('.sb-dir[data-rel="数据"]');
  for (let i = 0; i < 2; i++) {
    await folder.hover();
    await folder.locator('.sb-add').click();
    await page.locator('.sb-card', { hasText: '空文档' }).click();
    await expect(page.locator('.sb-modal')).toHaveCount(0);
  }
  await expect.poll(() => exists(path.join(wsDir, '数据', '无标题文档.html'))).toBe(true);
  await expect.poll(() => exists(path.join(wsDir, '数据', '无标题文档 2.html'))).toBe(true);
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
  expect(await exists(path.join(wsDir, '数据', 'c.png'))).toBe(true);
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

test('拖嵌套文件到侧栏头 → 移回工作区根', async () => {
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

test('点头部收起按钮 → 侧栏收成细条、再点展开', async () => {
  await openWorkspace();
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar.is-collapsed')).toBeVisible();
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar.is-collapsed')).toHaveCount(0);
});

test('置顶：右键文件→置顶→进置顶区，重启仍在，取消置顶移除', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: /^置顶$/ }).click();
  await expect(page.locator('#sb-pins .sb-sec-label')).toHaveText('置顶');
  await expect(page.locator('#sb-pins .sb-pin-row[data-rel="a.html"]')).toBeVisible();

  // 重启 app（同 WS2_USERDATA）→ 置顶持久化恢复
  await app.close();
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata') }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('#sb-pins .sb-pin-row[data-rel="a.html"]')).toBeVisible();

  // 取消置顶 → 置顶区消失
  await page.locator('#sb-pins .sb-pin-row[data-rel="a.html"]').hover();
  await page.locator('#sb-pins .sb-pin-row[data-rel="a.html"] .sb-unpin').click();
  await expect(page.locator('#sb-pins')).toBeHidden();
});

test('收起态图标轨：顶层图标 + hover 气泡 + 点文件夹图标展开', async () => {
  await openWorkspace();
  await page.keyboard.press('Control+\\'); // 收起
  await expect(page.locator('#sidebar.is-collapsed')).toBeVisible();
  // 轨上有 4 个顶层节点（数据/空目录/a.html/README）的迷你图标
  await expect(page.locator('#sb-rail .sb-rail-ico')).toHaveCount(4);
  // hover 数据 → 气泡显示名字 + 子项缩略
  await page.locator('#sb-rail .sb-rail-ico[data-rel="数据"]').hover();
  await expect(page.locator('.sb-rail-pop-title')).toHaveText('数据');
  await expect(page.locator('.sb-rail-pop-item', { hasText: 'b.html' })).toBeVisible();
  // 点文件夹图标 → 展开侧栏 + 展开该文件夹
  await page.locator('#sb-rail .sb-rail-ico[data-rel="数据"]').click();
  await expect(page.locator('#sidebar.is-collapsed')).toHaveCount(0);
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
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
