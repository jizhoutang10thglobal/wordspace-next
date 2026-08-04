// toggle 维度对齐（对拍 T14/T17/T4）：标题行 Enter 新建首块 / 空 toggle 占位与淡三角 / 折叠热区口径。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2tg-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc-' + Date.now() + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(450);
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);
const bodyKidsOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelector(s).children].filter((c) => c.tagName !== 'SUMMARY').map((c) => c.tagName + ':' + (c.textContent || '').trim());
}, sel);

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('T14 标题行末尾 Enter：在体内新建空块并落光标（不跳到已有内容）', async () => {
  await launch();
  await openDoc('<details open id="D"><summary>标题</summary><p id="b1">已有的第一块</p><p id="b2">第二块</p></details>');
  await frame.locator('#D summary').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.type('新写的内容');
  await expect.poll(async () => (await bodyKidsOf('#D')).join('|'), { message: '新块插在最前、已有块原样后移' })
    .toBe('P:新写的内容|P:已有的第一块|P:第二块');
  expect(await conformOf(await serialize())).toBe(true);
});

test('T14 边界：首块本来就是空的 → 不再多插一个空块', async () => {
  await launch();
  await openDoc('<details open id="D"><summary>标题</summary><p id="b1"><br></p></details>');
  await frame.locator('#D summary').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.type('直接写');
  await expect.poll(async () => (await bodyKidsOf('#D')).join('|'), { message: '仍只有一个体内块' }).toBe('P:直接写');
});

// 【断言迁移，逐条论证 —— 2026-08-05，对拍 T18】
// 这条原来断的是「折叠态按 Enter → 自动展开（否则新块看不见）」。那是**旧行为**，已按 Notion 改掉：
// 折叠态标题末 Enter 不再往体内插块，而是新建一个平级空 toggle、原 toggle 保持收着。
// 旧断言（open === true）与新契约正面冲突，只能迁移，没有两全的写法。
//
// 但它守的**底层不变式没变、也不该丢**：按完 Enter，光标落脚的地方必须是**看得见**的
//（当初「自动展开」正是为了这个）。所以终态断言从「open 变 true」换成同义、且更贴近用户的一条：
// 光标所在元素真的可见（有非零布局盒 + 没有祖先 details 把它收起来）。
// 新契约的正向/负向覆盖在 toggle.spec.js 的 T18-1/2/3，这里只留这条不变式。
test('T14 折叠态按 Enter：光标落脚处必须看得见（原「自动展开」守的底层不变式）', async () => {
  await launch();
  await openDoc('<details id="D"><summary>折叠着的标题</summary><p id="b1">里面的内容</p></details>');
  await frame.locator('#D summary').click({ position: { x: 60, y: 8 } });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const e = d.querySelector('[data-ws2-editing]');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    // 祖先里若有收起的 <details>，这元素就是被藏着的（details 收起时体内不渲染；summary 例外，它总在）
    let hidden = false;
    for (let p = e.parentElement; p; p = p.parentElement) {
      if (p.tagName === 'DETAILS' && !p.open && e.tagName !== 'SUMMARY') hidden = true;
    }
    return { boxed: r.width > 0 && r.height > 0, hidden, srcStillClosed: !d.getElementById('D').open };
  });
  expect(st, '按完 Enter 应该有个正在编辑的元素').not.toBeNull();
  expect(st.boxed, '光标落脚处必须有真实布局盒（看得见）').toBe(true);
  expect(st.hidden, '光标不许落在被收起的 details 内部').toBe(false);
  expect(st.srcStillClosed, '新契约附带：原 toggle 不该被替用户展开（旧行为会把它掰开）').toBe(true);
});

test('T17 空 toggle：编辑器内显示占位提示、且不入盘', async () => {
  await launch();
  await openDoc('<details open id="D"><summary>空的折叠块</summary><p id="b1"></p></details><details open id="E"><summary>有内容</summary><p>正文</p></details>');
  const hint = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return {
      empty: getComputedStyle(d.querySelector('#D > p'), '::before').content,
      filled: getComputedStyle(d.querySelector('#E > p'), '::before').content,
    };
  });
  expect(hint.empty, '空 toggle 体内有占位文案').toContain('空折叠块');
  expect(hint.filled === 'none' || !hint.filled.includes('空折叠块'), '有内容的 toggle 不显示占位').toBe(true);
  const html = await serialize();
  expect(html.includes('空折叠块'), '占位是编辑器 chrome、绝不入盘').toBe(false);
  expect(await conformOf(html)).toBe(true);
});

test('T17 空 toggle 的三角比非空的淡（一眼看出里面没东西）', async () => {
  await launch();
  await openDoc('<details open id="D"><summary>空的</summary><p></p></details><details open id="E"><summary>有内容</summary><p>正文</p></details>');
  const c = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const lum = (s) => { const m = s.match(/\d+/g); return m ? (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) : -1; };
    return {
      empty: lum(getComputedStyle(d.querySelector('#D > summary'), '::before').borderRightColor),
      filled: lum(getComputedStyle(d.querySelector('#E > summary'), '::before').borderRightColor),
    };
  });
  expect(c.empty, '空态三角更淡（亮度更高）').toBeGreaterThan(c.filled);
});

test('T4 折叠热区：24px 内命中折叠、之外进标题编辑', async () => {
  await launch();
  await openDoc('<details open id="D"><summary id="S">可折叠标题</summary><p>内容</p></details>');
  const box = await page.locator('#doc-frame').boundingBox();
  const sr = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const r = d.getElementById('S').getBoundingClientRect();
    return { x: r.x, y: r.y, h: r.height };
  });
  // 热区内点击 → 折叠
  await page.mouse.click(box.x + sr.x + 12, box.y + sr.y + sr.h / 2);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.getElementById('D').open), '热区内点击 → 折叠').toBe(false);
  // 热区外点击 → 不折叠、进编辑
  await page.mouse.click(box.x + sr.x + 60, box.y + sr.y + sr.h / 2);
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { open: d.getElementById('D').open, editing: !!d.querySelector('summary[data-ws2-editing]') };
  });
  expect(st.open, '热区外点击不切换折叠态').toBe(false);
  expect(st.editing, '热区外点击进标题编辑').toBe(true);
});
