// sticky ancestor（祖先文件夹吸顶）e2e 真门 —— 真 app 扁平树用 VS Code 式 JS 浮层实现。
//
// 强断言锚真实 computed 几何 + 真实滚动状态（S4：不查 JS 设的 class）：
//   ① 滚进深层子树 → 浮层出现正确祖先链 + 贴在可视区顶 + 阴影真被画（computed）。
//   ② 变异探针：滚回顶部 → 浮层清空/隐藏（证明是「滚动驱动」不是常驻元素——常驻元素这条必翻红）。
//   ③ 浮层祖先 = 折线处那行文件的真实祖先（compact 显示名对得上）。
//   ④ 点浮层里的祖先 → 真滚动把它带回可视区（可climb out）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsDir;

// 单子链 归档/2025/Q4/复盘 在「复盘」分叉（华东/华南）→ compact 成一行「归档/2025/Q4/复盘」。
// 华东区(d1) → 明细(d2) → 1..8月(d3)：够深够高，短视口下能把深层文件滚到顶部触发三级吸顶。
const DEEP = '归档/2025/Q4/复盘';
async function seedWorkspace(dir) {
  const east = path.join(dir, '归档', '2025', 'Q4', '复盘', '华东区');
  await fs.mkdir(path.join(east, '明细'), { recursive: true });
  await fs.mkdir(path.join(dir, '归档', '2025', 'Q4', '复盘', '华南区'), { recursive: true });
  for (const f of ['门店复盘.html', '客流.html']) await fs.writeFile(path.join(east, f), HTML(f), 'utf8');
  for (const m of ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月']) {
    await fs.writeFile(path.join(east, '明细', m + '.html'), HTML(m), 'utf8');
  }
  const south = path.join(dir, '归档', '2025', 'Q4', '复盘', '华南区');
  for (const f of ['门店复盘.html', '客流.html', '销售.html', '库存.html']) await fs.writeFile(path.join(south, f), HTML(f), 'utf8');
  await fs.writeFile(path.join(dir, 'a.html'), HTML('AAA'), 'utf8');
  // 根级填充文件：把树撑高，保证深层行 / 旁支能滚到可视区顶部（否则 maxScroll 太小、折线到不了）
  for (let i = 0; i < 14; i++) await fs.writeFile(path.join(dir, `z${String(i).padStart(2, '0')}.html`), HTML('z'), 'utf8');
}

async function launch() {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 320, height: 380 }); // 矮窗：保证树溢出可滚
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  return { a, p };
}

const clickDir = (rel) => page.evaluate((r) => {
  const el = document.querySelector(`.sb-dir[data-rel="${r}"]`);
  if (el) el.click();
}, rel);

// 滚 #sb-body 让某行（文件或文件夹）到可视区顶部下方 offset px
const scrollFileToTop = (rel, offset) => page.evaluate(({ rel, offset }) => {
  const body = document.getElementById('sb-body');
  const f = document.querySelector(`.sb-row[data-rel="${rel}"]`);
  if (body && f) body.scrollTop += (f.getBoundingClientRect().top - body.getBoundingClientRect().top) - offset;
  body.dispatchEvent(new Event('scroll'));
}, { rel, offset });

const stickyState = () => page.evaluate(() => {
  const st = document.getElementById('sb-sticky');
  const bodyR = document.getElementById('sb-body').getBoundingClientRect();
  const stR = st.getBoundingClientRect();
  return {
    count: st.children.length,
    rows: [...st.children].map((r) => (r.textContent || '').replace(/\s+/g, '')),
    display: getComputedStyle(st).display,
    atTop: Math.abs(stR.top - bodyR.top) < 2,
    shadow: getComputedStyle(st).boxShadow,
  };
});

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-sticky-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  await seedWorkspace(wsDir);
  ({ a: app, p: page } = await launch());
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  // 展开深链：归档compact → 华东区 → 明细
  await clickDir(DEEP);
  await clickDir(`${DEEP}/华东区`);
  await clickDir(`${DEEP}/华东区/明细`);
  await expect(page.locator(`.sb-file[data-rel="${DEEP}/华东区/明细/6月.html"]`)).toBeVisible();
});

test.afterEach(async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('STICKY-1 滚进深层子树 → 三级祖先吸顶（正确链 + 贴可视区顶 + 阴影真被画）', async () => {
  await scrollFileToTop(`${DEEP}/华东区/明细/6月.html`, 40); // 6月.html 到顶下 40px → 归档/华东区/明细 吸顶其上
  await page.waitForTimeout(120);
  const s = await stickyState();
  expect(s.count).toBe(3);
  // 祖先链自上而下 = compact 归档链 → 华东区 → 明细（= 折线处 6月.html 的真实祖先）
  expect(s.rows[0]).toContain('归档');
  expect(s.rows[0]).toContain('复盘');
  expect(s.rows[1]).toBe('华东区');
  expect(s.rows[2]).toBe('明细');
  expect(s.atTop).toBe(true); // 贴在 #sb-body 可视区顶
  expect(s.shadow).not.toBe('none'); // 吸顶叠层阴影真被 CSS 画（has-pins）——CSS 全废这里翻红
});

test('STICKY-2 变异探针：滚回顶部 → 浮层清空隐藏（证明滚动驱动、非常驻元素）', async () => {
  await scrollFileToTop(`${DEEP}/华东区/明细/6月.html`, 40);
  await page.waitForTimeout(120);
  expect((await stickyState()).count).toBe(3); // 深处：有吸顶
  // 滚回顶
  await page.evaluate(() => { const b = document.getElementById('sb-body'); b.scrollTop = 0; b.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(120);
  const s = await stickyState();
  expect(s.count).toBe(0); // 顶部：无祖先 → 浮层空
  expect(s.display).toBe('none'); // :empty 隐藏（常驻元素会一直 display block、count>0，此断言必翻红）
});

test('STICKY-3 旁支排除：滚进华南区（华东区的兄弟支）→ 吸顶归档+华南区，不吸华东区/明细', async () => {
  // 华南区 与 华东区 是兄弟（同为复盘的子）。折线进华南区的文件时，祖先链 = 归档compact(d0)+华南区(d1)。
  // 华东区/明细 是旁支、已滚出释放，绝不该还吸着——sticky 必须按真实层级释放过时祖先，不是无脑保留。
  await clickDir(`${DEEP}/华南区`); // 展开华南区
  await expect(page.locator(`.sb-file[data-rel="${DEEP}/华南区/库存.html"]`)).toBeVisible();
  // 滚到华南区的第 4 个文件（库存.html）→ 华南区 header 已完全滚到 fold 上方（被吸顶），anchor 明确是它的子文件
  await scrollFileToTop(`${DEEP}/华南区/库存.html`, 20);
  await page.waitForTimeout(120);
  const s = await stickyState();
  expect(s.rows[0]).toContain('归档'); // 顶层仍是 归档compact
  expect(s.rows.some((r) => r === '华南区')).toBe(true); // 吸的是华南区这支
  expect(s.rows.some((r) => r === '华东区')).toBe(false); // 旁支华东区已释放
  expect(s.rows.some((r) => r === '明细')).toBe(false); // 旁支明细已释放
});

test('STICKY-4 点浮层里的祖先 → 真滚动把它带回可视区（可 climb out）', async () => {
  await scrollFileToTop(`${DEEP}/华东区/明细/6月.html`, 40);
  await page.waitForTimeout(120);
  const before = await page.evaluate(() => document.getElementById('sb-body').scrollTop);
  // 点浮层里的「华东区」祖先行
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#sb-sticky .sb-sticky-row')].find((r) => (r.textContent || '').trim().startsWith('华东区'));
    row && row.click();
  });
  await page.waitForTimeout(400); // smooth scroll
  const after = await page.evaluate(() => document.getElementById('sb-body').scrollTop);
  expect(after).toBeLessThan(before); // 往上滚了（把华东区带回可视区）
  // 华东区真行现在贴近可视区顶
  const eastTop = await page.evaluate((rel) => {
    const b = document.getElementById('sb-body').getBoundingClientRect();
    const r = document.querySelector(`.sb-dir[data-rel="${rel}"]`).getBoundingClientRect();
    return r.top - b.top;
  }, `${DEEP}/华东区`);
  expect(eastTop).toBeLessThan(60);
});

test('STICKY-5 回归（缓存不失效）：树上方的区增高但没 render → 滚深层仍吸对祖先', async () => {
  // 复现「置顶/标签区增高只走 renderZones、不 render 树」→ stickyRows 缓存不刷 的场景：直接往 #sb-tree 上方
  // 插一个 150px 占位块（不触发 render()）。若缓存存的是 #sb-body 绝对 offsetTop（会因上方增高而 stale），
  // stickyPins(scrollTop) 会用偏小的旧坐标找错 anchor、钉错祖先。tree-relative 修复：树内相对坐标 +
  // 每帧 live 读 treeEl.offsetTop，上方增高自动抵消，仍钉对 归档/华东区/明细。
  await page.evaluate(() => {
    const body = document.getElementById('sb-body');
    const tree = document.getElementById('sb-tree');
    const sp = document.createElement('div');
    sp.style.height = '150px';
    sp.id = 'mut-spacer';
    body.insertBefore(sp, tree); // 把树整体下移 150px，且不经过 render()/cacheStickyRows()
  });
  await scrollFileToTop(`${DEEP}/华东区/明细/6月.html`, 40);
  await page.waitForTimeout(150);
  const s = await stickyState();
  expect(s.count).toBe(3);
  expect(s.rows[0]).toContain('归档');
  expect(s.rows[1]).toBe('华东区');
  expect(s.rows[2]).toBe('明细'); // 缓存 stale 会把这钉成别的行（本门变异自检过：还原绝对坐标即翻红）
});
