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

test('启动后显示首页', async () => {
  await launch(FIXTURE);
  await expect(page.locator('#open-btn')).toBeVisible();
  await expect(page.locator('#home h1')).toHaveText('Wordspace Next');
});

test('打开文档：内容渲染且文档脚本未执行', async () => {
  await launch(FIXTURE);
  await openDoc();
  await expect(frame.locator('#p1')).toHaveText('第一段文字。');
  const frameTitle = await frame.locator('html').evaluate((el) => el.ownerDocument.title);
  expect(frameTitle).not.toBe('SCRIPT-RAN');
  await expect(page.locator('#doc-name')).toHaveText('doc.html');
});

test('编辑文字出现未保存标记，保存写回磁盘且无编辑器痕迹', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').click();
  await page.keyboard.type('新增内容');
  await expect(page.locator('#dirty-dot')).toBeVisible();
  await saveViaButton();
  const saved = await fs.readFile(docPath, 'utf8');
  expect(saved).toContain('新增内容');
  expect(saved).not.toContain('data-ws2');
  expect(saved).not.toContain('暂不支持编辑');
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

test('常驻工具栏：开文档即显示，选中文字点加粗跨帧生效', async () => {
  await launch(FIXTURE);
  await openDoc();
  await expect(page.locator('#toolbar')).toBeVisible();
  await frame.locator('#p1').selectText();
  await page.locator('#toolbar button[title="加粗 Cmd+B"]').click();
  const html = await frame.locator('#p1').innerHTML();
  expect(html).toMatch(/<b>|font-weight/);
});

test('工具栏标题下拉：段落转标题 2', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p2').click();
  await page.locator('#toolbar select').first().selectOption('h2');
  await expect(frame.locator('h2')).toHaveText('第二段文字。');
});

test('工具栏链接：选中文字加链接，href 写入 <a>', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').selectText();
  await page.locator('#toolbar button[title="链接"]').click();
  await page.locator('.tb-linkinput').fill('https://wordspace.ai');
  await page.locator('#toolbar button[title="应用链接"]').click();
  await expect(frame.locator('#p1 a')).toHaveAttribute('href', 'https://wordspace.ai');
});

test('工具栏链接：危险 scheme（javascript:）被拒，不进文档也不落盘', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').selectText();
  await page.locator('#toolbar button[title="链接"]').click();
  await page.locator('.tb-linkinput').fill('javascript:alert(document.cookie)');
  await page.locator('#toolbar button[title="应用链接"]').click();
  await expect(frame.locator('#p1 a')).toHaveCount(0); // 没生成链接
  // 改点别的内容再存盘，确认危险 URL 从未进入文档/磁盘
  await frame.locator('#p2').click();
  await page.keyboard.type('改一下');
  await saveViaButton();
  const saved = await fs.readFile(docPath, 'utf8');
  expect(saved).not.toContain('javascript:');
});

test('工具栏复制块：当前段落复制一份', async () => {
  await launch(FIXTURE);
  await openDoc();
  const before = await frame.locator('p').count();
  await frame.locator('#p1').click();
  await page.locator('#toolbar button[title="复制块"]').click();
  expect(await frame.locator('p').count()).toBe(before + 1);
});

test('工具栏改格式后保存：格式写回磁盘且无编辑器痕迹', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').selectText();
  await page.locator('#toolbar button[title="加粗 Cmd+B"]').click();
  await saveViaButton();
  const saved = await fs.readFile(docPath, 'utf8');
  expect(saved).toMatch(/<b>|font-weight/);
  expect(saved).not.toContain('data-ws2');
  expect(saved).not.toContain('tb-btn');
});

test('斜杠菜单：输入 / 弹出，选标题 2 转换块', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p2').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/h2');
  await expect(frame.locator('[data-ws2-ui]').filter({ hasText: '标题 2' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(frame.locator('h2')).toHaveText('第二段文字。');
  const bodyText = await frame.locator('body').innerText();
  expect(bodyText).not.toContain('/h2');
});

test('拖动手柄：移动段落顺序，Cmd+Z 撤销', async () => {
  await launch(FIXTURE);
  await openDoc();
  // 真实鼠标按住拖动会触发 Chromium 原生 DnD 使合成输入挂起，这里用 iframe 内合成事件驱动同一套处理逻辑
  await frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const fire = (target, type, x, y) => target.dispatchEvent(new doc.defaultView.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const p1 = doc.getElementById('p1');
    const p2 = doc.getElementById('p2');
    const r1 = p1.getBoundingClientRect();
    fire(p1, 'mousemove', r1.left + 10, r1.top + r1.height / 2);
    const handle = doc.querySelector('[data-ws2-ui][title*="拖动"]');
    const hr = handle.getBoundingClientRect();
    fire(handle, 'mousedown', hr.left + 2, hr.top + 2);
    // 第一段小位移触发拖动阈值，第二段移到目标块
    fire(doc, 'mousemove', hr.left + 8, hr.top + 8);
    const r2 = p2.getBoundingClientRect();
    fire(doc, 'mousemove', r2.left + 10, r2.top + r2.height - 2);
    fire(doc, 'mouseup', r2.left + 10, r2.top + r2.height - 2);
  });
  let ids = await frame.locator('p').evaluateAll((els) => els.map(e => e.id));
  expect(ids.indexOf('p2')).toBeLessThan(ids.indexOf('p1'));
  await frame.locator('#p1').click();
  await page.keyboard.press('Meta+z');
  ids = await frame.locator('p').evaluateAll((els) => els.map(e => e.id));
  expect(ids.indexOf('p1')).toBeLessThan(ids.indexOf('p2'));
});

test('方向键 nudge：选中元素 ArrowRight×5 左移、合并一个 undo；文字编辑态方向键不移动（光标动）', async () => {
  await launch(FIXTURE);
  await openDoc();
  // 选中 #p1（点击 = canvas 选中，非文字编辑）
  await frame.locator('#p1').click();
  // ArrowRight×5 → 元素转 absolute、left 增加
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  const afterNudge = await frame.locator('#p1').evaluate((el) => ({
    position: el.style.position,
    left: parseFloat(el.style.left) || 0,
  }));
  expect(afterNudge.position).toBe('absolute');
  expect(afterNudge.left).toBeGreaterThan(0); // 5px（相对转换基准）

  // 5 连 nudge 合并成一个 undo op：等合并窗口收尾后 Cmd+Z 一次回到 nudge 前（无 inline left）
  await page.waitForTimeout(600); // 过 500ms 合并窗口，收一个 op
  await page.keyboard.press('Meta+z');
  const afterUndo = await frame.locator('#p1').evaluate((el) => el.style.left || '');
  expect(afterUndo).toBe(''); // 单步撤销回到 nudge 前（pre-conversion，inline left 清空）

  // 承重回归：双击进文字编辑态，ArrowRight 不移动元素（让光标移动）
  await frame.locator('#p1').dblclick();
  const leftBeforeEdit = await frame.locator('#p1').evaluate((el) => el.style.left || '');
  await page.keyboard.press('ArrowRight');
  const leftAfterEdit = await frame.locator('#p1').evaluate((el) => el.style.left || '');
  expect(leftAfterEdit).toBe(leftBeforeEdit); // 文字编辑态方向键不 nudge
});

test('锁定块：表格不可编辑，悬停出现提示，可整块删除', async () => {
  await launch(FIXTURE);
  await openDoc();
  const table = frame.locator('#t1');
  await expect(table).toHaveAttribute('contenteditable', 'false');
  await table.hover();
  await expect(frame.locator('[data-ws2-ui]').filter({ hasText: '此块暂不支持编辑' })).toBeVisible();
  const handle = frame.locator('[data-ws2-ui][title*="拖动"]');
  await expect(handle).toBeVisible();
  await frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const fire = (target, type, x, y) => target.dispatchEvent(new doc.defaultView.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const h = doc.querySelector('[data-ws2-ui][title*="拖动"]');
    const hr = h.getBoundingClientRect();
    fire(h, 'mousedown', hr.left + 2, hr.top + 2);
    fire(doc, 'mouseup', hr.left + 2, hr.top + 2);
  });
  const delItem = frame.locator('[data-ws2-ui]').filter({ hasText: '删除块' });
  await expect(delItem).toBeVisible();
  await delItem.click();
  await expect(frame.locator('#t1')).toHaveCount(0);
});

test('历史版本：保存两次后可恢复旧版', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').click();
  await page.keyboard.type('第一次修改');
  await saveViaButton();
  await frame.locator('#p1').click();
  await page.keyboard.type('第二次修改');
  await saveViaButton();
  await page.locator('#history-btn').click();
  const restoreButtons = page.locator('#history-list button');
  await expect(restoreButtons.first()).toBeVisible();
  const count = await restoreButtons.count();
  expect(count).toBeGreaterThanOrEqual(2);
  await restoreButtons.last().click();
  await expect(frame.locator('#p1')).not.toContainText('第一次修改');
  await expect(page.locator('#dirty-dot')).toBeVisible();
});

test('未保存修改时关闭窗口被拦截', async () => {
  await launch(FIXTURE);
  await openDoc();
  await frame.locator('#p1').click();
  await page.keyboard.type('未保存的修改');
  await expect(page.locator('#dirty-dot')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
  await page.waitForTimeout(800);
  const winCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  expect(winCount).toBe(1);
});
