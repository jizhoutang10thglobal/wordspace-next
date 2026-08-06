// SW-A/SW-B（Notion 对齐 sweep）：`---`→分隔线（Notion 实测 md-hr 探针 1→2，敲第三个 - 立即转）
// + ⌘E 行内代码 + ⌘⌥0-3 转正文/标题（证据类别=Notion 官方 shortcuts 文档——⌘ 组合键经 CDP/pressKey
// 打不进 Notion 已实证，无法真机对拍，spec 同款注明）。顺带钉 hr 的既有交互（此前零门）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2kbmd-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
}
async function openDoc(body) {
  const tag = 'run' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc' + seq + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(300);
}
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});
const DOC = '<p id="a">第一段。</p><p id="b">第二段内容文字。</p><p id="z">末段。</p>';
const undoIPC = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'undo'));

test('M1: 空段打 --- → 第三个 - 立即转分隔线、光标落新段；一步 undo 还原', async () => {
  await launch();
  await openDoc(DOC);
  await frame.locator('#z').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter'); // 新空段
  await page.keyboard.type('---');
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('hr').length)).toBe(1); // 不等空格
  await page.keyboard.type('后续文字'); // 光标应在 hr 后的新空段
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const hr = d.querySelector('hr');
    return { afterHr: hr.nextElementSibling ? hr.nextElementSibling.textContent : null, hrText: null };
  });
  expect(st.afterHr).toBe('后续文字');
  await undoIPC(); // 撤打字（后续文字）
  await undoIPC(); // 撤 hr 转换 → 逃生舱：还原字面 ---（ADV-KB-2 钉门）
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { hr: d.querySelectorAll('hr').length, literal: [...d.querySelectorAll('p')].some((p) => p.textContent === '---') };
  })).toEqual({ hr: 0, literal: true }); // Notion 同款：自动转换的 undo 先回字面文本
  await undoIPC(); // 再撤 --- 打字
  await expect.poll(() => page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.querySelectorAll('p')].some((p) => p.textContent === '---'))).toBe(false);
});

test('M2: 负向守卫——「a---」不转、既有 --- 文本中键入不转', async () => {
  await launch();
  await openDoc(DOC);
  await frame.locator('#z').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('a---');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('hr').length)).toBe(0); // 前面有字不转
});

test('K1: ⌘E 行内代码——选中词 → <code> 包裹入盘合规', async () => {
  await launch();
  await openDoc(DOC);
  await frame.locator('#b').click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const tn = d.getElementById('b').firstChild;
    const r = d.createRange(); r.setStart(tn, 3); r.setEnd(tn, 5); // 「内容」
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Meta+e');
  await expect.poll(() => page.evaluate(() => {
    const c = document.getElementById('doc-frame').contentDocument.querySelector('#b code');
    return c ? c.textContent : null;
  })).toBe('内容');
  const html = await page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
  expect(html).toContain('<code>内容</code>');
});

test('K2: ⌘⌥1/2/3/0 转标题与回转——内容保留、块级转换', async () => {
  await launch();
  await openDoc(DOC);
  await frame.locator('#b').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Meta+Alt+1');
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const h = d.querySelector('h1');
    return h ? h.textContent : null;
  })).toBe('第二段内容文字。');
  await page.keyboard.press('Meta+Alt+3');
  await expect.poll(() => page.evaluate(() => !!document.getElementById('doc-frame').contentDocument.querySelector('h3'))).toBe(true);
  await page.keyboard.press('Meta+Alt+0');
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { h: d.querySelectorAll('h1,h2,h3').length, ps: d.querySelectorAll('p').length };
  })).toEqual({ h: 0, ps: 3 }); // 回到三个正文段
});

test('K3: cell 编辑态 ⌘⌥1 不动（块级转换在格里禁用）', async () => {
  await launch();
  await openDoc('<p id="a">前。</p><table id="T"><tbody><tr><td id="c1">格文</td><td>乙</td></tr></tbody></table>');
  await frame.locator('#c1').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Meta+Alt+1');
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('h1').length)).toBe(0);
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('#T td').length)).toBe(2); // 表没被动
});

test('H1: hr 既有交互钉门——点击=灰选、Backspace 删除、undo 回来（此前零门）', async () => {
  await launch();
  await openDoc('<p id="a">上。</p><hr id="line"><p id="z">下。</p>');
  await frame.locator('#line').click(); // 不用 force——hit-target 真跑，覆盖层压住 hr 时这里就该红（ADV-KB-8）
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const hr = d.getElementById('line');
    if (!hr || !hr.hasAttribute('data-ws2-selected')) return false;
    const cs = getComputedStyle(hr);
    return cs.boxShadow !== 'none' || cs.outlineWidth !== '0px'; // 灰选必须真画出来（S4 判据）
  })).toBe(true); // 点击灰选
  await page.keyboard.press('Backspace');
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('hr').length)).toBe(0); // 删除
  await undoIPC();
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('hr').length)).toBe(1); // undo 回来
});

// ===== 对抗审查回归（ADV-KB-2/3/4/6 处置后钉死）=====

test('K4: ⌘E 是开关——再按一次解包，绝不嵌套 <code>', async () => {
  await launch();
  await openDoc(DOC);
  await frame.locator('#b').click();
  await page.waitForTimeout(150);
  const sel23 = () => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const b = d.getElementById('b');
    const tn = b.querySelector('code') ? b.querySelector('code').firstChild : b.firstChild;
    const r = d.createRange(); r.setStart(tn, 0); r.setEnd(tn, 2);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const tn = d.getElementById('b').firstChild;
    const r = d.createRange(); r.setStart(tn, 3); r.setEnd(tn, 5);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Meta+e');
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('#b code').length)).toBe(1);
  await sel23(); // 选中 code 内文字
  await page.keyboard.press('Meta+e'); // toggle off
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('#b code').length)).toBe(0); // 解包不嵌套
});

test('K5: ⌘E 后紧接 ⌘⌥1——两步 undo 各回各的（格式步不被并进转换步）', async () => {
  await launch();
  await openDoc(DOC);
  await frame.locator('#b').click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const tn = d.getElementById('b').firstChild;
    const r = d.createRange(); r.setStart(tn, 3); r.setEnd(tn, 5);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Meta+e');
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('code').length)).toBe(1);
  await page.keyboard.press('Meta+Alt+1');
  await expect.poll(() => page.evaluate(() => !!document.getElementById('doc-frame').contentDocument.querySelector('h1'))).toBe(true);
  await undoIPC(); // 撤转换
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { h1: d.querySelectorAll('h1').length, code: d.querySelectorAll('code').length };
  })).toEqual({ h1: 0, code: 1 }); // ADV-KB-3：code 幸存——格式步没被陪葬
  await undoIPC(); // 撤 ⌘E
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('code').length)).toBe(0);
});

test('K6: cell 编辑态 ⌘E——格内选词包 code，phrasing 合规', async () => {
  await launch();
  await openDoc('<p id="a">前。</p><table id="T"><tbody><tr><td id="c1">格内文字</td><td>乙</td></tr></tbody></table>');
  await frame.locator('#c1').click();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const tn = d.getElementById('c1').firstChild;
    const r = d.createRange(); r.setStart(tn, 0); r.setEnd(tn, 2);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Meta+e');
  await expect.poll(() => page.evaluate(() => {
    const c = document.getElementById('doc-frame').contentDocument.querySelector('#c1 code');
    return c ? c.textContent : null;
  })).toBe('格内');
  const html = await page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
  const { validate } = require('../src/lib/schema-validate.js');
  const { JSDOM } = require('jsdom');
  expect(validate(new JSDOM(html).window.document).conform).toBe(true);
});
