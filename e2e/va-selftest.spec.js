// 变异自检：证明 VA 门不是哑的（这是对"门存在 ≠ 门够强"的正面回答）。
// 对每份 VA：先确认好 app 上 VA 判绿（采集+判定在真 app 上确实正确），
// 再故意把样式彻底打掉（移除所有 <link>/<style>，模拟 CSP 又把 CSS 拦了 / 主题失效），
// 重新采集并断言 VA 必须翻红。破坏后还绿 = 门是哑的 = 整个 e2e job fail。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { evaluateChecks, selectorsOf } = require('../src/lib/va-eval');

// 对抗验收门不容忍概率性放过：retries 设 0，让间歇性失败如实暴露（flaky 是信号不是噪音）。
test.describe.configure({ retries: 0 });

const SPECS_DIR = path.join(__dirname, '../specs');
const vaFiles = fs.readdirSync(SPECS_DIR).filter((f) => f.endsWith('.va.json'));

async function snapshot(window, selectors) {
  const out = {};
  for (const sel of selectors) {
    out[sel] = await window.evaluate((s) => {
      const el = s === 'body' ? document.body : document.querySelector(s);
      return el ? getComputedStyle(el).backgroundColor : null;
    }, sel);
  }
  return out;
}

async function collect(window, va) {
  const selectors = selectorsOf(va);
  const snapshots = {};
  for (const step of va.steps) {
    if (step.snapshot) snapshots[step.snapshot] = await snapshot(window, selectors);
    if (step.click) {
      await window.locator(step.click).click();
      // 等两帧渲染落定（跟随实际渲染节奏，比固定 200ms 睡眠确定性强）
      await window.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
  }
  return snapshots;
}

for (const f of vaFiles) {
  const va = JSON.parse(fs.readFileSync(path.join(SPECS_DIR, f), 'utf8'));
  test(`变异自检: ${va.spec} — 样式打掉后 VA 必红（证明门有牙）`, async () => {
    const app = await electron.launch({
      args: ['--no-sandbox', path.join(__dirname, '..', va.launch.main)],
    });
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

      // 变异：移除所有外部样式表与 <style>，模拟 CSS / 主题彻底失效
      await window.evaluate(() => {
        document.querySelectorAll('link[rel="stylesheet"], style').forEach((el) => el.remove());
      });
      await window.waitForTimeout(100);

      const broken = await collect(window, va);
      const mutated = evaluateChecks(broken, va.checks);
      expect(mutated.passed,
        '门是哑的：把样式全打掉后 VA 仍判绿，说明断言根本没在验真实可见效果').toBe(false);
    } finally {
      await app.close();
    }
  });
}
