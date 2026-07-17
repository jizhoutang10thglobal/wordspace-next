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

test.afterEach(async () => { if (app) await app.close().catch(() => {}); });

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
