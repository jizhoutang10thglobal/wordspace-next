// 探针二（非门）：坐实「编辑态淡底铺满整张 ul」= Wendi 报的连成一片，并延伸扫同区域其他粒度漏洞。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2probe2-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
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
// 量「高亮到底罩住多高」——这是判定连成一片的强断言口径（几何，不查 class）
const hi = () => frame.locator('body').evaluate((b) => {
  const d = b.ownerDocument;
  const pick = (sel) => { const e = d.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { tag: e.tagName, id: e.id || null, h: +r.height.toFixed(1), top: +r.top.toFixed(1) }; };
  const rows = [...d.querySelectorAll('li')].map((l) => { const r = l.getBoundingClientRect(); return { t: l.textContent.trim().slice(0, 6), h: +r.height.toFixed(1) }; });
  return { editing: pick('[data-ws2-editing]'), selected: pick('[data-ws2-selected]'), rangesel: [...d.querySelectorAll('[data-ws2-rangesel]')].map((e) => e.tagName + (e.id ? '#' + e.id : '')), rows };
});
const clickRow = async (n) => { await frame.locator('#lst > li').nth(n).click(); await page.waitForTimeout(200); };

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; }
});

test('E1 编辑态高亮罩住多高：列表 vs 段落（对照）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li><li>第三行</li></ul><p id="pp">一个段落</p>');

  await clickRow(1);
  const listEdit = await hi();
  console.log('=== E1a 点进列表第 2 行:', JSON.stringify(listEdit));
  console.log(`>>> 编辑高亮 tag=${listEdit.editing.tag} 高=${listEdit.editing.h}px；单行高=${listEdit.rows[0].h}px；罩住行数≈${(listEdit.editing.h / listEdit.rows[0].h).toFixed(1)}`);

  await frame.locator('#pp').click();
  await page.waitForTimeout(200);
  const paraEdit = await hi();
  console.log('=== E1b 对照·点进段落:', JSON.stringify(paraEdit.editing));
  console.log(`>>> 段落：高亮 tag=${paraEdit.editing.tag} 高=${paraEdit.editing.h}px = 恰好它自己`);
});

test('E2 延伸·嵌套行：点进子项时 Esc 选中的是谁', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>父行<ul><li>子项甲</li><li>子项乙</li></ul></li></ul>');
  const sub = frame.locator('#lst li li').nth(1);
  await sub.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const s = await frame.locator('body').evaluate((b) => {
    const d = b.ownerDocument, e = d.querySelector('[data-ws2-selected]');
    return e ? { tag: e.tagName, text: e.textContent.trim().slice(0, 12), h: +e.getBoundingClientRect().height.toFixed(1) } : null;
  });
  console.log('=== E2 点子项乙 → Esc，选中的是:', JSON.stringify(s));
  console.log('>>> 期望「子项乙」（单行 28px）；若得到「父行+整棵子树」= closest(li) 爬错层');
  await page.screenshot({ path: 'probe-E2-nested.png' });
});

test('E3 延伸·⌘A 第二档后按 Esc（anchorNode 落在 ul 上）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li></ul>');
  await clickRow(1);
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(150);
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(150);
  console.log('=== E3a ⌘A×2 后:', JSON.stringify(await hi()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  console.log('=== E3b 再 Esc:', JSON.stringify(await hi()));
});

test('E4 延伸·只想选中间两行：拖选跨出列表会不会整张变蓝', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li><li>第三行</li><li>第四行</li></ul><p id="pp">后面的段落</p>');
  // 从第 2 行拖到第 3 行（列表内）
  const r2 = await frame.locator('#lst > li').nth(1).boundingBox();
  const r3 = await frame.locator('#lst > li').nth(2).boundingBox();
  await page.mouse.move(r2.x + 10, r2.y + r2.height / 2);
  await page.mouse.down();
  await page.mouse.move(r3.x + 60, r3.y + r3.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  console.log('=== E4a 列表内拖选 2→3 行:', JSON.stringify(await hi()));
  await page.screenshot({ path: 'probe-E4a-inlist.png' });

  // 从第 2 行拖到列表外的段落
  const pp = await frame.locator('#pp').boundingBox();
  await page.mouse.move(r2.x + 10, r2.y + r2.height / 2);
  await page.mouse.down();
  await page.mouse.move(pp.x + 40, pp.y + pp.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  console.log('=== E4b 从第 2 行拖到列表外段落:', JSON.stringify(await hi()));
  console.log('>>> 若 rangesel 含整个 UL = 只想带上 2/3/4 行，第 1 行也被算进去了');
  await page.screenshot({ path: 'probe-E4b-outlist.png' });
});

test('E5 延伸·勾选框在不在选中框里（行选 vs 整表选）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li></ul>');
  await clickRow(1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const rowSel = await frame.locator('body').evaluate((b) => {
    const d = b.ownerDocument, e = d.querySelector('[data-ws2-selected]');
    const li = d.querySelectorAll('#lst > li')[1];
    const cb = d.defaultView.getComputedStyle(li, '::before');
    return { selTag: e.tagName, selLeft: +e.getBoundingClientRect().left.toFixed(1), liLeft: +li.getBoundingClientRect().left.toFixed(1), cbLeft: cb.left };
  });
  console.log('=== E5a 行选中:', JSON.stringify(rowSel));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const ulSel = await frame.locator('body').evaluate((b) => {
    const d = b.ownerDocument, e = d.querySelector('[data-ws2-selected]');
    return { selTag: e.tagName, selLeft: +e.getBoundingClientRect().left.toFixed(1) };
  });
  console.log('=== E5b 整表选中:', JSON.stringify(ulSel));
  console.log('>>> 勾选框画在 li 左外 22px；两档选中框左缘若不一致 = 视觉跳动');
});
