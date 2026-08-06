// 带子项的父行：编辑态底色只罩它自己那一行，不罩整棵子树（对抗审查 ADV-2）。
// <li> 的边框盒天然包含嵌套子列表，所以「底色画在 li 上」在父行上会把子行一起罩住——
// 实测 93.6px，正是 Wendi 最初报的那个「连成一片」的数字。修法：给带子项的行把底色高度钳到 1lh。
//
// ⚠ 断言必须是**像素级**：底色 alpha 只有 .015（白底 255→251），读 computed background-size 是纯
// 级联值——本轮实证过一次：一条 CSS 注释里的字面注释结束符把整条规则吞掉了，而 matches() 照样 true。
//
// ⚠ 取样用**差分**：同一条竖带在「未聚焦」与「聚焦」两态各截一次，比同一批像素的前后差。
// 这样不依赖「取样带必须空白」这种脆前提——文字在两态里一模一样，差出来的只可能是底色。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2ptint-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  // 外观默认 'system' —— 深色主题的开发机上文档会被暗色滤镜处理，像素断言整个失去意义
  // （第一版实测栽在这）。钉环境不是改弱断言；CI runner 本就浅色，这步在 CI 上是 no-op（范式抄 align.spec.js）。
  await page.evaluate(() => window.ws2 && window.ws2.setAppearance && window.ws2.setAppearance('light'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== 'dark', null, { timeout: 4000 });
  await page.waitForTimeout(150);
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

// PNG（8-bit、非隔行、colorType 2/6）→ 每一行的平均亮度。解码范式抄 appearance.spec.js。
function rowMeans(buf) {
  let p = 8, width, height, colorType, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
  const stride = width * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)], row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const rv = raw[row + x];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[(y - 1) * stride + x - ch] : 0;
      let v;
      if (ft === 0) v = rv; else if (ft === 1) v = rv + a; else if (ft === 2) v = rv + b;
      else if (ft === 3) v = rv + ((a + b) >> 1); else v = rv + paeth(a, b, c);
      out[y * stride + x] = v & 255;
    }
  }
  const means = [];
  for (let y = 0; y < height; y++) {
    let s = 0;
    for (let x = 0; x < width; x++) { const i = y * stride + x * ch; s += (out[i] + out[i + 1] + out[i + 2]) / 3; }
    means.push(s / width);
  }
  return means;
}
// 固定裁剪框（两态必须逐像素同框，否则差分无意义）
async function clipOf(sel) {
  const b = await frame.locator(sel).boundingBox();
  return { x: Math.round(b.x + b.width - 170), y: Math.round(b.y), width: 130, height: Math.round(b.height) };
}
const shoot = async (clip) => rowMeans(await page.screenshot({ clip }));
const band = (m, a, b) => m.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; frame = null; }
});

test('PT-1 编辑带子项的父行：只有它自己那一行变暗，子行区域一像素不动（差分像素）', async () => {
  await launch();
  await openDoc('<p id="pp">上面的段落</p><ul id="lst" class="ws-todo"><li id="p1">父行<ul class="ws-todo"><li>子一</li><li>子二</li></ul></li></ul>');
  const clip = await clipOf('#p1');
  expect(clip.height, '前提：父行的边框盒确实包含整棵子树（修前底色就是按这个高度画的）').toBeGreaterThan(60);

  await frame.locator('#pp').click(); // 焦点在别处 = 基线
  await page.waitForTimeout(250);
  const base = await shoot(clip);

  await frame.locator('#p1').click({ position: { x: 40, y: 6 } }); // 点父行自己那一行
  await page.waitForTimeout(300);
  expect(await frame.locator('#p1').getAttribute('data-ws2-editrow'), '父行拿到行标记').not.toBeNull();
  const lit = await shoot(clip);

  const dTop = band(base, 2, 20) - band(lit, 2, 20);
  const dBot = band(base, clip.height - 20, clip.height - 2) - band(lit, clip.height - 20, clip.height - 2);
  console.log(`=== PT-1 父行那一行变暗 ${dTop.toFixed(2)}；子行区域变化 ${dBot.toFixed(2)}`);
  expect(dTop, '父行自己那一行必须真的被染暗').toBeGreaterThan(2);
  expect(Math.abs(dBot), '子行区域必须一点没变（不被父行的底色罩住）').toBeLessThan(0.5);
});

test('PT-2 叶子行不回归：多行叶子条目整盒仍全染（首末两行都要变暗）', async () => {
  await launch();
  await openDoc('<p id="pp">上面的段落</p><ul id="lst" class="ws-todo"><li id="leaf">第一行文字<br>第二行文字</li></ul>');
  const clip = await clipOf('#leaf');
  expect(clip.height, '前提：这条确实占两行').toBeGreaterThan(40);

  await frame.locator('#pp').click();
  await page.waitForTimeout(250);
  const base = await shoot(clip);

  await frame.locator('#leaf').click();
  await page.waitForTimeout(300);
  const lit = await shoot(clip);

  const dTop = band(base, 2, 16) - band(lit, 2, 16);
  const dBot = band(base, clip.height - 16, clip.height - 2) - band(lit, clip.height - 16, clip.height - 2);
  console.log(`=== PT-2 首行变暗 ${dTop.toFixed(2)}；末行变暗 ${dBot.toFixed(2)}`);
  expect(dTop, '首行被染').toBeGreaterThan(2);
  expect(dBot, '末行同样被染 —— 叶子行绝不能只染第一行（把 1lh 钳制误用到叶子行会在这里翻红）').toBeGreaterThan(2);
});
