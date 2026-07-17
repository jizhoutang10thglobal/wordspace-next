// 侧栏分区栏标排版一致性门（Colin 2026-07-17 真机抓到：英文下「Bookmarks」混排、
// 其余三个区块头全大写——.sb-fav-label 抄了 .sb-sec-label 配方却漏了 text-transform）。
// 强断言（S4：不查 class，读 computed style）：
// ① 收藏头与每个 .sb-sec-label 六项排版签名逐项相等（族内一致，将来谁漂移谁翻红）；
// ② 锚死 textTransform === 'uppercase'（style.md「分区栏标」= 等宽+宽字距+大写；
//    防「两张样式表全没加载、双双落回 none 而相等」的假绿）。
// 隐藏元素（#sb-fav 无书签时 hidden）的 computed style 照样可读，不依赖可见性。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, tmpDir;

test.afterEach(async () => {
  if (!app) return;
  // 临时文档未保存时关窗守卫会卡住 close——先 destroy 强关（纯测试收尾，抄 align.spec.js）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  app = null;
});

const SIG_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'color'];

test('收藏区头与置顶/标签页/文件区块头排版签名一致，且都是 uppercase', async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2typo-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.sb-fav-label', { state: 'attached', timeout: 5000 });
  // zoneHeader 的 .sb-sec-label 由 sidebar.js 渲染，等到至少一个在场（空态也渲染置顶/标签页区头）
  await page.waitForFunction(() => document.querySelectorAll('.sb-sec-label').length >= 1, { timeout: 5000 });

  const sigs = await page.evaluate((props) => {
    const sig = (el) => {
      const cs = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, cs[p]]));
    };
    return {
      fav: sig(document.querySelector('.sb-fav-label')),
      secs: [...document.querySelectorAll('.sb-sec-label')].map((el) => ({ text: el.textContent.trim(), ...sig(el) })),
    };
  }, SIG_PROPS);

  expect(sigs.secs.length).toBeGreaterThanOrEqual(1);
  // ② 绝对锚：分区栏标必须大写（style.md 冻结的设计标准）
  expect(sigs.fav.textTransform).toBe('uppercase');
  // ① 族内一致：收藏头与每个区块头逐项相等
  for (const sec of sigs.secs) {
    for (const p of SIG_PROPS) {
      expect(sigs.fav[p], `${p} of .sb-fav-label vs .sb-sec-label(${sec.text})`).toBe(sec[p]);
    }
  }
});

// —— 几何门（Colin 2026-07-17：置顶/标签页的计数比栏标浮起 ~2.5px、间距 14px vs 收藏行 6px）——
// 用 Range 量纯文字矩形（不含 padding，盒模型怎么挪都量的是字），三条不变式：
// ① 同行栏标与计数光学中线相等；② 栏标→计数间距全侧栏统一（收藏行=zone 行）；
// ③ 三行栏标文字左缘对齐。变异（padding 挪回 label 子元素）即翻红。
const HTML_DOC = '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>对齐样张</h1></body></html>';

test('栏标/计数几何：同线、等距、左缘对齐（收藏 vs 置顶/标签页）', async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2typo-'));
  const wsDir = path.join(tmpDir, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML_DOC, 'utf8');
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_FOLDER_IN: wsDir },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });

  // 开工作区（WS2_FOLDER_IN seam 免原生对话框）→ 收藏造 1 条（fav 计数现形）→ + 建临时文档（标签页计数=1）
  await page.click('#home-open-folder');
  await page.waitForSelector('#sidebar.sb-on', { timeout: 8000 });
  await page.evaluate(() => window.ws2.bmAdd({ title: '对齐样张', url: 'https://example.com/' }));
  await page.waitForSelector('#sb-fav:not([hidden])', { timeout: 5000 });
  await page.locator('#sb-tabs .sb-zone-add').click();
  await page.locator('.sb-card', { hasText: '空文档' }).click({ timeout: 5000 });
  await page.waitForFunction(() => {
    const c = document.querySelector('#sb-tabs .sb-zone-count');
    return c && c.textContent.trim().length > 0;
  }, { timeout: 8000 });

  const geo = await page.evaluate(() => {
    const textRect = (el) => {
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      const r = document.createRange();
      if (tn) r.selectNodeContents(tn); else r.selectNodeContents(el);
      const b = r.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, cy: (b.top + b.bottom) / 2 };
    };
    const rows = [];
    const fl = document.querySelector('.sb-fav-label');
    const fc = document.querySelector('.sb-fav-count');
    rows.push({ name: 'fav', label: textRect(fl), count: fc && fc.textContent.trim() ? textRect(fc) : null });
    for (const head of document.querySelectorAll('.sb-zone-head')) {
      const l = head.querySelector('.sb-sec-label');
      const c = head.querySelector('.sb-zone-count');
      if (!l) continue;
      rows.push({
        name: l.textContent.trim(),
        label: textRect(l),
        count: c && c.textContent.trim() ? textRect(c) : null,
      });
    }
    return rows;
  });

  const withCount = geo.filter((r) => r.count);
  expect(withCount.length, '至少要有收藏 + 标签页两行带计数').toBeGreaterThanOrEqual(2);
  // ① 同行光学中线：|centerY(栏标) - centerY(计数)| ≤ 1px
  for (const r of withCount) {
    expect(Math.abs(r.label.cy - r.count.cy), `row "${r.name}" 计数与栏标不同线`).toBeLessThanOrEqual(1);
  }
  // ② 栏标→计数间距统一：所有带计数行的 gap 彼此差 ≤ 1px
  const gaps = withCount.map((r) => r.count.left - r.label.right);
  const gMin = Math.min(...gaps), gMax = Math.max(...gaps);
  expect(gMax - gMin, `间距不统一: ${withCount.map((r, i) => `${r.name}=${gaps[i].toFixed(1)}px`).join(', ')}`).toBeLessThanOrEqual(1);
  // ③ 栏标文字左缘对齐（含没计数的行,如置顶空态/文件）
  const lefts = geo.map((r) => r.label.left);
  expect(Math.max(...lefts) - Math.min(...lefts), `左缘不齐: ${geo.map((r) => `${r.name}=${r.label.left.toFixed(1)}`).join(', ')}`).toBeLessThanOrEqual(1);
});
