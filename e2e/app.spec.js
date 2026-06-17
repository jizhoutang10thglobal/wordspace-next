const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(__dirname, 'screenshots');

const FIXTURE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>测试文档</title>
<style>body { font-family: serif; } .newver { background: #f6f6f3; }</style>
</head>
<body><div class="wrap">
<h1>测试文档</h1>
<p id="p1">第一段文字。</p>
<p id="p2">第二段文字。</p>
<div class="newver"><p id="p3">框内段落。</p></div>
<table id="t1"><tbody><tr><td>单元格内容</td></tr></tbody></table>
</div>
<script>document.title = 'SCRIPT-RAN';</script>
</body></html>`;

let app, page, frame, docPath, tmpDir;

async function launch(content) {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2e2e-'));
  docPath = path.join(tmpDir, 'doc.html');
  await fs.writeFile(docPath, content, 'utf8');
  app = await electron.launch({
    // --no-sandbox：CI 无特权 runner 下 Chromium 进程沙箱起不来必需；与 iframe 的
    // sandbox=allow-same-origin（挡文档脚本）是两回事，不影响安全断言（CLAUDE.md S3）
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' }
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
}

async function openDoc() {
  await app.evaluate(({ BrowserWindow }, p) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', p);
  }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('#p1')).toBeVisible();
}

// 画布模型：文字编辑要先双击元素进入 contenteditable，再打字（不再是 body 全局可编辑）。
async function editText(sel, text) {
  await frame.locator(sel).dblclick();
  await page.keyboard.type(text);
}

async function saveViaButton() {
  await page.locator('#save-btn').click();
  await expect(page.locator('#dirty-dot')).toBeHidden();
}

test.afterEach(async ({}, testInfo) => {
  if (page) {
    await fs.mkdir(SHOT_DIR, { recursive: true });
    const name = testInfo.title.replace(/[^\w一-鿿-]+/g, '_') + '.png';
    await page.screenshot({ path: path.join(SHOT_DIR, name) }).catch(() => {});
  }
  if (app) {
    // 强制销毁窗口绕过未保存关闭守卫，否则 close() 会被守卫拦住
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((w) => w.destroy());
    }).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null; page = null; frame = null;
});

test('启动后显示空态首页（单栏，无侧栏）', async () => {
  await launch(FIXTURE);
  await expect(page.locator('#open-btn')).toBeVisible();
  await expect(page.locator('#home .ws-empty-title')).toHaveText('Wordspace Next');
  await expect(page.locator('#sidebar')).toHaveCount(0); // 左侧文件栏已删（先只做编辑区）
});

test('打开文档：内容渲染且文档脚本未执行', async () => {
  await launch(FIXTURE);
  await openDoc();
  await expect(frame.locator('#p1')).toHaveText('第一段文字。');
  const frameTitle = await frame.locator('html').evaluate((el) => el.ownerDocument.title);
  expect(frameTitle).not.toBe('SCRIPT-RAN');
  await expect(page.locator('#doc-name')).toHaveText('doc.html');
});

test('双击编辑文字出现未保存标记，保存写回磁盘且无编辑器痕迹', async () => {
  await launch(FIXTURE);
  await openDoc();
  await editText('#p1', '新增内容'); // 画布模型：双击进编辑再打字
  await expect(page.locator('#dirty-dot')).toBeVisible();
  await saveViaButton();
  const saved = await fs.readFile(docPath, 'utf8');
  expect(saved).toContain('新增内容');
  expect(saved).not.toContain('data-ws2');
  expect(saved).not.toContain('contenteditable');
  expect(saved).toContain("document.title = 'SCRIPT-RAN';");
  expect(saved).toContain('.newver { background: #f6f6f3; }');
});

test('保真：未修改时序列化结果与原文档结构一致', async () => {
  await launch(FIXTURE);
  await openDoc();
  const out = await page.evaluate(() => {
    return WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument);
  });
  const { JSDOM } = require('jsdom');
  const expected = new JSDOM(FIXTURE).window.document.documentElement.outerHTML;
  const actual = new JSDOM(out).window.document.documentElement.outerHTML;
  expect(actual).toBe(expected);
});

test('浮动工具栏：没选中时隐藏；双击选区文字才浮出、点加粗跨帧生效', async () => {
  await launch(FIXTURE);
  await openDoc();
  await expect(page.locator('#toolbar')).toBeHidden();  // Notion 式：没选中不显示
  await frame.locator('#p1').dblclick();    // 进文字编辑（contenteditable）
  await frame.locator('#p1').selectText();  // 选中整段文字（range）→ 气泡浮出
  await expect(page.locator('#toolbar')).toBeVisible();
  await page.locator('#toolbar button[title="加粗 Cmd+B"]').click();
  const html = await frame.locator('#p1').innerHTML();
  expect(html).toMatch(/<b>|font-weight/);
});

test('转为菜单：选中段落转标题 2（元素级，无需进编辑）', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p2').click(); // 画布单击 = 选中元素 → 元素态气泡
  await expect(page.locator('#toolbar')).toBeVisible();
  await page.locator('#toolbar button[title="转换类型"]').click();
  await page.locator('#toolbar .tb-menu-item', { hasText: '标题 2' }).click();
  await expect(frame.locator('h2')).toHaveText('第二段文字。');
});

test('工具栏链接：双击进编辑、选区加链接，href 写入 <a>', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').dblclick();
  await frame.locator('#p1').selectText();
  await expect(page.locator('#toolbar')).toBeVisible();
  await page.locator('#toolbar button[title="链接"]').click();
  await page.locator('.tb-linkinput').fill('https://wordspace.ai');
  await page.locator('#toolbar button[title="应用链接"]').click();
  await expect(frame.locator('#p1 a')).toHaveAttribute('href', 'https://wordspace.ai');
});

test('工具栏链接：危险 scheme（javascript:）被拒，不进文档也不落盘', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').dblclick();
  await frame.locator('#p1').selectText();
  await expect(page.locator('#toolbar')).toBeVisible();
  await page.locator('#toolbar button[title="链接"]').click();
  await page.locator('.tb-linkinput').fill('javascript:alert(document.cookie)');
  await page.locator('#toolbar button[title="应用链接"]').click();
  await expect(frame.locator('#p1 a')).toHaveCount(0); // 没生成链接
  // 改点别的内容再存盘，确认危险 URL 从未进入文档/磁盘
  await editText('#p2', '改一下');
  await saveViaButton();
  const saved = await fs.readFile(docPath, 'utf8');
  expect(saved).not.toContain('javascript:');
});

test('工具栏复制块：选中段落复制一份（元素级）', async () => {
  await launch(FIXTURE);
  await openDoc();
  const before = await frame.locator('p').count();
  await frame.locator('#p1').click(); // 选中 → 元素态气泡
  await expect(page.locator('#toolbar')).toBeVisible();
  await page.locator('#toolbar button[title="复制块"]').click();
  expect(await frame.locator('p').count()).toBe(before + 1);
});

test('工具栏改格式后保存：格式写回磁盘且无编辑器痕迹', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').dblclick();
  await frame.locator('#p1').selectText();
  await expect(page.locator('#toolbar')).toBeVisible();
  await page.locator('#toolbar button[title="加粗 Cmd+B"]').click();
  await saveViaButton();
  const saved = await fs.readFile(docPath, 'utf8');
  expect(saved).toMatch(/<b>|font-weight/);
  expect(saved).not.toContain('data-ws2');
  expect(saved).not.toContain('tb-btn');
});

// 加固门（来自对抗 review 覆盖缺口）-------------------------------------------------

test('回归门：弹层默认不展开、不挡文档（弹层吃点击曾挂 9 个 e2e）', async () => {
  await launch(FIXTURE);
  await openDoc();
  await expect(page.locator('#toolbar')).toBeHidden();          // 没选中不显示
  expect(await page.locator('.tb-pop.open').count()).toBe(0);   // 没有任何常驻展开的弹层
  // 直接双击进编辑能成（不被任何常驻浮层挡住——正是当初坏掉的症状）
  await frame.locator('#p1').dblclick();
  await frame.locator('#p1').selectText();
  await expect(page.locator('#toolbar')).toBeVisible();
});

test('斜杠菜单：进编辑后输入 / 弹出，选标题 2 转换块', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p2').dblclick(); // 进编辑：caret 落在可编辑文字元素内（slash 守卫要求）
  await page.keyboard.type('/h2');
  await expect(frame.locator('[data-ws2-ui]').filter({ hasText: '标题 2' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(frame.locator('h2')).toHaveText('第二段文字。');
  const bodyText = await frame.locator('body').innerText();
  expect(bodyText).not.toContain('/h2');
});

test('自由拖动：选中元素拖到任意位置，转 absolute、left 改变（画布）', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').click(); // 选中 #p1
  // 真实鼠标按住拖会触发 Chromium 原生 DnD，这里用 iframe 内合成事件驱动同一套 dragmove 逻辑
  await frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const fire = (target, type, x, y) => target.dispatchEvent(new doc.defaultView.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const p1 = doc.getElementById('p1');
    const r = p1.getBoundingClientRect();
    fire(p1, 'mousedown', r.left + 10, r.top + 5);
    fire(doc, 'mousemove', r.left + 16, r.top + 11); // 过 4px 阈值 → 起拖、转 absolute
    fire(doc, 'mousemove', r.left + 120, r.top + 70); // 拖到偏移
    fire(doc, 'mouseup', r.left + 120, r.top + 70);
  });
  const moved = await frame.locator('#p1').evaluate((el) => ({
    position: el.style.position,
    left: parseFloat(el.style.left) || 0,
  }));
  expect(moved.position).toBe('absolute');
  expect(moved.left).toBeGreaterThan(0);
});

test('方向键 nudge：选中元素 ArrowRight×5 右移、合并一个 undo；文字编辑态方向键不移动（光标动）', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').click(); // 单击 = canvas 选中，非文字编辑
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  const afterNudge = await frame.locator('#p1').evaluate((el) => ({
    position: el.style.position,
    left: parseFloat(el.style.left) || 0,
  }));
  expect(afterNudge.position).toBe('absolute');
  expect(afterNudge.left).toBeGreaterThan(0);

  // 5 连 nudge 合并成一个 undo op：过合并窗口后 Cmd+Z 一次回到 nudge 前（无 inline left）
  await page.waitForTimeout(600);
  await page.keyboard.press('Meta+z');
  const afterUndo = await frame.locator('#p1').evaluate((el) => el.style.left || '');
  expect(afterUndo).toBe('');

  // 承重回归：双击进文字编辑态，ArrowRight 不移动元素（让光标移动）
  await frame.locator('#p1').dblclick();
  const leftBeforeEdit = await frame.locator('#p1').evaluate((el) => el.style.left || '');
  await page.keyboard.press('ArrowRight');
  const leftAfterEdit = await frame.locator('#p1').evaluate((el) => el.style.left || '');
  expect(leftAfterEdit).toBe(leftBeforeEdit);
});

test('未保存修改时关闭窗口被拦截', async () => {
  await launch(FIXTURE);
  await openDoc();
  await editText('#p1', '未保存的修改');
  await expect(page.locator('#dirty-dot')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
  await page.waitForTimeout(800);
  const winCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  expect(winCount).toBe(1);
});
