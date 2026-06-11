// 通用 VA runner：spec-agnostic。扫 specs/*.va.json，对每份真启动 app、按 steps 采集
// 真实 computed 背景色 / textContent、用 src/lib/va-eval 的纯逻辑判定。断言强度全来自 VA 文件
// （人写、实现 AI 不许改），runner 自己不认识任何具体 spec —— 未来 spec 只要带 .va.json 就自动被它覆盖。
// 启动与采集走 e2e/helpers（全新临时 userData + click/type/press/snapshot 通用词汇）。
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { evaluateChecks } = require('../src/lib/va-eval');
const { launchApp, collect } = require('./helpers');

// 对抗验收门不容忍概率性放过：retries 设 0，让间歇性失败如实暴露（flaky 是信号不是噪音）。
test.describe.configure({ retries: 0 });

const SPECS_DIR = path.join(__dirname, '../specs');
const vaFiles = fs.readdirSync(SPECS_DIR).filter((f) => f.endsWith('.va.json'));

if (vaFiles.length === 0) {
  test('specs/ 下没有任何 .va.json', () => {
    throw new Error('未找到 VA 文件 —— 有可见效果的 spec 必须带 specs/<slug>.va.json');
  });
}

for (const f of vaFiles) {
  const va = JSON.parse(fs.readFileSync(path.join(SPECS_DIR, f), 'utf8'));
  test(`VA: ${va.spec} — 真开 app 按可见验收清单判定`, async () => {
    const { app } = await launchApp(path.join(__dirname, '..', va.launch.main));
    try {
      const window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      if (va.launch.waitFor) {
        await window.locator(va.launch.waitFor).first().waitFor({ state: 'visible' });
      }
      const snapshots = await collect(window, va);
      const { passed, results } = evaluateChecks(snapshots, va.checks);
      const red = results.filter((r) => !r.pass);
      expect(passed, red.map((r) => `✗ ${r.id}（${r.desc}）: ${r.reasons.join('; ')}`).join('\n')).toBe(true);
    } finally {
      await app.close();
    }
  });
}
