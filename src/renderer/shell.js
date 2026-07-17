let docPath = null;
let docInfo = null; // 当前文档的跨平台派生值 { fileUrl, dirUrl, name }，主进程算（见 window.ws2.pathInfo）
let docContext = null; // 当前文档的互链身份 { rootId, rel }（classify-file 算）；临时/工作区外 = null（不支持互链）
// 换文档时算当前文档的 rootId+rel（给 U3 提及菜单 / U4 断链判定用）。async best-effort，用 docPath 守陈旧。
let docContextPromise = null;
function refreshDocContext(p) {
  docContextPromise = (async () => {
    try { const m = await window.ws2.classifyFile(p); if (docPath === p) docContext = (m && m.rootId != null) ? { rootId: m.rootId, rel: m.rel } : null; }
    catch (e) { if (docPath === p) docContext = null; }
    if (docPath === p && typeof refreshBacklinks === 'function') refreshBacklinks(); // U6：算完身份就刷反链面板
  })();
  return docContextPromise;
}
window.__wsDocContext = () => docContext;
window.__wsDocPath = () => docPath; // U4 linkview：断链扫描的 resolveDocLink fromAbs 来源
// 就绪 promise：刚打开文档 docContext 还在异步算（classify-file），@ 触发时可等它一下再开菜单（审查 D）。
window.__wsDocContextReady = () => docContextPromise || Promise.resolve(docContext);
// U3 @新建 / U4 断链「新建」：在 fromRel 同目录建一篇新文档，返回 { rel（算 href）, abs（跳去编辑/自愈用） }。null=失败。
// ext：'.md' → 建 markdown（骨架 = 一行 h1）；否则 '.html'（schema-1 合规骨架）。@新建默认 .html；断链「新建」尊重断链后缀。
window.__wsCreateLinkedDoc = async (rootId, fromRel, title, ext) => {
  ext = ext === '.md' ? '.md' : '.html';
  const dir = fromRel && fromRel.indexOf('/') >= 0 ? fromRel.slice(0, fromRel.lastIndexOf('/')) : '';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const content = ext === '.md'
    ? '# ' + String(title) + '\n'
    : '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="wordspace-schema" content="1">\n<title>'
        + esc(title) + '</title>\n</head>\n<body>\n<h1>' + esc(title) + '</h1>\n<p></p>\n</body>\n</html>\n';
  try { const r = await window.ws2.wsNewDoc(rootId, dir, title, content, ext); return r && r.rel ? { rel: r.rel, abs: r.abs } : null; }
  catch (e) { return null; }
};
// U3 @新建收尾：链接已插进当前文档 → 先存当前文档（别让脏守卫吞掉刚插的链接）→ 跳去编辑新文档（Colin 2026-07-09）。
window.__wsOpenCreatedDoc = async (abs) => {
  if (!abs) return;
  if (dirty && docPath && !tempDoc) { try { await save(); } catch (e) { /* 存失败也照跳，openDoc 的脏守卫会兜 */ } }
  openDoc(abs);
};
let dirty = false;
let undoMgr = null;
let blockEdit = null; // 当前文档的块编辑内核（WS2BlockEdit.attach 返回）；换文档前 detach 防堆叠
let basicEdit = null; // 非合规文档的基础编辑内核（WS2BasicEdit.attach 返回，Feature 3）
let pagination = null; // 分页文档的 V4 分页引擎（WS2Pagination.attach 返回）；与块编辑器同生命周期
let docPageCfg = null; // 分页版式配置（routeDoc 按磁盘字节解析 / applyPageSetup 运行时更新）；null = 非分页
let docConform = true; // openDoc 判定：文件合规→完整块编辑；不合规→基础编辑（分流 seam，KD-e）
let loadGen = 0;       // 每次载入/重载自增；旧的 frame.onload 闭包据此作废，防并发载入（如外部连改 + 重载）交叉 wireEditor
let openSeq = 0;       // openDoc 序号：await 期间又开了别的文档 / 关了文档 → 陈旧 openDoc 落地作废（修 SH-1，仿 loadGen）

// ---- 临时文档（从「标签页 +」/ Cmd+T 新建，未落盘；对齐 ui-demo 的临时未保存文档）----
// app 的文档 = 磁盘文件，本没有「内存里未落盘」的位置。这里补一个：临时文档 docPath=null，内容只活在
// iframe / tempStore 里，手动保存（走 SaveModal → wsNewDoc）才落盘变成真文件。tempStore 让临时文档切标签
// 不丢——单编辑器一次只 live 一个，切走前 stash 序列化回 store、切回按 store 重渲染。
let tempDoc = null;          // 当前活跃临时文档 { id, base }（base = 默认文件名 / 面包屑名）
const tempStore = new Map(); // id('temp:…') → { base, html }：所有临时文档内容
let tempSeq = 0;
function genTempId() { return 'temp:' + (++tempSeq) + ':' + Date.now().toString(36); }
// 序列化当前活跃文档的 DOM → 入盘 HTML。合规走 WS2Serialize，非合规（基础编辑）走 WS2BasicEdit——
// 两者产物不同（后者要剥掉 contenteditable / 编辑标记）。save() 与所有临时文档快照 / 挽救都必须走这同一处
// 分派：否则非合规文档的编辑标记会泄漏进磁盘（对抗审查 P2——rescue/stashActiveTemp/shellActiveTemp 曾各自
// hardcode WS2Serialize，就是这种「三处各写一份、忘了分派」的漂移引入的 bug）。
function serializeActiveDoc() {
  return basicEdit ? WS2BasicEdit.serialize(frame.contentDocument) : WS2Serialize.serializeDocument(frame.contentDocument);
}
// 主进程只认「有没有未保存」这个布尔（关窗提示用）：活跃脏 || 存在任何临时文档 = 未保存。
function syncAppDirty() { window.ws2.setDirty(dirty || !!tempDoc || tempStore.size > 0); }

const frame = document.getElementById('doc-frame');
const mainEl = document.getElementById('main');
const degradeNotice = document.getElementById('ws-degrade-notice'); // 非合规降级提示条（Feature 3）

// ---- U6 反链面板（标题下「N 篇文档链接到这里」；父层 chrome，绝不注入文档字节；0 反链整体隐藏）----
const backlinksEl = document.getElementById('ws-backlinks');
const blHeadEl = document.getElementById('ws-bl-head');
const blCountEl = document.getElementById('ws-bl-count');
const blListEl = document.getElementById('ws-bl-list');
let blExpanded = false;
let blGen = 0; // 每次刷新自增；异步 backlinks 回来校验，防切文档串味
function hideBacklinks() {
  blGen++;
  if (backlinksEl) backlinksEl.hidden = true;
  if (blListEl) blListEl.hidden = true;
  if (blHeadEl) blHeadEl.setAttribute('aria-expanded', 'false');
  blExpanded = false;
  if (backlinksEl) backlinksEl.classList.remove('is-expanded');
}
function blClamp(s) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 80 ? s.slice(0, 80) + '…' : s; }
async function refreshBacklinks() {
  if (!backlinksEl) return;
  const c = docContext;
  const g = ++blGen;
  if (!c) { hideBacklinks(); return; }
  let list, roots;
  try { [list, roots] = await Promise.all([window.ws2.linksBacklinks(c.rootId, c.rel), window.ws2.wsGetRoots().catch(() => [])]); } catch (e) { return; }
  if (g !== blGen || docContext !== c) return; // 又刷了一次 / 切了文档 → 本次作废
  if (!list || !list.length) { hideBacklinks(); return; }
  const rootName = new Map((roots || []).map((r) => [r.id, r.name])); // A：跨根来源标空间名
  blCountEl.textContent = window.wsT('shell.backlinksCount', { n: list.length });
  blListEl.textContent = '';
  for (let i = 0; i < list.length; i++) {
    const src = list[i];
    const crossRoot = src.rootId != null && src.rootId !== c.rootId; // A：来源在别的文件夹空间
    const item = document.createElement('button');
    item.className = 'ws-bl-item';
    item.title = (crossRoot ? (rootName.get(src.rootId) || '') + ' · ' : '') + src.rel;
    const t = document.createElement('div'); t.className = 'ws-bl-item-title'; t.textContent = src.title || src.rel;
    if (crossRoot) { const badge = document.createElement('span'); badge.className = 'ws-bl-item-root'; badge.textContent = rootName.get(src.rootId) || window.wsT('shell.otherSpace'); t.appendChild(badge); }
    item.appendChild(t);
    if (src.snippet) { const sn = document.createElement('div'); sn.className = 'ws-bl-item-snippet'; sn.textContent = blClamp(src.snippet); item.appendChild(sn); }
    item.addEventListener('click', async () => { // 点来源 = 应用内打开（跨根用来源自己的 rootId）
      try { const abs = await window.ws2.wsAbs(src.rootId != null ? src.rootId : c.rootId, src.rel); if (abs) openDoc(abs); } catch (e) {}
    });
    blListEl.appendChild(item);
  }
  backlinksEl.hidden = false;
}
if (blHeadEl) blHeadEl.addEventListener('click', () => {
  blExpanded = !blExpanded;
  blListEl.hidden = !blExpanded;
  blHeadEl.setAttribute('aria-expanded', blExpanded ? 'true' : 'false');
  backlinksEl.classList.toggle('is-expanded', blExpanded);
});
const home = document.getElementById('home');
const docHeader = document.getElementById('doc-header');
const docName = document.getElementById('doc-name');
const dirtyDot = document.getElementById('dirty-dot');
const docStatus = document.getElementById('doc-status');
const viewer = document.getElementById('viewer');
const saveBtn = document.getElementById('save-btn');
const exportBtn = document.getElementById('export-btn');
const exportMdBtn = document.getElementById('export-md-btn');

let savedTimer = null; // 「✓ 已保存」淡出定时器（保存成功后闪一下再消失）
function setDirty(v) {
  dirty = v;
  saveBtn.disabled = !(tempDoc || docPath); // 「另存为」开着文档就可用（不看脏态——自动保存后脏态只是 1.2s 窗口）；查看器态 docPath 已清 → 禁用
  syncAppDirty();
  // 任何脏态变化都终结上一次「✓ 已保存」的余晖——否则它的定时器会跨文档/重载串台（切文档后还挂在新文档
  // 面包屑上、或外部重载后压住清洁态）。save() 是先 setDirty(false) 再 flashSaved()，这里清掉无妨（flash 紧接重置）。
  if (savedTimer) { clearTimeout(savedTimer); savedTimer = null; }
  if (v) {
    dirtyDot.textContent = window.wsT('shell.unsaved');
    dirtyDot.className = 'ws-dirty';
    dirtyDot.hidden = false;
  } else {
    dirtyDot.className = 'ws-dirty';
    dirtyDot.hidden = true;
  }
  // 同步侧栏标签的未保存点（T2，对齐 ui-demo arc-tab-dot：脏真文件的标签也要有提示）
  if (window.__sbHooks && window.__sbHooks.onDirtyChange) window.__sbHooks.onDirtyChange(v);
}
// 保存成功的正向反馈：原地（面包屑里脏态那个位置）闪「✓ 已保存」绿字，~1.6s 后淡出。
// 不是弹窗：保存高频，模态太重；复用用户已经盯着的位置给即时确认，Cmd+S / 点按钮两条路都覆盖。
function flashSaved() {
  if (savedTimer) clearTimeout(savedTimer);
  dirtyDot.textContent = window.wsT('shell.saved');
  dirtyDot.className = 'ws-dirty ws-saved';
  dirtyDot.hidden = false;
  savedTimer = setTimeout(() => {
    dirtyDot.classList.add('ws-fade'); // opacity → 0（CSS transition）
    savedTimer = setTimeout(() => { dirtyDot.hidden = true; dirtyDot.className = 'ws-dirty'; savedTimer = null; }, 320);
  }, 1600);
}
// 自动保存（Colin 拍板 / 对齐 ui-demo「编辑即保存」）：真文件（有 docPath、非临时）改动后静默
// 1.2s 自动落盘；临时文档没有落盘目标、仍显式选位置保存（save() 的 tempDoc 分支会弹 SaveModal，
// 这里必须拦在前面）。每次保存仍走历史归档（安全网）——代价是连续编辑会多出一些历史版本，接受。
let autoSaveTimer = null;
// 用户确认「丢弃修改」/ 重载在飞时必须缴械 pending 自动保存：已到期的定时器会在随后的 await 让出期
// 开火，把刚被丢弃（或将被磁盘版本替换）的编辑写回磁盘（对抗审计实证：外部版本被反杀/三态分叉）。
function discardPendingAutoSave() { if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; } }
// 修 SH-3：非阻塞 DOM 模态（侧栏关闭确认）打开期间必须挂起自动保存——否则弹窗背后 1.2s 定时器照常
// 把编辑写盘，用户点「不保存直接关闭」时数据已落盘、弹窗文案成谎（且弹出条件就是 1.2s 内 dirty→几乎必现）。
let autoSavePaused = false;
function pauseAutoSave() { autoSavePaused = true; discardPendingAutoSave(); }
function resumeAutoSave() { autoSavePaused = false; if (dirty && docPath && !tempDoc) scheduleAutoSave(); }
function scheduleAutoSave() {
  if (autoSavePaused) return; // 挂起期间不排新定时器
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    if (dirty && docPath && !tempDoc) save();
  }, 1200);
}
const markDirty = () => { setDirty(true); scheduleAutoSave(); };
// U4 修复卡「重新指向」：程序化改当前文档 <a> href 前后的收口，跟 @提及 onDone 同款配方。
// before：flush 待定编辑成独立 undo 快照（免撤销修复时连带撤销之前的打字）；after：标脏 + checkpoint 修复后状态。
window.__wsBeforeDocEdit = () => { if (undoMgr && undoMgr.checkpoint) undoMgr.checkpoint(); };
window.__wsAfterDocEdit = () => { markDirty(); if (undoMgr && undoMgr.checkpoint) undoMgr.checkpoint(); };
// U5 改名/移动：把 moves 应用到「打开中文档」的内存 DOM（主进程重写时跳过了它，避免和自动保存打架——
// 内存改 + 走正常保存管线，脏文档也不会被覆盖）。moves=[[oldRel,newRel],…]。返回改的链接数。
// 主进程重写引用时跳过打开中的文档（怕和自动保存/未存编辑打架），改在这里对它的 DOM 内存改。
// C：abs 域（movesArr = [[absOld,absNew]...]）——同根写短形式、跨根写 abs 形式（镜像 link-rewrite.rewriteContentAbs）。
window.__wsApplyMovesToOpenDoc = async (movesArr) => {
  await (window.__wsDocContextReady ? window.__wsDocContextReady() : Promise.resolve()); // retarget 后 rel 重算完
  const ctx = window.__wsDocContext && window.__wsDocContext();
  const doc = frame.contentDocument;
  const L = window.WS2Links;
  if (!ctx || !doc || !L || !Array.isArray(movesArr) || !movesArr.length) return 0;
  const moves = new Map(movesArr); // absOld → absNew
  const inv = L.invertMoves(moves);
  let ownNewAbs, roots;
  try { [ownNewAbs, roots] = await Promise.all([window.ws2.wsAbs(ctx.rootId, ctx.rel), window.ws2.wsGetRoots().catch(() => [])]); } catch (e) { return 0; }
  if (!ownNewAbs) return 0;
  const ownOldAbs = inv.get(ownNewAbs) || ownNewAbs; // 自己被移动了？用旧 abs 解析既有 href
  const rootDirs = (roots || []).map((r) => r.path);
  const rootOf = (abs) => { for (const rd of rootDirs) { if (abs === rd || abs.indexOf(rd + '/') === 0) return rd; } return null; };
  const smart = (fromAbs, toAbs) => { const ro = rootOf(fromAbs), rt = rootOf(toAbs); return (ro && rt && ro === rt) ? L.relHref(fromAbs.slice(ro.length + 1), toAbs.slice(rt.length + 1)) : L.relHrefAbs(fromAbs, toAbs); };
  let n = 0;
  const as = doc.querySelectorAll('a[href]');
  for (let i = 0; i < as.length; i++) {
    const href = as[i].getAttribute('href');
    if (!href || L.classifyScheme(href) !== 'relative') continue;
    const parts = L.splitHrefSuffix(href);
    const absTarget = L.resolveHrefAbs(ownOldAbs, parts[0]);
    if (absTarget == null || rootOf(absTarget) == null) continue; // 工作区外 → 不碰
    const has = moves.get(absTarget);
    const tNew = has != null ? has : absTarget;
    if (tNew === absTarget && ownNewAbs === ownOldAbs) continue;
    const nh = smart(ownNewAbs, tNew) + parts[1];
    if (nh === href) continue;
    as[i].setAttribute('href', nh); n++;
  }
  if (n) { markDirty(); if (undoMgr && undoMgr.checkpoint) undoMgr.checkpoint(); if (window.WS2LinkView) window.WS2LinkView.scan(frame); }
  return n;
};

// AI 占位（斜杠 /ai 或格式气泡 ✦AI 触发）——本地编辑器暂无 AI，仅提示开发中（用父窗口弹窗，
// 因 iframe sandbox 无 allow-modals）。
function showAiSoon() { window.alert(window.wsT('shell.aiSoon')); }

// 仅用于显示的纯文件名：跨平台按 / 或 \ 切（Windows 路径用反斜杠）。真正加载用的 URL 一律走
// 主进程的 window.ws2.pathInfo（Node url.pathToFileURL），renderer 不自己拼 file:// URL。
function baseName(p) { return p.split(/[\\/]/).pop(); }
// markdown 后端：主进程 read-doc 已把 .md 转成 HTML，renderer 只在「怎么渲染/怎么导出/另存为什么格式」
// 三处按路径分流；编辑器/校验器链路完全不感知格式（与 src/main/md-adapter.js 的 isMdPath 同判定）。
function isMdPath(p) { return typeof p === 'string' && /\.md$/i.test(p); }

function injectBase(doc, dirUrl) {
  const base = doc.createElement('base');
  base.href = dirUrl;
  base.setAttribute('data-ws2-ui', '');
  doc.head.prepend(base);
}

// 文档载入后接线块编辑器（真实 file:// 与 srcdoc 两种载入方式通用）。
// ---- 文档视图缩放（触控板捏合 + Cmd±/0）----
// 几何放大整个文档视图（放大镜，不是改字号——改字号会重排）。只缩放 iframe 的 body（内容），编辑器浮层
// 在 documentElement 不受影响、保持原大小且坐标自洽（实测点击/光标/手柄在 0.75x~1.5x 各档都准）。
// 经构造样式表（adoptedStyleSheets）注入、纯 CSSOM、不进序列化 → 不写盘、不碰用户文档内容（保真安全）。
const ZOOM_MIN = 0.5, ZOOM_MAX = 3, ZOOM_STEP = 0.1;
let zoomFactor = 1;
let zoomSheet = null; // 绑定当前 contentDocument；换文档/重载后在 wireEditor 里置空重建
function applyZoom() {
  const cd = frame.contentDocument, cw = frame.contentWindow;
  if (!cd || !cw) return;
  try {
    if (!zoomSheet || !cd.adoptedStyleSheets.includes(zoomSheet)) {
      zoomSheet = new (cw.CSSStyleSheet || CSSStyleSheet)();
      cd.adoptedStyleSheets = [...cd.adoptedStyleSheets, zoomSheet];
    }
    // factor===1 写空规则：绝不能用 body{zoom:1} 盖掉用户文档自带的 body{zoom}（渲染视图也不能动用户的值，
    // 否则文档自带缩放版式被悄悄压平）。只有用户主动缩放（factor!=1）时才注入我们的 zoom。
    zoomSheet.replaceSync(zoomFactor === 1 ? '' : `body{zoom:${zoomFactor};}`);
  } catch (e) { /* 构造样式表不可用：放弃缩放，不影响编辑 */ }
}
// 缩放快捷键 Cmd/Ctrl +=/-/0：iframe 与父层 shell 都挂一份，焦点在哪都能缩放（否则点过保存按钮后按 Cmd+ 无反应）
function handleZoomKey(e) {
  if (!(e.metaKey || e.ctrlKey)) return false;
  if (window.__webIsActive && window.__webIsActive()) return false; // 网页标签活跃：缩放归 web view（browser.js/主进程）
  const k = e.key.toLowerCase();
  if (k === '=' || k === '+') { e.preventDefault(); setZoom(zoomFactor + ZOOM_STEP); return true; }
  if (k === '-') { e.preventDefault(); setZoom(zoomFactor - ZOOM_STEP); return true; }
  if (k === '0') { e.preventDefault(); setZoom(1); return true; }
  return false;
}
function setZoom(z) {
  zoomFactor = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  applyZoom();
  if (blockEdit) blockEdit.reposition(); // 缩放后手柄/气泡按新内容尺寸重定位
  if (basicEdit) basicEdit.reposition();  // 基础编辑器的宿主浮层同理（Feature 3）
  if (pagination) pagination.refresh();   // 分页几何按「实测宽/配置宽」反推缩放重算
  if (window.WS2Find) window.WS2Find.reposition(); // 查找条钉在 iframe 角，缩放不改 iframe 元素 rect，但保险重定位
}

// 分流判定（Feature 3，KD-e）：纯函数、不碰控制流——判「磁盘原始字节 reparse 出的 DOM」是否合规。
// 判失败（理论上不会，validate 是纯函数 + DOMParser 不抛）保守当合规、走现有完整编辑，不改现状行为。
function routeDoc(rawHtml) {
  try {
    // 走 Schema 注册表分类（多 Schema 就绪：classify 遍历已注册 schema、认出属于哪个）。现阶段仍只用 .conform
    // 二值分流；将来把 docConform 升成 docSchema 后，可按 classify().schemaId 路由到各自编辑器（待 align 的 shell.js 落地后做）。
    const dom = new DOMParser().parseFromString(rawHtml, 'text/html');
    const r = WS2SchemaRegistry.classify(dom);
    // 分页版式（判磁盘字节口径，同 conform）：合规 + head 有可解析的 page 块 → wireEditor 挂分页引擎。
    // 解析不出（写坏）只是分页不生效，不降级（分页 = Schema 1 可选版式，不是独立 Schema）。
    docPageCfg = null;
    if (r.conform && window.WS2SchemaPage) {
      const st = dom.head && dom.head.querySelector('style[data-ws-schema-css="page"]');
      if (st) docPageCfg = WS2SchemaPage.parsePageCss(st.textContent);
    }
    return !!r.conform;
  } catch (e) { docPageCfg = null; return false; } // fail-closed：判不了就走基础编辑器（对任意 HTML 都安全、不套块模型），别 fail-open 把坏文档送进完整编辑器
}

// 换文档 / 关文档：两个编辑内核都拆、降级条收起（统一收口，防堆叠）。
// undoMgr 一并清空——否则基础模式/空态下按 Cmd+Z 会去 undo 上一个文档的陈旧 manager
//（改的是已换掉的 detached doc、还把当前文档标脏）。
function detachEditors() {
  if (window.WS2Find) window.WS2Find.close(); // 换/关文档：关查找条 + 清高亮，否则飘到下一个文档
  if (pagination) { pagination.detach(); pagination = null; } // 先拆分页（它的扫荡要在块内核还活着时做完）
  if (window.WS2Mention) window.WS2Mention.close(); // 同理关提及菜单（跨文档持有的 DOM 引用必失效）
  if (window.WS2LinkView) window.WS2LinkView.detach(); // U4：清断链高亮 + 悬停/修复卡 + 定时器（跨文档必失效）
  hideBacklinks(); // U6：换/关文档先隐反链面板（refreshBacklinks 算完新文档再决定显不显）
  if (blockEdit) { blockEdit.detach(); blockEdit = null; }
  if (basicEdit) { basicEdit.detach(); basicEdit = null; }
  if (undoMgr) { if (undoMgr.timer) clearTimeout(undoMgr.timer); undoMgr = null; }
  if (degradeNotice) degradeNotice.hidden = true;
  updatePageSetupBtn(); // 编辑器已拆 → 「页面设置…」禁用（wireEditor 重挂时再开）
}

// 撤销/重做统一收口（菜单加速器 + 两个编辑器的 keydown 都走这）：
// 块编辑器 undo 后 reset() 重建内核；基础编辑器 undo 是整体 innerHTML 重写、旧 refs 全失效 →
// 重挂 WS2BasicEdit 内核（只重挂内核，shell 加在 doc 上的 keydown/wheel 监听还有效、不能重加）。
function runUndoRedo(isRedo) {
  if (!undoMgr) return;
  const changed = isRedo ? undoMgr.redo() : undoMgr.undo();
  if (!changed) return;
  if (blockEdit) blockEdit.reset();
  if (basicEdit) {
    basicEdit.detach();
    basicEdit = WS2BasicEdit.attach(frame.contentDocument, { win: frame.contentWindow, host: mainEl, markDirty });
  }
  markDirty();
}

// 非合规文档：挂基础编辑器 + 亮降级条。与 wireEditor 平级（KD-e：不嵌进 loadFromFile）。
// 快捷键 Cmd+S 存 / Cmd+B·I·U 富文字 / Cmd+Z 撤销 / 缩放键 —— 对称 wireEditor。
// 撤销同样走 WS2Undo 快照（Colin 2026-07-02：基础模式也必须有撤销，推翻 v1「不挂 undoMgr」取舍）。
function attachBasic() {
  // 空态守卫（Colin 报的 bug）：没有任何打开的文档时绝不挂基础编辑器/亮降级条——关掉最后一个
  // 非合规标签后，iframe 的陈旧 onload 可能晚到、拿着 docConform=false 把这里跑在空 iframe 上，
  // 降级条就留在空白页上。防御两层：这里守空态 + shellCloseDoc 作废陈旧 onload（++loadGen）。
  if (!docPath && !tempDoc) return;
  const doc = frame.contentDocument;
  detachEditors();
  undoMgr = new WS2Undo.UndoManager(doc);
  basicEdit = WS2BasicEdit.attach(doc, { win: frame.contentWindow, host: mainEl, markDirty });
  if (degradeNotice) degradeNotice.hidden = false;
  updateExportMd(); // 非合规 → 导出 md 禁用
  updatePageSetupBtn(); // 非合规 → 页面设置禁用（分页只对合规文档开放）
  // 输入调度 undo checkpoint（连续打字塌成一个 op）；标脏由基础编辑器内部 onInput 做
  doc.addEventListener('input', () => { if (undoMgr && undoMgr.scheduleCheckpoint) undoMgr.scheduleCheckpoint(); });
  // 导出仍可用：基础模式走 raw（直印源文件、忠于野文件原貌），不走块编辑器的 Wordspace 排版（见导出触发点）
  doc.addEventListener('keydown', (e) => {
    if (handleZoomKey(e)) return;
    // 标签切换（浏览器 feature §7）：焦点在编辑器 iframe 里事件不冒泡到父层,这里转发给侧栏。
    if (e.ctrlKey && !e.metaKey && e.key === 'Tab') { e.preventDefault(); if (window.__sbCycleTab) window.__sbCycleTab(e.shiftKey); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); if (window.__sbTabByIndex) window.__sbTabByIndex(+e.key); return; }
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); save(); }
    else if (k === 'b') { e.preventDefault(); doc.execCommand('bold'); markDirty(); }
    else if (k === 'i') { e.preventDefault(); doc.execCommand('italic'); markDirty(); }
    else if (k === 'u') { e.preventDefault(); doc.execCommand('underline'); markDirty(); }
    else if (k === 'z') { e.preventDefault(); runUndoRedo(e.shiftKey); }
  });
  doc.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const d = Math.max(-50, Math.min(50, e.deltaY));
    setZoom(zoomFactor * (1 - d * 0.01));
  }, { passive: false });
  zoomSheet = null; applyZoom();
  if (window.WS2DocTheme) window.WS2DocTheme.syncDocDark(); // 深色下注反色滤镜(样式已生效才采样)+ 揭开遮罩
  installLinkGuard(doc); // U0：非合规文档同样收口链接点击
  if (window.WS2LinkView) window.WS2LinkView.scan(frame); // U4：非合规文档也扫断链装饰（§8）
}

// 块编辑内核（WS2BlockEdit）跑在父层、操作 iframe 的 contentDocument（iframe sandbox 不跑脚本）。
function wireEditor() {
  // 空态守卫（对称 attachBasic，审计整改）：查看器态/空态下陈旧 onload 晚到时，绝不把块编辑器挂上
  // 已清空的隐藏 iframe——否则 Cmd+Z 会操作 detached 文档并 markDirty，产生「看图也提示未保存」的幽灵脏态。
  if (!docPath && !tempDoc) return;
  const doc = frame.contentDocument;
  if (basicEdit) { basicEdit.detach(); basicEdit = null; } // 合规路径：清掉可能残留的基础编辑器 + 收起降级条
  if (degradeNotice) degradeNotice.hidden = true;
  updateExportMd(); // 合规态定了（含 reloadDoc 外部改动翻转合规性的路径）→ 刷新「导出为 Markdown」可用性
  if (undoMgr && undoMgr.timer) clearTimeout(undoMgr.timer); // 取消上个文档悬挂的 checkpoint 定时器（防 stale 闭包）
  undoMgr = new WS2Undo.UndoManager(doc);
  try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
  try { doc.execCommand('styleWithCSS', false, false); } catch (e) {} // 语义标签优先（<b>/<i>），颜色走 CSSOM span（KTD2）

  if (blockEdit) { blockEdit.detach(); blockEdit = null; }
  blockEdit = WS2BlockEdit.attach(doc, {
    win: frame.contentWindow, undoMgr, markDirty, onAiSoon: showAiSoon,
    pickImages: () => window.ws2.pickImages(), // 图片插入：父层原生选图（basicEdit 不接，非合规文档无图片入口）
  });
  // 分页文档：磁盘字节里有可解析的 page 块（routeDoc 已判）→ 挂 V4 分页引擎（引擎样式走
  // adoptedStyleSheets、推挤产物 strip-on-persist，都不入盘）。md 不套页面概念（入盘格式装不下 page 块）。
  if (pagination) { pagination.detach(); pagination = null; }
  if (docPageCfg && !isMdPath(docPath || '') && window.WS2Pagination) {
    pagination = WS2Pagination.attach(doc, { win: frame.contentWindow, config: docPageCfg });
  }
  updatePageSetupBtn(); // 合规 html + 块编辑器已挂 → 「页面设置…」可用

  // 输入：标脏 + 调度 undo checkpoint（连续打字塌成一个 op）
  doc.addEventListener('input', () => { markDirty(); if (undoMgr.scheduleCheckpoint) undoMgr.scheduleCheckpoint(); });
  // 粘贴改由块编辑器 blockedit.onPaste 处理（结构感知：只取纯文本 + 多行自己劈成同类型兄弟块、不产生嵌套，修 ED-A4）。
  // 全局快捷键（Cmd/Ctrl）：撤销/重做/保存/加粗斜体下划线。块内 Enter/Backspace/斜杠/Esc 由 blockEdit 处理。
  doc.addEventListener('keydown', (e) => {
    if (handleZoomKey(e)) return; // 缩放键 Cmd/Ctrl +=/-/0（与父层共用一份逻辑）
    // 标签切换（浏览器 feature §7）：焦点在编辑器 iframe 里事件不冒泡到父层,这里转发给侧栏。
    if (e.ctrlKey && !e.metaKey && e.key === 'Tab') { e.preventDefault(); if (window.__sbCycleTab) window.__sbCycleTab(e.shiftKey); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); if (window.__sbTabByIndex) window.__sbTabByIndex(+e.key); return; }
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); runUndoRedo(e.shiftKey); }
    else if (k === 's') { e.preventDefault(); save(); }
    else if (k === 'b') { e.preventDefault(); doc.execCommand('bold'); markDirty(); }
    else if (k === 'i') { e.preventDefault(); doc.execCommand('italic'); markDirty(); }
    else if (k === 'u') { e.preventDefault(); doc.execCommand('underline'); markDirty(); }
  });

  // 触控板捏合：Chromium 把捏合手势映射成带 ctrlKey 的 wheel。拦掉浏览器自带页面缩放，按 deltaY 连续无极调。
  doc.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const d = Math.max(-50, Math.min(50, e.deltaY)); // 限幅：鼠标滚轮一格 deltaY 常达 ±100+，不限会算出 0/负乘子一步砸到边界
    setZoom(zoomFactor * (1 - d * 0.01)); // 乘法步进：缩放观感更线性
  }, { passive: false });

  // 新 contentDocument → 旧缩放样式表失效，按当前 zoomFactor 重挂（外部重载保留缩放；openDoc 已先复位 100%）
  zoomSheet = null;
  applyZoom();
  if (window.WS2DocTheme) window.WS2DocTheme.syncDocDark(); // 深色下注反色滤镜(样式已生效才采样)+ 揭开遮罩
  installLinkGuard(doc); // U0：文档内 <a> 点击收口（见下）
  if (window.WS2LinkView) window.WS2LinkView.scan(frame); // U4：合规文档加载完成 → 扫断链装饰
}

// ---- U0：文档内 <a> 点击收口 ----
// 修 P0：文档里点链接 → iframe 自导航到目标页 → 晚到的 onload 把块编辑器挂上新页、docPath 仍指旧文件
// → 1.2s 自动保存把 B 页内容写进 A 的路径（跨文件数据覆盖）。这里 capture 阶段拦下所有会导致 iframe
// 导航的点击、改走 openDoc 漏斗；同时是互链「点击打开」的地基。三条渲染路径（file:// 直载 / md srcdoc /
// 非合规 basic-edit）都在 wireEditor/attachBasic 里装它，全覆盖。
function toastLite(msg) { if (window.__wsToast) window.__wsToast(msg); } // U4 前的占位提示（断链等）
async function onDocLinkClick(e) {
  // 匹配 <a>/<area>（图片热区）/SVG <a>——任何能让 sandbox iframe 自导航的锚点都要收口（不止 HTML <a>）。
  // href 从普通属性或 xlink:href（老 SVG）取，两者都可能触发导航。
  const a = e.target && e.target.closest ? e.target.closest('a, area') : null;
  if (!a) return;
  const href = a.getAttribute('href') || a.getAttribute('xlink:href') || '';
  if (!href) return; // 无 href 的 a/area 不导航，交给正常编辑
  const kind = (window.WS2Links && window.WS2Links.classifyScheme(href)) || 'ignore';
  if (kind === 'anchor') return; // #foo：同文档滚动、不导航——放行，不接管
  e.preventDefault(); // 其余一律阻止 iframe 裸导航（P0 根治：相对/web/file:/其它都不许）
  // 编辑态下点链接文字：浏览器本就不导航，让它放光标改字、别打开（对齐 ui-demo「editing→不 open」）
  if (a.isContentEditable) return;
  // 接管这次点击前，先清掉块编辑器的瞬态 UI（灰选中/块菜单/手柄）——否则 stopPropagation 跳过它的
  // bubble onClick 清理，会留下幽灵灰选中（审查 #1）。deselect 幂等，无选中时无副作用。
  if (blockEdit && blockEdit.deselect) blockEdit.deselect();
  e.stopPropagation(); // 非编辑态：接管这次点击，别让块编辑器当「进入编辑」
  if (kind === 'ignore') return; // 空/根绝对/file:/其它 scheme：拦下不动作
  if (kind === 'web') { try { window.ws2.openExternalUrl(href); } catch (err) {} return; } // http/mailto/tel → 系统程序
  if (!docPath) return; // 临时文档无磁盘路径：相对链接无从解析
  let r;
  try { r = await window.ws2.resolveDocLink(docPath, href); } catch (err) { return; }
  if (!r || r.error) return;
  if (!r.insideRoot) { toastLite(window.wsT('shell.linkOutsideWorkspace')); return; }
  if (!r.exists) { // U4：断链 → 弹修复卡（重新指向候选 / 新建），linkview 缺失时退回 toast 占位
    if (window.WS2LinkView && window.WS2LinkView.showRepair) window.WS2LinkView.showRepair(a, r);
    else toastLite(window.wsT('shell.linkTargetMissing', { target: r.rel || href }));
    return;
  }
  window.__wsOpenResolved(r);
}
// U4：把 resolveDocLink 结果按 kind 打开——html/md 进编辑器，其余进查看器/外部打开卡片。
// 抽出来给 onDocLinkClick + linkview 悬停卡「打开」/修复后跳转复用（避免重解析）。
window.__wsOpenResolved = (r) => {
  if (!r) return;
  if (r.kind === 'html' || r.kind === 'md') openDoc(r.abs);
  else showViewer({ abs: r.abs, rel: r.rel, rootId: r.rootId, name: r.name, kind: r.kind }); // 多根：查看器/外部打开按 rootId+rel
};
function installLinkGuard(doc) {
  if (doc) doc.addEventListener('click', onDocLinkClick, true); // capture：先于块编辑器进入编辑
}

function prepFrame(asDirty) {
  home.hidden = true;
  docHeader.hidden = false;
  if (docStatus) docStatus.hidden = false; // 本地状态标
  closeViewer();
  frame.hidden = false;
  if (window.WS2DocTheme) window.WS2DocTheme.maskForLoad(); // 深色下遮住 frame,防未反色白闪(syncDocDark 揭开)
  docName.textContent = docInfo.name;
  docName.title = docInfo.name; // 名字过长被截断时，悬停显示全名
  exportBtn.disabled = false; // 开了文档就能导出（不像保存要脏才亮）
  setDirty(!!asDirty);
}

// ---- 非 HTML 文件的应用内查看器（#1）：图片/PDF 直接预览，其余 → 外部打开卡片 ----
function kindLabel(kind) {
  const m = { word: window.wsT('shell.kindWord'), pdf: 'PDF', image: window.wsT('shell.kindImage'), sheet: window.wsT('shell.kindSheet'), slides: window.wsT('shell.kindSlides'), other: window.wsT('shell.kindFile') };
  return m[kind] || window.wsT('shell.kindFile');
}
const EXT_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>';
function bigIconSvg() {
  return '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
}
function closeViewer() {
  if (!viewer) return;
  viewer.hidden = true;
  viewer.innerHTML = '';
}
function openExternalBtn(node, cls) {
  const b = document.createElement('button');
  b.className = cls;
  b.innerHTML = EXT_SVG + '<span>' + window.wsT('shell.openWithDefault') + '</span>';
  // 根内走 (rootId, rel)（assertInsideWorkspace 守卫）；根外（「打开」按钮选的）没 rel，走吃 abs 的那条。
  b.onclick = () => (node.rel ? window.ws2.wsOpenExternal(node.rootId, node.rel) : window.ws2.openExternalAbs(node.abs));
  return b;
}
// node = { name, rel, abs, kind } —— rel 来自侧栏文件树；「打开」按钮选的工作区外文件 rel 为 null、走 abs
async function showViewer(node) {
  // ⚠ 摘 web view 挪到脏守卫**之后**（浏览器 feature P2-1）：取消丢弃时什么都不动、网页态保留。
  if (tempDoc) { stashActiveTemp(); tempDoc = null; }
  else if (dirty) {
    if (!confirm(window.wsT('shell.discardOpenThisFile'))) return;
    discardPendingAutoSave(); // 确认丢弃：到期的自动保存不能把刚丢弃的编辑写回盘
  }
  if (window.__webDetach) window.__webDetach(); // 守卫通过 → 摘 web view（原生 view 盖住一切 DOM）
  // 退出编辑器态：停 watch、拆编辑内核（块+基础都拆）、清 docPath（非可编辑文件没有保存目标）
  window.ws2.unwatchDoc();
  detachEditors();
  loadGen++; frame.onload = null; // 对称 #94 shellCloseDoc：作废在飞导航，否则晚到的 load 把块编辑器挂上查看器底下的隐藏 iframe（幽灵脏态）
  docPath = null; docContext = null;
  docInfo = null;
  docPageCfg = null; // 查看器态没有分页概念（对称 shellCloseDoc）
  setDirty(false);
  frame.hidden = true;
  frame.removeAttribute('src');
  frame.removeAttribute('srcdoc');
  home.hidden = true;
  docHeader.hidden = true;
  if (docStatus) docStatus.hidden = true;
  exportBtn.disabled = true; // 非 html 不能导出
  if (exportMdBtn) exportMdBtn.disabled = true;
  if (window.__sbHooks) window.__sbHooks.onOpen(node.abs); // 侧栏高亮当前查看的文件

  const kind = node.kind || 'other';
  viewer.innerHTML = '';
  if (kind === 'image' || kind === 'pdf') {
    let url = null;
    // 根内走 (rootId, rel)，根外走 abs（「打开」按钮选的）；取不到就退化成外部打开卡片。
    try { url = node.rel ? await window.ws2.wsFileUrl(node.rootId, node.rel) : await window.ws2.fileUrlAbs(node.abs); } catch (e) { /* 退化成卡片 */ }
    if (url) {
      if (kind === 'pdf') {
        // PDF.js 渲染（连续滚动 canvas + 自己的一行工具栏）；替代 Chromium 内置 viewer（B7 合并工具栏 / B8 无预览栏）
        await window.WS2PdfViewer.mount(viewer, url, { fileName: node.name, openExternalEl: openExternalBtn(node, 'fv-open') });
        return;
      }
      const bar = document.createElement('div');
      bar.className = 'fv-bar';
      const name = document.createElement('span');
      name.className = 'fv-name';
      name.textContent = node.name;
      name.title = node.name; // 名字过长被截断时，悬停显示全名
      const tag = document.createElement('span');
      tag.className = 'fv-tag';
      tag.textContent = window.wsT('shell.imageReadonly');
      const sp = document.createElement('div');
      sp.className = 'fv-sp';
      bar.append(name, tag, sp, openExternalBtn(node, 'fv-open'));
      viewer.appendChild(bar);
      const scroll = document.createElement('div');
      scroll.className = 'imgv-scroll';
      // 影院式画框（T3 对齐 ui-demo ImageViewer）：深色底 + figure 圆角画框 + 文件名标题
      const fig = document.createElement('figure');
      fig.className = 'imgv-frame';
      const img = document.createElement('img');
      img.className = 'imgv-img';
      img.src = url;
      img.alt = node.name;
      const cap = document.createElement('figcaption');
      cap.className = 'imgv-cap';
      cap.textContent = node.name;
      fig.append(img, cap);
      scroll.appendChild(fig);
      viewer.appendChild(scroll);
      viewer.hidden = false;
      return;
    }
  }
  // Word/表格/演示/其他（或图片/PDF 取 URL 失败）→ 外部打开卡片
  const wrap = document.createElement('div');
  wrap.className = 'efp';
  const card = document.createElement('div');
  card.className = 'efp-card';
  const ico = document.createElement('div');
  ico.className = 'efp-ico';
  ico.innerHTML = bigIconSvg();
  const name = document.createElement('div');
  name.className = 'efp-name ws-truncate';
  name.textContent = node.name;
  name.title = node.name; // 名字过长被截断时，悬停显示全名
  const meta = document.createElement('div');
  meta.className = 'efp-meta ws-truncate';
  meta.textContent = kindLabel(kind) + ' · ' + (node.rel || node.name);
  const note = document.createElement('p');
  note.className = 'efp-note';
  note.textContent = window.wsT('shell.notHtmlNote');
  card.append(ico, name, meta, note, openExternalBtn(node, 'efp-open'));
  wrap.appendChild(card);
  viewer.appendChild(wrap);
  viewer.hidden = false;
}
window.__shellShowViewer = showViewer;

// 打开真实文件：iframe 直接指向 file:// URL（主进程 pathInfo 算，跨平台正确），
// 文档拥有自己的 CSP 上下文、相对资源天然解析。
function loadFromFile(opts) {
  detachEditors();
  const gen = ++loadGen;
  const wantUrl = docInfo.fileUrl;
  // 分流（Feature 3）：docConform 由 openDoc/reloadDoc 先判好。合规→完整块编辑；不合规→基础编辑 + 降级条。
  frame.onload = () => {
    if (gen !== loadGen) return;
    if (!loadedIsExpected(wantUrl)) return; // U0 硬化：iframe 若被导航到别的文件（漏网的表单/meta-refresh），绝不把编辑器挂错页
    docConform ? wireEditor() : attachBasic();
  };
  frame.removeAttribute('srcdoc');
  frame.src = docInfo.fileUrl;
  prepFrame(opts && opts.asDirty);
}
// U0 硬化：onload 时校验 iframe 真的停在预期文档上，防「被漏网导航（表单/meta-refresh/未覆盖的锚点）打飞后，
// 晚到的 load 把编辑器挂错页 + 自动保存写错文件」。三条渲染路径都接（file:// 直载 / srcdoc / reload），别只护一条。
//   wantUrl 给了（file:// 直载 / reload 落地）：比对 decode 后 pathname，导航去别的 file:// 文件 → false。
//   wantUrl 省略（srcdoc：.md / 临时 / 历史恢复，预期停在 about:srcdoc）：一旦变成 file:// 就是被导航走 → false。
// about:blank（reload 中转）→ true；读不到 location（不该发生）→ 保守 true，不误挡正常载入。
function loadedIsExpected(wantUrl) {
  try {
    const cur = new URL(frame.contentWindow.location.href);
    if (!wantUrl) return cur.protocol !== 'file:'; // srcdoc 路径：跑到 file:// = 被导航走
    if (cur.protocol !== 'file:') return true; // about:blank 中转 / 尚未落地
    const want = new URL(wantUrl);
    return decodeURIComponent(cur.pathname) === decodeURIComponent(want.pathname);
  } catch (e) { return true; }
}

// 外部磁盘改动后重新载入磁盘版本（Bug2：用 Claude 等外部工具改完，自动刷新渲染）。
// 同一 file:// URL 直接赋 frame.src 不会重导航 → 先 about:blank 再设回，强制刷新一次。
// loadGen 守卫：若重载途中又来一次载入（外部连续改动 / 同时打开别的文档），旧 onload 作废，
// 不把 wireEditor 跑在 about:blank 或错误文档上。setDirty(false) 放到真正载完磁盘版本后才清。
async function reloadDoc() {
  const p = docPath;
  if (!p) return;
  discardPendingAutoSave(); // 旧 DOM 的自动保存不能在重载让出期开火（会把将被替换的内容写回盘）
  let raw = null;
  try { raw = await window.ws2.readDoc(p); } catch (e) { /* 读失败：保留现有编辑器，等下一拍/用户操作 */ }
  // 身份守卫（审计 P1）：await 让出期间用户切了文档 → 这次重载作废。没有这行，旧文档内容会灌进
  // 新文档身份（md 分支直接 srcdoc 渲染旧 raw），自动保存随后把 A 的内容写进 B——跨文件数据覆盖；
  // docConform 也会被旧内容覆写、给新文档挂错编辑器。
  if (docPath !== p) return;
  if (raw != null) docConform = routeDoc(raw); // 外部改动可能翻转合规性 → 重判分流
  // .md：渲染内容不在磁盘文件里（是 read-doc 的转换产物）→ 重载 = 重新 srcdoc（赋值天然重导航，
  // 不需要下面 about:blank 的二段跳）。读盘失败时不拆不换——保留现有编辑器可继续编辑/另存，
  // 而不是「可见但点不动」的悬挂态（loadFromHtml 内部自带 detachEditors）。
  if (isMdPath(p)) { if (raw != null) loadFromHtml(raw); return; } // md 走 loadFromHtml→prepFrame 已遮
  detachEditors();
  if (window.WS2DocTheme) window.WS2DocTheme.maskForLoad(); // 非 md reload:遮住防深色闪白(syncDocDark 揭开)
  const gen = ++loadGen;
  const wantUrl = docInfo.fileUrl;
  frame.onload = () => {
    if (gen !== loadGen) return; // 被更晚的载入抢占
    frame.onload = () => { if (gen !== loadGen) return; if (!loadedIsExpected(wantUrl)) return; docConform ? wireEditor() : attachBasic(); setDirty(false); };
    frame.src = docInfo.fileUrl;
  };
  frame.removeAttribute('srcdoc');
  frame.src = 'about:blank';
}

// srcdoc 文档继承外壳的严格 CSP（style-src 无 unsafe-inline）→ 文档里的 <style> 元素和 style= 属性
// 全被拦死（实测：临时文档 body max-width:none / style="color:red" 不生效，console 报
// "Applying inline style violates …style-src"；file:// 载入有自己的 CSP 上下文、不受影响）。
// 不削弱外壳 CSP（S4 红线），改把文档样式镜像成 CSSOM 再应用——CSSOM 不受 style-src 限制
// （repo 既有共识：sidebar.js 模板卡 borderTopColor 同注释）：
//   ① 全部 <style> 的文本合并进一张构造样式表（adoptedStyleSheets；不在 DOM、不进序列化）；
//   ② style= 属性用 el.style.cssText 重放（只在 CSP 拦掉后 el.style 为空时补，属性文本会被
//      规范化重写——临时文档没有磁盘基线、无损；历史恢复只变属性书写形态、不改 CSS 语义）；
//   ③ MutationObserver 盯后续动态加的 <style>（编辑器 ensureSchemaBaseline/ensureTodoStyle
//      等「入盘样式」在 srcdoc 里 append 时同样被 CSP 拦）与新写的 style= 属性，随写随镜像。
function mirrorSrcdocStyles(doc) {
  const win = doc.defaultView;
  if (!win || typeof win.CSSStyleSheet !== 'function') return;
  let sheet;
  try { sheet = new win.CSSStyleSheet(); } catch (e) { return; }
  const sync = () => {
    let css = '';
    for (const s of doc.querySelectorAll('style')) css += s.textContent + '\n';
    try { sheet.replaceSync(css); } catch (e) { /* 坏 CSS 尽力而为：replaceSync 会跳过坏规则，只有整体解析炸才到这 */ }
  };
  const replayAttr = (el) => {
    // CSP 拦掉的标志：属性有值而 CSSOM 声明表为空。重放后 length>0，观察器再进来会跳过（不自激）。
    const t = el.getAttribute && el.getAttribute('style');
    if (t && el.style && el.style.length === 0) { try { el.style.cssText = t; } catch (e) { /* 忽略坏值 */ } }
  };
  sync();
  doc.adoptedStyleSheets = [...(doc.adoptedStyleSheets || []), sheet]; // 编辑器自己的表（EDITOR_CSS/zoom）在 attach 时排它后面，覆盖关系跟 file:// 一致
  for (const el of doc.querySelectorAll('[style]')) replayAttr(el);
  const mo = new win.MutationObserver((muts) => {
    let styleTouched = false;
    for (const m of muts) {
      if (m.type === 'attributes') { replayAttr(m.target); continue; }
      if (m.type === 'characterData') {
        const p = m.target.parentElement;
        if (p && p.tagName === 'STYLE') styleTouched = true;
        continue;
      }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'STYLE' || (n.querySelector && n.querySelector('style'))) styleTouched = true;
        // 带着 style= 新插入的节点只有 childList 记录（attributes 记录只发给「已观察节点的属性变更」）→ 这里补重放
        replayAttr(n);
        if (n.querySelectorAll) for (const el of n.querySelectorAll('[style]')) replayAttr(el);
      }
      for (const n of m.removedNodes) if (n.nodeType === 1 && n.tagName === 'STYLE') styleTouched = true;
    }
    if (styleTouched) sync();
  });
  mo.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
}

// 载入一段 HTML 内容（历史恢复）：srcdoc + 注入 <base> 让相对资源指向原文件目录（用 docInfo.dirUrl）
function loadFromHtml(html, opts) {
  detachEditors();
  const gen = ++loadGen;
  // 历史恢复走同一文档既有 docConform；临时文档由 openTempDoc 先设好 docConform。injectBase 守 docInfo（临时文档无 docInfo/dirUrl）。
  frame.onload = () => {
    if (gen !== loadGen) return;
    if (!loadedIsExpected()) return; // U0 硬化：srcdoc 被导航去 file:// → 不接线（防编辑器挂错页 + 自动保存写错 .md/临时文档）
    if (docInfo && docInfo.dirUrl) injectBase(frame.contentDocument, docInfo.dirUrl);
    mirrorSrcdocStyles(frame.contentDocument); // 只在 srcdoc 路径镜像（file:// 不需要，也别去规范化真文件的 style 属性）
    docConform ? wireEditor() : attachBasic();
  };
  frame.removeAttribute('src');
  frame.srcdoc = html;
  prepFrame(opts && opts.asDirty);
}

// ===== 临时文档引擎 =====
// 切走当前活跃文档前的守卫：活跃是临时文档 → 序列化存回（随便走、不丢）；活跃是脏的真文件 → 问一下
// （单编辑器切走 = 丢编辑，跟 openDoc 的脏守卫一致）。返回 false = 用户取消、别切。
function canLeaveActive() {
  if (tempDoc) { stashActiveTemp(); return true; }
  if (dirty) {
    if (!confirm(window.wsT('shell.discardSwitch'))) return false;
    discardPendingAutoSave(); // 确认丢弃：同 openDoc，别让到期的自动保存把丢弃的编辑写回盘
  }
  return true;
}
// 新建一个临时文档并渲染：生成 id、存进 tempStore、渲染。返回 id 给侧栏建标签（取消切换则返回 null）。
function shellNewTemp(base, html) {
  if (!canLeaveActive()) return null;
  const id = genTempId();
  tempStore.set(id, { base: base || window.wsT('common.untitled'), html });
  renderTemp(id);
  return id;
}
// p2-6：外部删除了「打开中且脏」的真文档 → 别静默丢改动。把编辑器当前内容原地转挂成临时文档语义
// （docPath 清空、脱离已删磁盘文件、掐掉在途自动保存），返回 {id, base} 让侧栏建临时标签 + 弹 SaveModal
// 挽救。不走 canLeaveActive（那会弹「丢弃?」确认——这里正是要救它，不能问）。
function shellRescueDeletedDirty() {
  if (tempDoc || !docPath) return null; // 已是临时文档 / 没有真文件在开：不该走到这
  let html;
  try { html = serializeActiveDoc(); }
  catch (e) { return null; } // 序列化失败：救不了，交给调用方回落
  const base = String((docInfo && docInfo.name) || docName.textContent || window.wsT('common.untitled')).replace(/\.[^.]+$/, '');
  discardPendingAutoSave(); // 文件已被删，在途自动保存写它只会 ENOENT，先掐掉
  const id = genTempId();
  tempStore.set(id, { base, html });
  renderTemp(id); // 转成活跃临时文档（asDirty），docPath 清空 + unwatchDoc
  return { id, base };
}
// 切回一个已存在的临时文档（点它的标签）。
function shellReopenTemp(id) {
  if (!tempStore.has(id)) return false;
  if (!canLeaveActive()) return false; // 切走守卫（活跃脏文档「丢弃?」）被用户取消 → 没切成
  renderTemp(id);
  return true;
}
// 渲染某临时文档进编辑器（切走守卫由 canLeaveActive 处理过）。
function renderTemp(id) {
  const rec = tempStore.get(id);
  if (!rec) return;
  if (window.__webDetach) window.__webDetach(); // 浏览器 feature：先摘 web view
  window.ws2.unwatchDoc(); // 临时文档没有磁盘监听目标
  docPath = null; docContext = null;
  docInfo = { name: rec.base };
  tempDoc = { id, base: rec.base };
  zoomFactor = 1;
  // ⚠ schema-1 rebase 钩子（handoff-schema1-integration.md §2）：schema-1 的 iframe onload 按模块变量
  // docConform 决定挂块编辑器还是基础编辑器，而 loadFromHtml 故意不改 docConform（历史恢复复用既有判定）。
  // 临时文档是新文档、必须显式设，否则读到上一个文档的陈旧 docConform、编辑器错挂。
  docConform = routeDoc(rec.html); // handoff §2：临时文档显式设分流判定（模板产物合规→块编辑；万一非合规也正确降级）——否则读到上个文档陈旧 docConform、编辑器错挂
  loadFromHtml(rec.html, { asDirty: true }); // srcdoc 渲染；临时 = 未保存 = 脏（面包屑显「● 未保存」）
  docName.textContent = rec.base;
  docName.title = rec.base;
  exportBtn.disabled = true; // 临时文档没落盘、不能导出（保存后才亮）
  if (exportMdBtn) exportMdBtn.disabled = true; // 导出 md 同理（updateExportMd 的 tempDoc 闸也兜着）
}
// 把当前活跃临时文档的编辑内容序列化存回 tempStore（切走 / 保存前调，防单编辑器切标签丢内容）。
function stashActiveTemp() {
  if (!tempDoc) return;
  try {
    const html = serializeActiveDoc();
    const rec = tempStore.get(tempDoc.id) || { base: tempDoc.base };
    tempStore.set(tempDoc.id, { base: rec.base, html });
  } catch (e) { /* 序列化失败：留上一次 stash */ }
}
// 保存对话框要用的当前活跃临时文档快照（id/base/最新 html）。侧栏 SaveModal 读它。
function shellActiveTemp() {
  if (!tempDoc) return null;
  let html;
  try { html = serializeActiveDoc(); }
  catch (e) { html = (tempStore.get(tempDoc.id) || {}).html || ''; }
  return { id: tempDoc.id, base: tempDoc.base, html };
}
// 临时文档已落盘（SaveModal 存完）→ 就地把编辑器指向真文件（不重载，内容与刚序列化的一致）。
async function shellFinalizeTemp(id, abs, name) {
  tempStore.delete(id);
  if (!tempDoc || tempDoc.id !== id) return; // 保存的不是当前活跃项（当前流程不会发生）：只清 store
  let info;
  try { info = await window.ws2.pathInfo(abs); } catch (e) { info = { name }; }
  tempDoc = null;
  docPath = abs;
  docInfo = info;
  docName.textContent = name;
  docName.title = name;
  window.ws2.watchDoc(abs);
  exportBtn.disabled = false;
  updateExportMd(); // 落盘成真文件（合规 html）后「导出为 Markdown」的四个门已全开，别停在 renderTemp 的禁用态
  setDirty(false);
  flashSaved();
}
// 丢弃一个临时文档（未保存关闭选「不保存」）。是活跃项则清编辑器脏态，免得回落时误弹脏守卫。
function shellDiscardTemp(id) {
  tempStore.delete(id);
  if (tempDoc && tempDoc.id === id) { tempDoc = null; setDirty(false); }
}

async function openDoc(p) {
  const wasWebActive = window.__webIsActive && window.__webIsActive(); // 浏览器 feature：进来时激活的是不是网页标签
  // 修 SH-4 + 浏览器 feature P1-2：点已打开文档的标签/树行。
  // ① 非 web 态点已激活文档 → no-op（旧行为）。
  // ② **web 态**点「已载入的后台文档」标签（p===docPath,iframe 内容还在）→ 不重载（重载会丢它的未保存
  //    编辑）,但必须摘 web view 显示 iframe + 把 activeRel 切回文档（onOpen 设）——否则 activeRel 滞留在
  //    web 标签,地址栏/⌘S/⌘W 全作用到看不见的网页上（状态分裂）。
  if (p === docPath && !tempDoc) {
    if (wasWebActive) {
      if (window.__webDetach) window.__webDetach();
      if (window.__sbHooks && window.__sbHooks.onOpen) window.__sbHooks.onOpen(docPath);
    }
    return;
  }
  const seq = ++openSeq; // 修 SH-1：本次 open 的序号；await 期间又开/关了别的文档，落地时作废（最后点击者赢）
  // 没真打开成 → 撤销 onOpenFile 设的 __pendingColdOpen，否则它会一直抑制后续 loadTabs 的「恢复激活标签」
  // （如 app 已开 + 当前文档脏，第二实例双击别的文件、用户点「取消」时会走到这）。
  // 离开活跃临时文档：序列化存回 tempStore（不弹脏守卫，切回它还在）；真文件仍走原脏守卫。
  // ⚠ 脏守卫在**摘 web view 之前**（浏览器 feature P2-1）：用户点「取消」时什么都不该动、网页态保留;
  //    原来 __webDetach 在最前,取消后 view 已摘=网页态丢失、露出旧文档。脏确认对 web 态也要保留——
  //    web 态下 dirty 属于后台文档 A,切去别的文档 B 会让 A 让位,不问就丢了 A 的未保存编辑。
  if (tempDoc) { stashActiveTemp(); tempDoc = null; }
  else if (dirty) {
    if (!confirm(window.wsT('shell.discardOpenNew'))) { window.__pendingColdOpen = null; return; }
    discardPendingAutoSave(); // 确认丢弃：到期的自动保存不能在下面 readDoc 的让出期把刚丢弃的编辑写回盘
  }
  if (window.__webDetach) window.__webDetach(); // 守卫通过、确定打开新文档 → 摘 web view
  let info; let raw; // raw：接住磁盘原始文本做 Feature 3 分流判定（routeDoc）
  try {
    // 校验文件存在 + UTF-8（拒非 UTF-8 防损坏）；接住返回的原始文本做分流判定（Feature 3，不新增 IPC）；再取 file:// URL 等
    raw = await window.ws2.readDoc(p);
    info = await window.ws2.pathInfo(p);
  } catch (e) {
    alert(window.wsT('shell.cannotOpenFile', { path: p }) + '\n' + (e.message || e));
    window.__pendingColdOpen = null;
    return;
  }
  if (seq !== openSeq) return; // 修 SH-1：await 期间用户又开了别的文档 → 这次陈旧 open 作废，别灌进新文档身份
  docPath = p;
  docInfo = info;
  docContext = null; refreshDocContext(p); // U3：算当前文档 rootId+rel（提及菜单/断链判定用）
  docConform = routeDoc(raw); // 合规→完整编辑 / 不合规→基础编辑（判磁盘原始字节 reparse，§4.3 铁律③）
  zoomFactor = 1; // 新文档从 100% 开始（wireEditor 会按这个重挂缩放）
  // .md 走 srcdoc（KD-1）：iframe file:// 直载 .md 会被 Chromium 当纯文本渲染；readDoc 返回的 raw
  // 已是转换好的 HTML，loadFromHtml 的 injectBase(dirUrl) 让相对图片照常解析。
  if (isMdPath(p)) loadFromHtml(raw);
  else loadFromFile();
  window.ws2.watchDoc(p); // 盯外部磁盘改动（Bug2）；换文档时主进程会重指向到新路径
  // 先建标签/高亮（onOpen 内会清 __pendingColdOpen）。放在 recents 之前，且 recents 设成尽力而为：
  // recents 写盘失败（userData 只读/满）不该把建标签和清标记一起拖死——否则冷启动标签丢 + 标记泄漏。
  if (window.__sbHooks) window.__sbHooks.onOpen(docPath);
  else window.__pendingColdOpen = null; // 无侧栏（单文件态）：没有 onOpen 来清，自己清，免得泄漏到将来开工作区
  try { await window.ws2.recentsAdd(p); } catch (e) { /* recents 是尽力而为，失败不影响打开 */ }
  renderRecents();
}

// 给侧栏（sidebar.js）用：当前打开文件被改名/移动后，把 app 内部状态指向新路径（不重载内容，
// 只换保存目标 + watcher + 面包屑/高亮）。被删则回到空态。
function shellRetargetDoc(newAbs, newName) {
  docPath = newAbs;
  docInfo = Object.assign({}, docInfo, { name: newName });
  docContext = null; refreshDocContext(newAbs); // 改名/移动 → rel 变，重算互链身份
  docName.textContent = newName;
  docName.title = newName; // 名字过长被截断时，悬停显示全名
  window.ws2.watchDoc(newAbs);
  if (window.__sbHooks) window.__sbHooks.onOpen(docPath);
}
function shellCloseDoc() {
  if (window.__webDetach) window.__webDetach(); // 浏览器 feature：回空态也要摘 web view
  window.ws2.unwatchDoc();
  loadGen++; // 作废所有在飞/陈旧的 frame.onload（否则晚到的 load 会把编辑器/降级条重新挂回空白页）
  openSeq++; // 修 SH-1：关文档也作废在飞的 openDoc（await 期间关掉 → 落地时不该把内容挂回来）
  frame.onload = null;
  detachEditors();
  docPath = null; docContext = null;
  docInfo = null;
  tempDoc = null;
  docPageCfg = null; // 关文档清分页配置（防陈旧值泄漏到下一个上下文；openDoc 的 routeDoc 会重设）
  setDirty(false);
  frame.hidden = true;
  frame.removeAttribute('src');
  frame.removeAttribute('srcdoc'); // 临时文档关掉后别让 srcdoc 内容留在 iframe 里（虽已 hidden，清干净）
  docHeader.hidden = true;
  if (docStatus) docStatus.hidden = true;
  closeViewer();
  exportBtn.disabled = true;
  if (exportMdBtn) exportMdBtn.disabled = true;
  home.hidden = false;
}
window.__shellRetargetDoc = shellRetargetDoc;
window.__shellCloseDoc = shellCloseDoc;
window.__shellDocPath = () => docPath;
window.__shellIsDirty = () => dirty; // 给侧栏关标签时的脏检查
window.__shellDiscard = () => setDirty(false); // 已确认丢弃 → 清脏，切下一个时不再追问
// 临时文档桥（侧栏 sidebar.js 用）：建/切/取快照/落盘就位/丢弃。
window.__shellNewTemp = shellNewTemp;
window.__shellRescueDeletedDirty = shellRescueDeletedDirty; // p2-6：外部删脏文档 → 转临时文档挽救
window.__shellReopenTemp = shellReopenTemp;
window.__shellStashActiveTemp = () => stashActiveTemp(); // 切到网页标签前 stash 活跃临时文档（不关闭,切回即恢复）
window.__shellActiveTemp = shellActiveTemp;
window.__shellFinalizeTemp = shellFinalizeTemp;
window.__shellDiscardTemp = shellDiscardTemp;
window.__shellIsTemp = () => !!tempDoc; // 当前活跃的是不是临时文档
window.__shellSaveActive = () => save(); // 「保存并关闭」里保存已落盘的脏文档用（返回 promise）
window.__shellPauseAutosave = pauseAutoSave; // 修 SH-3：侧栏关闭确认弹窗开合时挂起/恢复自动保存
window.__shellResumeAutosave = resumeAutoSave;
// 侧栏收起/展开改了 iframe 几何（真收起：宽 260→0，编辑区 iframe 横移）→ 编辑器宿主浮层（块编辑手柄/气泡，
// position:fixed、坐标=iframe 矩形+元素矩形）要重定位，否则飘。复用 resize handler 那套调用（handoff §3）。
// handoff §3：块编辑手柄/气泡 + 基础编辑器格式条都是 position:fixed 宿主浮层，收起改 iframe 几何后都要重定位。
window.__shellReposition = () => { if (blockEdit) blockEdit.reposition(); if (basicEdit) basicEdit.reposition(); if (pagination) pagination.refresh(); if (window.WS2Find) window.WS2Find.reposition(); if (window.WS2Mention) window.WS2Mention.reposition(); if (window.WS2LinkView) window.WS2LinkView.reposition(); };

// 「打开」按钮：选任意文件 → 按 kind 分流。html 进编辑器（openDoc 漏斗，含建标签）；图片/PDF/其它走
// 应用内查看器 showViewer（图片·PDF 预览、其余给「默认程序打开」卡片）。工作区内的文件 onOpen 会建标签
// （像浏览器开标签页）；工作区外的能预览但不进标签（产品决策 B）。
async function pickAndOpen() {
  const p = await window.ws2.pickFile();
  if (!p) return;
  let meta;
  try { meta = await window.ws2.classifyFile(p); }
  catch (e) { meta = { kind: 'other', name: baseName(p), rel: null, rootId: null }; }
  if (meta.kind === 'html' || meta.kind === 'md') {
    openDoc(p);
  } else {
    // rootId 跟着 rel 走：根内文件查看器走 wsFileUrl(rootId, rel)（assertInsideWorkspace 守卫那条）
    showViewer({ abs: p, rel: meta.rel, rootId: meta.rootId, name: meta.name || baseName(p), kind: meta.kind });
  }
}

async function save() {
  // 临时文档：没有落盘目标 → 弹「保存到哪里」（侧栏 SaveModal，它有文件树 + wsNewDoc）。early-return 在
  // 序列化行之前，所以跟 schema-1 的 `basicEdit ? WS2BasicEdit.serialize : WS2Serialize` 三元不打架。
  // ⚠ schema-1 rebase（handoff §1）：下面这行取 schema-1 的三元版，别覆盖成单一 WS2Serialize。
  if (tempDoc) { if (window.__sbHooks && window.__sbHooks.openSaveModal) window.__sbHooks.openSaveModal(false); return; }
  if (!docPath || !dirty) return;
  discardPendingAutoSave(); // 修 SH-9：本次已在存，取消 pending 定时器，别在下面 await 让出期二次开火（双写盘+归档重复）
  const cd = frame.contentDocument;
  // 修 SH-8/MP-1：reloadDoc 的 about:blank 二段跳 / 半载期间序列化会产空壳（非空串、绕过 writeDocSafe 拒空），
  // 把真文件覆盖成空 HTML 还闪「✓ 已保存」。要求编辑器确实挂在真实文档上（block 有 canvas/root 标记；basic 有实例）。
  if (!cd || (!basicEdit && !cd.querySelector('[data-ws2-canvas],[data-ws2-root]'))) return;
  // 基础编辑（非合规）走结构保真序列化（剥编辑态、不 Schema 规整）；完整编辑走 block serialize。
  const html = serializeActiveDoc();
  let result;
  try {
    result = await window.ws2.saveDoc(docPath, html);
  } catch (e) {
    alert(window.wsT('shell.saveFailed', { err: e.message || e }));
    return;
  }
  setDirty(false);
  if (result && result.archiveWarning) {
    alert(window.wsT('shell.saveArchiveWarn', { warn: result.archiveWarning }));
  } else {
    flashSaved(); // 归档警告已经弹了 alert 就不再闪「已保存」，免得自相矛盾
  }
}

async function renderRecents() {
  // 空态已换成导览页(start-page.js 渲染时间流);这里只做委托——openDoc 成功后照旧调本函数刷新。
  // 模块加载序:shell.js 先于 start-page.js,boot 那次调用落空没关系,start-page 自己首渲。
  if (window.__startPage) window.__startPage.refresh();
}

// 另存为（Colin 2026-07-02：自动保存后「保存」钮失义；另存为=把当前文档复制存到任意位置）。
// 临时文档=首次保存（SaveModal 选名字/位置）；真文件=先冲一次原文件（免得切走时弹丢弃守卫/丢
// 最后 1.2s 的尾巴）→ 原生另存框写副本 → 切到副本（标准另存为语义；工作区外=↗ 外部标签）。
async function saveAs() {
  if (saveBtn.disabled) return;
  if (tempDoc) { if (window.__sbHooks && window.__sbHooks.openSaveModal) window.__sbHooks.openSaveModal(false); return; }
  if (!docPath) return;
  if (dirty) await save();
  const cd = frame.contentDocument;
  // 修 SH-8：同 save()——重载二段跳期间别把空壳另存成空副本（外部改动触发的静默 reload 期间点「另存为」）。
  if (!cd || (!basicEdit && !cd.querySelector('[data-ws2-canvas],[data-ws2-root]'))) { alert(window.wsT('shell.docNotReadyRetry')); return; }
  const html = basicEdit
    ? WS2BasicEdit.serialize(cd)
    : WS2Serialize.serializeDocument(cd);
  let r;
  try { r = await window.ws2.wsSaveDocAs(baseName(docPath).replace(/\.(html?|md)$/i, ''), html, isMdPath(docPath) ? 'md' : undefined); } // 另存为保持原格式（KD-6）
  catch (e) { alert(window.wsT('shell.saveAsFailed', { err: e.message || e })); return; }
  if (!r || r.canceled || !r.abs) return;
  await openDoc(r.abs);
  flashSaved();
}
// ⋯ 菜单开合：点钮切换、点外面/Esc/选完条目收起（disabled 项点了不派发 click、菜单留着）。
const docMenuBtn = document.getElementById('doc-menu-btn');
const docMenu = document.getElementById('doc-menu');
if (docMenuBtn && docMenu) {
  docMenuBtn.onclick = () => { docMenu.hidden = !docMenu.hidden; };
  docMenu.addEventListener('click', () => { docMenu.hidden = true; });
  document.addEventListener('mousedown', (e) => {
    if (docMenu.hidden) return;
    if (docMenu.contains(e.target) || docMenuBtn.contains(e.target)) return;
    docMenu.hidden = true;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !docMenu.hidden) docMenu.hidden = true; });
}
window.__shellOpenAiAccess = openAiAccessModal; // 侧栏页脚 AI 钮（sidebar.js）也开同一个弹窗

// ---- 页面设置（分页文档 = Schema 1 可选版式）----
// 只对「合规 html 文档 + 块编辑器已挂」开放（md 的入盘格式装不下 page 块；非合规走基础编辑不套页面概念）。
function updatePageSetupBtn() { // 惰性取元素：detachEditors 等调用点在 DOM 早期就会跑到
  const b = document.getElementById('page-setup-btn');
  if (b) b.disabled = !(blockEdit && (docPath || tempDoc) && !isMdPath(docPath || ''));
}
// 应用页面设置：cfg=null 关分页（移除 page 块）；否则写入/更新 canonical page CSS（buildPageCss）。
// 页码开关走 head 的 meta[name="ws-page-numbers"]（head 白名单放行 meta[name]，conform 不受影响）。
// 轻量重接（不动 undoMgr / 块内核）：分页引擎 detach/attach + docPageCfg 同步 + markDirty（自动保存落盘）。
function applyPageSetup(cfg, pageNumbers) {
  const doc = frame.contentDocument;
  if (!doc || !blockEdit) return;
  const head = doc.head || doc.documentElement;
  let st = head.querySelector('style[data-ws-schema-css="page"]');
  if (!cfg) {
    if (st) st.remove();
  } else {
    if (!st) { st = doc.createElement('style'); st.setAttribute('data-ws-schema-css', 'page'); head.appendChild(st); }
    st.textContent = WS2SchemaPage.buildPageCss(cfg);
  }
  let m = head.querySelector('meta[name="ws-page-numbers"]');
  if (cfg && pageNumbers) {
    if (!m) { m = doc.createElement('meta'); m.setAttribute('name', 'ws-page-numbers'); head.appendChild(m); }
    m.setAttribute('content', 'true');
  } else if (m) { m.remove(); }
  docPageCfg = cfg || null;
  if (pagination) { pagination.detach(); pagination = null; }
  if (cfg && window.WS2Pagination) pagination = WS2Pagination.attach(doc, { win: frame.contentWindow, config: cfg });
  if (blockEdit) blockEdit.reposition(); // 纸面几何变了，手柄/气泡重定位
  markDirty();
}
// 页面设置弹窗：所有改动即时生效（弹窗背后分页视图实时变，关掉弹窗就是「完成」）——对齐 ui-demo
// PageSetupModal 的行为契约（docs/features/paged-doc.md）。
function openPageSetupModal() {
  if (!blockEdit || document.querySelector('.ws-pgs-overlay')) return;
  const doc = frame.contentDocument;
  const P = window.WS2SchemaPage;
  // 工作副本（引擎当前配置 / 默认）；nums 从活文档 head 读
  let on = !!docPageCfg;
  let cfg = docPageCfg
    ? { size: docPageCfg.size, orientation: docPageCfg.orientation, margin: { ...docPageCfg.margin } }
    : { size: 'A4', orientation: 'portrait', margin: { ...P.DEFAULT_PAGE.margin } };
  let nums = !!(doc.head && doc.head.querySelector('meta[name="ws-page-numbers"][content="true"]'));

  const overlay = document.createElement('div');
  overlay.className = 'sb-modal-overlay ws-pgs-overlay';
  const sizeOpts = Object.keys(P.PAGE_SIZES).map((s) => '<option value="' + s + '"' + (s === cfg.size ? ' selected' : '') + '>' + s + '</option>').join('');
  overlay.innerHTML =
    '<div class="sb-modal ws-pgs-modal">' +
      '<div class="sb-modal-head"><div class="sb-modal-head-text">' +
        '<div class="sb-modal-title">' + window.wsT('shell.pageSetupTitle') + '</div>' +
        '<div class="sb-modal-where">' + window.wsT('shell.pageSetupWhere') + '</div></div>' +
        '<button class="sb-modal-x" id="pgs-x" aria-label="' + window.wsT('common.close') + '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<label class="ws-pgs-row ws-pgs-toggle"><input type="checkbox" id="pgs-on"' + (on ? ' checked' : '') + '> ' + window.wsT('shell.pagedDocLabel') + '</label>' +
      '<div id="pgs-body"' + (on ? '' : ' class="ws-pgs-off"') + '>' +
        '<div class="ws-pgs-row"><span class="ws-pgs-lbl">' + window.wsT('shell.paper') + '</span><select id="pgs-size">' + sizeOpts + '</select>' +
          '<select id="pgs-orient"><option value="portrait"' + (cfg.orientation === 'portrait' ? ' selected' : '') + '>' + window.wsT('shell.portrait') + '</option><option value="landscape"' + (cfg.orientation === 'landscape' ? ' selected' : '') + '>' + window.wsT('shell.landscape') + '</option></select></div>' +
        '<div class="ws-pgs-row"><span class="ws-pgs-lbl">' + window.wsT('shell.margin') + '</span><select id="pgs-preset">' +
          '<option value="normal">' + window.wsT('shell.marginNormal') + '</option><option value="narrow">' + window.wsT('shell.marginNarrow') + '</option><option value="wide">' + window.wsT('shell.marginWide') + '</option><option value="custom">' + window.wsT('shell.marginCustom') + '</option></select></div>' +
        '<div class="ws-pgs-row ws-pgs-margins">' +
          ['top', 'right', 'bottom', 'left'].map((k, i) => '<label>' + [window.wsT('shell.marginTop'), window.wsT('shell.marginRight'), window.wsT('shell.marginBottom'), window.wsT('shell.marginLeft')][i] + ' <input type="number" min="0" max="80" step="0.1" id="pgs-m-' + k + '" value="' + cfg.margin[k] + '"> mm</label>').join('') +
        '</div>' +
        '<label class="ws-pgs-row ws-pgs-toggle"><input type="checkbox" id="pgs-nums"' + (nums ? ' checked' : '') + '> ' + window.wsT('shell.pageNumbersLabel') + '</label>' +
      '</div>' +
      '<div class="ws-pgs-actions"><button id="pgs-done" class="ws-pgs-btn ws-pgs-primary">' + window.wsT('common.done') + '</button></div>' +
    '</div>';
  const $ = (id) => overlay.querySelector('#' + id);
  const presetOf = (mg) => Object.keys(P.MARGIN_PRESETS).find((k) => ['top', 'right', 'bottom', 'left'].every((e) => P.MARGIN_PRESETS[k][e] === mg[e])) || 'custom';
  $('pgs-preset').value = presetOf(cfg.margin);
  function readMargins() {
    const mg = {};
    for (const k of ['top', 'right', 'bottom', 'left']) {
      const v = parseFloat($('pgs-m-' + k).value);
      mg[k] = (Number.isFinite(v) && v >= 0 && v <= 80) ? Math.round(v * 10) / 10 : 25.4; // 越界回默认，别让 NaN 入盘
    }
    return mg;
  }
  const sync = () => applyPageSetup(on ? cfg : null, on && nums); // 即时生效（关分页时页码 meta 一并清）
  $('pgs-on').onchange = () => {
    on = $('pgs-on').checked;
    $('pgs-body').classList.toggle('ws-pgs-off', !on);
    sync();
  };
  $('pgs-size').onchange = () => { cfg.size = $('pgs-size').value; sync(); };
  $('pgs-orient').onchange = () => { cfg.orientation = $('pgs-orient').value; sync(); };
  $('pgs-preset').onchange = () => {
    const p = P.MARGIN_PRESETS[$('pgs-preset').value];
    if (!p) return; // 自定义：等用户改输入框
    ['top', 'right', 'bottom', 'left'].forEach((k) => { $('pgs-m-' + k).value = p[k]; });
    cfg.margin = { ...p };
    sync();
  };
  ['top', 'right', 'bottom', 'left'].forEach((k) => {
    $('pgs-m-' + k).oninput = () => { cfg.margin = readMargins(); $('pgs-preset').value = presetOf(cfg.margin); sync(); };
  });
  $('pgs-nums').onchange = () => { nums = $('pgs-nums').checked; sync(); };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  $('pgs-x').onclick = close;
  $('pgs-done').onclick = close;
  overlay.onmousedown = (e) => { if (e.target === overlay) close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}
const pageSetupBtn = document.getElementById('page-setup-btn');
if (pageSetupBtn) pageSetupBtn.onclick = openPageSetupModal;

document.getElementById('open-btn').onclick = pickAndOpen;
// 打开文件夹（⋯ 菜单 / 菜单栏）：走侧栏的 pickFolder（含 WS2_FOLDER_IN 测试 seam 与工作区装载全流程）
const openFolderMenuBtn = document.getElementById('open-folder-btn');
if (openFolderMenuBtn) openFolderMenuBtn.onclick = () => { if (window.__sbHooks && window.__sbHooks.pickFolder) window.__sbHooks.pickFolder(); };
const homeOpenBtn = document.getElementById('home-open');
if (homeOpenBtn) homeOpenBtn.onclick = pickAndOpen;
saveBtn.onclick = saveAs; // 菜单里的「另存为…」；Cmd+S / 菜单栏「保存」仍走 save()（真文件即存、临时弹 SaveModal）
window.addEventListener('resize', () => { if (blockEdit) blockEdit.reposition(); if (basicEdit) basicEdit.reposition(); if (pagination) pagination.refresh(); if (window.WS2Find) window.WS2Find.reposition(); }); // 窗口尺寸变 → 浮层跟上
window.addEventListener('keydown', handleZoomKey); // 焦点在父层 shell（点过保存按钮/首页）时也能 Cmd± 缩放（iframe 内事件不冒泡到这）

// 外部磁盘改动（Bug2）：是当前文档才处理；有未保存改动先问，免得静默覆盖用户的编辑。
// 审计整改两条：①问之前缴械 pending 自动保存（到期定时器会在 confirm 之后的让出期把「用户刚决定
// 丢弃」的编辑写回盘）；②窗口隐藏驻留中（macOS 关窗后）别对隐形窗口弹阻塞 confirm——挂起，唤醒再问。
let pendingExternalChange = null;
function handleDocChanged(p) {
  if (!docPath || p !== docPath) return;
  if (dirty) {
    discardPendingAutoSave();
    if (document.hidden) { pendingExternalChange = p; return; }
    if (!confirm(window.wsT('shell.externalChangedConfirm'))) {
      scheduleAutoSave(); // 用户选保留自己的版本：恢复自动保存语义（跟旧行为一致，编辑照常落盘）
      return;
    }
  }
  reloadDoc();
}
window.ws2.onDocChanged(handleDocChanged);
// U4：链接索引刷新（目标文件增删/改名）→ 若刷的是当前文档所在根，重扫断链装饰自愈。
// 突发合并防抖：单次文件操作（如 @新建 create→save）会连发多个 links-index-updated，
// 每个都触发一轮 async resolveDocLink 扫描风暴、抢 IPC（U3-E 因此偶发翻车）。合并成一次。
let linksScanTimer = null;
window.ws2.onLinksUpdated((rootId) => {
  const c = window.__wsDocContext && window.__wsDocContext();
  if (!(c && c.rootId === rootId)) return;
  refreshBacklinks(); // U6：别的文档增删了指向本文档的链接 → 反链面板跟上（自带 blGen 防抖/守卫）
  if (!window.WS2LinkView) return;
  clearTimeout(linksScanTimer);
  linksScanTimer = setTimeout(() => window.WS2LinkView.scan(frame), 250);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pendingExternalChange) {
    const p = pendingExternalChange;
    pendingExternalChange = null;
    handleDocChanged(p);
  }
});

// 主进程发来「打开这个文件」（Finder 双击 / 文件关联 / 第二实例）。冷启动时这跟侧栏「恢复上次工作区」
// 并发：同步先标记 __pendingColdOpen，让 loadTabs 知道「这个文件该占 viewer，别拿上次激活标签抢」；
// 标签实际创建在 sidebar onOpen 里等恢复跑完才做（见 sidebar.js restoreReady）。
// PDF 等查看器类型分流进 showViewer（跟「打开」按钮 pickAndOpen 同一套口径）——2026-07-17 起
// fileAssociations 声明了 .pdf（Wendi「PDF 默认打开设为 Wordspace」），双击 PDF 不能再直塞编辑器。
window.ws2.onOpenFile(async (p) => {
  window.__pendingColdOpen = p;
  let meta;
  try { meta = await window.ws2.classifyFile(p); }
  catch (e) { meta = { kind: 'other', name: baseName(p), rel: null, rootId: null }; }
  if (meta.kind === 'html' || meta.kind === 'md') { openDoc(p); return; }
  await showViewer({ abs: p, rel: meta.rel, rootId: meta.rootId, name: meta.name || baseName(p), kind: meta.kind });
  // viewer 路径没有 sidebar onOpen 来清占位标记，自己清——否则泄漏到将来会一直抑制 loadTabs 恢复激活标签
  window.__pendingColdOpen = null;
});
// 「AI 接入」弹窗（菜单「AI 接入…」触发；对齐 ui-demo /agents 页两卡结构，复用统一模态壳 T1）。
// Prompt 文本经 IPC 读打包资源 src/renderer/ai-guide.md（与 docs/ 正本被防漂移测试锁逐字节一致）。
const AI_SKILL_CMD = 'npx skills add wordspace-ai/skills';
function openAiAccessModal() {
  if (document.querySelector('.aiax-overlay')) return; // 已开着别叠层
  const overlay = document.createElement('div');
  overlay.className = 'sb-modal-overlay aiax-overlay';
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  const modal = document.createElement('div');
  modal.className = 'sb-modal aiax-modal';
  const head = document.createElement('div');
  head.className = 'sb-modal-head';
  const ht = document.createElement('div');
  ht.className = 'sb-modal-head-text';
  ht.innerHTML = '<div class="sb-modal-title">' + window.wsT('shell.aiAccessTitle') + '</div><div class="sb-modal-where">' + window.wsT('shell.aiAccessWhere') + '</div>';
  const x = document.createElement('button');
  x.className = 'sb-modal-x';
  x.setAttribute('aria-label', window.wsT('common.close'));
  x.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  x.onclick = close;
  head.append(ht, x);
  const body = document.createElement('div');
  body.className = 'sb-modal-body';
  const flashBtn = (btn, ok) => { const t = btn.textContent; btn.textContent = ok; btn.disabled = true; setTimeout(() => { btn.textContent = t; btn.disabled = false; }, 1400); };

  // Tab 切换（Colin：skill 是方式一、标推荐；步骤写详但分页装）
  const tabs = document.createElement('div');
  tabs.className = 'aiax-tabs';
  const tabSkill = document.createElement('button');
  tabSkill.className = 'aiax-tab is-active';
  tabSkill.id = 'aiax-tab-skill';
  tabSkill.innerHTML = window.wsT('shell.installSkill') + ' <span class="aiax-badge">' + window.wsT('shell.recommended') + '</span>';
  const tabPrompt = document.createElement('button');
  tabPrompt.className = 'aiax-tab';
  tabPrompt.id = 'aiax-tab-prompt';
  tabPrompt.textContent = window.wsT('shell.copyPrompt');
  tabs.append(tabSkill, tabPrompt);

  // —— 面板一：安装 Skill ——
  const paneSkill = document.createElement('div');
  paneSkill.className = 'aiax-pane';
  const introSkill = document.createElement('div');
  introSkill.className = 'aiax-way-desc';
  introSkill.textContent = window.wsT('shell.skillIntro');
  const cmdRow = document.createElement('div');
  cmdRow.className = 'aiax-cmd';
  const cmdText = document.createElement('code');
  cmdText.textContent = AI_SKILL_CMD;
  const btnCmd = document.createElement('button');
  btnCmd.className = 'sb-btn aiax-copy-cmd';
  btnCmd.textContent = window.wsT('shell.copyCommand');
  btnCmd.onclick = async () => {
    try { await navigator.clipboard.writeText(AI_SKILL_CMD); flashBtn(btnCmd, window.wsT('shell.copied')); }
    catch (e) { alert(window.wsT('shell.copyFailed', { err: e.message || e })); }
  };
  cmdRow.append(cmdText, btnCmd);
  const steps = document.createElement('ol');
  steps.className = 'aiax-steps';
  // 步骤按 CLI 真实交互实测校准（expect 驱动过全流程，别凭 README 想象）
  steps.innerHTML =
    window.wsT('shell.installStep1') +
    window.wsT('shell.installStep2') +
    window.wsT('shell.installStep3') +
    window.wsT('shell.installStep4') +
    window.wsT('shell.installStep5') +
    window.wsT('shell.installStep6');
  paneSkill.append(introSkill, cmdRow, steps);

  // —— 面板二：复制 Prompt ——
  const panePrompt = document.createElement('div');
  panePrompt.className = 'aiax-pane';
  panePrompt.hidden = true;
  const introPrompt = document.createElement('div');
  introPrompt.className = 'aiax-way-desc';
  introPrompt.textContent = window.wsT('shell.promptIntro');
  const btnPrompt = document.createElement('button');
  btnPrompt.className = 'sb-btn sb-btn-primary aiax-copy-prompt';
  btnPrompt.textContent = window.wsT('shell.copyPrompt');
  btnPrompt.onclick = async () => {
    try {
      const text = await window.ws2.aiGuide();
      await navigator.clipboard.writeText(text);
      flashBtn(btnPrompt, window.wsT('shell.copied'));
    } catch (e) { alert(window.wsT('shell.copyFailed', { err: e.message || e })); }
  };
  panePrompt.append(introPrompt, btnPrompt);

  const setTab = (skill) => {
    tabSkill.classList.toggle('is-active', skill);
    tabPrompt.classList.toggle('is-active', !skill);
    paneSkill.hidden = !skill;
    panePrompt.hidden = skill;
  };
  tabSkill.onclick = () => setTab(true);
  tabPrompt.onclick = () => setTab(false);

  const foot = document.createElement('div');
  foot.className = 'aiax-note';
  foot.textContent = window.wsT('shell.autoValidateNote');
  body.append(tabs, paneSkill, panePrompt, foot);
  modal.append(head, body);
  overlay.appendChild(modal);
  overlay.onmousedown = (e) => { if (e.target === overlay) close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

window.ws2.onMenu((cmd) => {
  // 浏览器 feature：网页标签活跃时,find-in-doc/export-pdf/undo/redo/save 归 web（browser.js 判定并执行,
  // true=已处理——否则会作用到 view 底下的后台文档上,如菜单导出把后台文档印出来）。
  if (window.__webMenu && window.__webMenu(cmd)) return;
  if (cmd === 'ai-access') openAiAccessModal();
  if (cmd === 'perf-diag' && window.__sbHooks && window.__sbHooks.perfDiag) window.__sbHooks.perfDiag(); // 菜单「性能诊断…」→ 隐藏面板
  if (cmd === 'open-folder' && window.__sbHooks && window.__sbHooks.pickFolder) window.__sbHooks.pickFolder();
  if (cmd === 'manage-roots' && window.__sbHooks && window.__sbHooks.manageRoots) window.__sbHooks.manageRoots(); // 逃生门（D4）：不依赖树的移除入口
  // 修 SH-5：弹层（SaveModal/关闭确认/命令面板）开着时 Cmd+O 加速器穿透会把活跃文档从弹层底下换走
  // （最坏：SaveModal 点「保存到这里」时 activeTemp 已 null → 静默什么都不存）。有弹层就忽略「打开」。
  if (cmd === 'open' && !document.querySelector('.sb-modal-overlay') && !document.getElementById('fp-overlay')) pickAndOpen();
  if (cmd === 'save') save();
  if (cmd === 'export-pdf') exportPdf(pdfExportMode()); // 基础模式=raw 直印源文件；md 一律 wordspace（KD-5）
  if (cmd === 'undo') runUndoRedo(false); // 菜单加速器（真实用户 Cmd+Z 走这，不走 doc keydown）
  if (cmd === 'redo') runUndoRedo(true);
  if (cmd === 'new-tab' && window.__sbHooks && window.__sbHooks.newTab) window.__sbHooks.newTab();          // Cmd+T
  if (cmd === 'close-tab' && window.__sbHooks && window.__sbHooks.closeActiveTab) window.__sbHooks.closeActiveTab(); // Cmd+W
  // Cmd+F = 文档内查找：块编辑器活跃（合规、已挂、非查看器/空态）→ 开查找条；否则回退聚焦侧栏文件筛选。
  if (cmd === 'find-in-doc') {
    if (blockEdit && frame.contentDocument && window.WS2Find) window.WS2Find.open(frame);
    else if (window.__sbHooks && window.__sbHooks.focusFilter) window.__sbHooks.focusFilter();
  }
  if (cmd === 'find-file' && window.__sbHooks && window.__sbHooks.focusFilter) window.__sbHooks.focusFilter();        // Cmd+Shift+F
  if (cmd === 'find-palette' && window.__sbHooks && window.__sbHooks.findPalette) window.__sbHooks.findPalette();     // Cmd+P
  // ⌘\ 切换侧栏（视图菜单加速器,覆盖全焦点域——含文档编辑 iframe 内的原失灵域；主层另有 keydown fallback）。__webMenu 不认领此命令,恒落这里。
  if (cmd === 'toggle-sidebar' && window.__sbHooks && window.__sbHooks.toggleSidebar) window.__sbHooks.toggleSidebar();
  // ⌘R 刷新:网页标签由 __webMenu 上面接管（webNav reload）;文档标签落到这里 → 有意 no-op（不重载,防未保存编辑丢失,§2 拍板）。
});

// 导出 PDF。两条内部路径（单按钮、无 UI 菜单）：
//   'wordspace'（合规文档默认）= 把当前文档 + 编辑器排版烤成静态 HTML 再印，跟 app 里看到的一致；
//   'raw'（非合规=基础编辑）    = 主进程直印磁盘源文件（忠于野文件原貌，不烤块编辑器排版，缺块标记不会抛错）。
// 有未保存改动先落盘（印的是磁盘版本）。合并注意：ux-fixes 曾把 raw 当死代码收敛掉，F3 又让它成活路径 → 保 mode 版。
let exporting = false; // single-flight：连按不并发开多个隐藏窗口/叠多个对话框
async function exportPdf(mode) {
  if (exporting || !docPath) return;
  exporting = true; // 必须在 await save() 之前置位——否则脏文档连按时第二次调用会在 save 的 await 让出期溜过守卫
  try {
    if (dirty) { await save(); if (dirty) return; } // save 失败（仍脏）→ 不导出
    mode = mode === 'raw' ? 'raw' : 'wordspace';
    // 基础编辑（非合规——含非合规 md，pdfExportMode 对 md 一律 wordspace）：没有块编辑器的 canvas 标记，
    // buildWordspacePrintHtml 会误抛「文档尚未就绪」→ 改烤结构保真序列化的当前文档（所见即所得、不套排版）。
    const html = mode === 'wordspace'
      ? (basicEdit ? WS2BasicEdit.serialize(frame.contentDocument) : buildWordspacePrintHtml())
      : null; // raw 无需烤 HTML（主进程直印源文件）；wordspace 可能抛错，下面 catch 兜
    // 分页文档：走标准 @page 分页（preferCSSPageSize）而非连续单页；页码开关随文档 head meta。
    const paged = mode === 'wordspace' && !basicEdit && !!docPageCfg && !isMdPath(docPath);
    const cdoc = frame.contentDocument;
    const pageNumbers = paged && !!(cdoc && cdoc.head && cdoc.head.querySelector('meta[name="ws-page-numbers"][content="true"]'));
    const res = await window.ws2.exportPdf(docPath, mode, html, { paged, pageNumbers }); // 主进程按 mode 分 exportPdfFromHtml / 直印源文件
    if (res && res.error) alert(window.wsT('shell.exportPdfFailed', { err: res.error }));
  } catch (e) {
    alert(window.wsT('shell.exportPdfFailed', { err: (e && e.message) || e }));
  } finally {
    exporting = false;
  }
}

// Mode 2「Wordspace 样式」：把当前文档 + 编辑器排版烤成一份静态打印 HTML，让导出跟 app 里看到的一致。
// 剥覆盖层(data-ws2-ui)/交互态属性，保留 data-ws2-canvas/root（EDITOR_CSS 要靠它们定位），内联 EDITOR_CSS、
// 去掉文档自带 CSP（否则内联 <style> 被 style-src 拦）。主进程那边 js:false 印、文档脚本不跑——跟编辑器一致。
// 不注入 <base>：临时打印文件写在源文件同目录，相对资源 + 文档自带 <base> 都跟编辑器 file:// 直载时一致解析
// （注入反而会顶掉文档自带的 base，把图片解析错）。仅这份临时打印文档去 CSP，用户原文件分毫不动。
function buildWordspacePrintHtml() {
  const cd = frame.contentDocument;
  // 防 Bug2 外部重载把 contentDocument 切到 about:blank/半载时克隆出空壳 → 导出空白 PDF 却报成功
  if (!cd || !cd.querySelector('[data-ws2-canvas],[data-ws2-root]')) {
    throw new Error(window.wsT('shell.docNotReadyExport'));
  }
  const root = cd.documentElement.cloneNode(true);
  root.querySelectorAll('[data-ws2-ui]').forEach((n) => n.remove());
  root.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  ['data-ws2-editing', 'data-ws2-selected', 'data-ws2-ce', 'data-ws2-drop', 'data-ws2-eid'].forEach((a) =>
    root.querySelectorAll('[' + a + ']').forEach((n) => n.removeAttribute(a)));
  root.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]').forEach((n) => n.remove());
  // 分页推挤是运行时视觉产物，绝不烤进打印 HTML：spacer 节点已随 data-ws2-ui 整删（上面那行），
  // 这里再剥内容元素上的推挤样式（li 的 paddingTop / 块级 marginTop）+ 兜底删 spacer。
  root.querySelectorAll('.ws-page-spacer').forEach((n) => n.remove());
  root.querySelectorAll('[data-ws-pushed]').forEach((n) => {
    n.style.paddingTop = '';
    n.style.marginTop = '';
    n.removeAttribute('data-ws-pushed');
    if (!n.getAttribute('style')) n.removeAttribute('style');
  });
  const head = root.querySelector('head') || root;
  const style = cd.createElement('style'); style.textContent = WS2BlockEdit.EDITOR_CSS; head.appendChild(style);
  // 分页文档：打印辅助（body 版式还原 + break-inside 断行口径 + pre 折行）烤进打印 HTML、不入盘。
  // 排在 EDITOR_CSS 之后，同权重时以打印口径为准。@page 本身已在文档 head 的 page 块里（入盘 canonical）。
  if (docPageCfg && window.WS2SchemaPage) {
    const ps = cd.createElement('style'); ps.textContent = WS2SchemaPage.PAGED_PRINT_CSS; head.appendChild(ps);
  }
  // 保留原 doctype：无 doctype 的 quirks 文档别被强塞标准模式（盒模型/行高会变、跟编辑器不一致）
  const dt = cd.doctype;
  const doctypeStr = dt ? '<!DOCTYPE ' + dt.name
    + (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : '')
    + (dt.systemId ? (dt.publicId ? '' : ' SYSTEM') + ' "' + dt.systemId + '"' : '') + '>' : '';
  return doctypeStr + '\n' + root.outerHTML;
}

// 导出按钮 → 单按钮、无样式菜单。合规文档走 Wordspace 样式（所见即所得）；非合规（基础编辑）走 raw
// 直印源文件（忠于野文件原貌、不套块编辑器排版，否则缺块标记会抛错）。Feature 3 让 raw 从「未接 UI 的逃生口」
// 变回活路径 —— 故此处保 mode 版，不用 ux-fixes 那版收敛掉 raw 的无参 exportPdf()。
// .md 例外（KD-5）：raw=直印源文件会印出裸 markdown 文本 → 一律 wordspace（烤渲染后的 contentDocument，与格式无关）。
function pdfExportMode() { return (basicEdit && !isMdPath(docPath)) ? 'raw' : 'wordspace'; }
exportBtn.onclick = () => { if (!exportBtn.disabled) exportPdf(pdfExportMode()); };

// 「导出为 Markdown」（Colin+Wendi 2026-07-03：新建不选格式、默认 html；合规文档事后可导出 md 副本）。
// 门：真文件 + 符合 Schema #1（非合规转 md 会丢/坏结构，不给）+ 本身不是 md（另存为已保 .md，导出无意义）。
function updateExportMd() {
  if (!exportMdBtn) return;
  exportMdBtn.disabled = !(docPath && !tempDoc && docConform && !isMdPath(docPath));
}
// 导出语义：产 .md 副本、当前文档不切换（对齐导出 PDF；「另存为」才切换）。序列化当前 DOM=所见即所得
//（含未保存编辑）；主进程 ws-save-doc-as ext='md' 写盘前 htmlToMd，成功后 Finder 高亮副本。
async function exportAsMd() {
  if (!exportMdBtn || exportMdBtn.disabled) return;
  const cd = frame.contentDocument;
  // 外部重载二段跳期间 contentDocument 可能是 about:blank——别把空壳序列化成「看起来导出成功」的空 .md
  if (!cd || !cd.querySelector('[data-ws2-canvas],[data-ws2-root]')) { alert(window.wsT('shell.docNotReadyExport')); return; }
  const html = WS2Serialize.serializeDocument(cd);
  try { await window.ws2.wsSaveDocAs(baseName(docPath).replace(/\.(html?|md)$/i, ''), html, 'md', { reveal: true }); }
  catch (e) { alert(window.wsT('shell.exportMdFailed', { err: e.message || e })); }
}
if (exportMdBtn) exportMdBtn.onclick = exportAsMd;

renderRecents();

// 品牌页脚版本号（#3）：真实 app 版本。
(async () => {
  try {
    const v = await window.ws2.appVersion();
    const el = document.getElementById('ws-ver');
    if (el && v) el.textContent = 'v' + v;
  } catch (e) { /* 取不到就留空 */ }
})();
