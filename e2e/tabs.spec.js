// 文档标签页 + 置顶（双标记模型）e2e 真门：宿主真启动 Electron。
// 标签=打开记录，置顶=钉住的；同一批文件带 open/pinned 双标记，置顶优先去重。
// 拖拽用合成 DragEvent 驱动真实 ondragstart/ondrop（→ window.WS2Tabs.dropEntry），判定落渲染/持久化顺序。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsDir;

async function seedWorkspace(dir) {
  await fs.mkdir(path.join(dir, '数据'), { recursive: true });
  await fs.writeFile(path.join(dir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(dir, 'README'), 'no-ext', 'utf8');
  await fs.writeFile(path.join(dir, '数据', 'b.html'), HTML('BBB'), 'utf8');
  await fs.writeFile(path.join(dir, '数据', 'c.png'), 'png', 'utf8');
  await fs.writeFile(path.join(dir, '数据', 'd.html'), HTML('DDD'), 'utf8');
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
    window.confirm = () => true;
    window.alert = () => {};
  });
  return { a, p };
}
async function openWorkspace() {
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
}
const tabRow = (rel) => page.locator(`#sb-tabs .sb-tab[data-rel="${rel}"]`);
const pinnedRow = (rel) => page.locator(`#sb-pinned .sb-tab[data-rel="${rel}"]`);

// 合成拖拽：把标签 srcRel 拖到某区（'pinned' / 'tabs'）的某 Y 位置。
async function tabDnd(srcRel, destZone, clientY = 0) {
  await page.evaluate(
    ({ srcRel, destZone, clientY }) => {
      const src = document.querySelector(`.sb-tab[data-rel="${srcRel}"]`);
      const dst = document.querySelector(`.sb-zone-list[data-zone="${destZone}"]`);
      if (!src || !dst) throw new Error('tab dnd 节点没找到: ' + srcRel + ' → ' + destZone);
      const dt = new DataTransfer();
      const ev = (t, el) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientY }));
      ev('dragstart', src);
      ev('dragover', dst);
      ev('drop', dst);
      ev('dragend', src);
    },
    { srcRel, destZone, clientY },
  );
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-tabs-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  await seedWorkspace(wsDir);
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir }));
});
test.afterEach(async () => {
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('打开文件→进标签页区且激活；开第二个→两标签；点标签切回', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(tabRow('a.html')).toBeVisible();
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
  // 开第二个
  await page.locator('.sb-dir[data-rel="数据"]').click();
  await page.click('.sb-file[data-rel="数据/b.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('BBB');
  await expect(tabRow('数据/b.html')).toHaveClass(/is-active/);
  await expect(tabRow('a.html')).not.toHaveClass(/is-active/);
  // 点 a 标签切回
  await tabRow('a.html').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
});

test('重复打开同一文件不新增标签', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await page.click('.sb-file[data-rel="a.html"]'); // 再点树里的 a
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toHaveCount(1);
});

test('关激活标签→激活剩下最后一个；关到空→回空态', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await page.locator('.sb-dir[data-rel="数据"]').click();
  await page.click('.sb-file[data-rel="数据/b.html"]'); // active=b
  // 关激活 b → 激活 a
  await tabRow('数据/b.html').hover();
  await tabRow('数据/b.html').locator('.sb-tab-close').click();
  await expect(tabRow('数据/b.html')).toHaveCount(0);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
  // 关 a → 空 → 回 home
  await tabRow('a.html').hover();
  await tabRow('a.html').locator('.sb-tab-close').click();
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#sb-tabs .sb-tab')).toHaveCount(0);
});

test('非 html（c.png）也进标签页 + 查看器；关闭正常', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click();
  await page.click('.sb-file[data-rel="数据/c.png"]');
  await expect(page.locator('#viewer .fv-bar')).toBeVisible();
  await expect(tabRow('数据/c.png')).toHaveClass(/is-active/);
  await tabRow('数据/c.png').hover();
  await tabRow('数据/c.png').locator('.sb-tab-close').click();
  await expect(tabRow('数据/c.png')).toHaveCount(0);
});

test('改名被打开的文件→标签 title/rel 跟随', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '重命名' }).click();
  const input = page.locator('.sb-rename');
  await input.fill('改名后');
  await input.press('Enter');
  await expect(tabRow('改名后.html')).toBeVisible(); // 标签跟到新 rel
  await expect(tabRow('改名后.html')).toContainText('改名后.html');
  await expect(tabRow('a.html')).toHaveCount(0);
});

test('删除被打开的文件→标签消失 + 回空态（仅一个标签时）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect(tabRow('a.html')).toHaveCount(0);
  await expect(page.locator('#home')).toBeVisible();
});

test('重启 app→标签 + 上次激活恢复并打开', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await page.locator('.sb-dir[data-rel="数据"]').click();
  await page.click('.sb-file[data-rel="数据/b.html"]'); // active=b
  // 等标签状态落盘再关（持久化是 fire-and-forget IPC，关太快会丢最后一次写）
  const wsJson = path.join(tmp, 'userdata', 'workspace.json');
  await expect
    .poll(async () => {
      try {
        return (await fs.readFile(wsJson, 'utf8')).includes('数据/b.html');
      } catch {
        return false;
      }
    }, { timeout: 4000 })
    .toBe(true);
  await app.close();
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata') }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(tabRow('a.html')).toBeVisible();
  await expect(tabRow('数据/b.html')).toBeVisible();
  await expect(tabRow('数据/b.html')).toHaveClass(/is-active/); // 上次激活的恢复
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('BBB');
});

test('标签 📌→移进置顶区（× 消失）；取消钉→落回标签页', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await tabRow('a.html').hover();
  await tabRow('a.html').locator('.sb-tab-pin').click(); // 钉
  await expect(pinnedRow('a.html')).toBeVisible(); // 进置顶
  await expect(tabRow('a.html')).toHaveCount(0); // 离开标签页（去重）
  await expect(pinnedRow('a.html').locator('.sb-tab-close')).toHaveCount(0); // 置顶项无 ×
  // 取消钉（点置顶里的 📌）→ 还开着 → 落回标签页
  await pinnedRow('a.html').locator('.sb-tab-pin').click();
  await expect(tabRow('a.html')).toBeVisible();
  await expect(pinnedRow('a.html')).toHaveCount(0);
});

test('既钉又开：钉一个开着的文件→只在置顶不在标签页（去重）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // a 开着、激活
  await tabRow('a.html').hover();
  await tabRow('a.html').locator('.sb-tab-pin').click(); // 钉
  await expect(pinnedRow('a.html')).toBeVisible();
  await expect(tabRow('a.html')).toHaveCount(0); // 不在标签页重复
  await expect(pinnedRow('a.html')).toHaveClass(/is-active/); // 仍是激活
});

test('拖标签进置顶区→变 pinned（合成 DragEvent，落持久化）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // 有一个标签 → 两区都出现
  await expect(page.locator('.sb-zone-list[data-zone="pinned"]')).toBeVisible();
  await tabDnd('a.html', 'pinned');
  await expect(pinnedRow('a.html')).toBeVisible();
  await expect(tabRow('a.html')).toHaveCount(0);
});

test('同区拖拽重排标签→顺序变', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await page.locator('.sb-dir[data-rel="数据"]').click();
  await page.click('.sb-file[data-rel="数据/b.html"]');
  await page.click('.sb-file[data-rel="数据/d.html"]'); // 标签页顺序 a, b, d
  const order = async () =>
    page.locator('#sb-tabs .sb-tab').evaluateAll((els) => els.map((e) => e.dataset.rel));
  expect(await order()).toEqual(['a.html', '数据/b.html', '数据/d.html']);
  await tabDnd('数据/d.html', 'tabs', 0); // 拖 d 到顶部（clientY=0）
  expect(await order()).toEqual(['数据/d.html', 'a.html', '数据/b.html']);
});

test('标签页区「+」→ 模板台 → 新文档成为激活标签', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // 先有标签，标签页区头部出现 +
  await page.locator('#sb-tabs .sb-zone-add').click();
  await expect(page.locator('.sb-modal')).toBeVisible();
  await page.locator('.sb-card', { hasText: '空文档' }).click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('无标题文档');
  await expect(tabRow('无标题文档.html')).toHaveClass(/is-active/);
});

// 选到「打开」对话框的文件：原生对话框 e2e 点不了，stub 主进程 dialog.showOpenDialog 返回固定路径。
async function stubPick(absPath) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, absPath);
}

test('空状态：开工作区 0 标签 0 置顶 → 置顶/标签页两区恒显示带占位提示（Wendi bug1）', async () => {
  await openWorkspace();
  // 什么都没打开、没置顶——两个区都得在
  await expect(page.locator('#sb-pinned')).toBeVisible();
  await expect(page.locator('#sb-pinned .sb-zone-hint')).toHaveText('把标签拖到这里置顶');
  await expect(page.locator('#sb-pinned .sb-tab')).toHaveCount(0);
  await expect(page.locator('#sb-tabs')).toBeVisible();
  await expect(page.locator('#sb-tabs .sb-zone-hint')).toHaveText('没有打开的标签');
  await expect(page.locator('#sb-tabs .sb-tab')).toHaveCount(0);
});

test('「打开」按钮开非 html（工作区内）→ 应用内预览 + 进标签页（Wendi bug2+3）', async () => {
  await openWorkspace();
  await stubPick(path.join(wsDir, '数据', 'c.png'));
  await page.click('#open-btn');
  await expect(page.locator('#viewer .fv-bar')).toBeVisible(); // 应用内查看器，不是只能开 html
  await expect(tabRow('数据/c.png')).toBeVisible(); // 像浏览器一样进了标签页
  await expect(tabRow('数据/c.png')).toHaveClass(/is-active/);
});

test('「打开」按钮开 html（工作区内）→ 进编辑器 + 进标签页', async () => {
  await openWorkspace();
  await stubPick(path.join(wsDir, 'a.html'));
  await page.click('#open-btn');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
});

test('「打开」按钮开工作区外文件 → 能预览但不进标签页（产品决策 B）', async () => {
  await openWorkspace();
  const outside = path.join(tmp, 'outside.png'); // 在 tmp 下、但不在 wsDir 工作区内
  await fs.writeFile(outside, 'png', 'utf8');
  await stubPick(outside);
  await page.click('#open-btn');
  await expect(page.locator('#viewer .fv-bar')).toBeVisible(); // 预览出来了
  await expect(page.locator('#sb-tabs .sb-tab')).toHaveCount(0); // 但没进标签页（没有 rel）
});

// UI 防重叠门：右上角 .top-actions（打开/保存/导出）是 position:absolute 浮层，贴顶的横条若不给它
// reserve 右 padding 就会被压住。功能 e2e（按钮能点）测不出这类视觉重叠 → 这里用 boundingBox 直接验。
test('UI 防重叠+对齐：查看器「用默认程序打开」与右上角浮动 actions 不重叠且垂直对齐', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click();
  await page.click('.sb-file[data-rel="数据/c.png"]');
  await expect(page.locator('#viewer .fv-bar')).toBeVisible();
  const ta = await page.locator('.top-actions').boundingBox();
  const fo = await page.locator('.fv-open').boundingBox();
  // 水平：fv-open 整体在 top-actions 左侧、不重叠
  expect(fo.x + fo.width, 'fv-open 右边缘应在 top-actions 左侧、不重叠').toBeLessThanOrEqual(ta.x);
  // 垂直：两者中线对齐（fv-bar 与文档头同高 52px 才齐）——上次只验 x 漏了 y，这条补上
  const taC = ta.y + ta.height / 2, foC = fo.y + fo.height / 2;
  expect(Math.abs(taC - foC), 'fv-open 与 top-actions 垂直中线应对齐').toBeLessThanOrEqual(2);
});

test('UI 防重叠：编辑器长文件名面包屑不压到右上角浮动 actions', async () => {
  await openWorkspace();
  const longName = 'A'.repeat(200) + '.html'; // 极长名 → 面包屑截断并填满到 padding 边界，逼近浮层
  await fs.writeFile(path.join(wsDir, longName), HTML('LONG'), 'utf8');
  await stubPick(path.join(wsDir, longName));
  await page.click('#open-btn');
  await expect(page.locator('#doc-name')).toHaveText(longName);
  const ta = await page.locator('.top-actions').boundingBox();
  const bc = await page.locator('.ws-breadcrumb').boundingBox();
  expect(bc.x + bc.width, '面包屑右边缘应在 top-actions 左侧、不重叠').toBeLessThanOrEqual(ta.x);
});
