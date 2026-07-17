// U4 针对性验收：真实 file:// 文档模型的"所见即所得 + 安全"两个核心声明。
// 她原本的 app.spec.js 没断言文档自带样式是否真生效、内联事件处理器是否被挡——这里补上。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');

let app, page, frame, tmpDir, cspErrors;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wsfid-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' }
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  cspErrors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/content security policy|refused to (load|execute|apply)/i.test(t)) cspErrors.push(t);
  });
}

async function openFile(content, extra = {}) {
  const docPath = path.join(tmpDir, 'doc.html');
  await fs.writeFile(docPath, content, 'utf8');
  for (const [name, body] of Object.entries(extra)) {
    await fs.writeFile(path.join(tmpDir, name), body, 'utf8');
  }
  await app.evaluate(({ BrowserWindow }, p) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', p);
  }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  return docPath;
}

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null; page = null; frame = null;
});

// 渲染保真：文档自带 <style> 时，编辑器绝不能用自己的 data-ws2-canvas 排版盖掉作者样式——
// 哪怕正文裸挂 body（blockRoot===body）。回归点：曾因「blockRoot===body 就套 canvas」把作者裸写的
// h1{color:red} 被 [data-ws2-canvas]>h1{color:#1c1d1f} 的高权重盖成黑色（实测「四不像」）。
test('自带 <style> 但正文裸挂 body：作者样式不被编辑器排版覆盖', async () => {
  await launch();
  await openFile('<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<style>body{font-family:"Courier New",monospace;background:rgb(255,251,230)}'
    + 'h1{color:rgb(176,0,32)}p{font-size:16px}</style></head>'
    + '<body><h1 id="h">标题</h1><p id="p">正文</p></body></html>');
  // 作者的红标题必须活着（不是 canvas 的 #1c1d1f）
  const h1color = await frame.locator('#h').evaluate((el) => getComputedStyle(el).color);
  expect(h1color).toBe('rgb(176, 0, 32)');
  // 作者的等宽字体必须活着（不是 canvas 的 -apple-system 无衬线栈）
  const pfont = await frame.locator('#p').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(pfont.toLowerCase()).toContain('courier');
  // body 不应被打上 data-ws2-canvas（套排版的开关）
  const hasCanvas = await frame.locator('body').evaluate((el) => el.hasAttribute('data-ws2-canvas'));
  expect(hasCanvas).toBe(false);
});

// §0：真·裸文档不再被套编辑器**运行时 canvas 装饰**（不入盘的整套 820+字号+颜色）；宽度改由 baseline 入盘格式给。
// 反掉旧行为（曾「裸文档 blockRoot===body 就套 data-ws2-canvas 排版」）。区别：canvas=运行时装饰、baseline=入盘格式。
test('真·裸文档：不套 canvas 运行时装饰；宽度由 baseline 入盘格式给', async () => {
  await launch();
  await openFile('<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    + '<body><h1 id="h">标题</h1><p id="p">正文</p></body></html>');
  // body 不再被打 data-ws2-canvas（运行时装饰开关已删）
  const hasCanvas = await frame.locator('body').evaluate((el) => el.hasAttribute('data-ws2-canvas'));
  expect(hasCanvas).toBe(false);
  // max-width 来自 baseline 入盘格式（data-ws-schema-css），不是 canvas 运行时装饰——随文件走、app 外也有
  const baselineIn = await frame.locator('body').evaluate(() => !!document.querySelector('style[data-ws-schema-css="baseline"]'));
  expect(baselineIn, 'baseline 入盘格式应在').toBe(true);
  const maxW = await frame.locator('body').evaluate((el) => getComputedStyle(el).maxWidth);
  expect(maxW).toBe('820px');
  // 内容仍在
  const htext = await frame.locator('#h').evaluate((el) => el.textContent);
  expect(htext).toBe('标题');
});

test('文档自带 inline <style> 真实生效（所见即所得）', async () => {
  await launch();
  await openFile('<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<style>#m { color: rgb(10, 20, 30); background-color: rgb(40, 50, 60); }</style>'
    + '</head><body><p id="m">styled</p></body></html>');
  const color = await frame.locator('#m').evaluate((el) => getComputedStyle(el).color);
  const bg = await frame.locator('#m').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(color).toBe('rgb(10, 20, 30)');
  expect(bg).toBe('rgb(40, 50, 60)');
});

test('文档相对路径 <link> 样式表能加载（file:// 相对解析）', async () => {
  await launch();
  await openFile('<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<link rel="stylesheet" href="theme.css"></head><body><p id="m">x</p></body></html>',
    { 'theme.css': '#m { color: rgb(1, 2, 3); }' });
  await expect
    .poll(async () => frame.locator('#m').evaluate((el) => getComputedStyle(el).color))
    .toBe('rgb(1, 2, 3)');
});

test('收紧 CSP 下打开文档无 CSP 违规（外壳资源照常加载）', async () => {
  await launch();
  await openFile('<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<style>p{color:red}</style></head><body><p>x</p></body></html>');
  await page.waitForTimeout(300);
  // 正面验：作者内联 <style> 在 file:// iframe 里照常渲染（红字）。sandbox=allow-same-origin 的同源 iframe 会让
  // 父层 CSP 顺带把 iframe 内文档自己的内联样式「评估」一次、报一条 style-src「applying inline style」，但 iframe
  // 自身无 CSP、样式实际生效（report-only、非真拦——sha256(p{color:red}) 即那条违规的 hash）。故把这条无害自报
  // 排除，真正要守的「外壳资源被拦」(refused to load/execute 脚本/样式表/字体) 仍全捕；渲染生效本身是最强反证。
  const pColor = await page.frameLocator('#doc-frame').locator('p').evaluate((el) => getComputedStyle(el).color);
  expect(pColor, '作者内联样式应照常渲染（红字）= CSP 没真拦文档渲染').toBe('rgb(255, 0, 0)');
  const shellViolations = cspErrors.filter((t) => !/applying inline style/i.test(t));
  expect(shellViolations, '外壳资源 CSP 违规：\n' + shellViolations.join('\n')).toEqual([]);
});

test('恶意 meta refresh 不能把 iframe 导航到远程（frame-src file: 挡住）', async () => {
  await launch();
  await openFile('<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<meta http-equiv="refresh" content="0; url=https://example.com/evil">'
    + '</head><body><p id="m">local</p></body></html>');
  await page.waitForTimeout(900);
  // iframe 应仍停在本地文档（#m 还在），没被导航到远程
  expect(await frame.locator('#m').count()).toBe(1);
  expect(await frame.locator('#m').evaluate((el) => el.textContent)).toBe('local');
});

test('文档自带脚本与内联事件处理器（onerror）均不执行', async () => {
  await launch();
  await openFile('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>'
    + '<p id="m">x</p>'
    + '<img src="does-not-exist.png" onerror="document.title=\'HACKED\'">'
    + '<script>document.title=\'SCRIPT-RAN\';</' + 'script></body></html>');
  await page.waitForTimeout(250);
  const title = await frame.locator('html').evaluate((el) => el.ownerDocument.title);
  expect(title).not.toBe('SCRIPT-RAN');
  expect(title).not.toBe('HACKED');
});
