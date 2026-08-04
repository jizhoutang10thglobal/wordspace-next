// 「排版过的文件」维度的门（2026-08-05 新建）。
//
// 立论：Wordspace 是 HTML-native 编辑器 —— 「拿一个别处来的 .html 直接打开」是产品前提。
// 而磁盘上的 HTML 几乎必然排过版（标签之间有换行和缩进），编辑器自己吐出来的却是紧凑格式。
// 代码里的结构判据大多是照着紧凑格式写的，于是同一篇文档、同一串操作，两种写法结果不同。
// 现有 690 条 e2e 的样本**全是我们自己写的紧凑单行字符串**，这个维度此前一条门都没有。
//
// 判定方式不需要预先知道「正确答案」：同一篇文档的紧凑版与排版版跑同一串操作，产出必须一致。
// 已抓到的真 bug：
//   ① isCaretAtStart 严格相等 → 带缩进的块行首退格全是死键（2026-08-04 修，见 callout-backspace-merge）
//   ② 占位 <br> 判据写成 childNodes.length===1 → 并入空块后多留一行空行（本文件 P-2）
//
// ⚠ app 在文档改脏之后 open-file 不换文档（实测等 15s 也不换）——每份文档必须重启实例，别死等。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  if (!tmpDir) tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2pretty-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
}
async function closeApp() {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null; page = null; frame = null;
}
const HEAD = '<style id="ws-callout-style" data-ws-schema-css="callout">.ws-callout{background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px;margin:14px 0}</style>'
  + '<style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style>';
async function openDoc(body) {
  const tag = 'run' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title>${HEAD}</head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc' + seq + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  // 等到**这一份**文档真的换进来（按 title 认人），别用死等 —— 会读到上一份的残留
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(300);
}
// 排版版：模拟人手排版 / 格式化工具的输出
const prettify = (s) => s
  .replace(/></g, '>\n<')
  .replace(/<(div class="ws-callout"|ul|ol|blockquote|details)([^>]*)>/g, '<$1$2>\n  ')
  .replace(/<\/(p|li|summary)>/g, '</$1>\n  ');

// 比较口径：剥掉交互态标记，但**保留 <br>**（多一个 <br> 正是要抓的 bug），只归一化标签之间的空白
const readState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const norm = (h) => (h || '').replace(/\s*\n\s*/g, '').replace(/>\s+</g, '><').trim();
  return {
    body: norm(d.body.innerHTML.replace(/ ?data-ws2-[a-z]+(="[^"]*")?/g, '').replace(/ ?contenteditable="[^"]*"/g, '')),
    text: (d.body.textContent || '').replace(/\s+/g, ''),
  };
});
async function caretStart(sel) { await frame.locator(sel).click(); await page.waitForTimeout(160); await page.keyboard.press('Home'); await page.waitForTimeout(60); }
async function caretEnd(sel) { await frame.locator(sel).click(); await page.waitForTimeout(160); await page.keyboard.press('End'); await page.waitForTimeout(60); }
const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(280); };

// 跑一遍「紧凑版」与「排版版」，返回两侧产出
async function parity(body, run) {
  await closeApp(); await launch();
  await openDoc(body);
  const b0 = await readState();
  await run();
  const compact = await readState();
  await closeApp(); await launch();
  await openDoc(prettify(body));
  await run();
  const pretty = await readState();
  return { b0, compact, pretty };
}

test.afterEach(async () => { await closeApp(); });

test('P-1 段落行首退格并入上一块：两种写法产出一致（此前排版版是死键）', async () => {
  test.setTimeout(120000);
  const r = await parity('<p id="a">上一块</p><p id="b">这一块</p>', async () => { await caretStart('#b'); await key('Backspace'); });
  expect(r.compact.body).not.toBe(r.b0.body); // 前置：紧凑版真的做了事，否则下面的相等是两个死键相等
  expect(r.pretty.body).toBe(r.compact.body);
});

test('P-2 并入空目标块：排版版不许多留一个占位 <br>', async () => {
  test.setTimeout(120000);
  const r = await parity('<p id="a"><br></p><p id="b">这一块</p>', async () => { await caretStart('#b'); await key('Backspace'); });
  expect(r.compact.body).toContain('这一块');
  expect(r.compact.body).not.toContain('<br>'); // 紧凑版本来就对
  expect(r.pretty.body).toBe(r.compact.body);  // 修前：排版版是 <p><br>这一块</p>
});

test('P-3 列表行首退格剥离：两种写法产出一致', async () => {
  test.setTimeout(120000);
  const r = await parity('<p id="a">上一块</p><ul id="L"><li id="r1">一</li><li id="r2">二</li></ul>',
    async () => { await caretStart('#r1'); await key('Backspace'); });
  expect(r.compact.body).not.toBe(r.b0.body);
  expect(r.pretty.body).toBe(r.compact.body);
});

test('P-4 块末 Delete 前向合并：两种写法产出一致', async () => {
  test.setTimeout(120000);
  const r = await parity('<p id="a">上一块</p><p id="b">这一块</p>', async () => { await caretEnd('#a'); await key('Delete'); });
  expect(r.compact.body).not.toBe(r.b0.body);
  expect(r.pretty.body).toBe(r.compact.body);
});

test('P-5 提示框首行退格：两种写法产出一致', async () => {
  test.setTimeout(120000);
  const r = await parity('<p id="a">上一块</p><div class="ws-callout" id="C"><p id="c1">框甲</p><p id="c2">框乙</p></div>',
    async () => { await caretStart('#c1'); await key('Backspace'); });
  expect(r.compact.text).toBe('上一块框甲框乙');
  expect(r.pretty.body).toBe(r.compact.body);
});
