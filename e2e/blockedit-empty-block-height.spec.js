// Wendi 2026-07-22 报「在一行上方/下方插入文字时，这行原有文字会上下抖动、纵坐标没固定住」。
// 根因：EDITOR_CSS 给空块的 min-height 是固定 1.6em，但各块行高不同（p=1.75、h1=1.3…），对不上——
// 空块比有字的块矮一截（p 实测 25.6 vs 28）。块在「空↔有字」间翻转时，下面所有内容行跳 2.4px（标题更大）。
// 修：min-height:1lh（＝该块自己的行高），空块精确等于有字时一行高，翻转零位移。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises'); const path = require('path'); const os = require('os');
const ROOT = path.join(__dirname, '..'); let app, page, frame, tmpDir;
async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2eb-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}
async function openDoc(html) {
  const p = path.join(tmpDir, 'doc.html'); await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, fp) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp), p);
  frame = page.frameLocator('#doc-frame'); await expect(frame.locator('body')).toBeVisible(); await page.waitForTimeout(400); return p;
}
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

// 追「这是测试文档」内容行的视口 top（按内容找，避开 splitBlock 的元素复用）
const contentTop = () => frame.locator('body').evaluate((b) => {
  const blk = [...b.children].find((c) => c.textContent && c.textContent.includes('这是测试文档'));
  return blk ? Math.round(blk.getBoundingClientRect().top * 10) / 10 : null;
});

test('空段与有字段等高：上方空段变有字，下面内容行纵坐标不动（不抖）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<p id="above"></p><p>这是测试文档，注意我点击的时候。</p></body></html>');
  const whenEmpty = await contentTop();            // 上方 <p> 为空
  await frame.locator('#above').click();
  await page.keyboard.type('在上方插入的文字');       // 上方 <p> 变有字
  await page.waitForTimeout(120);
  const whenFilled = await contentTop();
  expect(whenFilled, '上方段从空变有字，下面内容行不应移动（空块须与有字块同高，min-height:1lh）').toBe(whenEmpty);
});

test('空标题与有字标题等高：上方空标题变有字，下面内容行纵坐标不动（标题行高≠正文，固定 em 必翻车）', async () => {
  await launch();
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<h1 id="above"></h1><p>这是测试文档，注意我点击的时候。</p></body></html>');
  const whenEmpty = await contentTop();
  await frame.locator('#above').click();
  await page.keyboard.type('标题文字');
  await page.waitForTimeout(120);
  const whenFilled = await contentTop();
  expect(whenFilled, '上方标题从空变有字，下面内容行不应移动').toBe(whenEmpty);
});
