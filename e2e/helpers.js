// e2e 共用工具：统一 Electron 启动 + VA steps 采集执行。
// 启动隔离（S6）：localStorage 持久化落在 userData，不隔离会跨测试运行互相污染
// （上次留下的编辑让这次「初始态不含探针」假红）——每次启动默认全新临时目录。
// 采集器只有一份：va-runner 与 va-selftest 共用，免得两份 collect 漂移。
const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { selectorsOf } = require('../src/lib/va-eval');

// userData 不传 = 新建全新临时目录；传 = 复用（持久化类测试要跨启动用同一目录）
async function launchApp(mainPath, userData) {
  const dir = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'wsnd-e2e-'));
  const app = await electron.launch({
    args: ['--no-sandbox', mainPath],
    env: { ...process.env, WSND_USER_DATA: dir },
  });
  return { app, userData: dir };
}

// 等两帧渲染落定（跟随实际渲染节奏，比固定睡眠确定性强）
function settle(window) {
  return window.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

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

// 按 VA steps 真跑一遍，返回各命名快照。
// 步骤词汇通用、runner 不认识任何具体 spec：
//   { snapshot: name }            采一帧
//   { click: selector }           点击
//   { type: [selector, text] }    真敲键盘输入（焦点不在 selector 内时先点它一下）
//   { press: key, times?: n }     按键（如 Meta+z），可重复
async function collect(window, va) {
  const selectors = selectorsOf(va);
  const snapshots = {};
  for (const step of va.steps) {
    if (step.snapshot) snapshots[step.snapshot] = await snapshot(window, selectors);
    if (step.click) {
      await window.locator(step.click).first().click();
      await settle(window);
    }
    if (step.type) {
      const [sel, text] = step.type;
      const focused = await window.evaluate((s) => {
        const root = s === 'body' ? document.body : document.querySelector(s);
        return !!root && (root === document.activeElement || root.contains(document.activeElement));
      }, sel);
      if (!focused) await window.locator(sel).first().click();
      await window.keyboard.type(text);
      await settle(window);
    }
    if (step.press) {
      for (let i = 0; i < (step.times || 1); i++) {
        await window.keyboard.press(step.press);
      }
      await settle(window);
    }
  }
  return snapshots;
}

module.exports = { launchApp, settle, snapshot, collect };
