// 探针（非门）：复现 Wendi 报的「回车建的第二行，选中深色仍和上一行连成一片」
// 只采集事实，不断言对错。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2probe-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'appearance-light')).catch(() => {});
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title><style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}

// 采集：谁挂了选中属性 + 两行几何 + 计算光晕是否压到上一行
const snap = () => frame.locator('body').evaluate((b) => {
  const d = b.ownerDocument, win = d.defaultView;
  const marked = [...d.querySelectorAll('[data-ws2-selected],[data-ws2-editing],[data-ws2-rangesel]')].map((e) => ({
    tag: e.tagName,
    id: e.id || null,
    attrs: [...e.attributes].map((a) => a.name).filter((n) => n.startsWith('data-ws2')),
    shadow: win.getComputedStyle(e).boxShadow,
    bg: win.getComputedStyle(e).backgroundColor,
  }));
  const lis = [...d.querySelectorAll('#lst > li')].map((l) => {
    const r = l.getBoundingClientRect();
    return { text: l.textContent.trim(), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1), sel: l.hasAttribute('data-ws2-selected') };
  });
  const gap = lis.length >= 2 ? +(lis[1].top - lis[0].bottom).toFixed(2) : null;
  return { marked, lis, gap, ulCount: d.querySelectorAll('ul').length, html: (d.querySelector('#lst') || {}).outerHTML };
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; }
});

test('P1 用户原路径：一行 todo → 回车 → 打字 → Esc', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li></ul>');

  // 点进第一行末尾
  await frame.locator('#lst > li').first().click();
  await page.waitForTimeout(150);
  await frame.locator('#lst > li').first().evaluate((l) => {
    const d = l.ownerDocument, r = d.createRange(); r.selectNodeContents(l); r.collapse(false);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });

  console.log('=== A 编辑第一行时（打字前）:', JSON.stringify(await snap(), null, 1));

  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.type('第二行');
  await page.waitForTimeout(250);

  const afterType = await snap();
  console.log('=== B 回车+打字后（编辑第二行中）:', JSON.stringify(afterType, null, 1));
  await page.screenshot({ path: 'probe-B-editing-row2.png' });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const afterEsc = await snap();
  console.log('=== C 按 Esc 后（行选中）:', JSON.stringify(afterEsc, null, 1));
  await page.screenshot({ path: 'probe-C-esc-row2.png' });

  // 关键推算：光晕 spread vs 行间距
  const gap = afterEsc.gap;
  console.log(`=== 判定：行间距 gap=${gap}px；[data-ws2-selected] 外圈 spread=6px、内圈 2px`);
  console.log(`=== 外圈是否压进上一行 border box: ${6 > gap ? '是，压进 ' + (6 - gap).toFixed(2) + 'px' : '否'}`);
  console.log(`=== 行间空白是否被灰晕填满: ${6 >= gap ? '是（整条 ' + gap + 'px 缝全被染）' : '否'}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  console.log('=== D 再按一次 Esc（应升到整张列表）:', JSON.stringify(await snap(), null, 1));
  await page.screenshot({ path: 'probe-D-esc-whole-list.png' });
});

test('P2 对照：两行是独立的两张 ul 时，同样按 Esc 选第二行', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li></ul><ul id="lst2" class="ws-todo"><li>第二行</li></ul>');
  await frame.locator('#lst2 > li').first().click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const s = await frame.locator('body').evaluate((b) => {
    const d = b.ownerDocument, win = d.defaultView;
    const a = d.querySelector('#lst > li').getBoundingClientRect();
    const c = d.querySelector('#lst2 > li').getBoundingClientRect();
    return {
      gapBetweenUls: +(c.top - a.bottom).toFixed(2),
      marked: [...d.querySelectorAll('[data-ws2-selected]')].map((e) => ({ tag: e.tagName, id: e.id || null, shadow: win.getComputedStyle(e).boxShadow })),
    };
  });
  console.log('=== P2 两张独立 ul:', JSON.stringify(s, null, 1));
  console.log(`=== 两张 ul 之间的间距 ${s.gapBetweenUls}px vs 同一 ul 内 li 间距（P1 里量到的）`);
  await page.screenshot({ path: 'probe-P2-two-uls.png' });
});

test('P3 ⋮⋮ 手柄路径：悬停第二行点手柄选中', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li></ul>');
  const li2 = frame.locator('#lst > li').nth(1);
  await li2.hover();
  await page.waitForTimeout(300);
  const gripInfo = await page.evaluate(() => {
    const g = document.querySelector('#ws2-grip, .ws2-grip, [data-ws2-grip]');
    return g ? { found: true, rect: g.getBoundingClientRect().toJSON(), cls: g.className } : { found: false };
  });
  console.log('=== P3 手柄:', JSON.stringify(gripInfo));
  console.log('=== P3 悬停第二行时:', JSON.stringify(await snap(), null, 1));
  await page.screenshot({ path: 'probe-P3-hover-row2.png' });
});
