// 文档互链 e2e。当前覆盖 U0（文档内 <a> 导航收口）——核心是 P0 回归门：
// 点文档里的相对链接绝不能让 iframe 自导航、把自动保存写进错误文件。
// 强断言锚真实 fs 字节（不查 DOM class）；WS2_FOLDER_IN 测试 seam 直接喂 seed 目录。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
// 合规文档（进块编辑器——P0 就发生在这）：标题 + 一段带相对链接的正文。
const DOC = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${title}</h1>${body}</body></html>`;

let app, page, tmp, wsDir;

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-doclink-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  await fs.writeFile(path.join(wsDir, 'A.html'), DOC('文档A', '<p>正文 AAA-KEEP <a href="B.html">去B</a> 结束。</p>'), 'utf8');
  await fs.writeFile(path.join(wsDir, 'B.html'), DOC('文档B', '<p>正文 BBB-MARK 这里。</p>'), 'utf8');
  // 一篇指向不存在文件的断链文档
  await fs.writeFile(path.join(wsDir, 'C.html'), DOC('文档C', '<p>断链 <a href="缺失.html#节2">找不到</a> 结束。</p><p>外链 <a href="https://example.com/">站点</a>。</p>'), 'utf8');
  // 子目录里有一篇同名文档：给 C.html 断链的「重新指向」提供候选（根下的 缺失.html 仍不存在 → C 的链接照旧断）
  await fs.mkdir(path.join(wsDir, '归档'), { recursive: true });
  await fs.writeFile(path.join(wsDir, '归档', '缺失.html'), DOC('归档缺失', '<p>这是归档里的同名文档。</p>'), 'utf8');
  // .md（srcdoc 渲染路径）+ 非合规 HTML（基础编辑路径）——覆盖另外两条渲染路径的链接点击 P0
  await fs.writeFile(path.join(wsDir, 'M.md'), '# 文档M\n\n正文 MMM-KEEP [去B](B.html) 结束。\n', 'utf8');
  await fs.writeFile(path.join(wsDir, 'N.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div><h1>文档N</h1><p>正文 NNN-KEEP <a href="B.html">去B</a></p></div></body></html>', 'utf8');
  // D.html：干净可编辑正文（无既有链接），给 U3 @ 提及测试用（点它不会误点到已有链接触发 U0 打开）
  await fs.writeFile(path.join(wsDir, 'D.html'), DOC('文档D', '<p>草稿一段文字 </p>'), 'utf8');
  await fs.writeFile(path.join(wsDir, '报告.pdf'), '%PDF-1.4 fake', 'utf8'); // 非文档文件（B2：@菜单也列它）
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmp, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_FOLDER_IN: wsDir },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  await page.click('#home-open-folder');
  await expect(page.locator('.sb-file[data-rel="A.html"]')).toBeVisible();
});

test.afterEach(async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('U0-P0：点文档内相对链接 → openDoc 切到目标；旧文件字节不被自动保存污染', async () => {
  await page.click('.sb-file[data-rel="A.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档A');

  // 点文档里的「去B」链接 → 应用内切到 B（openDoc 漏斗），iframe 不裸导航
  await frame.locator('a[href="B.html"]').click();
  await expect(frame.locator('h1')).toHaveText('文档B', { timeout: 6000 });
  const dp = await page.evaluate(() => window.__shellDocPath());
  expect(dp.endsWith('B.html')).toBe(true); // docPath 真切到 B（不是停在 A）

  // 在当前文档（B）编辑 + 等自动保存（1.2s）落盘
  await frame.locator('p').first().click();
  await page.keyboard.type('EDIT-B');
  await page.waitForTimeout(1700);

  // 关键回归：A.html 磁盘字节仍是原样，B 的内容绝不能出现在 A 里（P0 = 编辑器挂错页 + 自动保存写错文件）
  const aBytes = await fs.readFile(path.join(wsDir, 'A.html'), 'utf8');
  expect(aBytes).toContain('AAA-KEEP');
  expect(aBytes).not.toContain('BBB-MARK');
  expect(aBytes).not.toContain('EDIT-B');
  // B.html 收到了编辑（自动保存写对了目标）
  const bBytes = await fs.readFile(path.join(wsDir, 'B.html'), 'utf8');
  expect(bBytes).toContain('EDIT-B');
});

test('U0-P0(.md srcdoc)：.md 文档里点相对链接 → 切到目标；.md 源字节不被污染', async () => {
  await page.click('.sb-file[data-rel="M.md"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档M');
  await frame.locator('a[href="B.html"]').click();
  await expect(frame.locator('h1')).toHaveText('文档B', { timeout: 6000 });
  const dp = await page.evaluate(() => window.__shellDocPath());
  expect(dp.endsWith('B.html')).toBe(true);
  await frame.locator('p').first().click();
  await page.keyboard.type('EDIT-FROM-MD');
  await page.waitForTimeout(1700);
  // .md 源文件字节原样（srcdoc 路径的 onload 硬化 + 点击收口双保险）
  const mBytes = await fs.readFile(path.join(wsDir, 'M.md'), 'utf8');
  expect(mBytes).toContain('MMM-KEEP');
  expect(mBytes).not.toContain('EDIT-FROM-MD');
  expect(mBytes).not.toContain('BBB-MARK');
});

test('U0(基础编辑)：非合规文档里点相对链接 → 不导航、不污染源文件', async () => {
  await page.click('.sb-file[data-rel="N.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档N');
  // 基础编辑整 body contenteditable：点链接放光标、不导航（P0 = 绝不让 iframe 跳走污染源文件）
  await frame.locator('a[href="B.html"]').click();
  await page.waitForTimeout(400);
  await expect(frame.locator('h1')).toHaveText('文档N'); // 仍在 N，没被导航走
  const dp = await page.evaluate(() => window.__shellDocPath());
  expect(dp.endsWith('N.html')).toBe(true);
  const nBytes = await fs.readFile(path.join(wsDir, 'N.html'), 'utf8');
  expect(nBytes).toContain('NNN-KEEP');
  expect(nBytes).not.toContain('BBB-MARK');
});

test('U0：文档内 http 外链 → 走系统程序（openExternalUrl），iframe 不导航', async () => {
  // spy shell.openExternal（主进程）
  await app.evaluate(({ shell }) => {
    globalThis.__extCalls = [];
    const orig = shell.openExternal;
    shell.openExternal = (u) => { globalThis.__extCalls.push(u); return Promise.resolve(); };
    globalThis.__restoreExt = () => { shell.openExternal = orig; };
  });
  await page.click('.sb-file[data-rel="C.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档C');
  await frame.locator('a[href="https://example.com/"]').click();
  await page.waitForTimeout(300);
  const calls = await app.evaluate(() => globalThis.__extCalls || []);
  expect(calls).toContain('https://example.com/');
  // iframe 没被导航走：还停在 C
  await expect(frame.locator('h1')).toHaveText('文档C');
  await app.evaluate(() => globalThis.__restoreExt && globalThis.__restoreExt());
});

test('U3：@ 提及 → 选文档 → 插入纯净 <a href>（磁盘零 class/contenteditable/&nbsp;）', async () => {
  await page.click('.sb-file[data-rel="D.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档D');
  await frame.locator('p').first().click(); // 进入编辑
  await page.keyboard.press('End');
  await page.keyboard.type('@');            // 触发提及菜单（父层浮层）
  await expect(page.locator('.ws-mention-menu')).toBeVisible({ timeout: 5000 });
  await page.keyboard.type('文档B');         // 中文筛（DOM 真相 query：insertText 走 input→syncFromDom，验证中文能筛）
  await expect(page.locator('.ws-mention-item.is-active')).toContainText('文档B'); // 文档在前，active=0=文档B（含「新建」项时用 active 消歧）
  await page.keyboard.press('Enter');       // 选中
  await expect(page.locator('.ws-mention-menu')).toBeHidden();
  await expect(frame.locator('a', { hasText: '文档B' })).toHaveAttribute('href', 'B.html');
  await page.waitForTimeout(1700);          // 自动保存
  const d = await fs.readFile(path.join(wsDir, 'D.html'), 'utf8');
  expect(d).toMatch(/<a href="B\.html">文档B<\/a>/);      // 纯净 href + 标题快照
  expect(d).not.toContain('ws-doclink');                 // 零 class
  expect(d).not.toContain('contenteditable');            // 零 contenteditable
  expect(d).not.toContain('&nbsp;');
  expect(d).not.toContain('\u00a0'); // 零 nbsp（用普通空格落 caret）
});

test('U3-E：@新建 → 当前文档插链接 + 跳去编辑新文档（Colin 2026-07-09）', async () => {
  await page.click('.sb-file[data-rel="D.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档D');
  await frame.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('@');
  await expect(page.locator('.ws-mention-menu')).toBeVisible({ timeout: 5000 });
  await page.keyboard.type('新章节');            // 不存在的名字 → 菜单出「新建「新章节」」项（active=0）
  await expect(page.locator('.ws-mention-item.is-active')).toContainText('新建「新章节」');
  await page.keyboard.press('Enter');           // 选新建 → 建文档 + 插链接 + 跳去编辑新文档
  // 跳转到新文档：编辑器 h1 变成「新章节」（是 E 的核心——不再留在老文档）
  await expect(frame.locator('h1')).toHaveText('新章节', { timeout: 6000 });
  // 新文档真落盘
  const nu = await fs.readFile(path.join(wsDir, '新章节.html'), 'utf8');
  expect(nu).toContain('<h1>新章节</h1>');
  // 老文档 D.html 存了纯净链接（跳转前已 save）
  const d = await fs.readFile(path.join(wsDir, 'D.html'), 'utf8');
  expect(d).toMatch(/<a href="新章节\.html">新章节<\/a>/);
  expect(d).not.toContain('ws-doclink');
  expect(d).not.toContain('@新章节'); // 触发符+query 不残留正文
  // 去掉正确的链接后不应再有「新章节」残留（href+文字都在链接里，别有漏进正文的裸文字）
  expect(d.replace(/<a href="新章节\.html">新章节<\/a>/g, '')).not.toContain('新章节');
});

test('U3-B6：从侧栏拖文件进正文 → 插入纯净链接（真实拖拽管线）', async () => {
  await page.click('.sb-file[data-rel="D.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档D');
  // 真实拖拽：Playwright dragTo 走 mousedown/move/up → 浏览器生成真 dragstart/dragover/drop（非合成事件，L10）
  await page.locator('.sb-file[data-rel="B.html"]').dragTo(frame.locator('p').first());
  await expect(frame.locator('a[href="B.html"]')).toBeVisible({ timeout: 4000 });
  await page.waitForTimeout(1700);
  const d = await fs.readFile(path.join(wsDir, 'D.html'), 'utf8');
  expect(d).toMatch(/<a href="B\.html">/);
  expect(d).not.toContain('ws-doclink');
  expect(d).not.toContain('contenteditable');
});

test('U3-B5：选中文字 → 气泡「链接」→ 选文档 → 选中文字变链接（wrap 保留文字）', async () => {
  await page.click('.sb-file[data-rel="D.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档D');
  await frame.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); // 选中「草稿」
  await frame.locator('button[title="链接"]').click(); // 气泡链接按钮
  await expect(page.locator('.ws-mention-menu')).toBeVisible({ timeout: 5000 });
  await page.keyboard.type('b');                 // ASCII 筛（rel b.html）——wrap 模式下中文 IME 会替换掉选中的「草稿」
  await expect(page.locator('.ws-mention-item', { hasText: '文档B' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(frame.locator('a[href="B.html"]')).toHaveText('草稿'); // 选中文字变链接、保留文字（wrap）
  await page.waitForTimeout(1700);
  const d = await fs.readFile(path.join(wsDir, 'D.html'), 'utf8');
  expect(d).toMatch(/<a href="B\.html">草稿<\/a>/);
  expect(d).not.toContain('ws-doclink');
});

test('U3-B2：@菜单也列非文档文件（pdf）', async () => {
  await page.click('.sb-file[data-rel="D.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档D');
  await frame.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('@');
  await expect(page.locator('.ws-mention-menu')).toBeVisible({ timeout: 5000 });
  await page.keyboard.type('报告'); // 中文筛（DOM 真相 query 现在能捕获）；docs 无匹配 → 非文档 报告.pdf 排 active=0
  await expect(page.locator('.ws-mention-item.is-active')).toContainText('报告');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1700);
  const d = await fs.readFile(path.join(wsDir, 'D.html'), 'utf8');
  expect(d).toMatch(/<a href="[^"]*报告[^"]*\.pdf">报告<\/a>/); // 链到 pdf（href 可能百分号转义）
});

test('U2：链接索引 IPC —— query 列全部文档 + backlinks 根内反查', async () => {
  const res = await page.evaluate(async () => {
    const roots = await window.ws2.wsGetRoots();
    const rootId = roots[0].id;
    const q = await window.ws2.linksQuery(rootId);           // 懒建索引 + 返回候选
    const bl = await window.ws2.linksBacklinks(rootId, 'B.html');
    return {
      rels: q.map((d) => d.rel).sort(),
      titleA: (q.find((d) => d.rel === 'A.html') || {}).title,
      titleMd: (q.find((d) => d.rel === 'M.md') || {}).title,
      backlinksOfB: bl.map((e) => e.rel).sort(),
      snippetA: (bl.find((e) => e.rel === 'A.html') || {}).snippet,
    };
  });
  // A/B/C/D/M.md/N.html + 子目录 归档/缺失.html 全在索引
  expect(res.rels).toEqual(['A.html', 'B.html', 'C.html', 'D.html', 'M.md', 'N.html', '归档/缺失.html']);
  expect(res.titleA).toBe('文档A');
  expect(res.titleMd).toBe('文档M'); // md 的 h1 也抽到
  // A、M.md、N.html 都链到 B → 都是 B 的反链（索引不看合规性，非合规 N 的链接也算）
  expect(res.backlinksOfB).toEqual(['A.html', 'M.md', 'N.html']);
  expect(res.snippetA).toContain('去B'); // 反链带上下文摘句
});

test('U4：点断链 → 弹修复卡（不导航、不切文档）', async () => {
  await page.click('.sb-file[data-rel="C.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档C');
  await frame.locator('a[href="缺失.html#节2"]').click();
  // 修复卡出现（父层浮层），头部 danger 文案
  await expect(page.locator('.ws-linkview-card.is-broken')).toBeVisible();
  await expect(page.locator('.ws-linkview-card')).toContainText('链接目标不存在');
  // 没切文档：仍是 C（点断链绝不导航/换页）
  await expect(frame.locator('h1')).toHaveText('文档C');
  const dp = await page.evaluate(() => window.__shellDocPath());
  expect(dp.endsWith('C.html')).toBe(true);
  // Esc 关卡
  await page.keyboard.press('Escape');
  await expect(page.locator('.ws-linkview-card')).toBeHidden();
});

test('U4：修复卡「新建」→ 建缺失文件（尊重后缀）+ 断链自愈 + 原文档字节不变', async () => {
  await page.click('.sb-file[data-rel="C.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档C');
  const brokenSize = () => page.evaluate(() => {
    const w = document.getElementById('doc-frame').contentWindow;
    const hl = w.CSS && w.CSS.highlights && w.CSS.highlights.get('ws-broken');
    return hl ? hl.size : 0;
  });
  await expect.poll(brokenSize, { timeout: 5000 }).toBe(1); // 先确认真断
  await frame.locator('a[href="缺失.html#节2"]').click();
  await expect(page.locator('.ws-linkview-card.is-broken')).toBeVisible();
  // 「新建」项：目录=根、名=缺失.html
  await page.locator('.ws-linkview-repair-item', { hasText: '新建' }).click();
  // 目标文件真被创建在根（.html，尊重断链后缀）
  await expect.poll(() => fs.readFile(path.join(wsDir, '缺失.html'), 'utf8').then(() => true).catch(() => false), { timeout: 5000 }).toBe(true);
  // 断链自愈：高亮清零（链接现在解析得通）
  await expect.poll(brokenSize, { timeout: 5000 }).toBe(0);
  // 原文档 C.html 字节不变（新建不改引用方，链接照旧 缺失.html#节2）
  const c = await fs.readFile(path.join(wsDir, 'C.html'), 'utf8');
  expect(c).toMatch(/<a href="缺失\.html#节2">找不到<\/a>/);
  // 没切走当前标签页（修复场景在修当前文档，别打断）
  expect((await page.evaluate(() => window.__shellDocPath())).endsWith('C.html')).toBe(true);
});

test('U4：修复卡「重新指向」→ 改写 href 到候选（保留 #尾缀）+ 自愈', async () => {
  await page.click('.sb-file[data-rel="C.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档C');
  const brokenSize = () => page.evaluate(() => {
    const w = document.getElementById('doc-frame').contentWindow;
    const hl = w.CSS && w.CSS.highlights && w.CSS.highlights.get('ws-broken');
    return hl ? hl.size : 0;
  });
  await expect.poll(brokenSize, { timeout: 5000 }).toBe(1);
  await frame.locator('a[href="缺失.html#节2"]').click();
  await expect(page.locator('.ws-linkview-card.is-broken')).toBeVisible();
  // 候选：归档/缺失.html（同名文档）→「重新指向」
  const repoint = page.locator('.ws-linkview-repair-item', { hasText: '重新指向' });
  await expect(repoint).toContainText('归档/缺失.html');
  await repoint.first().click();
  // href 被改写成候选路径 + 保留原 #节2 尾缀
  await expect(frame.locator('a[href="归档/缺失.html#节2"]')).toBeVisible();
  // 自愈：高亮清零
  await expect.poll(brokenSize, { timeout: 5000 }).toBe(0);
  // 落盘：C.html 的 href 真被改（等自动保存 1.2s）
  await page.waitForTimeout(1700);
  const c = await fs.readFile(path.join(wsDir, 'C.html'), 'utf8');
  expect(c).toContain('归档/缺失.html#节2');
  expect(c).not.toMatch(/href="缺失\.html/); // 旧断链 href 不再存在
});

test('U4：断链文档 → ws-broken 高亮圈住断链锚文本；有效内链不圈；装饰零落盘', async () => {
  // C.html 恰有 1 条断链（缺失.html，文字「找不到」）+ 1 条外链（web 不算断链）
  await page.click('.sb-file[data-rel="C.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('文档C');
  const brokenSize = () => page.evaluate(() => {
    const w = document.getElementById('doc-frame').contentWindow;
    const hl = w.CSS && w.CSS.highlights && w.CSS.highlights.get('ws-broken');
    return hl ? hl.size : 0;
  });
  // scan 是异步（逐 href resolveDocLink）→ poll 等高亮注册；断真实 CSS.highlights 注册状态（非 JS class）
  await expect.poll(brokenSize, { timeout: 5000 }).toBe(1);
  const covered = await page.evaluate(() => {
    const w = document.getElementById('doc-frame').contentWindow;
    return [...w.CSS.highlights.get('ws-broken')][0].toString();
  });
  expect(covered).toBe('找不到'); // 圈的是断链锚整段文字
  // 铁律1：装饰纯视觉、不落盘——扫过之后 C.html 的 <a> 仍是纯净字节
  const c = await fs.readFile(path.join(wsDir, 'C.html'), 'utf8');
  expect(c).not.toContain('ws-broken');
  expect(c).toMatch(/<a href="缺失\.html#节2">找不到<\/a>/);
  // 差分自检：切到有效内链文档（A.html 的 B.html 存在）→ 0 断链高亮（证明真检测、非恒亮）
  await page.click('.sb-file[data-rel="A.html"]');
  await expect(frame.locator('h1')).toHaveText('文档A');
  await expect.poll(brokenSize, { timeout: 5000 }).toBe(0);
  // TODO(U4 step 6)：补像素门 + 变异自检（清 ws-broken 高亮 → 像素必翻红），随 host-verify 一起做
});
