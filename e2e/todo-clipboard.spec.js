// 复制/剪切部分待办项误走行内模式携带裸 <li>：粘进段落成 <p>…<li> 非法嵌套、整篇降级、勾选语义丢失（clip-1）。
// 修法：copy 侧跨 li 选区走块级打包（保留待办类型 + data-checked）；paste 侧单列表并入同类列表不劈 ul；
// insertInlineAtCaret 入口块级守卫。真键盘 copy→paste 走系统剪贴板。CI 用 xvfb 真启动 Electron。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2clip-'));
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
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);
// 在指定 ul 内设跨 li 文本选区（liA 起点 → liB 终点）。
async function selectAcrossLis(ulSel, ai, bi) {
  await frame.locator(ulSel).evaluate((ul, [a, b]) => {
    const d = ul.ownerDocument;
    const kids = [...ul.children].filter((c) => c.tagName === 'LI');
    const r = d.createRange();
    r.setStart(kids[a].firstChild, 0);
    r.setEnd(kids[b].firstChild, kids[b].firstChild.textContent.length);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  }, [ai, bi]);
}
const pInnerHasLi = () => frame.locator('body').evaluate(() => [...document.querySelectorAll('p')].some((p) => p.querySelector('li')));

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('部分待办项复制→粘进段落：产合规 ws-todo 块、无 <p><li> 非法嵌套、保勾选（clip-1）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>甲</li><li data-checked="true">乙</li><li>丙</li></ul><p id="p9">段落</p>');
  await frame.locator('#lst > li').first().click();
  await page.waitForTimeout(80);
  await selectAcrossLis('#lst', 0, 1); // 选 li1 起 → li2 末（2 整项，非全列表）
  await page.keyboard.press('ControlOrMeta+c');
  await page.waitForTimeout(120);
  await frame.locator('#p9').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => frame.locator('ul.ws-todo').count(), { message: '应新增一个 ws-todo 列表块（原 1 + 粘贴 1）' }).toBe(2);
  expect(await pInnerHasLi(), '任何 <p> 内都不许出现 <li>（非法嵌套）').toBe(false);
  // 粘贴出的列表含 2 项、第二项保留勾选态
  const checkedCount = await frame.locator('ul.ws-todo > li[data-checked="true"]').count();
  expect(checkedCount, '原列表 li2 + 粘贴列表 li2 各一个 checked').toBe(2);
  expect(await conformOf(await serialize())).toBe(true);
});

// clip-1 只管剪贴板产物；Cmd+X 的删除侧走原生 execCommand('delete')（计划 U3「删除侧行为不动」，
// 残留由既有删除路径决定、不属本单元），故这里只断言剪贴板产物合规 + 整篇仍 conform、不产生 <p><li>。
test('剪切部分待办项：剪贴板产物合规、粘进段落不产生 <p><li>', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>甲</li><li>乙</li><li>丙</li></ul><p id="p9">段落</p>');
  await frame.locator('#lst > li').first().click();
  await page.waitForTimeout(80);
  await selectAcrossLis('#lst', 0, 1);
  await page.keyboard.press('ControlOrMeta+x');
  await page.waitForTimeout(150);
  expect(await conformOf(await serialize()), '剪切后整篇仍合规（无非合规死残留）').toBe(true);
  await frame.locator('#p9').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => frame.locator('ul.ws-todo').count(), { message: '源列表 + 粘贴出的列表 = 2 个 ws-todo 块' }).toBe(2);
  expect(await pInnerHasLi(), '粘贴产物不许 <p><li> 非法嵌套').toBe(false);
  expect(await conformOf(await serialize())).toBe(true);
});

test('部分待办项粘进另一个 todo 列表中部：项并入、仍单个 ul、保勾选（最高频路径）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>甲</li><li data-checked="true">乙</li><li>丙</li></ul>');
  await frame.locator('#lst > li').first().click();
  await page.waitForTimeout(80);
  await selectAcrossLis('#lst', 0, 1); // 复制 甲 + 乙(checked)
  await page.keyboard.press('ControlOrMeta+c');
  await page.waitForTimeout(120);
  // 光标进末项（丙）末尾，粘贴 → 逐项并入当前列表
  await frame.locator('#lst > li').nth(2).click();
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => frame.locator('#lst > li').count(), { message: '并入后共 5 项' }).toBe(5);
  expect(await frame.locator('ul.ws-todo').count(), '绝不劈成多个 ul').toBe(1);
  expect(await frame.locator('#lst > li[data-checked="true"]').count(), '原 li2 + 粘贴的乙 各 checked').toBe(2);
  expect(await conformOf(await serialize())).toBe(true);
});

test('回归：单个 li 内选两字复制→粘进段落：仍走行内并入段落，不产生块/裸 li', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>甲乙丙丁</li></ul><p id="p9">段落</p>');
  await frame.locator('#lst > li').first().click();
  await page.waitForTimeout(80);
  await frame.locator('#lst > li').first().evaluate((li) => {
    const d = li.ownerDocument; const r = d.createRange();
    r.setStart(li.firstChild, 1); r.setEnd(li.firstChild, 3); // 选「乙丙」
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('ControlOrMeta+c');
  await page.waitForTimeout(120);
  await frame.locator('#p9').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => frame.locator('#p9').textContent(), { message: '行内文字并入段落' }).toBe('段落乙丙');
  expect(await frame.locator('ul.ws-todo').count(), '不产生新列表').toBe(1);
  expect(await pInnerHasLi(), '段落内不许出现 li').toBe(false);
  expect(await conformOf(await serialize())).toBe(true);
});

// 对抗审查发现：选区跨进嵌套子项时，closest('li') 取到最深 li 不在顶层 kids 里 → kids[-1].cloneNode 抛
// TypeError → onCopy 崩、复制静默回落原生 → 粘贴降级纯文本、待办格式全丢。修法：topLiOf 上卷到顶层 li。
test('跨嵌套子项复制不崩：块级打包正常、粘贴产合规 ws-todo 块（U3 补全）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="A">顶层A</li><li id="B">顶层B<ul><li id="b1">子b1</li></ul></li><li id="C">顶层C</li></ul><p id="p9">段落</p>');
  await frame.locator('#A').click();
  await page.waitForTimeout(80);
  // 从顶层 A 文字选到嵌套子项 b1 文字（跨进嵌套层）
  await frame.locator('#lst').evaluate((ul) => {
    const d = ul.ownerDocument;
    const a = d.getElementById('A'), b1 = d.getElementById('b1');
    const r = d.createRange();
    r.setStart(a.firstChild, 0); r.setEnd(b1.firstChild, b1.firstChild.textContent.length);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('ControlOrMeta+c');
  await page.waitForTimeout(120);
  await frame.locator('#p9').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+v');
  // 崩溃时 onCopy 回落原生 → 粘贴走纯文本、不产生新 ws-todo 块（count 仍 1）。块级打包成功则 count=2。
  await expect.poll(() => frame.locator('ul.ws-todo').count(), { message: '块级复制成功应产出粘贴的 ws-todo 块（崩溃回落原生则仍为 1）' }).toBe(2);
  expect(await pInnerHasLi(), '段落内不许出现裸 li').toBe(false);
  expect(await conformOf(await serialize())).toBe(true);
});

// 对抗审查发现（P3）：merge 不校验列表类型 → ws-todo 项并进普通 ul 会留下不渲染的死 data-checked。
// 修法：merge 限同类列表（tag + ws-todo 与否一致），跨类型改走块级插入自成一块。
test('跨类型粘贴不并入：ws-todo 项粘进普通 ul 不留死 data-checked（U3 补全）', async () => {
  await launch();
  await openDoc('<ul id="src" class="ws-todo"><li>甲</li><li data-checked="true">乙</li><li>丙</li></ul><ul id="plain"><li id="P1">普通1</li><li>普通2</li></ul>');
  await frame.locator('#src > li').first().click();
  await page.waitForTimeout(80);
  await selectAcrossLis('#src', 0, 1); // 复制 甲 + 乙(checked)
  await page.keyboard.press('ControlOrMeta+c');
  await page.waitForTimeout(120);
  await frame.locator('#P1').click(); // 进普通 ul（非 todo）
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(200);
  // 普通（非 ws-todo）列表里绝不出现 data-checked 死属性；ws-todo 项自成一块保住勾选语义
  const deadChecked = await frame.locator('ul:not(.ws-todo) > li[data-checked]').count();
  expect(deadChecked, '普通列表里不许留下不渲染的死 data-checked').toBe(0);
  expect(await frame.locator('ul.ws-todo').count(), 'ws-todo 项应自成一块（源 + 粘贴）').toBe(2);
  expect(await conformOf(await serialize())).toBe(true);
});

test('U21：带 id 的块复制粘贴到同文档 → 第二份剥 id、无重复 id、原块 id 不动（clip-4）', async () => {
  await launch();
  await openDoc('<p id="a1">复制我</p><p id="p9">目标</p>');
  await frame.locator('#a1').click();
  await frame.locator('#a1').selectText();
  await page.keyboard.press('ControlOrMeta+c');
  await page.waitForTimeout(120);
  await frame.locator('#p9').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(200);
  await expect.poll(() => frame.locator('p').count(), { message: '粘出一个新段落（原 2 + 粘贴 1）' }).toBe(3);
  const idCount = await frame.locator('body').evaluate(() => document.querySelectorAll('[id="a1"]').length);
  expect(idCount, '同 id 只此一份（原块），粘贴份已剥 id').toBe(1);
  expect(await frame.locator('#a1').textContent(), '原块内容不动').toBe('复制我');
  const dup = await frame.locator('body').evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map((e) => e.id).filter(Boolean); return ids.length !== new Set(ids).size; });
  expect(dup, '全文无重复 id').toBe(false);
  expect(await conformOf(await serialize())).toBe(true);
});

// U22/clip-5：外部纯文本（无本编辑器哨兵）——用 electron clipboard.writeText 模拟真外部粘贴。
async function setClipboardText(t) { await app.evaluate(({ clipboard }, txt) => clipboard.writeText(txt), t); }

test('U22：外部纯文本「- [ ] 」多行粘进空段落 → 3 项 todo、[x] 勾选、conform（clip-5）', async () => {
  await launch();
  await openDoc('<p id="p1">目标</p>');
  await frame.locator('#p1').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  await setClipboardText('- [ ] 甲\n- [x] 乙\n- [ ] 丙');
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(200);
  await expect.poll(() => frame.locator('ul.ws-todo > li').count(), { message: '3 项 todo' }).toBe(3);
  expect(await frame.locator('ul.ws-todo > li').allTextContents()).toEqual(['甲', '乙', '丙']);
  const checked = await frame.locator('ul.ws-todo > li').evaluateAll((lis) => lis.map((li) => li.getAttribute('data-checked')));
  expect(checked, '仅第二项勾选').toEqual([null, 'true', null]);
  expect(await conformOf(await serialize())).toBe(true);
});

test('U22 负例：混合文本（某行无 marker）→ 不转 todo、维持字面', async () => {
  await launch();
  await openDoc('<p id="p1">目标</p>');
  await frame.locator('#p1').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  await setClipboardText('- [ ] 甲\n普通一行\n- [ ] 丙');
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(200);
  expect(await frame.locator('ul.ws-todo').count(), '任一行不匹配 → 不转 todo').toBe(0);
  expect((await frame.locator('body').textContent()).includes('- [ ] 甲'), 'marker 字面保留').toBe(true);
});

test('U22：粘进已有 todo 列表 → 追加 3 项、勾选按 marker（clip-5）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>原项</li></ul>');
  await frame.locator('#lst > li').first().click(); await page.keyboard.press('End');
  await page.waitForTimeout(100);
  await setClipboardText('- [ ] 甲\n- [x] 乙\n- [ ] 丙');
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(200);
  await expect.poll(() => frame.locator('#lst > li').count(), { message: '原 1 + 追加 3 = 4' }).toBe(4);
  const checked = await frame.locator('#lst > li').evaluateAll((lis) => lis.map((li) => li.getAttribute('data-checked')));
  expect(checked, '追加项按 marker 勾选').toEqual([null, null, 'true', null]);
  expect(await frame.locator('ul.ws-todo').count(), '仍是单个 ul（不劈）').toBe(1);
  expect(await conformOf(await serialize())).toBe(true);
});

test('U22 对抗审查：粘进只含一个空项的新 todo 列表 → 空项被填、不留空 checkbox 行（clip-5）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="e1"><br></li></ul>'); // 刚建的 todo：一个空项，光标在其内
  await frame.locator('#e1').click();
  await setClipboardText('- [ ] 甲\n- [x] 乙\n- [ ] 丙');
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(200);
  await expect.poll(() => frame.locator('#lst > li').count(), { message: '空项被首个 item 填入、不留空行（3 项非 4 项）' }).toBe(3);
  expect(await frame.locator('#lst > li').allTextContents()).toEqual(['甲', '乙', '丙']);
  const checked = await frame.locator('#lst > li').evaluateAll((lis) => lis.map((li) => li.getAttribute('data-checked')));
  expect(checked).toEqual([null, 'true', null]);
  expect(await conformOf(await serialize())).toBe(true);
});
