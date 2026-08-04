// 表格块菜单的「作用对象可辨」门（对拍 T6）。
// 强断言纪律（S4）：读逐格 computed backgroundColor 真值比对，不查属性存在性——
// 属性在、CSS 没生效（比如被 CSP 拦或选择器写错）时，查属性的门照过 = 哑门。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

const DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>' +
  '<p id="p1">前文</p>' +
  '<table class="ws-table"><thead><tr><th scope="col" id="h1">甲</th><th scope="col" id="h2">乙</th><th scope="col" id="h3">丙</th></tr></thead>' +
  '<tbody>' +
  '<tr id="r1"><td id="c11">十一</td><td id="c12">十二</td><td id="c13">十三</td></tr>' +
  '<tr id="r2"><td id="c21">廿一</td><td id="c22">廿二</td><td id="c23">廿三</td></tr>' +
  '</tbody></table><p id="p2">后文</p></body></html>';

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2menuscope-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
  const p = path.join(tmpDir, 'd.html');
  await fs.writeFile(p, DOC, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('#p1')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(450);
}
// 点进某格 → 悬停它 → 点手柄开菜单
async function openMenuFromCell(cellSel) {
  await frame.locator(cellSel).click();
  await page.waitForTimeout(260);
  const box = await page.locator('#doc-frame').boundingBox();
  const r = await page.evaluate((s) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const b = d.querySelector(s).getBoundingClientRect();
    return { x: b.x + 20, y: b.y + b.height / 2 };
  }, cellSel);
  await page.mouse.move(5, 5); await page.waitForTimeout(60);
  await page.mouse.move(box.x + r.x, box.y + r.y, { steps: 6 });
  // 轮询等手柄真出现并定位好——固定 waitForTimeout 在这里会偶发抢跑（整文件连跑时实测翻过车），
  // 而抢跑的表现是「颜色断言失败」，读起来像实现错、其实是探针没开成菜单。
  const g = await page.waitForFunction(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.querySelector('.ws-grip');
    if (!el || el.style.display === 'none') return null;
    const b = el.getBoundingClientRect();
    return b.width > 0 ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  }, null, { timeout: 5000 }).then((h) => h.jsonValue());
  await page.mouse.click(box.x + g.x, box.y + g.y);
  await frame.locator('.ws-blockmenu-item').first().waitFor({ state: 'visible', timeout: 5000 });
  // 前置断言：菜单真开了、标记真打上了。缺这条时，helper 失败会伪装成后面的颜色断言失败。
  expect(await markCount()).toBeGreaterThan(0);
}
const bg = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  return d.defaultView.getComputedStyle(el).backgroundColor;
}, sel);
const markCount = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return d.querySelectorAll('[data-ws2-menurow],[data-ws2-menucol]').length;
});

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null; page = null; frame = null;
});

test('菜单开着时目标行与目标列在视觉上可辨（读 computed 真值）', async () => {
  await launch();
  await openMenuFromCell('#c22'); // 目标 = 第 2 数据行、第 2 列

  const [tgtRow, otherRow, tgtCol, otherCol] = [await bg('#c21'), await bg('#c11'), await bg('#c12'), await bg('#c13')];
  // 目标行的格 ≠ 非目标行的同列格；目标列的格 ≠ 非目标列的同行格。
  // 这是「作用对象可辨」的可证伪判据：两者相同 = 用户看不出要动哪一行/列。
  expect(tgtRow).not.toBe(otherRow);
  expect(tgtCol).not.toBe(otherCol);
  // 表头行也属于目标列（插列/删列会动它）——列标记必须贯穿到表头，否则标了半截更误导
  expect(await bg('#h2')).not.toBe(await bg('#h3'));
});

test('换一个格开菜单，标记跟着换（不是钉死在首格）', async () => {
  await launch();
  await openMenuFromCell('#c22'); // 目标 = 第 2 行 / 第 2 列
  expect(await bg('#c21')).not.toBe(await bg('#c13')); // 前提：此刻确实标着（c21 在目标行、c13 都不在）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(220);
  await openMenuFromCell('#c11'); // 换到第 1 行 / 第 1 列

  // 基准 = 既不在新目标行、也不在新目标列的格（c23：第 2 行第 3 列）
  const neutral = await bg('#c23');
  expect(await bg('#c22')).toBe(neutral);      // 旧目标行的格已回归中性 = 标记真的挪走了
  expect(await bg('#c12')).not.toBe(neutral);  // 新目标行被标上
  expect(await bg('#c21')).not.toBe(neutral);  // 新目标列（第 1 列）贯穿到第 2 行
  expect(await bg('#h1')).not.toBe(await bg('#h2')); // 目标列已从第 2 列换到第 1 列
});

test('菜单关闭后标记清零（Esc / 执行菜单项 两条路径）', async () => {
  await launch();
  await openMenuFromCell('#c22');
  expect(await markCount()).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(260);
  expect(await markCount()).toBe(0); // 路径①：Esc

  await openMenuFromCell('#c22');
  expect(await markCount()).toBeGreaterThan(0);
  await frame.locator('.ws-blockmenu-item', { hasText: '下方插行' }).click();
  await page.waitForTimeout(320);
  expect(await markCount()).toBe(0); // 路径②：执行菜单项（菜单项内部调 closeBlockMenu）
});

test('入盘门：菜单开着时 serialize，标记不进磁盘字节', async () => {
  await launch();
  await openMenuFromCell('#c22');
  expect(await markCount()).toBeGreaterThan(0); // 前提：此刻 DOM 里确有标记（否则本门空转）
  const html = await page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
  // ⚠ 只有这两条字符串断言有牙。别再加「reparse 判合规」当第二道门——schema-validate 没有任何
  // data-* 属性白名单，tr/td 上带 data-ws2-menurow 也 100% 合规，那道门不论漏没漏都恒绿 = 摆设。
  expect(html).not.toContain('data-ws2-menurow');
  expect(html).not.toContain('data-ws2-menucol');
});

// 第二条剥除路径：PDF 导出走 shell.js 自己那份清单，不经 serialize 的 cleanRoot。
// 可复现场景：格内开着块菜单 → 点父层「导出 PDF」（菜单不会因此关闭）→ 行列高亮印进 PDF。
test('入盘门②：菜单开着时导出 PDF，标记不进打印 HTML', async () => {
  await launch();
  await openMenuFromCell('#c22');
  expect(await markCount()).toBeGreaterThan(0);
  const printHtml = await page.evaluate(() => window.__wsBuildPrintHtml());
  // ⚠ 不能用子串匹配：打印 HTML 里内联了整份 EDITOR_CSS，而这些名字**作为选择器文本**就在里面，
  // toContain 会把 CSS 选择器误判成残留属性（本门第一版就这么假红过）。解析成 DOM 查真属性。
  const leaked = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, 'text/html');
    return {
      row: d.querySelectorAll('[data-ws2-menurow]').length,
      col: d.querySelectorAll('[data-ws2-menucol]').length,
      cell: d.querySelectorAll('[data-ws2-cell]').length, // 既有漏项，本次收口一并堵上
    };
  }, printHtml);
  expect(leaked).toEqual({ row: 0, col: 0, cell: 0 });
});

// 标记集合必须与真正执行删除的集合同源（都走 tableRowsOf/rowCellsOf 的数据行口径）。
// 这条比查描边强：它把「画的对象」和「做的对象」直接钉在一起——正是 T6 那个病的根。
test('被标记的格集合 === 删除本行后真正消失的格集合', async () => {
  await launch();
  await openMenuFromCell('#c22');
  const markedRow = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('tr[data-ws2-menurow] > td, tr[data-ws2-menurow] > th')].map((n) => n.id);
  });
  expect(markedRow.sort()).toEqual(['c21', 'c22', 'c23']);
  await frame.locator('.ws-blockmenu-item', { hasText: '删除本行' }).click();
  await page.waitForTimeout(340);
  const gone = await page.evaluate((ids) => {
    const d = document.getElementById('doc-frame').contentDocument;
    return ids.filter((i) => !d.getElementById(i));
  }, markedRow);
  expect(gone.sort()).toEqual(['c21', 'c22', 'c23']); // 标了哪几格，删掉的就是哪几格
});
