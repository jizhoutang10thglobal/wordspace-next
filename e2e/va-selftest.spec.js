// 变异自检：证明 VA 门不是哑的（这是对"门存在 ≠ 门够强"的正面回答）。
// 对每份 VA：先确认好 app 上 VA 判绿（采集+判定在真 app 上确实正确），
// 再故意把样式彻底打掉（移除所有 <link>/<style>，模拟 CSP 又把 CSS 拦了 / 主题失效），
// 重新采集并断言 VA 必须翻红。破坏后还绿 = 门是哑的 = 整个 e2e job fail。
// 启动与采集走 e2e/helpers（与 va-runner 同一份 collect，免两份漂移）。
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { evaluateChecks, selectorsOf, statesOf } = require('../src/lib/va-eval');
const { launchApp, snapshot, collect } = require('./helpers');

// 对抗验收门不容忍概率性放过：retries 设 0，让间歇性失败如实暴露（flaky 是信号不是噪音）。
test.describe.configure({ retries: 0 });

const SPECS_DIR = path.join(__dirname, '../specs');
const vaFiles = fs.readdirSync(SPECS_DIR).filter((f) => f.endsWith('.va.json'));

for (const f of vaFiles) {
  const va = JSON.parse(fs.readFileSync(path.join(SPECS_DIR, f), 'utf8'));
  test(`变异自检: ${va.spec} — 样式打掉后 VA 必红（证明门有牙）`, async () => {
    const { app } = await launchApp(path.join(__dirname, '..', va.launch.main));
    try {
      const window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      if (va.launch.waitFor) {
        await window.locator(va.launch.waitFor).first().waitFor({ state: 'visible' });
      }

      // 基线：好 app 上 VA 应判绿（确认采集+判定本身正确，破坏对比才有意义）
      const good = await collect(window, va);
      const baseline = evaluateChecks(good, va.checks);
      expect(baseline.passed, '基线异常：好 app 上 VA 本就该绿，却红了 —— ' +
        baseline.results.filter((r) => !r.pass).map((r) => r.id).join(',')).toBe(true);

      // 变异：移除样式（让颜色门失效）+ 清空被验元素文本（让内容门 contains 类失效）。
      const sels = selectorsOf(va);
      await window.evaluate((ss) => {
        document.querySelectorAll('link[rel="stylesheet"], style').forEach((el) => el.remove());
        ss.forEach((s) => {
          const el = s === 'body' ? document.body : document.querySelector(s);
          if (el) el.textContent = '';
        });
      }, sels);
      await window.waitForTimeout(100);

      // 破坏后采一次当前 DOM，所有命名状态共用这份坏快照——不再走 steps 的 click/type，
      // 因为清空容器文本会连带删掉里面的按钮（如 #theme-toggle），再 click 会卡死。
      const brokenSnap = await snapshot(window, sels);
      const broken = {};
      statesOf(va).forEach((st) => { broken[st] = brokenSnap; });
      const mutated = evaluateChecks(broken, va.checks);
      expect(mutated.passed,
        '门是哑的：把样式和内容都打坏后 VA 仍判绿，说明断言根本没在验真实可见效果').toBe(false);
    } finally {
      await app.close();
    }
  });
}
