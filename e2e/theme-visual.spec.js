// 强视觉门：toggle 后读真实 computed backgroundColor、算亮度做断言。
// 跟 app.spec.js 的 class 断言互补——class 是 JS 直接设的、不过 CSS，CSP 把样式
// 全拦了它照样过（spec2 就这么假绿的）。这里量的是浏览器算完层叠后的真实颜色，
// CSS 没生效 / .dark-theme 没命中 / background 写错，暗态亮度都掉不到阈值下 → 必 fail。
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
// 复用 va-eval 的同一把尺子（别留第二份 luminance，免得两份漂移）
const { luminance } = require('../src/lib/va-eval');

// 对抗验收门不容忍概率性放过：retries 设 0。
test.describe.configure({ retries: 0 });

async function bg(window, selector) {
  const css = await window.evaluate((sel) => {
    const el = sel === 'body' ? document.body : document.querySelector(sel);
    return getComputedStyle(el).backgroundColor; // 经过 CSS cascade 的真实结果
  }, selector);
  return { css, lum: luminance(css) };
}

test('暗/亮主题切换：外壳背景真的从亮变暗，文档容器两态恒白', async () => {
  const app = await electron.launch({
    args: ['--no-sandbox', path.join(__dirname, '../src/main.js')],
  });
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.locator('#doc-container h1, #doc-container p').first().waitFor({ state: 'visible' });

    // ---- 亮态(默认) ----
    const shellLight = await bg(window, 'body');
    const docLight = await bg(window, '#doc-container');
    // CSS 真生效时亮态外壳必须够亮(#f0f0f0 ≈ 0.87)；没生效会露馅
    expect(shellLight.lum, `亮态外壳背景=${shellLight.css}`).toBeGreaterThan(0.7);
    expect(docLight.lum, `亮态文档背景=${docLight.css}`).toBeGreaterThan(0.95);

    // ---- 切到暗态 ----
    await window.locator('#theme-toggle').click();
    await window.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const shellDark = await bg(window, 'body');
    const docDark = await bg(window, '#doc-container');
    // 核心真门：暗态外壳必须真的变暗(#1a1a1a ≈ 0.01)，低于绝对阈值
    expect(shellDark.lum, `暗态外壳背景=${shellDark.css}`).toBeLessThan(0.2);
    // 暗态一定比亮态暗(相对关系，防两态被同一颜色顶替)
    expect(shellDark.lum).toBeLessThan(shellLight.lum);
    // 文档容器两态恒白、不被主题染色
    expect(docDark.lum, `暗态文档背景=${docDark.css}`).toBeGreaterThan(0.95);
    expect(docDark.css).toBe(docLight.css);

    // ---- 切回亮态：外壳亮度回升 ----
    await window.locator('#theme-toggle').click();
    await window.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const shellBack = await bg(window, 'body');
    expect(shellBack.lum, `回切后外壳背景=${shellBack.css}`).toBeGreaterThan(0.7);
  } finally {
    await app.close();
  }
});
