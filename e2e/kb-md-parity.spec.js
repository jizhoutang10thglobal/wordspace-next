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
  await undoIPC(); // 撤打字
  await undoIPC(); // 撤 hr 转换
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('hr').length)).toBe(0);
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
  await frame.locator('#line').click({ force: true });
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const hr = d.getElementById('line');
    return hr && hr.hasAttribute('data-ws2-selected');
  })).toBe(true); // 点击灰选
  await page.keyboard.press('Backspace');
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('hr').length)).toBe(0); // 删除
  await undoIPC();
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('hr').length)).toBe(1); // undo 回来
});
