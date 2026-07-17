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
    env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', ...env },
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
  // 有未保存的临时文档时主进程关窗守卫会让 app.close() 卡住 → 先 destroy 强制关（纯测试收尾）。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('SH-4：点当前已激活的标签是 no-op，不重载（未保存编辑不丢、不弹丢弃确认）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  // 在文档里改点东西（进脏态）——用编辑器把标题文字改掉
  const h1 = page.frameLocator('#doc-frame').locator('h1');
  await h1.click();
  await page.frameLocator('#doc-frame').locator('h1').evaluate((el) => { el.textContent = 'AAA-edited'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  // 若点激活标签触发重载（旧行为），会从磁盘重载回 'AAA'（且脏态会弹确认）。修后应保持 'AAA-edited'。
  await tabRow('a.html').click();
  await page.waitForTimeout(300);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA-edited');
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

// UX2（Wendi F4）：标签快捷键经真实菜单路由（main webContents.send('menu',cmd) → onMenu → __sbHooks）。
test('UX2: Cmd+W 关当前标签 / Cmd+T 弹模板台（菜单 onMenu 路由）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
  // Cmd+W → 'close-tab' → __sbHooks.closeActiveTab 关当前活跃标签
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'close-tab'));
  await expect(tabRow('a.html')).toHaveCount(0);
  // Cmd+T → 'new-tab' → __sbHooks.newTab 弹二合一新建 modal（浏览器 spec §4.5.1：地址栏 + 新建文档）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
  await expect(page.locator('.sb-modal-overlay')).toBeVisible();
  await expect(page.locator('.sb-modal-title')).toHaveText('新建标签页');
  await expect(page.locator('.sb-cm-omni-input')).toBeVisible(); // 顶部地址栏行
  await expect(page.locator('.sb-modal-grid')).toBeVisible(); // 下方仍是模板台
});

// UX3（Wendi F5-②；2026-07-06 调整）：Cmd+F 改成文档内查找（find-in-doc），无块编辑器文档时回退聚焦
// 文件筛选；Cmd+Shift+F（find-file）恒聚焦文件筛选。此处无文档 → 两条都应落到 sb-filter-input。
test('UX3: Cmd+Shift+F 聚焦筛选框 + 无文档时 Cmd+F 回退到筛选框', async () => {
  await openWorkspace();
  // Cmd+Shift+F → 'find-file' → 恒聚焦筛选
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'find-file'));
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('sb-filter-input');
  // 移开焦点，再验 Cmd+F（find-in-doc）在无块编辑器文档时的回退
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'find-in-doc'));
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('sb-filter-input');
});

// UX4v3（2026-07-14 Colin 定）：点标签**展开**到该文件 + 高亮，但**不滚动视口**。
// 原 UX4「点标签自动展开+滚动定位」是 Wendi 2026-07-03 的 F6-①；Wendi 报滚动刺眼（同滚动容器 #sb-body 里
// scrollIntoView 会把上方标签区顶走）→ 拆成「展开保留、滚动去掉」。scrollIntoView 探针做强门：既证展开
// （折叠行重新可见），又证没滚（探针没被调）。
test('UX4v3: 点标签展开定位但不滚动视口（展开+高亮=有，scrollIntoView=无）', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click();            // 展开"数据"
  await page.click('.sb-file[data-rel="数据/b.html"]');             // 开 b.html（进标签）
  await expect(tabRow('数据/b.html')).toBeVisible();
  await page.click('.sb-file[data-rel="a.html"]');                  // 开 a.html 并激活（b 失去高亮）
  await page.locator('.sb-dir[data-rel="数据"]').click();            // 收起"数据" → b.html 在树里隐藏
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toHaveCount(0);

  // 装 scrollIntoView 探针（只盯文件行——expandToFile 滚的就是它）
  await page.evaluate(() => {
    window.__fileScrolled = false;
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...a) {
      if (this.classList && this.classList.contains('sb-file')) window.__fileScrolled = true;
      return orig && orig.apply(this, a);
    };
  });

  await tabRow('数据/b.html').click();                              // 点折叠着的 b.html 标签
  // 展开发生：b.html 行重新露出来 + 高亮（Colin：折叠也要展开露出来）
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toHaveClass(/is-active/);
  await expect(tabRow('数据/b.html')).toHaveClass(/is-active/);
  // 但视口没被滚走（Wendi：不往下跳）——scrollIntoView 探针没被文件行触发
  expect(await page.evaluate(() => window.__fileScrolled)).toBe(false);
  // 变异①去掉 expandToFile 的 scroll 门（恒滚）→ 探针 true → 末行翻红；
  // 变异②把 openTabRow(entry,'expand') 改回不展开 → b.html 行不可见 → 上面 toBeVisible 翻红。
});

// UX5（Wendi F1）：侧栏宽度可鼠标拖拽 + 持久化。
test('UX5: 侧栏宽度可拖拽 + 持久化', async () => {
  await openWorkspace();
  const w0 = await page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().width);
  const box = await page.locator('#sb-resize').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const w1 = await page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().width);
  expect(w1, '拖拽后侧栏没变宽').toBeGreaterThan(w0 + 40);
  const saved = await page.evaluate(() => parseInt(localStorage.getItem('ws2-sb-width'), 10));
  expect(saved, '宽度没持久化到 localStorage').toBeGreaterThan(w0 + 40);
});

// Wendi 2026-07-16：侧栏拖太窄时顶排图标被裁掉「消失」。门=往左怼到极限后宽度夹在 240 下限，
// 且顶排每个图标钮的几何边界都在侧栏内（坐标断言，不查 class——图标溢出被网页盖掉时 class 照样在）。
test('侧栏最小宽度 240：拖到最窄顶排图标不被裁切 + 旧存值迁移', async () => {
  await openWorkspace();
  const box = await page.locator('#sb-resize').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 500, box.y + 200, { steps: 5 });
  await page.mouse.up();
  const sb = await page.locator('#sidebar').boundingBox();
  expect(Math.round(sb.width), '拖到极限的宽度不是 240 下限').toBe(240);
  for (const id of ['sb-toggle', 'nav-back', 'nav-fwd', 'nav-reload', 'nav-history', 'sb-find']) {
    const b = await page.locator('#' + id).boundingBox();
    expect(b, `#${id} 拿不到 boundingBox（不可见）`).toBeTruthy();
    expect(b.x + b.width, `#${id} 超出侧栏右边界被裁切`).toBeLessThanOrEqual(sb.x + sb.width + 0.5);
    expect(b.x, `#${id} 超出侧栏左边界`).toBeGreaterThanOrEqual(sb.x - 0.5);
  }
  // 旧存值迁移：Wendi 老版本可能存着 180 → 重载后夹到 240，不跳回默认 260
  await page.evaluate(() => localStorage.setItem('ws2-sb-width', '180'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  const w = await page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(w), '旧存值 180 没被夹到 240').toBe(240);
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

test('关激活的中间标签 → 激活相邻的下一个（不是最后一个）(Colin 2026-07-09；变异敏感)', async () => {
  await openWorkspace();
  // 4 个标签 [a, b, c.png, d]，让「相邻 c.png」≠「最后一个 d」——旧 bug 会跳到 d，修后应到 c.png。
  await page.click('.sb-file[data-rel="a.html"]');
  await page.locator('.sb-dir[data-rel="数据"]').click();
  await page.click('.sb-file[data-rel="数据/b.html"]');
  await page.click('.sb-file[data-rel="数据/c.png"]'); // 查看器也是标签
  await page.click('.sb-file[data-rel="数据/d.html"]'); // active=d
  await page.click(`#sb-tabs .sb-tab[data-rel="数据/b.html"]`); // 激活中间的 b
  await expect(tabRow('数据/b.html')).toHaveClass(/is-active/);
  await tabRow('数据/b.html').hover();
  await tabRow('数据/b.html').locator('.sb-tab-close').click();
  await expect(tabRow('数据/b.html')).toHaveCount(0);
  // 相邻下一个 = c.png（关键:不是最后一个 d）。旧行为会让 d 激活 → 这条翻红。
  await expect(tabRow('数据/c.png')).toHaveClass(/is-active/);
  await expect(tabRow('数据/d.html')).not.toHaveClass(/is-active/);
});

test('关标签不滚树/不展开到相邻文件所在的文件夹（reveal=false；Colin 报的树跳走本体，变异敏感）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // tab a（根目录）
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 展开 数据
  await page.click('.sb-file[data-rel="数据/b.html"]'); // tab b
  await page.click('.sb-file[data-rel="数据/d.html"]'); // tab d，标签序 [a, b, d]
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 折叠 数据 → 里面的行不再可见
  await expect(page.locator('.sb-file[data-rel="数据/d.html"]')).toHaveCount(0);
  await page.click(`#sb-tabs .sb-tab[data-rel="a.html"]`); // 激活根目录的 a
  await tabRow('a.html').hover();
  await tabRow('a.html').locator('.sb-tab-close').click(); // 关激活 a → 相邻回落到 数据 里的 b
  await expect(tabRow('数据/b.html')).toHaveClass(/is-active/); // 确实回落到了 b（相邻）
  // 关键:回落激活了 数据 里的标签,但树不该因此展开 数据/滚过去（reveal=false）。
  // 变异:把 openTabRow(e,false) 改回 openTabRow(e) → expandToFile 会展开 数据 → 这两条翻红。
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toHaveCount(0); // 仍不可见=没展开
  await expect(page.locator('.sb-file[data-rel="数据/d.html"]')).toHaveCount(0);
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

test('标签 📌→移进置顶区（× 保留可关闭）；取消钉→落回标签页', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await tabRow('a.html').hover();
  await tabRow('a.html').locator('.sb-tab-pin').click(); // 钉
  await expect(pinnedRow('a.html')).toBeVisible(); // 进置顶
  await expect(tabRow('a.html')).toHaveCount(0); // 离开标签页（去重）
  await expect(pinnedRow('a.html').locator('.sb-tab-close')).toHaveCount(1); // 置顶项也有 ×（Wendi 要的）
  // 取消钉（点置顶里的 📌）→ 还开着 → 落回标签页
  await pinnedRow('a.html').locator('.sb-tab-pin').click();
  await expect(tabRow('a.html')).toBeVisible();
  await expect(pinnedRow('a.html')).toHaveCount(0);
});

test('置顶区的 ×：直接关闭（整条移出置顶，不只取消钉）', async () => {
  await openWorkspace();
  // 从树右键直接钉一个没打开的文件 → 置顶区有它、但没开（open:false）
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '置顶' }).click();
  await expect(pinnedRow('a.html')).toBeVisible();
  await expect(tabRow('a.html')).toHaveCount(0); // 没开、只在置顶
  // 点置顶区的 × → 整条删掉
  await pinnedRow('a.html').hover();
  await pinnedRow('a.html').locator('.sb-tab-close').click();
  await expect(pinnedRow('a.html')).toHaveCount(0); // 移出置顶
  await expect(tabRow('a.html')).toHaveCount(0); // 也不落回标签页（是删、不是取消钉）
});

test('置顶区的 ×：关掉「既钉又开且激活」的项 → 编辑器回落/空态', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // a 开着、激活
  await tabRow('a.html').hover();
  await tabRow('a.html').locator('.sb-tab-pin').click(); // 钉 a（进置顶、仍激活）
  await expect(pinnedRow('a.html')).toHaveClass(/is-active/);
  // 点置顶区 × 关掉激活的 a → 没有别的标签 → 回空态
  await pinnedRow('a.html').hover();
  await pinnedRow('a.html').locator('.sb-tab-close').click();
  await expect(pinnedRow('a.html')).toHaveCount(0);
  await expect(page.locator('#home')).toBeVisible();
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

test('标签页区「+」→ 模板台 → 新建临时文档（激活、标为未保存、不进树）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // 先有标签，标签页区头部出现 +
  await page.locator('#sb-tabs .sb-zone-add').click();
  await expect(page.locator('.sb-modal')).toBeVisible();
  await page.locator('.sb-card', { hasText: '空文档' }).click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('未命名');
  // 临时文档：标签是 temp（未保存），不是落盘的 rel 标签，也没进文件树
  const tempTab = page.locator('#sb-tabs .sb-tab.sb-tab-temp');
  await expect(tempTab).toHaveCount(1);
  await expect(tempTab).toHaveClass(/is-active/);
  await expect(tempTab).toContainText('未命名');
  await expect(page.locator('.sb-file[data-rel="未命名.html"]')).toHaveCount(0); // 没进树
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
  await expect(page.locator('#sb-pinned .sb-zone-hint')).toHaveText('把标签页拖到这里置顶'); // 文案对齐 ui-demo（T2）
  // T2：置顶空态是虚线框（看得出是可拖入目标），不是纯斜体文字
  expect(await page.locator('#sb-pinned .sb-zone-hint').evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
  await expect(page.locator('#sb-pinned .sb-tab')).toHaveCount(0);
  await expect(page.locator('#sb-tabs')).toBeVisible();
  await expect(page.locator('#sb-tabs .sb-zone-hint')).toHaveText('没有打开的标签');
  await expect(page.locator('#sb-tabs .sb-tab')).toHaveCount(0);
});

test('「打开」按钮开非 html（工作区内）→ 应用内预览 + 进标签页（Wendi bug2+3）', async () => {
  await openWorkspace();
  await stubPick(path.join(wsDir, '数据', 'c.png'));
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  await expect(page.locator('#viewer .fv-bar')).toBeVisible(); // 应用内查看器，不是只能开 html
  await expect(tabRow('数据/c.png')).toBeVisible(); // 像浏览器一样进了标签页
  await expect(tabRow('数据/c.png')).toHaveClass(/is-active/);
});

test('「打开」按钮开 html（工作区内）→ 进编辑器 + 进标签页', async () => {
  await openWorkspace();
  await stubPick(path.join(wsDir, 'a.html'));
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
});

// 外部标签 = 工作区外文件（在 tmp 下、不在 wsDir 内），abs 作身份，data-rel 属性值=abs。
const extTab = (abs) => page.locator(`#sb-tabs .sb-tab[data-rel="${abs}"]`);

test('「打开」按钮开工作区外文件 → 进标签页（外部标签）+ 应用内预览', async () => {
  await openWorkspace();
  const outside = path.join(tmp, 'outside.png');
  await fs.writeFile(outside, 'png', 'utf8');
  await stubPick(outside);
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  await expect(page.locator('#viewer .fv-bar')).toBeVisible(); // 预览出来了
  await expect(extTab(outside)).toBeVisible(); // 像浏览器一样进了标签页
  await expect(extTab(outside)).toHaveClass(/sb-tab-ext/); // 带外部标记
});

test('「打开」开工作区外 html → 进编辑器 + 外部标签（↗标记 + 完整路径 tooltip）', async () => {
  await openWorkspace();
  const outside = path.join(tmp, 'outside.html');
  await fs.writeFile(outside, HTML('OUTSIDE'), 'utf8');
  await stubPick(outside);
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('OUTSIDE');
  await expect(extTab(outside)).toHaveClass(/is-active/);
  await expect(extTab(outside)).toHaveClass(/sb-tab-ext/);
  await expect(extTab(outside).locator('.sb-tab-ext-ico')).toHaveCount(1);
  await expect(extTab(outside)).toHaveAttribute('title', outside);
});

test('点外部标签重开：切到内部文件再点回，正确重载外部文件', async () => {
  await openWorkspace();
  const outside = path.join(tmp, 'ext.html');
  await fs.writeFile(outside, HTML('EXT'), 'utf8');
  await stubPick(outside);
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('EXT');
  await page.click('.sb-file[data-rel="a.html"]'); // 切到内部 a
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await extTab(outside).click(); // 点回外部标签
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('EXT');
});

test('重启恢复外部标签（文件还在）', async () => {
  await openWorkspace();
  const outside = path.join(tmp, 'keep.html');
  await fs.writeFile(outside, HTML('KEEP'), 'utf8');
  await stubPick(outside);
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  await expect(extTab(outside)).toBeVisible();
  const wsJson = path.join(tmp, 'userdata', 'workspace.json');
  await expect.poll(async () => {
    try { return (await fs.readFile(wsJson, 'utf8')).includes('keep.html'); } catch { return false; }
  }, { timeout: 4000 }).toBe(true);
  await app.close();
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata') }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(extTab(outside)).toBeVisible(); // 外部标签恢复
});

test('外部文件磁盘删了 → 重启静默丢弃该标签', async () => {
  await openWorkspace();
  const outside = path.join(tmp, 'gone.html');
  await fs.writeFile(outside, HTML('GONE'), 'utf8');
  await stubPick(outside);
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  const wsJson = path.join(tmp, 'userdata', 'workspace.json');
  await expect.poll(async () => {
    try { return (await fs.readFile(wsJson, 'utf8')).includes('gone.html'); } catch { return false; }
  }, { timeout: 4000 }).toBe(true);
  await fs.rm(outside); // 删掉外部文件
  await app.close();
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata') }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(extTab(outside)).toHaveCount(0); // 静默丢（path-exists 校验剔除）
});

test('先开工作区外文件、再添加其所在文件夹为根 → 外部标签并进新根（Wendi bug 2026-07-17）', async () => {
  await openWorkspace();
  const dir2 = path.join(tmp, '第二文件夹');
  await fs.mkdir(dir2, { recursive: true });
  const inside = path.join(dir2, 'x.html');
  await fs.writeFile(inside, HTML('XX'), 'utf8');
  await stubPick(inside);
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  await expect(extTab(inside)).toHaveClass(/sb-tab-ext/); // 此刻确实是外部标签
  // 把文件所在的文件夹添加为第二个根
  await app.evaluate(({ }, d) => { process.env.WS2_FOLDER_IN = d; }, dir2);
  await page.click('#sb-add-root');
  await expect(page.locator('.sb-root-head', { hasText: '第二文件夹' })).toBeVisible();
  // 标签被收编：abs 身份换成 rel 身份，↗ 外部标记消失，激活态跟随，编辑器内容不动
  const claimed = page.locator('#sb-tabs .sb-tab[data-rel="x.html"]');
  await expect(claimed).toBeVisible();
  await expect(claimed).not.toHaveClass(/sb-tab-ext/);
  await expect(extTab(inside)).toHaveCount(0); // abs 身份的旧条目销毁，不留双胞胎
  await expect(claimed).toHaveClass(/is-active/);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('XX');
  // 从树里点同一个文件 → 命中同一条标签，不翻倍（修前：abs ≠ rootId:rel 两个身份 → 两条标签）
  await page.click('.sb-file[data-rel="x.html"]');
  await expect(page.locator('#sb-tabs .sb-tab')).toHaveCount(1);
});

test('已持久化的外部标签、其文件夹其实已是根 → 启动自愈并进根（Wendi 已中招的存量状态）', async () => {
  await openWorkspace();
  const wsJson = path.join(tmp, 'userdata', 'workspace.json');
  await expect.poll(async () => {
    try { return (await fs.readFile(wsJson, 'utf8')).includes('workspace'); } catch { return false; }
  }, { timeout: 4000 }).toBe(true);
  await app.close();
  // 直接把「坏状态」写进 store：a.html 在根内，标签却是 abs 外部身份（修复前版本会持久化出这种状态）
  const raw = JSON.parse(await fs.readFile(wsJson, 'utf8'));
  const absA = path.join(wsDir, 'a.html');
  raw.tabs = { entries: [{ abs: absA, kind: 'html', title: 'a.html', open: true, pinned: false }], activeRel: absA };
  await fs.writeFile(wsJson, JSON.stringify(raw), 'utf8');
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata') }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  const healed = page.locator('#sb-tabs .sb-tab[data-rel="a.html"]');
  await expect(healed).toBeVisible(); // 启动后已收编成 rel 身份
  await expect(healed).not.toHaveClass(/sb-tab-ext/);
  await expect(page.locator('#sb-tabs .sb-tab')).toHaveCount(1);
});

test('去重不打架：工作区内 a.html + 工作区外 a.html（同名异位）→ 两个独立标签', async () => {
  await openWorkspace();
  const outside = path.join(tmp, 'a.html'); // basename 同名，但在工作区外
  await fs.writeFile(outside, HTML('OUTA'), 'utf8');
  await page.click('.sb-file[data-rel="a.html"]'); // 内部 → rel 标签
  await stubPick(outside);
  await page.click('#doc-menu-btn');
  await page.click('#open-btn'); // 外部 → abs 标签
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toBeVisible(); // 内部
  await expect(extTab(outside)).toBeVisible(); // 外部
  await expect(page.locator('#sb-tabs .sb-tab')).toHaveCount(2); // 两条独立、不去重
});

test('既有外部标签时删工作区内文件夹不崩、外部标签不动（防 undefined.indexOf 回归）', async () => {
  await openWorkspace();
  const outside = path.join(tmp, 'safe.html');
  await fs.writeFile(outside, HTML('SAFE'), 'utf8');
  await stubPick(outside);
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  await expect(extTab(outside)).toBeVisible();
  // 删工作区内文件夹 → removeTabsUnder 目录分支会遍历所有 entry 的 rel（外部 entry rel=undefined）
  await page.locator('.sb-dir[data-rel="数据"]').click({ button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect(extTab(outside)).toBeVisible(); // 没崩、外部标签纹丝不动
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
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  await expect(page.locator('#doc-name')).toHaveText(longName);
  const ta = await page.locator('.top-actions').boundingBox();
  const bc = await page.locator('.ws-breadcrumb').boundingBox();
  expect(bc.x + bc.width, '面包屑右边缘应在 top-actions 左侧、不重叠').toBeLessThanOrEqual(ta.x);
});

// U4（Wendi 2026-07-15）：⌘\ 切换侧栏改由「视图」菜单加速器统一处理（sendMenu('toggle-sidebar')）。
// 菜单加速器覆盖全部焦点域（主层 / 文档编辑 iframe / 网页 view），是唯一通道——旧的主层 document keydown
// 与 web-tabs before-input 转发都删了，避免双触发。此门验 onMenu 路由（老代码无此菜单路由 → 会漏）；
// 原生加速器在 iframe 聚焦时真触发是 Electron 保证 + host-verify 真键盘验，e2e 测的是路由契约。
test('UX-U4: ⌘\\ 视图菜单 toggle-sidebar → 折叠/恢复；文档编辑聚焦时仍生效（原失灵域回归门）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  const toggle = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'toggle-sidebar'));
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
  await toggle();
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  await expect(page.locator('#sb-edge-hot')).toBeVisible(); // 沉浸收起：浮钮已删，全隐后左缘热区就位
  await toggle();
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('#sb-edge-hot')).toBeHidden();
  // 焦点进文档编辑 iframe（keydown 不冒泡的原失灵域）→ 经菜单加速器仍单次生效（焦点无关，路由恒达）
  await page.frameLocator('#doc-frame').locator('body').click();
  await toggle();
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  await toggle();
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
});

// U5（Wendi 2026-07-15）：⌘R 对**文档**标签有意 no-op（防未保存编辑丢失，§2 拍板）。web 标签的真刷新在 browser.spec.js。
test('UX-U5: ⌘R 对文档标签 no-op —— menu reload 不重载 iframe（易失 DOM 标记存活 = 没重载）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  // 往文档 iframe 塞一个磁盘原文里没有的易失标记——若 ⌘R 真重载 iframe，会被磁盘原文覆盖冲掉
  await page.frameLocator('#doc-frame').locator('body').evaluate((b) => b.setAttribute('data-u5-marker', 'kept'));
  // 菜单 reload（= ⌘R）：文档标签 → __webMenu 判非 web、shell onMenu 无 reload 分支 → no-op
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'reload'));
  await page.waitForTimeout(500); // 给「若误重载」一点发生时间
  // 标记仍在 = iframe 没被重载；正文不变；标签仍是 a.html（强断言：查存活标记，不是查「没报错」）
  await expect(page.frameLocator('#doc-frame').locator('body')).toHaveAttribute('data-u5-marker', 'kept');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
});

// 快捷键可发现性（Wendi 2026-07-16）：核心操作的控件 title 带上快捷键提示，用户悬停能看到「哦有快捷键」。
// 这道门验提示真挂上（防误删/漂移）——补全的是既有 native title 覆盖面（收起侧栏/收藏/查找文件此前已有）。
test('快捷键 tooltip：核心操作控件 title 带简洁快捷键提示（刷新/关标签/新建标签/另存为）', async () => {
  // 简洁格式（ui-demo 定稿）：mac「动作 ⌘X」，非 mac 启动归一成「动作 Ctrl+X」——CI(Linux xvfb) 走 Ctrl 形式，两者都认。
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(tabRow('a.html')).toBeVisible();
  // 标签行 × 关闭钮：⌘W（置顶区的 × 是「移出置顶」、无此提示，不在此验）
  await expect(tabRow('a.html').locator('.sb-tab-close')).toHaveAttribute('title', /(⌘|Ctrl\+)W/);
  // 标签页区「+」新建标签：⌘T
  await expect(page.locator('#sb-tabs .sb-zone-add')).toHaveAttribute('title', /(⌘|Ctrl\+)T/);
  // 导航条刷新：⌘R（DOM 里恒在，disabled 不影响 title）
  await expect(page.locator('#nav-reload')).toHaveAttribute('title', /(⌘|Ctrl\+)R/);
  // ⋯ 菜单「另存为」：⌘⇧S / Ctrl+Shift+S
  await expect(page.locator('#save-btn')).toHaveAttribute('title', /(⌘⇧|Ctrl\+Shift\+)S/);
  // 既有提示未回退（回归兜底）：收起侧栏 ⌘\、查找文件 ⌘P
  await expect(page.locator('#sb-toggle')).toHaveAttribute('title', /(⌘|Ctrl\+)\\/);
  await expect(page.locator('#sb-find')).toHaveAttribute('title', /(⌘|Ctrl\+)P/);
});

// 快捷键教学气泡（Wendi 2026-07-16，对齐 ui-demo coach）：鼠标点了有快捷键的操作 → 弹一次
// 「下次可以用 ⌘X」hint toast，每个操作一辈子只弹一次（localStorage 记住）。
test('快捷键教学气泡：首次鼠标点收起侧栏 → 弹一次 hint；再次操作不弹（每操作只教一次）', async () => {
  await openWorkspace();
  // 首次点收起 → hint 气泡出现：带灯泡 + 文案含平台化 ⌘\/Ctrl+\
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  const hint = page.locator('.sb-toast-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(/(⌘|Ctrl\+)\\/);
  await expect(hint.locator('.sb-toast-bulb svg')).toBeVisible(); // 灯泡真渲染（不是光有 class）
  // 同 op 再操作（沉浸收起后浮钮已删：hover 左缘出 peek、点 toggle 展开——也是鼠标操作 toggle-sidebar）→ 不再弹第二条
  await page.mouse.move(3, 430);
  await expect(page.locator('body')).toHaveClass(/is-sb-peek/, { timeout: 2000 });
  await page.waitForTimeout(380); // 等 peek 滑入动画落定再点
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('.sb-toast-hint')).toHaveCount(1); // 仍是第一条（4.2s 内），没弹新的
  // 「已教过」真落盘：localStorage 记录含 toggle-sidebar（重启也不再弹的持久化依据）
  const coached = await page.evaluate(() => localStorage.getItem('ws-coached-ops') || '');
  expect(coached).toContain('toggle-sidebar');
});
