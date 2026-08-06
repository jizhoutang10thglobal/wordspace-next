// PR-5（Notion parity 第三批）：表格矩形选区 + 边界钳制 + 边缘加行/加列条。
// Notion 对照（2026-08-06 复拍原始读数，报告 notion-t/*.png）：
//  N1 跨格拖选=anchor 格与指针格的行列包围盒，独立描边、格不填底（f1-during-drag）
//  N2 松手保持（f1-after-release）；N3 Delete 清内容不动结构（9 格恒 9 格，AFTER-DELETE 读数）
//  N4 非聚焦格内拖动=1×1 格矩形而非文字选择（f2/f2b）
//  N5 出向拖出表界=夹回表内矩形，上下对称（f3/f3b）；N6 入向选区夹在段落里、表绝不被部分圈选（f4c 修正读数）
//  T2 贴近下缘/右缘出全宽/全高加条，点一下真加（t2b：rows 3→4 / cols 3→4）
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, cdp, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2rect-')); // 独立 userData（共享撞 SingletonLock）
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
  cdp = await page.context().newCDPSession(page); // 按住拖动只能走裸 CDP——Playwright mouse.down+move 在 Electron 进 drag loop 卡死（memory 铁律的选区变体）
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

const T33 = '<p id="a">表格上方的一个段落。</p><table id="T"><tbody>'
  + '<tr id="r1"><td id="c11">一甲</td><td id="c12">一乙</td><td id="c13">一丙</td></tr>'
  + '<tr id="r2"><td id="c21">二甲</td><td id="c22">二乙</td><td id="c23">二丙</td></tr>'
  + '<tr id="r3"><td id="c31">三甲</td><td id="c32">三乙</td><td id="c33">三丙</td></tr>'
  + '</tbody></table><p id="z">表格下方的一个段落。</p>';

const center = async (sel) => { const b = await frame.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
// 步进拖拽（裸 CDP 真输入管线；矩形机的 4px 阈值靠中间步越过）
async function drag(from, to) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  // ⚠ mousePressed 必须带 buttons:1、mouseMoved 必须带 button:'left'——缺任一 Chromium 的文字
  // 选择控制器不启动（实测：只带 buttons 的 move 能喂我们自己的矩形机，却永远选不出原生文字）。
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, button: 'left', buttons: 1 });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 1, clickCount: 1 });
  await page.waitForTimeout(120);
}
const cellselIds = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelectorAll('[data-ws2-cellsel]')].map((c) => c.id).sort();
});
const rectBoxInfo = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const b = d.querySelector('.ws-rectsel');
  if (!b || b.style.display === 'none') return null;
  const r = b.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const nativeSelText = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const s = d.getSelection();
  return s && s.rangeCount ? s.toString() : '';
});

test('R1/R2: 跨格拖选=矩形包围盒描边，松手保持，格不走 rangesel 蓝底', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  expect(await cellselIds()).toEqual(['c21', 'c22', 'c31', 'c32']); // 2×2 包围盒，丙列在外
  const box = await rectBoxInfo();
  expect(box).not.toBeNull(); // 描边浮件在（N2 松手保持）
  const u = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const a = d.getElementById('c21').getBoundingClientRect(), b = d.getElementById('c32').getBoundingClientRect();
    return { x: a.x, y: a.y, w: b.right - a.x, h: b.bottom - a.y };
  });
  expect(Math.abs(box.x - u.x)).toBeLessThan(4); // 描边贴合矩形并集（±每边 1px 外扩）
  expect(Math.abs(box.w - u.w)).toBeLessThan(6);
  expect(Math.abs(box.h - u.h)).toBeLessThan(6);
  const border = await page.evaluate(() => {
    const b = document.getElementById('doc-frame').contentDocument.querySelector('.ws-rectsel');
    const cs = getComputedStyle(b);
    return { w: parseFloat(cs.borderTopWidth), c: cs.borderTopColor };
  });
  expect(border.w).toBeGreaterThan(1); // ADV-R7：描边必须真画出来——.ws-rectsel 的 CSS 规则被删/失效时这里翻红（S4 判据）
  expect(border.c).not.toBe('rgba(0, 0, 0, 0)');
  expect(await nativeSelText()).toBe(''); // 原生选区不参与（描边是唯一高亮，格不填 rangesel 蓝底）
  expect(await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return d.querySelectorAll('#T [data-ws2-rangesel]').length + (d.getElementById('T').hasAttribute('data-ws2-rangesel') ? 1 : 0);
  })).toBe(0);
});

test('R3: Delete 清矩形内容不动结构，一步 undo 回来', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#T td')].map((c) => (c.textContent || '').trim());
  })).toEqual(['一甲', '一乙', '一丙', '', '', '二丙', '', '', '三丙']); // 只空矩形内 4 格
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('#T td').length)).toBe(9); // 结构不动（N3）
  expect(await cellselIds()).toEqual(['c21', 'c22', 'c31', 'c32']); // 选中态保持（Notion 同款）
  // undo 走菜单 IPC 路径（keyboard Meta+z 不触发菜单加速器 = 假 FAIL，memory 铁律；姿势照 C-undo）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'undo'));
  await page.waitForTimeout(300);
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#T td')].map((c) => (c.textContent || '').trim()).join('|');
  })).toBe('一甲|一乙|一丙|二甲|二乙|二丙|三甲|三乙|三丙'); // 单 checkpoint 一步全回
});

test('R4: 非聚焦格内拖动 = 1×1 格矩形，不是文字选择', async () => {
  await launch();
  await openDoc(T33);
  const c = await center('#c11');
  await drag({ x: c.x - 20, y: c.y }, { x: c.x + 25, y: c.y }); // 格内横拖扫过文字
  expect(await cellselIds()).toEqual(['c11']); // N4：1×1 矩形
  expect(await nativeSelText()).toBe(''); // 没有文字选区
});

test('R5/R5b: 出向拖出表界（下/上）夹回表内矩形，外面块不沾', async () => {
  await launch();
  await openDoc(T33);
  const c12 = await center('#c12'), z = await center('#z');
  await drag(c12, { x: c12.x, y: z.y }); // 从一乙垂直拖进下方段落（x 钉在乙列，对齐 Notion F3 探针几何）
  expect(await cellselIds()).toEqual(['c12', 'c22', 'c32']); // 乙列 1→3 行（N5 夹底）
  expect(await page.evaluate(() => !document.getElementById('doc-frame').contentDocument.getElementById('z').hasAttribute('data-ws2-rangesel'))).toBe(true);
  await page.mouse.click(60, 60); // 清态
  await page.waitForTimeout(150);
  const c33 = await center('#c33'), a = await center('#a');
  await drag(c33, { x: c33.x, y: a.y }); // 从三丙垂直拖进上方段落
  expect(await cellselIds()).toEqual(['c13', 'c23', 'c33']); // 丙列 3→1 行（N5b 夹顶，对称）
});

test('R6: 入向拖选被表界截断——表格绝不被部分圈选', async () => {
  await launch();
  await openDoc(T33);
  const a = await center('#a');
  await drag({ x: a.x - 80, y: a.y }, await center('#c22')); // 从段落文字拖进表内
  expect(await cellselIds()).toEqual([]); // 表内零格标记
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const T = d.getElementById('T');
    const s = d.getSelection();
    const endInTable = s && s.rangeCount ? T.contains(s.getRangeAt(0).endContainer) : false;
    return { endInTable, tableMarked: T.hasAttribute('data-ws2-rangesel'), cellMarks: d.querySelectorAll('#T [data-ws2-rangesel]').length };
  });
  expect(st.endInTable).toBe(false); // 原生选区端点被钳在表外、段落侧文字选择保留（Notion f4c 修正读数同款：夹在段落里）
  expect(st.tableMarked).toBe(false); // 旧「端点在表内=整表蓝」通道已退役
  expect(st.cellMarks).toBe(0);
});

test('R7: 表格被完整罩住（贯穿拖选）仍整块标记——ED-A2 整删语义保留', async () => {
  await launch();
  await openDoc(T33);
  const a = await center('#a'), z = await center('#z');
  await drag({ x: a.x - 80, y: a.y }, { x: z.x + 80, y: z.y }); // 上段中部 → 下段中部，贯穿全表
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.getElementById('T').hasAttribute('data-ws2-rangesel'))).toBe(true);
});

test('R8/R9: Esc 上卷整表灰选；点表外解除矩形', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { sel: d.getElementById('T').hasAttribute('data-ws2-selected'), cells: d.querySelectorAll('[data-ws2-cellsel]').length };
  })).toEqual({ sel: true, cells: 0 }); // 矩形 → 整表灰选（与 cell-Esc 同档）
  await page.mouse.click(60, 60);
  await page.waitForTimeout(150);
  await drag(await center('#c21'), await center('#c32'));
  expect((await cellselIds()).length).toBe(4);
  await (await center('#a'), page.mouse.click((await center('#a')).x, (await center('#a')).y));
  await expect.poll(() => cellselIds()).toEqual([]); // 点表外 = 解除
});

test('E1/E2/E3: 下缘条加行、右缘条加列、离开即收', async () => {
  await launch();
  await openDoc(T33);
  const tb = await frame.locator('#T').boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); // 先进表再滑向下缘（真实轨迹）
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height + 8);
  const rowBar = frame.locator('.ws-tbladdrow');
  await expect(rowBar).toBeVisible();
  const rb = await rowBar.boundingBox();
  expect(Math.abs(rb.width - tb.width)).toBeLessThan(6); // 全宽（Notion t2b：条宽=表宽）
  await rowBar.click();
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('#T tr').length)).toBe(4);
  expect(await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const rows = d.querySelectorAll('#T tr');
    return rows[3].querySelectorAll('td').length;
  })).toBe(3); // 新行列数守恒
  // 右缘条加列
  const tb2 = await frame.locator('#T').boundingBox();
  await page.mouse.move(tb2.x + tb2.width / 2, tb2.y + tb2.height / 2);
  await page.mouse.move(tb2.x + tb2.width + 8, tb2.y + tb2.height / 2);
  const colBar = frame.locator('.ws-tbladdcol');
  await expect(colBar).toBeVisible();
  const cb = await colBar.boundingBox();
  expect(Math.abs(cb.height - tb2.height)).toBeLessThan(6); // 全高
  await colBar.click();
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#T tr')].every((r) => r.children.length === 4);
  })).toBe(true);
  // 离开 → 收
  await page.mouse.move((await center('#a')).x, (await center('#a')).y);
  await expect(frame.locator('.ws-tbladdrow')).toBeHidden();
  await expect(frame.locator('.ws-tbladdcol')).toBeHidden();
});

test('R10: 编辑格内拖动仍是文字选择（先点进格），出格才升级矩形', async () => {
  await launch();
  await openDoc(T33);
  await frame.locator('#c11').click(); // 进 cell 编辑
  await page.waitForTimeout(200);
  const c = await center('#c11');
  await drag({ x: c.x - 20, y: c.y }, { x: c.x + 25, y: c.y }); // 编辑格内横拖
  expect(await nativeSelText()).toBe('一甲'); // 文字选择活着（Notion 聚焦格同款）
  expect(await cellselIds()).toEqual([]);
  await page.mouse.click(60, 60);
  await page.waitForTimeout(150);
  await frame.locator('#c11').click();
  await page.waitForTimeout(200);
  await drag(await center('#c11'), await center('#c22')); // 从编辑格拖出
  expect(await cellselIds()).toEqual(['c11', 'c12', 'c21', 'c22']); // 出格升级矩形（T14 出向不再跨块）
});

test('S1: 矩形态的格标记与浮件绝不入盘（WS2_MARKERS + 覆盖层剥除）', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  expect((await cellselIds()).length).toBe(4);
  const html = await page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
  expect(html).not.toContain('data-ws2-cellsel');
  expect(html).not.toContain('ws-rectsel');
  expect(html).not.toContain('ws-tbladdrow');
});

// ===== 对抗审查回归（2026-08-06 ADV-R1..R9，处置后钉死）=====

test('ADV-R1: 矩形态按 ⌘A → 矩形让位全篇选区，Backspace 删的是全篇不是格', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  expect((await cellselIds()).length).toBe(4);
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.getSelection();
    return { cells: d.querySelectorAll('[data-ws2-cellsel]').length, hasSel: !!(s && s.rangeCount && !s.isCollapsed) };
  });
  expect(st.cells).toBe(0); // ⌘A 清矩形态（selectWholeDoc 的 clearRectSel）
  expect(st.hasSel).toBe(true); // 全篇原生选区在
  await page.keyboard.press('Backspace');
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { tables: d.querySelectorAll('table').length, text: (d.body.textContent || '').trim() };
  })).toEqual({ tables: 0, text: '' }); // 全篇删干净——不是只清几个格（劫持 bug 的画像）
});

test('ADV-R2: 矩形态开轴菜单 → 矩形让位；Esc 一次关菜单', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  await frame.locator('#c22').hover();
  await page.waitForTimeout(300);
  await frame.locator('.ws-rowsel').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  expect(await cellselIds()).toEqual([]); // openAxisMenu 清矩形（单一活动态）
  await page.keyboard.press('Escape');
  await expect(frame.locator('.ws-blockmenu')).toBeHidden(); // 菜单正常关（无 rectSel 分支截胡）
});

test('ADV-R3: 矩形态直接打字 → 字落左上格，不蒸发', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  await page.keyboard.type('x');
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.getElementById('c21').textContent)).toBe('二甲x');
  expect(await cellselIds()).toEqual([]); // 矩形已清、进格编辑
});

test('ADV-R4: 矩形态 ⌘X → TSV 进剪贴板 + 格清空', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  await page.keyboard.press('Meta+x');
  await expect.poll(() => page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('#T td')].map((c) => (c.textContent || '').trim()).join('|');
  })).toBe('一甲|一乙|一丙|||二丙|||三丙'); // 矩形 4 格清空
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(clip).toBe('二甲\t二乙\n三甲\t三乙'); // TSV：tab 分格、换行分行（onCopy ⓪ 分支全格式钉死）
});

test('ADV-R5: 矩形态开块菜单删表 → 无幽灵描边残留', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  await frame.locator('#c22').hover();
  await page.waitForTimeout(300);
  await frame.locator('.ws-grip').click(); // 块手柄 → 整表块菜单
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  expect(await cellselIds()).toEqual([]); // openBlockMenu 清矩形（含防「复制」克隆游离标记）
  await frame.locator('.ws-blockmenu-item', { hasText: '删除' }).click();
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('table').length)).toBe(0);
  expect(await rectBoxInfo()).toBeNull(); // 描边浮件没有悬浮在尸体位置（deselect 的 clearRectSel）
});

test('ADV-R6: 双表相邻——跨两表的选区被取消，B 表不被圈进', async () => {
  await launch();
  await openDoc('<p id="a">前文。</p><table id="TA"><tbody><tr><td id="a11">A一</td><td>A二</td></tr></tbody></table>'
    + '<table id="TB"><tbody><tr><td id="b11">B一</td><td>B二</td></tr></tbody></table><p id="z">后文。</p>');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const r = d.createRange();
    r.setStart(d.getElementById('a11').firstChild, 0);
    r.setEnd(d.getElementById('b11').firstChild, 1);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.getSelection();
    return {
      collapsed: !s || s.rangeCount === 0 || s.isCollapsed,
      aMarked: d.getElementById('TA').hasAttribute('data-ws2-rangesel'),
      bMarked: d.getElementById('TB').hasAttribute('data-ws2-rangesel'),
      cellMarks: d.querySelectorAll('[data-ws2-cellsel]').length,
    };
  });
  expect(st.collapsed).toBe(true); // 无合法钳法 → 选区取消
  expect(st.aMarked).toBe(false);
  expect(st.bMarked).toBe(false); // B 表没有因钳制锚点被整个圈进
  expect(st.cellMarks).toBe(0);
});

test('ADV-R9: 表被键盘整删后幽灵加行条点击 = 无害收场', async () => {
  await launch();
  await openDoc(T33);
  await frame.locator('#c11').click(); // 进 cell
  await page.waitForTimeout(150);
  const tb = await frame.locator('#T').boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height + 8); // 唤出加行条
  await expect(frame.locator('.ws-tbladdrow')).toBeVisible();
  await page.keyboard.press('Escape'); // 灰选整表
  await page.keyboard.press('Backspace'); // 整删（鼠标没动，条还挂着）
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('table').length)).toBe(0);
  const blocksBefore = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.body.querySelectorAll('p').length);
  await frame.locator('.ws-tbladdrow').click({ force: true }); // 点幽灵条
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { tables: d.querySelectorAll('table').length, blocks: d.body.querySelectorAll('p').length,
      barShown: (() => { const b = d.querySelector('.ws-tbladdrow'); return b && b.style.display !== 'none'; })() };
  });
  expect(st.tables).toBe(0); // 没对尸体表跑手术
  expect(st.blocks).toBe(blocksBefore); // 文档没被改
  expect(st.barShown).toBe(false); // 条自我收场
});
