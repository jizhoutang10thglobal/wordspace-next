#!/usr/bin/env node
// 宿主对抗验收 —— "完成前真打开看"的自动化。
//
// 在宿主真显示器上真启动 app，按每份 specs/*.va.json 的可见验收清单判定真实屏幕效果，
// 跑变异探针（打掉样式后 VA 必须翻红，证明门有牙），截图存证，并（可选）用宿主 token
// 确认 CI 的 e2e job 真绿（破"容器内 token 读不到 CI"的约束）。
//
// 定位：由一个独立于实现的 agent 在 PR 开出后、人 merge 前跑，任务是"证伪"不是"盖章"。
// 复用 src/lib/va-eval 的纯判定逻辑（和 CI 的 va-runner 同一把尺子）。
//
// 用法：
//   node scripts/host-verify.js            # 只跑本地对抗验收（VA + 变异探针 + 截图）
//   node scripts/host-verify.js <PR或分支>  # 额外用 gh 确认该 PR 的 CI e2e 真绿
const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { evaluateChecks, selectorsOf, statesOf } = require('../src/lib/va-eval');

const ROOT = path.join(__dirname, '..');
const SPECS_DIR = path.join(ROOT, 'specs');
const SHOTS_DIR = path.join(ROOT, 'test-results', 'acceptance');

async function snapshot(window, selectors) {
  const out = {};
  for (const sel of selectors) {
    out[sel] = await window.evaluate((s) => {
      const el = s === 'body' ? document.body : document.querySelector(s);
      if (!el) return null;
      return { bg: getComputedStyle(el).backgroundColor, text: el.textContent };
    }, sel);
  }
  return out;
}

// 走一遍 steps 采集各命名快照；shoot=true 时在每个快照点截图存证
async function walk(window, va, selectors, shoot) {
  const snapshots = {};
  for (const step of va.steps) {
    if (step.snapshot) {
      snapshots[step.snapshot] = await snapshot(window, selectors);
      if (shoot) await window.screenshot({ path: path.join(SHOTS_DIR, `${va.spec}-${step.snapshot}.png`) });
    }
    if (step.click) {
      await window.locator(step.click).click();
      // 等两帧渲染落定（跟随实际渲染节奏，比固定 200ms 睡眠确定性强）
      await window.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
  }
  return snapshots;
}

async function verifyOne(vaFile) {
  const va = JSON.parse(fs.readFileSync(path.join(SPECS_DIR, vaFile), 'utf8'));
  const issues = [];
  console.log(`\n▶ 宿主对抗验收: ${va.spec}（${va.title || ''}）`);
  const app = await electron.launch({ args: ['--no-sandbox', path.join(ROOT, va.launch.main)] });
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    if (va.launch.waitFor) await window.locator(va.launch.waitFor).first().waitFor({ state: 'visible' });

    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const selectors = selectorsOf(va);

    // 真实效果判定 + 截图存证
    const snapshots = await walk(window, va, selectors, true);
    const { passed, results } = evaluateChecks(snapshots, va.checks);
    results.forEach((r) => console.log(`  ${r.pass ? '✓' : '✗'} ${r.id} — ${r.desc}${r.pass ? '' : '  ::  ' + r.reasons.join('; ')}`));
    if (!passed) issues.push(`${va.spec}: 可见验收判红（看上面 ✗）`);

    // 变异探针：移除样式（颜色门）+ 清空被验元素文本（内容门），打坏后 VA 必须翻红
    await window.evaluate((sels) => {
      document.querySelectorAll('link[rel="stylesheet"], style').forEach((e) => e.remove());
      sels.forEach((s) => {
        const el = s === 'body' ? document.body : document.querySelector(s);
        if (el) el.textContent = '';
      });
    }, selectors);
    await window.waitForTimeout(100);
    // 破坏后采一次当前 DOM、所有状态共用（不再走 steps 的 click，清空容器文本会删掉按钮）
    const brokenSnap = await snapshot(window, selectors);
    const broken = {};
    statesOf(va).forEach((st) => { broken[st] = brokenSnap; });
    const mutated = evaluateChecks(broken, va.checks);
    if (mutated.passed) {
      issues.push(`${va.spec}: 变异探针没红 —— 门是哑的`);
      console.log('  ✗ 变异探针：打掉样式后 VA 仍绿（门哑了！）');
    } else {
      console.log('  ✓ 变异探针：打掉样式后 VA 翻红（门有牙）');
    }
  } finally {
    await app.close();
  }
  return issues;
}

function confirmCI(prRef) {
  try {
    const out = execSync(`gh pr checks ${prRef}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(out);
    return true; // gh pr checks 全过才退出码 0
  } catch (e) {
    console.log((e.stdout || '') + (e.stderr || e.message || ''));
    return false;
  }
}

(async () => {
  const prRef = process.argv[2];
  const vaFiles = fs.readdirSync(SPECS_DIR).filter((f) => f.endsWith('.va.json'));
  if (vaFiles.length === 0) {
    console.log('未找到任何 specs/*.va.json —— 有可见效果的 spec 必须带 VA。');
    process.exit(1);
  }

  let issues = [];
  for (const f of vaFiles) issues = issues.concat(await verifyOne(f));
  console.log(`\n截图存证: ${path.relative(ROOT, SHOTS_DIR)}/`);

  if (prRef) {
    console.log(`\n▶ 用宿主 token 确认 CI e2e 真绿（${prRef}）`);
    if (!confirmCI(prRef)) issues.push('CI checks 未全绿（或查询失败）');
  } else {
    console.log('\n（未给 PR 参数，跳过 CI 状态确认 —— 记得人工看 GitHub 绿勾）');
  }

  console.log('\n════════════════════════════════════════════');
  if (issues.length) {
    console.log('❌ 对抗验收否决：');
    issues.forEach((i) => console.log('   - ' + i));
    console.log('════════════════════════════════════════════');
    process.exit(1);
  }
  console.log('✅ 对抗验收通过：可见效果符合 VA、门有牙' + (prRef ? '、CI e2e 绿' : '（CI 待人工确认）'));
  console.log('════════════════════════════════════════════');
})();
