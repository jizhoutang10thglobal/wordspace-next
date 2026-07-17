// 语言（i18n）验收门。CI 用 xvfb 真启动 Electron 跑。WS2_LANG seam 锁定生效语言（!app.isPackaged）。
// 覆盖：① 启动语言（initLang 路径）真的把 renderer 静态外壳按语言写进 DOM；② 同一元素在 en / zh 下
// 文本不同（强断言：防「其实显示中文、却被当英文过」的假绿）；③ window.wsLang / <html lang> 跟随；
// ④ 设置页语言段用英文渲染（语言切换 UI 存在且本地化）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, tmpDir;

async function launch(lang) {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2lang-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: lang, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // i18n-ui.js 在 DOMContentLoaded 刷静态外壳；等空态按钮拿到文本再断言。
  await page.waitForFunction(() => {
    const b = document.getElementById('sb-empty-open');
    return b && b.textContent && b.textContent.trim().length > 0;
  }, { timeout: 5000 });
  return page;
}
test.afterEach(async () => { if (app) await app.close().catch(() => {}); });

// 从渲染态取几处静态外壳文案（都由 data-i18n / data-i18n-ph 驱动，i18n-ui.js 按语言写入）。
async function shell(page) {
  return page.evaluate(() => ({
    wsLang: window.wsLang,
    htmlLang: document.documentElement.lang,
    emptyBtn: (document.getElementById('sb-empty-open') || {}).textContent || '',
    emptyNote: (document.querySelector('.sb-empty-note') || {}).textContent || '',
    omniPh: (document.getElementById('omni-input') || {}).getAttribute('placeholder') || '',
  }));
}

test('en 启动：静态外壳全英文 + wsLang/html lang=en', async () => {
  const page = await launch('en');
  const s = await shell(page);
  expect(s.wsLang).toBe('en');
  expect(s.htmlLang).toBe('en');
  expect(s.emptyBtn).toBe('Open folder');
  expect(s.emptyNote).toContain('Open a local folder');
  expect(s.omniPh).toBe('Search, or enter a URL');
  // 强断言:不能残留中文(防「标 en 实则中文」)
  expect(/[一-鿿]/.test(s.emptyBtn + s.emptyNote + s.omniPh)).toBe(false);
});

test('zh 启动：静态外壳全中文 + wsLang/html lang=zh', async () => {
  const page = await launch('zh');
  const s = await shell(page);
  expect(s.wsLang).toBe('zh');
  expect(s.htmlLang).toContain('zh');
  expect(s.emptyBtn).toBe('打开文件夹');
  expect(s.emptyNote).toContain('打开一个本地文件夹');
  expect(s.omniPh).toBe('搜索,或输入网址');
});

// 强断言(跨语言不变式):同一批元素在 en 与 zh 下必须逐一不同——证明真的在按语言取，而不是恒定一种语言。
test('en 与 zh 的同一外壳元素文本必须不同（翻译真的生效）', async () => {
  const pageEn = await launch('en');
  const en = await shell(pageEn);
  await app.close();
  const pageZh = await launch('zh');
  const zh = await shell(pageZh);
  expect(en.emptyBtn).not.toBe(zh.emptyBtn);
  expect(en.emptyNote).not.toBe(zh.emptyNote);
  expect(en.omniPh).not.toBe(zh.omniPh);
});

test('设置页语言段用英文渲染（语言切换 UI 存在且本地化）', async () => {
  const page = await launch('en');
  // 打开设置子页面(浏览器 surface)：走命令,与 ⌘, 同。
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('menu', 'open-settings'); });
  await page.waitForSelector('#wp-language-select', { timeout: 5000 });
  const info = await page.evaluate(() => {
    const sel = document.getElementById('wp-language-select');
    const opts = [...sel.options].map((o) => o.textContent);
    // 语言段标题(wp-sec 里含「Language」)
    const secs = [...document.querySelectorAll('.wp-sec')].map((e) => e.textContent);
    return { opts, hasLanguageSec: secs.includes('Language'), value: sel.value };
  });
  expect(info.hasLanguageSec).toBe(true);
  expect(info.value).toBe('en'); // WS2_LANG=en → langPref 返回 en
  // 三态选项:跟随系统翻英「Follow system」，中文/English 用母语名恒定
  expect(info.opts).toContain('Follow system');
  expect(info.opts).toContain('中文');
  expect(info.opts).toContain('English');
});
