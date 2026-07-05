// U1 风险前置 spike（go/no-go 门）——WebContentsView 与现有 DOM chrome 能否共存。
// 用法：npx electron scripts/browser-spike.js   （宿主 macOS，有真显示器）
// 产出：把五项实证结论打到 stdout + 写 scripts/browser-spike-result.json，供 plan 执行注记引用。
//
// 五项（plan U1）：
//   ① bounds 跟随（侧栏宽变/窗口 resize）+ setBounds 是否即时生效
//   ② setVisible(false) / removeChildView 后 children 计数与残影（electron#44652）
//   ③ loadURL 完成是否抢焦点（#42578）+ focusOnNavigation:false 是否可用 + win.webContents.focus() 能否夺回
//   ④ DnD 拖拽 ghost 是否浮在 view 之上（NSDraggingSession，需目视，这里只记录“待人工确认”）
//   ⑤ 侧栏 dragstart 的 dataTransfer 会不会泄给 view 内页面的 drop handler（需目视/脚本注入，记录方案）
//
// 判据：① ② 或 ③ 的「夺回」失败 → no-go，停下与 Colin 重估。
const { app, BrowserWindow, WebContentsView } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'browser-spike-result.json');
const results = { ranAt: null, findings: {}, verdict: null, notes: [] };
const log = (...a) => { console.log('[spike]', ...a); };

// 极简 chrome 页：一个可聚焦的 <input> 充当地址栏，验证 ③ 的焦点夺回。
const CHROME_HTML = `data:text/html,<!doctype html><meta charset=utf8>
<body style="font-family:sans-serif;padding:8px">
<input id=addr placeholder="address bar" style="width:60%">
<div id=sidebar style="position:absolute;left:0;top:0;width:200px;height:100%;background:#eee"></div>
</body>`;

async function run() {
  const win = new BrowserWindow({ width: 1100, height: 800, webPreferences: { contextIsolation: true } });
  await win.loadURL(CHROME_HTML);

  // ---- 建 web view（无 preload / sandbox，对齐 plan KD-4）----
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, focusOnNavigation: false },
  });
  win.contentView.addChildView(view);
  const SIDEBAR_W = 200, CHROME_H = 44;
  const layout = () => {
    const [w, h] = win.getContentSize();
    view.setBounds({ x: SIDEBAR_W, y: CHROME_H, width: w - SIDEBAR_W, height: h - CHROME_H });
    return { x: SIDEBAR_W, y: CHROME_H, width: w - SIDEBAR_W, height: h - CHROME_H };
  };

  // ③ focusOnNavigation 可用性：new 时没抛错即 API 存在（老 Electron 无此键会被忽略，靠下面的焦点实测判定）
  results.findings.focusOnNavigation_accepted = true;

  // 先把 DOM input 聚焦，再让 view loadURL，看焦点是否被抢
  await win.webContents.executeJavaScript(`document.getElementById('addr').focus(); document.activeElement.id`)
    .then((id) => { results.notes.push('loadURL 前 DOM activeElement=' + id); });

  const wantBounds = layout();
  await view.webContents.loadURL('https://example.com').catch((e) => {
    results.notes.push('loadURL example.com 失败(可能无网): ' + (e && e.message));
  });

  // ① bounds 生效 + 跟随
  const got = view.getBounds();
  results.findings.bounds_applies = (got.width === wantBounds.width && got.x === wantBounds.x);
  // 模拟侧栏变宽 / 窗口 resize
  win.setContentSize(1300, 900);
  const want2 = layout();
  const got2 = view.getBounds();
  results.findings.bounds_follows_resize = (got2.width === want2.width && got2.height === want2.height);

  // ③ loadURL 后 DOM input 是否还持有焦点（focusOnNavigation:false 生效则应仍在 DOM）
  const activeAfter = await win.webContents.executeJavaScript(`document.activeElement && document.activeElement.id`).catch(() => null);
  results.findings.dom_keeps_focus_after_load = (activeAfter === 'addr');
  // 夺回：显式把焦点还给 chrome webContents，再查 DOM 能否重新聚焦 input
  win.webContents.focus();
  await win.webContents.executeJavaScript(`document.getElementById('addr').focus(); true`).catch(() => {});
  const reclaimed = await win.webContents.executeJavaScript(`document.activeElement && document.activeElement.id`).catch(() => null);
  results.findings.focus_reclaimable = (reclaimed === 'addr');

  // ② setVisible / removeChildView
  const childrenWithView = win.contentView.children.length;
  view.setVisible(false);
  results.findings.setVisible_toggles = (view.getVisible() === false);
  view.setVisible(true);
  win.contentView.removeChildView(view);
  const childrenAfterRemove = win.contentView.children.length;
  results.findings.removeChildView_detaches = (childrenAfterRemove === childrenWithView - 1);
  // 残影（#44652）只能目视——记录待确认
  results.findings.removeChildView_ghost = 'MANUAL: 目视确认 removeChildView 后 view 区域无残留像素（#44652，41-42 应已修）';

  // ④⑤ 需目视/交互，记录人工确认项
  results.findings.dnd_ghost_over_view = 'MANUAL: 拖标签行 ghost 是否浮在 view 之上（macOS NSDraggingSession，大概率是，spike 无法自动断言）';
  results.findings.sidebar_dnd_leak = 'MANUAL: 侧栏 dragstart 的相对路径是否能被 view 内页面 ondrop 读到（U3 实现前用注入页做一次真拖拽验证）';

  // 判据
  const goBlockers = [];
  if (!results.findings.bounds_applies || !results.findings.bounds_follows_resize) goBlockers.push('① bounds 不生效/不跟随');
  if (!results.findings.focus_reclaimable) goBlockers.push('③ win.webContents.focus() 夺不回 DOM 焦点');
  if (!results.findings.removeChildView_detaches) goBlockers.push('② removeChildView 不摘除');
  results.verdict = goBlockers.length ? ('NO-GO: ' + goBlockers.join('; ')) : 'GO（自动可测项全过；④⑤及残影目视另行确认）';

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  log('结论:', results.verdict);
  log('明细:', JSON.stringify(results.findings, null, 2));
  log('已写', OUT);
  setTimeout(() => { win.destroy(); app.quit(); }, 300);
}

app.whenReady().then(() => {
  results.ranAt = process.env.WS2_SPIKE_STAMP || 'unstamped';
  run().catch((e) => {
    results.verdict = 'ERROR: ' + (e && e.stack || e);
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    log('spike 崩了:', e);
    setTimeout(() => app.quit(), 200);
  });
});
