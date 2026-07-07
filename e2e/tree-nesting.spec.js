// 文件树深层嵌套 e2e 真门 —— compact folders + 缩进导引线（把 ui-demo PR #126 移植进真 app）。
//
// 强断言锚在**真实 computed 几何 / 真实 fs**，不查 JS 直接设的 class（CLAUDE.md S4：「能想出 CSS/操作
// 全废但断言还过」= 弱门）：
//   ① compact：最深 rel 作身份 + 中间段不作独立行（证明真合并、不是只藏了显示）。
//   ② compaction 压有效深度 → 最深文件的 computed paddingLeft 有界（不 compact 会 ≥86px，此断言必翻红）。
//   ③ 导引线真被画：读 getComputedStyle 的 width/backgroundColor/position（CSS 全废时翻红），非查元素在不在。
//   ④ 回归：透过 compact 链打开最深文件 → 真实路径正确加载（压缩只改显示、不改 FileEntry 路径）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsDir;

// seed：一条 5 级单子文件夹长链「归档/2025/Q4/复盘」在「复盘」处分叉成华东/华南两区，各含一文件。
//   → 归档→2025→Q4→复盘 全是单传，compact 成一行；复盘下才分支。最深文件真实深度 5 级。
async function seedWorkspace(dir) {
  const deep = path.join(dir, '归档', '2025', 'Q4', '复盘');
  await fs.mkdir(path.join(deep, '华东区'), { recursive: true });
  await fs.mkdir(path.join(deep, '华南区'), { recursive: true });
  await fs.writeFile(path.join(deep, '华东区', '门店复盘.html'), HTML('门店复盘华东'), 'utf8');
  await fs.writeFile(path.join(deep, '华南区', '门店复盘.html'), HTML('门店复盘华南'), 'utf8');
  await fs.writeFile(path.join(dir, 'a.html'), HTML('AAA'), 'utf8'); // 根级基线 + openWorkspace 的等待锚
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

const DEEP = '归档/2025/Q4/复盘'; // 最深合并链的 rel（= compact 行身份）
const HUADONG = DEEP + '/华东区';
const DEEP_FILE = HUADONG + '/门店复盘.html';

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-treenest-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  await seedWorkspace(wsDir);
  ({ a: app, p: page } = await launch({
    WS2_USERDATA: path.join(tmp, 'userdata'),
    WS2_FOLDER_IN: wsDir,
  }));
});

test.afterEach(async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('TN-1 compact folders：单子文件夹长链合并成一行，身份落最深那级，中间段不作独立行', async () => {
  await openWorkspace();
  // compact 行以最深 rel 作身份
  const compactRow = page.locator(`.sb-dir[data-rel="${DEEP}"]`);
  await expect(compactRow).toBeVisible();
  // 显示名合并了全部 4 段（不是只显示最深段「复盘」）
  const nameText = await compactRow.locator('.sb-name').innerText();
  for (const seg of ['归档', '2025', 'Q4', '复盘']) expect(nameText).toContain(seg);
  // 中间各段**不**作为独立行存在——证明是真合并、不是每级仍占一行只改了缩进
  await expect(page.locator('.sb-dir[data-rel="归档"]')).toHaveCount(0);
  await expect(page.locator('.sb-dir[data-rel="归档/2025"]')).toHaveCount(0);
  await expect(page.locator('.sb-dir[data-rel="归档/2025/Q4"]')).toHaveCount(0);
});

test('TN-2 强断言：compaction 把有效深度压下来 → 最深文件 computed paddingLeft 有界（不 compact 必 ≥86px）', async () => {
  await openWorkspace();
  await page.locator(`.sb-dir[data-rel="${DEEP}"]`).click(); // 展开 compact 链 → 华东/华南
  await expect(page.locator(`.sb-dir[data-rel="${HUADONG}"]`)).toBeVisible();
  await page.locator(`.sb-dir[data-rel="${HUADONG}"]`).click(); // 展开华东区
  const deepFile = page.locator(`.sb-file[data-rel="${DEEP_FILE}"]`);
  await expect(deepFile).toBeVisible();
  // 真实路径深 5 级；compact 后此文件在视觉 depth 2 → paddingLeft = 26 + 2*12 = 50px。
  // 若 compaction 失效（按真实深度 5 缩进）→ 26 + 5*12 = 86px，下面 <60 必翻红。这就是变异敏感的强断言。
  const pad = await deepFile.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(pad).toBeLessThan(60);
  expect(pad).toBeGreaterThan(30); // 仍有缩进、不是被压平到 0
});

test('TN-3 强断言：缩进导引线真被 CSS 画出来（查 computed width/background/position，非查元素在不在）', async () => {
  await openWorkspace();
  await page.locator(`.sb-dir[data-rel="${DEEP}"]`).click();
  await page.locator(`.sb-dir[data-rel="${HUADONG}"]`).click();
  const deepFile = page.locator(`.sb-file[data-rel="${DEEP_FILE}"]`);
  await expect(deepFile).toBeVisible();
  const guides = await deepFile.evaluate((el) =>
    [...el.querySelectorAll('.sb-guide')].map((g) => {
      const cs = getComputedStyle(g);
      return { w: cs.width, bg: cs.backgroundColor, left: parseFloat(cs.left), pos: cs.position };
    }),
  );
  expect(guides.length).toBe(2); // depth 2 → 2 级祖先导引线
  for (const g of guides) {
    expect(g.pos).toBe('absolute');
    expect(g.w).toBe('1px');
    // 背景真被上色（CSS 全废/被 CSP 拦时这里翻红——S4 强断言）
    expect(g.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(g.bg).not.toBe('transparent');
  }
  expect(guides[1].left).toBeGreaterThan(guides[0].left); // 两条线 x 递增、不重叠
});

test('TN-4 回归：透过 compact 链打开最深文件 → 真实路径正确加载进编辑器', async () => {
  await openWorkspace();
  await page.locator(`.sb-dir[data-rel="${DEEP}"]`).click();
  await page.locator(`.sb-dir[data-rel="${HUADONG}"]`).click();
  await page.locator(`.sb-file[data-rel="${DEEP_FILE}"]`).click();
  await expect(page.locator('#doc-frame')).toBeVisible();
  // 打开的是华东区那份（内容「门店复盘华东」）——压缩只改显示、FileEntry 路径未变
  await expect(page.frameLocator('#doc-frame').locator('body')).toContainText('门店复盘华东');
});
