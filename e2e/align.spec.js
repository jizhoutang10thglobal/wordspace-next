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
  await page.click('#doc-menu-btn'); // ⋯ 菜单里点「另存为…」（临时文档=保存流）
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
  await page.click('#doc-menu-btn'); // ⋯ 菜单里点「另存为…」（临时文档=保存流）
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

test('SB-4：关闭非激活的临时文档也要确认（不零确认静默销毁）', async () => {
  await openWorkspace();
  await newTempDoc(); // temp #1（激活）
  await newTempDoc(); // temp #2（激活，#1 变非激活）
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveCount(2);
  // 关第一个（非激活）temp 的 ×
  const firstTemp = page.locator('#sb-tabs .sb-tab.sb-tab-temp').first();
  await firstTemp.hover();
  await firstTemp.locator('.sb-tab-close').click();
  // 修前：直接销毁、无确认。修后：先切到它 + 弹确认框
  await expect(page.locator('.sb-modal-confirm')).toBeVisible();
  await page.locator('.sb-modal-confirm .sb-btn-danger').click(); // 不保存
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveCount(1); // 只关了一个
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

// 回归（Colin 2026-07-05 抓的 bug）：从别的标签页上关「后台」临时标签，原来直接静默丢弃——
// closeOrRemove 的确认守卫错加了 wasActive 前置。临时=内容未落盘，后台关一样要确认。
test('后台临时标签 × → 也弹未保存确认（原来静默直接关）→ 不保存 → 消失且没落盘', async () => {
  await openWorkspace();
  await newTempDoc();
  const frame = page.frameLocator('#doc-frame');
  await frame.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_MARK_'); // 有真实编辑内容,丢了才叫事故
  await page.click('.sb-file[data-rel="a.html"]'); // 切走 → 临时标签变后台(stash 进 tempStore)
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  const tempTab = page.locator('#sb-tabs .sb-tab.sb-tab-temp');
  await expect(tempTab).not.toHaveClass(/is-active/); // 前置:确实是后台标签
  await tempTab.hover();
  await tempTab.locator('.sb-tab-close').click();
  await expect(page.locator('.sb-modal-confirm')).toBeVisible(); // 修复点:后台关也必须确认
  await page.locator('.sb-modal-confirm .sb-btn-danger').click();
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveCount(0);
  await page.waitForTimeout(150);
  expect(await exists(path.join(wsDir, '未命名.html'))).toBe(false);
});

test('后台临时标签「保存并关闭」→ 先激活它再弹 SaveModal → 存的是它的内容不是当前文档', async () => {
  await openWorkspace();
  await newTempDoc();
  const frame = page.frameLocator('#doc-frame');
  await frame.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_TEMPMARK_');
  await page.click('.sb-file[data-rel="a.html"]'); // 临时标签转后台
  const tempTab = page.locator('#sb-tabs .sb-tab.sb-tab-temp');
  await tempTab.hover();
  await tempTab.locator('.sb-tab-close').click();
  await expect(page.locator('.sb-modal-confirm')).toBeVisible();
  await page.locator('.sb-modal-confirm .sb-btn-primary').click(); // 保存并关闭
  await expect(page.locator('.sb-modal-save')).toBeVisible(); // 修复点:先激活后台临时文档再弹保存框(原来 __shellActiveTemp 为空,静默没反应)
  await page.locator('.sb-modal-save .sb-btn-primary').click(); // 存根目录
  await expect.poll(() => exists(path.join(wsDir, '未命名.html'))).toBe(true);
  const saved = await fs.readFile(path.join(wsDir, '未命名.html'), 'utf8');
  expect(saved).toContain('_TEMPMARK_'); // 存的是那个后台临时文档的内容
  const aHtml = await fs.readFile(path.join(wsDir, 'a.html'), 'utf8');
  expect(aHtml).toContain('AAA'); // 当前文档 a.html 没被误写
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
  await page.click('#doc-menu-btn'); // ⋯ 菜单里点「另存为…」（临时文档=保存流）
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
  await page.click('#doc-menu-btn'); // ⋯ 菜单里点「另存为…」（临时文档=保存流）
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

test('SH-3：关闭确认弹窗期间自动保存被挂起（「不保存」前不偷偷落盘）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('AAA');
  await frame.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('_SH3_');       // 脏 + 排 1.2s 自动保存
  // 立刻发 close-tab 菜单命令（synthetic Cmd+W 不触发原生菜单加速器，走 webContents.send 同真实菜单路径）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'close-tab'));
  await expect(page.locator('.sb-modal-confirm')).toBeVisible();
  await page.waitForTimeout(1600);          // 盖过 1.2s debounce——挂起后不应落盘
  expect((await fs.readFile(path.join(wsDir, 'a.html'), 'utf8')).includes('_SH3_'), '弹窗期间自动保存没被挂起').toBe(false);
  await page.locator('.sb-modal-confirm .sb-btn-danger').click(); // 不保存直接关闭
  await page.waitForTimeout(200);
  expect((await fs.readFile(path.join(wsDir, 'a.html'), 'utf8')).includes('_SH3_'), '「不保存」后仍被落盘').toBe(false);
});

test('SH-5：SaveModal 开着时 Cmd+T / Cmd+P 加速器不叠第二层弹窗', async () => {
  await openWorkspace();
  await newTempDoc();
  await page.click('#doc-menu-btn');
  await page.click('#save-btn');            // 临时文档 → SaveModal
  await expect(page.locator('.sb-modal-save')).toBeVisible();
  // 加速器穿透：走菜单命令路径（synthetic 键不触发原生菜单加速器）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'find-palette'));
  await page.waitForTimeout(200);
  expect(await page.locator('.sb-modal-overlay').count(), '弹层被叠了第二层').toBe(1);
  await expect(page.locator('#fp-overlay')).toHaveCount(0);
  await expect(page.locator('.sb-modal-save')).toBeVisible(); // 原 SaveModal 还在
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

test('T1 统一模态壳：shadow-modal + head 分隔线 + pop 动画 + 关闭X + 确认弹窗橙色警告图标（真 computed style）', async () => {
  await openWorkspace();
  await newTempDoc();
  await page.click('#doc-menu-btn'); // ⋯ 菜单里点「另存为…」（临时文档=保存流）
  await page.click('#save-btn');
  await expect(page.locator('.sb-modal-save .sb-modal-x')).toBeVisible();
  const geo = await page.evaluate(() => {
    const m = document.querySelector('.sb-modal-save');
    return {
      shadow: getComputedStyle(m).boxShadow,
      headBorder: getComputedStyle(m.querySelector('.sb-modal-head')).borderBottomWidth,
      anim: getComputedStyle(m).animationName,
    };
  });
  expect(geo.shadow, '模态阴影没换 shadow-modal（32px 模糊，纸方墨圆保守版暖墨浮层影）').toContain('32px');
  expect(geo.headBorder, 'head 缺分隔线').toBe('1px');
  expect(geo.anim, '缺 ws-modal-pop 动画').toBe('ws-modal-pop');
  await page.locator('.sb-modal-save .sb-modal-x').click(); // X 真能关
  await expect(page.locator('.sb-modal-save')).toHaveCount(0);
  // 关闭确认：橙色圆形警告图标（--c-warning-tint #f9f1e5 底）
  const tempTab = page.locator('#sb-tabs .sb-tab.sb-tab-temp');
  await tempTab.hover();
  await tempTab.locator('.sb-tab-close').click();
  await expect(page.locator('.sb-modal-confirm .sb-cc-ico')).toBeVisible();
  expect(await page.locator('.sb-modal-confirm .sb-cc-ico').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(249, 241, 229)');
  await page.locator('.sb-modal-confirm .sb-btn-danger').click(); // 收尾：丢弃临时文档
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveCount(0);
});

test('T2 标签栏：激活态白纸 puck（真 computed style）+ 未保存点（临时常显 / 真文件脏窗显示、自动保存后消失）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  const tab = page.locator('#sb-tabs .sb-tab[data-rel="a.html"]');
  await expect(tab).toHaveClass(/is-active/);
  const st = await tab.evaluate((el) => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, shadow: cs.boxShadow, h: el.getBoundingClientRect().height }; });
  expect(st.bg, '激活标签应是白纸 puck（surface），不是蓝底 selection').toBe('rgb(255, 255, 255)');
  expect(st.shadow, '保守口径（Wendi 2026-07-08）：卡片/控件零装饰阴影，激活标签靠底色差').toBe('none');
  expect(Math.round(st.h), '标签行高应为 32').toBe(32);
  await expect(tab.locator('.sb-tab-dot')).toBeHidden(); // 干净真文件无点
  // 编辑 → 点出现（脏窗口）→ 自动保存落盘 → 点消失
  await page.frameLocator('#doc-frame').locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('D');
  await expect(tab.locator('.sb-tab-dot')).toBeVisible();
  await expect(tab.locator('.sb-tab-dot')).toBeHidden({ timeout: 6000 });
  // 临时文档：未保存点常显
  await newTempDoc();
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp .sb-tab-dot')).toBeVisible();
  // 收尾：丢弃临时文档（hover 时 dot 让位、close 钮出现）
  const tempTab = page.locator('#sb-tabs .sb-tab.sb-tab-temp');
  await tempTab.hover();
  await tempTab.locator('.sb-tab-close').click();
  await page.locator('.sb-modal-confirm .sb-btn-danger').click();
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveCount(0);
});

test('T7 查找入口钮 + 面板 polish：#sb-find 点开命令面板（shadow-pop + pop-in 动画，真 computed style）', async () => {
  await openWorkspace();
  await page.click('#sb-find'); // 界面可见入口（此前只有 Cmd+P 快捷键）
  await expect(page.locator('.fp')).toBeVisible();
  const st = await page.locator('.fp').evaluate((el) => { const cs = getComputedStyle(el); return { shadow: cs.boxShadow, anim: cs.animationName }; });
  expect(st.shadow, '面板阴影没走 shadow-pop（24px 模糊暖墨浮层影）').toContain('24px');
  expect(st.anim, '面板缺 pop 动画').toBe('ws-pop-in');
  await page.keyboard.press('Escape');
  await expect(page.locator('.fp')).toHaveCount(0);
});

test('⋯ 菜单 + 另存为：真文件另存到工作区外（seam）→ 副本落盘 + 切到副本（↗ 外部标签）', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  const outPath = path.join(tmp, 'copy', '副本.html');
  await fs.mkdir(path.join(tmp, 'copy'), { recursive: true });
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata3'), WS2_FOLDER_IN: wsDir, WS2_SAVE_AS_OUT: outPath }));
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await page.click('#doc-menu-btn');
  await expect(page.locator('#doc-menu')).toBeVisible();
  await expect(page.locator('#save-btn')).toHaveText(/另存为/);   // 「保存」已改「另存为」（自动保存后失义）
  await expect(page.locator('#export-btn')).toHaveText(/导出 PDF/); // 「导出」写全「导出 PDF」
  await expect(page.locator('#save-btn')).toBeEnabled();           // 真文件不看脏态、常可用
  await page.click('#save-btn');                                    // → 原生另存框（seam 直给 outPath）
  await expect.poll(() => exists(outPath)).toBe(true);              // 副本真落盘
  expect(await fs.readFile(outPath, 'utf8')).toContain('AAA');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-ext')).toHaveClass(/is-active/); // 切到副本（↗ 外部标签）
  // 菜单点完自动收起
  await expect(page.locator('#doc-menu')).toBeHidden();
});
