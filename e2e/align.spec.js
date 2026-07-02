// app↔ui-demo 对齐 e2e 真门（宿主/CI 真启动 Electron）：临时文档保存流 + 未保存关闭确认 + 切标签不丢
// + 收起「真收起」 + Cmd+P 命令面板。容器无显示器跑不了，交 CI(xvfb)/宿主 host-verify。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsDir;

const exists = (p) => fs.access(p).then(() => true, () => false);

async function seedWorkspace(dir) {
  await fs.mkdir(path.join(dir, '数据'), { recursive: true });
  await fs.writeFile(path.join(dir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(dir, '数据', 'b.html'), HTML('BBB'), 'utf8');
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
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
}
// 从「标签页 +」建一个临时文档（空文档模板）。
async function newTempDoc() {
  await page.locator('#sb-tabs .sb-zone-add').click();
  await expect(page.locator('.sb-modal')).toBeVisible();
  await page.locator('.sb-card', { hasText: '空文档' }).click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('未命名');
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-align-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  await seedWorkspace(wsDir);
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir }));
});
test.afterEach(async () => {
  // 有未保存的临时文档时，主进程关窗守卫（WS2_NO_CLOSE_DIALOG 下静默取消关闭）会让 app.close() 卡住 →
  // 先 destroy 强制关（绕开未保存守卫，纯测试收尾；真 app 退出仍会弹原生「放弃/取消」）。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('临时文档新建：不落盘、不进树、标为未保存（● dirty-dot）', async () => {
  await openWorkspace();
  await newTempDoc();
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveClass(/is-active/);
  await expect(page.locator('#dirty-dot')).toContainText('未保存');   // 临时 = 未保存
  await expect(page.locator('.sb-file[data-rel="未命名.html"]')).toHaveCount(0); // 没进树
  await page.waitForTimeout(150);
  expect(await exists(path.join(wsDir, '未命名.html'))).toBe(false); // 没落盘
});

test('保存流：保存按钮 → SaveModal「保存到哪里」→ 存到根 → 落盘 + 转真标签 + 进树', async () => {
  await openWorkspace();
  await newTempDoc();
  await page.click('#save-btn');
  await expect(page.locator('.sb-modal-save')).toBeVisible();
  await expect(page.locator('.sb-modal-save .sb-modal-title')).toHaveText('保存到哪里');
  await page.locator('.sb-modal-save .sb-btn-primary').click(); // 默认根目录
  await expect.poll(() => exists(path.join(wsDir, '未命名.html'))).toBe(true);
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveCount(0);       // 临时标签没了
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="未命名.html"]')).toHaveClass(/is-active/); // 转成真标签
  await expect(page.locator('.sb-file[data-rel="未命名.html"]')).toBeVisible(); // 进树
});

test('保存到子文件夹「数据」', async () => {
  await openWorkspace();
  await newTempDoc();
  await page.click('#save-btn');
  await expect(page.locator('.sb-modal-save')).toBeVisible();
  await page.locator('.sb-save-row', { hasText: '数据' }).click();
  await page.locator('.sb-modal-save .sb-btn-primary').click();
  await expect.poll(() => exists(path.join(wsDir, '数据', '未命名.html'))).toBe(true);
});

test('未保存关闭：临时文档 × → CloseConfirmModal →「不保存直接关闭」→ 标签消失、没落盘', async () => {
  await openWorkspace();
  await newTempDoc();
  const tempTab = page.locator('#sb-tabs .sb-tab.sb-tab-temp');
  await tempTab.hover();
  await tempTab.locator('.sb-tab-close').click();
  await expect(page.locator('.sb-modal-confirm')).toBeVisible();
  await page.locator('.sb-modal-confirm .sb-btn-danger').click(); // 不保存直接关闭
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveCount(0);
  await page.waitForTimeout(150);
  expect(await exists(path.join(wsDir, '未命名.html'))).toBe(false);
});

test('保存并关闭：临时文档 × → 确认 →「保存并关闭」→ SaveModal → 落盘 + 关标签', async () => {
  await openWorkspace();
  await newTempDoc();
  const tempTab = page.locator('#sb-tabs .sb-tab.sb-tab-temp');
  await tempTab.hover();
  await tempTab.locator('.sb-tab-close').click();
  await expect(page.locator('.sb-modal-confirm')).toBeVisible();
  await page.locator('.sb-modal-confirm .sb-btn-primary').click(); // 保存并关闭
  await expect(page.locator('.sb-modal-save')).toBeVisible();      // 转「保存到哪里」
  await page.locator('.sb-modal-save .sb-btn-primary').click();
  await expect.poll(() => exists(path.join(wsDir, '未命名.html'))).toBe(true);
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="未命名.html"]')).toHaveCount(0); // 存完关掉
});

test('临时文档切标签不丢：编辑 → 切到别的文件 → 切回，编辑内容还在', async () => {
  await openWorkspace();
  await newTempDoc();
  const frame = page.frameLocator('#doc-frame');
  await frame.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_MARK_');
  await expect(frame.locator('h1')).toContainText('_MARK_');
  await page.click('.sb-file[data-rel="a.html"]');                 // 切到 a.html（临时被 stash）
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await page.locator('#sb-tabs .sb-tab.sb-tab-temp').click();       // 切回临时标签
  await expect(page.frameLocator('#doc-frame').locator('h1')).toContainText('_MARK_'); // 内容恢复
});

test('收起「真收起」：#sb-toggle → 侧栏全隐（宽 0）+ 悬浮展开按钮；#sb-reopen 展开', async () => {
  await openWorkspace();
  const width = () => page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().width);
  expect(await width()).toBeGreaterThan(100);
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  expect(await width(), '真收起应宽度归零').toBeLessThan(5);
  await expect(page.locator('#sb-reopen')).toBeVisible();
  await page.click('#sb-reopen');
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
  expect(await width()).toBeGreaterThan(100);
  await expect(page.locator('#sb-reopen')).toBeHidden();
});

test('Cmd+P 命令面板：菜单 find-palette → 面板 → 输入过滤 → Enter 打开', async () => {
  await openWorkspace();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'find-palette'));
  await expect(page.locator('.fp')).toBeVisible();
  await expect(page.locator('.fp-row').first()).toBeVisible();
  await page.locator('.fp-input').fill('b.html');
  await expect(page.locator('.fp-row')).toHaveCount(1);
  await expect(page.locator('.fp-row .fp-name')).toHaveText('b.html');
  await page.locator('.fp-input').press('Enter');
  await expect(page.locator('.fp')).toHaveCount(0);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('BBB');
});

// —— UX 对齐第一批（feat/ux-align）：页边距 CSP 镜像 / 保存改名 / 浏览…存区外 ——

test('临时文档有页边距：srcdoc 继承外壳严格 CSP、<style>/style= 被拦 → CSSOM 镜像兜底（真 computed style）', async () => {
  await openWorkspace();
  await newTempDoc();
  // baseline 页边距（ensureSchemaBaseline attach 时补的 <style>，srcdoc 里被 CSP 拦、靠镜像层生效）
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const cs = d.defaultView.getComputedStyle(d.body);
    return cs.maxWidth + '|' + cs.paddingTop;
  }), { message: '临时文档 body 没吃到 baseline 页边距（srcdoc CSP 拦 <style>）' }).toBe('820px|48px');
  // style= 属性重放：动态塞一个带内联样式的段落（模拟作者内容），MutationObserver 补挂 CSSOM
  const color = await page.evaluate(() => new Promise((res) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const p = d.createElement('p');
    p.setAttribute('style', 'color: rgb(255, 0, 0)');
    p.textContent = 'x';
    d.body.appendChild(p);
    setTimeout(() => res(d.defaultView.getComputedStyle(p).color), 200);
  }));
  expect(color, 'style= 属性在 srcdoc 里没被 CSSOM 重放').toBe('rgb(255, 0, 0)');
});

test('保存改名：SaveModal 文件名输入改「我的笔记」→ 以新名落盘 + 真标签', async () => {
  await openWorkspace();
  await newTempDoc();
  await page.click('#save-btn');
  await expect(page.locator('.sb-modal-save')).toBeVisible();
  const name = page.locator('.sb-save-name');
  await expect(name).toHaveValue('未命名'); // 默认名 = 未命名（不再是模板名）
  await name.fill('我的笔记');
  await page.locator('.sb-modal-save .sb-btn-primary').click();
  await expect.poll(() => exists(path.join(wsDir, '我的笔记.html'))).toBe(true);
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="我的笔记.html"]')).toHaveClass(/is-active/);
  await expect(page.locator('.sb-toast')).toContainText('已保存到'); // 保存成功正反馈 toast
});

test('浏览…保存到工作区外（WS2_SAVE_AS_OUT seam）→ 区外落盘 + 转外部标签', async () => {
  // 用带 seam 的环境重启（原生保存框 e2e 点不了，非打包态 seam 直给输出路径，同 WS2_PDF_OUT）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  const outPath = path.join(tmp, 'outside', '外面.html');
  await fs.mkdir(path.join(tmp, 'outside'), { recursive: true });
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata2'), WS2_FOLDER_IN: wsDir, WS2_SAVE_AS_OUT: outPath }));
  await openWorkspace();
  await newTempDoc();
  await page.click('#save-btn');
  await expect(page.locator('.sb-modal-save')).toBeVisible();
  await page.locator('.sb-modal-save .sb-btn', { hasText: '浏览…' }).click();
  await expect.poll(() => exists(outPath)).toBe(true);                                 // 真写到工作区外
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveCount(0);           // 临时标签没了
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-ext')).toHaveClass(/is-active/);  // 转外部标签（↗）
  await expect(page.locator('.sb-toast')).toContainText('已保存到');
});

test('临时文档 Cmd+Z：打字 → 菜单 undo → 还原到模板基线（srcdoc 路径撤销）', async () => {
  await openWorkspace();
  await newTempDoc();
  const frame = page.frameLocator('#doc-frame');
  await frame.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_U_');
  await expect(frame.locator('h1')).toContainText('_U_');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'undo'));
  await expect(frame.locator('h1')).toHaveText('未命名');
});

test('自动保存：真文件打字后自动落盘（不按 Cmd+S）；临时文档不自动落盘', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('AAA');
  await frame.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_AS_');
  // 不按 Cmd+S：1.2s 静默期后 debounce 自动落盘
  await expect.poll(async () => {
    try { return (await fs.readFile(path.join(wsDir, 'a.html'), 'utf8')).includes('_AS_'); } catch { return false; }
  }, { timeout: 6000, message: '真文件没被自动保存' }).toBe(true);
  // 临时文档：同样编辑 + 等待，绝不能自动落盘（没有落盘目标，得显式选位置）
  await newTempDoc();
  await page.frameLocator('#doc-frame').locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_T_');
  await page.waitForTimeout(2500); // 盖过 debounce 窗口
  expect(await exists(path.join(wsDir, '未命名.html')), '临时文档被错误地自动落盘了').toBe(false);
  await expect(page.locator('#dirty-dot')).toContainText('未保存'); // 临时文档仍标未保存
});
