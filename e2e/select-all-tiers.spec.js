// ⌘A 分档修补门（2026-08-07 todo 深扫 B1/B2）：
// B1 空列表行：`liText.length > 0` 把第一档挡掉 → 刚回车的空行上 ⌘A 一次=整张清单，随手一字替掉
//    整份 checklist 并落盘（那一档的注释写明就是防这个，判据把空行漏了）。
// B2 多段容器（callout/quote）：⌘A 只有 整框→全篇 两档、没有「本段」档；同位置 Esc 有段档——
//    同一容器两套口径。一键选全 + 打字 = 整框内容被替掉落盘。
// 契约：docs/features/editor-select-all.md。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, docPath, seq = 0;
const CMDA = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2sat-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.waitForTimeout(250);
}
async function openDoc(body) {
  const tag = 'sat' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title></head><body>${body}</body></html>`;
  docPath = path.join(tmpDir, 'd' + seq + '.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(400);
}
const selText = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const s = d.getSelection();
  return s && s.rangeCount ? s.toString().replace(/\s+/g, '') : '';
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); app = null; }
});

test('SA-1 空列表行 ⌘A 不塌档：一次不选整张清单；接着打字只动空行、三条待办无损', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">买牛奶</li><li id="r2">交房租</li><li id="r3">改简历</li></ul>');
  await frame.locator('#r3').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  const t1 = await selText();
  expect(t1.includes('买牛奶'), `B1 主症状：空行上 ⌘A 一次选中整张清单（实得选区「${t1}」）`).toBe(false);
  // 危险尾巴：随手打字
  await page.keyboard.type('甲');
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.getElementById('L').querySelectorAll('li')].map((li) => li.textContent.trim());
  });
  expect(rows, '三条待办必须原样都在，字只进空行').toEqual(['买牛奶', '交房租', '改简历', '甲']);
  // 打字重置阶梯：新一轮 ⌘A 第一档=本行（现已非空），第二档=整张清单
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), '打字后新一轮第一档 = 本行').toBe('甲');
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), '第二档 = 整张清单').toBe('买牛奶交房租改简历甲');
});

test('SA-1b 空行阶梯连按：①空行（选区不出行）→ ②整张清单 → ③全篇', async () => {
  await launch();
  await openDoc('<p id="pre">前文</p><ul class="ws-todo" id="L"><li id="r1">买牛奶</li><li id="r2">交房租</li></ul>');
  await frame.locator('#r2').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), '一档：空行自己（无文字可选）').toBe('');
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), '二档：整张清单').toBe('买牛奶交房租');
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(250);
  expect((await selText()).includes('前文'), '三档：全篇').toBe(true);
});

test('SA-2 提示框 ⌘A 三档：本段 → 整框 → 全篇', async () => {
  await launch();
  await openDoc('<p id="pre">框外前文</p><div class="ws-callout" id="C"><p id="c1">第一段</p><p id="c2">第二段</p><p id="c3">第三段</p></div><p id="post">框外后文</p>');
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), 'B2 主症状：第一档应只选本段').toBe('第二段');
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), '第二档 = 整框').toBe('第一段第二段第三段');
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(250);
  const t3 = await selText();
  expect(t3.includes('框外前文') && t3.includes('框外后文'), `第三档 = 全篇，实得「${t3}」`).toBe(true);
});

test('SA-3 引用块 ⌘A 三档同款', async () => {
  await launch();
  await openDoc('<p id="pre">前</p><blockquote id="Q"><p id="q1">引一</p><p id="q2">引二</p></blockquote><p id="post">后</p>');
  await frame.locator('#q2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), '第一档只选本段').toBe('引二');
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), '第二档整框').toBe('引一引二');
});

test('SA-4 回归：非空列表行三档原样（行 → 整表 → 全篇）', async () => {
  await launch();
  await openDoc('<p id="pre">前文</p><ul class="ws-todo" id="L"><li id="r1">买牛奶</li><li id="r2">交房租</li></ul>');
  await frame.locator('#r2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), '一档=本行').toBe('交房租');
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), '二档=整表').toBe('买牛奶交房租');
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(250);
  expect((await selText()).includes('前文'), '三档=全篇').toBe(true);
});

test('SA-5 回归：单段提示框 ⌘A 不憋死（本段=整框时直接升框再升全篇）', async () => {
  await launch();
  await openDoc('<p id="pre">前</p><div class="ws-callout" id="C"><p id="c1">唯一段</p></div><p id="post">后</p>');
  await frame.locator('#c1').click();
  await page.waitForTimeout(200);
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(200);
  expect(await selText(), '一档').toBe('唯一段');
  await page.keyboard.press(CMDA);
  await page.waitForTimeout(250);
  expect((await selText()).includes('前'), '二档直接升全篇（本段=整框，中间档跳过不憋死）').toBe(true);
});
