// 行为×块型完备性矩阵门（E·U3，plan 2026-08-07-001；契约正本 docs/features/todo-list.md「行单元契约」）。
// 逐格断言「块级交互的作用单元 = 行」：7 个行为 × 6 种 fixture 笛卡尔展开生成用例。
// 目的不是替代各行为自己的深门（像素差分/变异自检都在各自 spec 里），是**完备性**——
// #421 的教训是「行为 A 下沉了、行为 B 忘了」，本矩阵让每个新行为/新块型必须过一遍所有格子。
//
// 契约三条在这里的体现：
//   ① 每格断言「作用标记落在行上、不落在存储容器 ul 上」；
//   ② 新增块级交互 → 必须在 BEHAVIORS 加一行（矩阵自检 M-0 会数格子，表出缺口当场红）；
//   ③ 断言全部在交互态**存续期间**做（编辑中/选中中/菜单开着时），不看操作结束后的终态。
//
// 断言强度说明：本矩阵以「标记落点 + 结构产物」为judge口径——标记→像素的链条由既有深门钉着
// （todo-row-editing-highlight/todo-parent-row-tint 是像素级差分）。矩阵格子若换成全像素断言，
// 42 格 × 截图解码会把 CI 拖爆，且与深门重复。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2rowmx-'));
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
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; frame = null; }
});

// ---- 探测原语（与各深门同口径） ----
const inDoc = (fn, arg) => frame.locator('body').evaluate(fn, arg);
const markedOf = (attr) => inDoc((b, a) => {
  const d = b.ownerDocument;
  return [...d.querySelectorAll(`[${a}]`)].map((e) => e.tagName + (e.id ? '#' + e.id : ''));
}, attr);
// 程序化造跨块选区（page.mouse 在 iframe 里拖选会卡死，PR #395 记过这坑）
const setRange = (a, z) => inDoc((b, [s, e]) => {
  const d = b.ownerDocument;
  const first = (el) => d.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
  // 终点取目标的**最后一个**文本节点末尾——多行叶子（<br> 后还有文本节点）只取 first 会漏罩后半行，
  // 行未被整罩就不该标蓝（那是产品对的），矩阵首跑在 rangesel×todo-multiline 亲测栽过这一格。
  const last = (el) => { const w = d.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n = null, x; while ((x = w.nextNode())) n = x; return n; };
  const r = d.createRange();
  r.setStart(first(d.querySelector(s)), 0);
  const t = last(d.querySelector(e)); r.setEnd(t, t.textContent.length);
  const sel = d.getSelection(); sel.removeAllRanges(); sel.addRange(r);
}, [a, z]);
const gripCenter = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const g = d.querySelector('.ws-grip');
  if (!g || g.style.display === 'none') return null;
  const r = g.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
const bandOf = (sel) => inDoc((b, s) => {
  const r = b.ownerDocument.querySelector(s).getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
}, sel);
const norm = (s) => (s || '').replace(/\s+/g, '');

// ---- fixture 轴（6 种，target 恒为 #target；ctl=段落对照组防矩阵变哑门） ----
const FIXTURES = [
  { key: 'todo-top',   kind: 'list', body: '<p id="pp">对照段落</p><ul id="lst" class="ws-todo"><li id="r1">行一待办</li><li id="target">行二待办</li><li id="r3">行三待办</li></ul>' },
  { key: 'todo-nested', kind: 'list', nested: true, body: '<p id="pp">对照段落</p><ul id="lst" class="ws-todo"><li id="host">父行待办<ul class="ws-todo"><li id="target">子行待办</li><li id="c2">子二待办</li></ul></li></ul>' },
  // target 后必须还有一行：rangesel 拉到 target 末若恰罩满整列表，整罩=标 ul 是拍过板的正确语义，
  // 矩阵这格测的是**部分覆盖下沉到行**（首跑亲测：target 居末 → 整罩 → 标 UL，格子测不到目标语义）。
  { key: 'todo-multiline', kind: 'list', multiline: true, body: '<p id="pp">对照段落</p><ul id="lst" class="ws-todo"><li id="r1">行一待办</li><li id="target">首行文字<br>次行文字</li><li id="r3">行三待办</li></ul>' },
  { key: 'ul-plain', kind: 'list', body: '<p id="pp">对照段落</p><ul id="lst"><li id="r1">圆点一</li><li id="target">圆点二</li><li id="r3">圆点三</li></ul>' },
  { key: 'ol',       kind: 'list', body: '<p id="pp">对照段落</p><ol id="lst"><li id="r1">编号一</li><li id="target">编号二</li><li id="r3">编号三</li></ol>' },
  { key: 'para-ctl', kind: 'para', body: '<p id="pp">对照段落</p><p id="target">目标段落自身即行</p><p id="r3">下文段落</p>' },
];

// ---- 行为轴（7 项）。probe(f) 内含该格的全部断言；NA 表：不适用格必须在这登记理由（M-0 数格子用） ----
const NA = {
  // 当前 42 格全适用（嵌套行的「+」走同层插行 = 契约里记录在案的结构性分歧，作为分歧断言而非跳过）。
  // 新行为若确有不适用格：'行为key|fixture key': '一句理由'，M-0 认账，绝不许静默跳格。
};

const BEHAVIORS = [
  {
    key: 'editrow', name: '编辑态高亮标记落行',
    probe: async (f) => {
      await frame.locator('#target').click(f.multiline ? { position: { x: 30, y: 8 } } : {});
      await page.waitForTimeout(300);
      const rows = await markedOf('data-ws2-editrow');
      if (f.kind === 'list') {
        expect(rows, '编辑态行标记必须恰好落在光标行').toEqual(['LI#target']);
        expect(await markedOf('data-ws2-editing'), '编辑宿主(现架构=存储单元)').toEqual([(await inDoc((b) => b.ownerDocument.getElementById('lst').tagName)) + '#lst']);
      } else {
        expect(rows, '段落无行标记（块自身即行）').toEqual([]);
        expect(await markedOf('data-ws2-editing')).toEqual(['P#target']);
      }
    },
  },
  {
    key: 'rangesel', name: '跨块选区蓝底落行',
    probe: async (f) => {
      await frame.locator('#pp').click();
      await setRange('#pp', '#target');
      await page.waitForTimeout(350);
      const m = await markedOf('data-ws2-rangesel');
      expect(m, '起点段落整块被罩').toContain('P#pp');
      if (f.kind === 'list') {
        expect(m, '被罩的行按行标记').toContain('LI#target');
        expect(m.some((x) => x.endsWith('#lst')), '部分覆盖时绝不标存储单元 ul/ol').toBe(false);
        if (f.nested) expect(m, '父行未被整罩→不标父行').not.toContain('LI#host');
      } else {
        expect(m, '段落被罩=标块自身').toContain('P#target');
      }
    },
  },
  {
    key: 'grip', name: '手柄悬停锚行',
    probe: async (f) => {
      await frame.locator('#target').hover();
      // 手柄出现时机不定，固定短睡会赛跑（首跑 grip×todo-top/nested 亲测栽过）→ 轮询到可见为止
      await page.waitForFunction(() => {
        const d = document.getElementById('doc-frame').contentDocument;
        const el = d && d.querySelector('.ws-grip');
        return !!el && el.style.display !== 'none';
      }, null, { timeout: 4000 });
      const g = await gripCenter();
      expect(g, '悬停后手柄可见').not.toBeNull();
      const band = await bandOf('#target');
      expect(g.y >= band.top && g.y <= band.bottom, `手柄 y=${g.y} 必须落在行带 [${band.top},${band.bottom}] 内`).toBe(true);
      if (f.kind === 'list' && !f.multiline) {
        // 手柄锚的是行不是列表：行带必须窄于列表带（多行列表才成立；多行叶子自身就占整两行，另测）
        const listBand = await bandOf('#lst');
        expect(band.bottom - band.top < listBand.bottom - listBand.top, '行带应窄于列表带（否则手柄断言退化为块级）').toBe(true);
      }
    },
  },
  {
    key: 'menu', name: '手柄菜单行作用域',
    probe: async (f) => {
      await frame.locator('#target').hover();
      await page.waitForTimeout(200);
      await frame.locator('.ws-grip').click();
      await expect(frame.locator('.ws-blockmenu')).toBeVisible();
      const selNow = await markedOf('data-ws2-selected');
      if (f.kind === 'list') {
        expect(selNow, '菜单开着时高亮恰好该行').toEqual(['LI#target']);
      } else {
        expect(selNow, '段落=块作用域，高亮块自身').toEqual(['P#target']);
      }
    },
  },
  {
    key: 'plus', name: 'gutter「+」插入锚行',
    probe: async (f) => {
      await frame.locator('#target').hover();
      await page.waitForTimeout(200);
      await frame.locator('.ws-plus').click();
      await page.waitForTimeout(300);
      const shape = await inDoc((b) => {
        const d = b.ownerDocument;
        const t = d.getElementById('target');
        const li = t && t.closest && t.closest('li') === t;
        if (!li) { // 段落/或行已不在列表语境
          const nx = t.nextElementSibling;
          return { mode: 'block', nextTag: nx ? nx.tagName : null, nextEmpty: nx ? (nx.textContent || '').trim() === '' : null };
        }
        const list = t.parentElement;
        const isLast = t === [...list.children].filter((c) => c.tagName === 'LI').pop();
        const after = list.nextElementSibling;
        const nx = t.nextElementSibling;
        return { mode: 'row', isLast, afterListTag: after ? after.tagName : null, afterListEmpty: after ? (after.textContent || '').trim() === '' : null, nextRowTag: nx ? nx.tagName : null, nextRowEmpty: nx ? (nx.textContent || '').trim() === '' : null };
      });
      if (f.kind === 'para') {
        expect(shape.nextTag, '段落下方插空正文块').toBe('P');
        expect(shape.nextEmpty).toBe(true);
      } else if (f.nested) {
        // 结构性分歧（契约记录在案）：嵌套行「+」退而插同层新行
        expect(shape.nextRowTag, '嵌套行「+」=同层插新行').toBe('LI');
        expect(shape.nextRowEmpty).toBe(true);
      } else {
        // 顶层行：目标行成为前段列表末项、其后紧跟空正文块（中间行=劈开；末行=退化为列表后插入，不产空列表）
        expect(shape.isLast, '「+」后目标行应是所在列表末项（劈开或本就是末行）').toBe(true);
        expect(shape.afterListTag, '列表之后紧跟插入的空正文块').toBe('P');
        expect(shape.afterListEmpty).toBe(true);
      }
    },
  },
  {
    key: 'cmda', name: '⌘A 第一档=行内容',
    probe: async (f) => {
      await frame.locator('#target').click(f.multiline ? { position: { x: 30, y: 8 } } : {});
      await page.waitForTimeout(250);
      await page.keyboard.press('Meta+a');
      await page.waitForTimeout(150);
      const got = await inDoc((b) => String(b.ownerDocument.getSelection()));
      const want = await inDoc((b) => b.ownerDocument.getElementById('target').textContent);
      expect(norm(got), '⌘A 第一档选中恰好=该行全部内容（不含邻行）').toBe(norm(want));
    },
  },
  {
    key: 'esc', name: 'Esc 第一档=灰选行',
    probe: async (f) => {
      await frame.locator('#target').click(f.multiline ? { position: { x: 30, y: 8 } } : {});
      await page.waitForTimeout(250);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const selNow = await markedOf('data-ws2-selected');
      if (f.kind === 'list') {
        expect(selNow, 'Esc 一档灰选恰好该行（存储单元 ul 在二档）').toEqual(['LI#target']);
      } else {
        expect(selNow, '段落 Esc=灰选块自身').toEqual(['P#target']);
      }
    },
  },
];

// M-0 矩阵完备性自检：每格必须「有用例」或「在 NA 表有理由」。新增 BEHAVIORS/FIXTURES 忘了配格子会当场红。
test('M-0 矩阵表完备（每格有用例或有理由的 n/a）', () => {
  const holes = [];
  for (const b of BEHAVIORS) for (const f of FIXTURES) {
    const naKey = `${b.key}|${f.key}`;
    const hasNa = Object.prototype.hasOwnProperty.call(NA, naKey);
    if (hasNa && !String(NA[naKey] || '').trim()) holes.push(`${naKey}: n/a 无理由`);
  }
  expect(holes, holes.join('; ')).toEqual([]);
  expect(BEHAVIORS.length * FIXTURES.length, '格子总数（新行为/块型必须显式进矩阵）').toBe(42);
});

for (const b of BEHAVIORS) {
  for (const f of FIXTURES) {
    const naKey = `${b.key}|${f.key}`;
    if (NA[naKey]) continue; // 有理由的 n/a（M-0 已验理由非空）
    test(`${b.key}×${f.key} ${b.name}`, async () => {
      await launch();
      await openDoc(f.body);
      await b.probe(f);
    });
  }
}
