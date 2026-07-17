// 左侧本地文件栏（F06）。跑在父层 shell 作用域（classic script，shell.js 之后加载）→ 直接调
// shell.js 的 openDoc / __shellRetargetDoc 等。所有 fs 经 window.ws2.ws*（主进程）。
// CSP 约束：不用 setAttribute('style')/cssText（会被 style-src 拦）；缩进/导引线走 .style.paddingLeft/.style.left
// 单 CSSOM 属性（这类 property setter CSP 安全，同 menu.style.left），数据走 dataset（data-* 不受 CSP 限制）。样式其余在 shell.css。
(function () {
  const rootNameEl = document.getElementById('sb-root-name');
  const filterWrap = document.getElementById('sb-filter');
  const filesLabel = document.getElementById('sb-files-label');
  const filterInput = document.getElementById('sb-filter-input');
  const emptyEl = document.getElementById('sb-empty');
  const treeEl = document.getElementById('sb-tree');
  const bodyEl = document.getElementById('sb-body'); // 滚动容器（sticky ancestor 挂它的 scroll）
  const stickyEl = document.getElementById('sb-sticky'); // 吸顶浮层
  const openFolderBtn = document.getElementById('sb-open-folder');
  const emptyOpenBtn = document.getElementById('sb-empty-open');
  if (!treeEl) return;

  // 多根工作区：每根一节（根标题行 + 它自己的树）。「打开一个文件夹」= 恰好只有一个根，没有第二种模式。
  let rootsState = []; // [{ id, path, name, missing, tree }] 有序 = 侧栏显示序；missing 根 tree=null
  let query = '';
  let tabState = { entries: [], activeRel: null }; // 标签/置顶模型（src/lib/tabs.js → window.WS2Tabs，全局单一集合持久化）
  let suppressRevealOnce = false; // 一次性:关标签回落时置真,onOpen 消费它整个抑制树定位（Colin：关标签不滚树）
  let suppressScrollOnce = false; // 一次性:点标签时置真,onOpen 消费它让 expandToFile 展开但不滚（Colin 2026-07-14）
  let diagRenderStart = 0; // 诊断探针：一次 render/renderRoot 的起点，afterRender 里结算
  const diagRender = { lastMs: 0, maxMs: 0, count: 0 }; // 诊断探针：renderer 渲染耗时（Cmd+Shift+D 看）
  // 启动恢复完成信号：冷启动（app 没开就双击 .html）时，open-file 建标签必须等「恢复根 + 标签」
  // 整条跑完才做，否则会被 loadTabs 整体覆盖 / 被 openTabFromAbs 的过期根守卫中止（Colin 报的「文档开了没标签」）。
  // 一旦 resolve 永久 resolved：app 已开着时再 open（热路径）不阻塞，立即建标签。
  let resolveRestore;
  const restoreReady = new Promise((r) => { resolveRestore = r; });
  window.__sbRestoreReady = restoreReady; // browser.js 的 web-open-request 消费者同款串行化（冷启动系统递 URL 不被 loadTabs 覆盖）
  // 收起的文件夹，键 = `rootId:rel`（多根里同 rel 是不同文件夹，必须带根限定；加根时该根全部收起，只显示顶层）
  const collapsed = new Set();
  const rootClosed = new Set(); // 收起的根（整节折叠，rootId）
  const colKey = (rootId, rel) => rootId + ':' + rel;
  const rootOf = (rootId) => rootsState.find((r) => r.id === rootId) || null;

  // P3-07 树展开态持久化（缓存语义，rel 失效即弃）。存「偏离默认」的部分：目录默认收起→存被展开的目录 rel；
  // 根默认展开→存被收起的根。防抖原子写（走 workspace.json 的既有 serialized 写）。失联/未加载根的展开态
  // 用 persistedExpanded 沿用，别在别的根 toggle 触发的 save 里把它清空。
  let persistedExpanded = {}; // rootId -> [rel...]（最近一次持久化的展开集，给失联/未加载根兜底）
  function computeTreeState() {
    const expandedByRoot = {};
    for (const st of rootsState) {
      if (st.tree) {
        const rels = [];
        (function w(nodes) { for (const n of nodes) if (n.isDir) { if (!collapsed.has(colKey(st.id, n.rel))) rels.push(n.rel); w(n.children || []); } })(st.tree);
        expandedByRoot[st.id] = rels.slice(0, 500);
      } else if (persistedExpanded[st.id]) {
        expandedByRoot[st.id] = persistedExpanded[st.id]; // 失联/未加载：沿用上次，别丢
      }
    }
    persistedExpanded = expandedByRoot;
    const collapsedRoots = rootsState.filter((st) => rootClosed.has(st.id)).map((st) => st.id);
    return { expandedByRoot, collapsedRoots };
  }
  function scheduleTreeStateSave() {
    if (!window.ws2.wsSetTreeState) return; // 旧 preload 兜底
    // 立即存（不防抖）——与 persistTabs 同步落盘一致。折叠/展开是点击频率、不是逐帧,一次 computeTreeState
    // + 一次 IPC 可接受;而 400ms 防抖有「toggle 后立刻退出(<400ms)丢这次改动」的缺口（对抗审查 P3）。
    window.ws2.wsSetTreeState(computeTreeState());
  }
  async function restoreTreeState() {
    if (!window.ws2.wsGetTreeState) return;
    let ts = null;
    try { ts = await window.ws2.wsGetTreeState(); } catch (e) { return; }
    if (!ts) return;
    persistedExpanded = ts.expandedByRoot || {};
    for (const rootId of Object.keys(persistedExpanded)) {
      const st = rootOf(rootId);
      if (!st || !st.tree) continue;
      const existing = new Set();
      (function w(nodes) { for (const n of nodes) if (n.isDir) { existing.add(n.rel); w(n.children || []); } })(st.tree);
      for (const rel of persistedExpanded[rootId]) if (existing.has(rel)) collapsed.delete(colKey(rootId, rel)); // 默认全收起，把持久化展开的删掉；rel 失效即弃
    }
    for (const rootId of (ts.collapsedRoots || [])) if (rootOf(rootId)) rootClosed.add(rootId);
  }
  const liveRootCount = () => rootsState.filter((r) => !r.missing).length;

  // 树节点出厂时不带根归属 → 装进 rootsState 前逐节点标 rootId（右键/拖拽/打开在任何深度都要知道归属根）。
  function annotateTree(nodes, rootId) {
    for (const n of nodes) {
      n.rootId = rootId;
      if (n.children && n.children.length) annotateTree(n.children, rootId);
    }
    return nodes;
  }

  // 收集某根树里所有文件夹的收起键（加根时一次性塞进 collapsed → 该根默认全收起）。
  function collectDirRels(nodes, rootId, acc) {
    for (const n of nodes) {
      if (n.isDir) {
        acc.add(colKey(rootId, n.rel));
        collectDirRels(n.children, rootId, acc);
      }
    }
    return acc;
  }

  // ---- 内联 SVG 图标（CSP 允许 SVG 元素；用 innerHTML 注入，非脚本）----
  // 根标题行的磁盘图标（lucide hard-drive，对齐 ui-demo 根节）。
  const HDD_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/></svg>';
  const SVG = {
    chevron: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1z"/></svg>',
    file: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  };
  // 按类型换图标形状（T8 对齐 ui-demo FileIcon：色值早就分了、形状此前全是同一个 file 轮廓）。
  // lucide：image=FileImage / sheet=FileSpreadsheet / slides=Presentation / word·pdf·html=FileText / 其余=File。
  const KIND_PATH = {
    image: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><circle cx="10" cy="12" r="2"/><path d="m20 17-1.3-1.3a2.4 2.4 0 0 0-3.4 0L9 22"/>',
    sheet: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
    slides: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
    word: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  };
  KIND_PATH.pdf = KIND_PATH.word; // FileText 同款（ui-demo：word/pdf/html 都是 FileText、靠颜色区分）
  KIND_PATH.html = KIND_PATH.word;
  KIND_PATH.md = KIND_PATH.word; // md 也是可编辑文档，同 FileText 轮廓（.sb-kind-md 类是将来单独标色的钩子）
  KIND_PATH.web = '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'; // 地球（web 标签无 favicon 时的通用图标）
  const kindSvg = (kind) =>
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    (KIND_PATH[kind] || '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>') +
    '</svg>';

  // 文件树缩进：每级 12px（研究：窄侧栏 12-16px + 导引线；导引线扛层级、缩进不用大）。**不再硬封顶**——
  // 靠 compact folders 压有效深度 + 导引线读层级 + 名字省略号/tooltip 兜底（VS Code/Notion 同款）。
  // 缩进走 .style.paddingLeft 单 CSSOM 属性（CSP 安全，同 menu.style.left；不是 setAttribute('style')/cssText）。
  const INDENT_STEP = 12;
  const GUIDE_X0 = 14; // 第 0 级导引线 x：对齐 dir caret 中心（base 8 + caret 半宽 ~6），第 i 级在 GUIDE_X0 + i*STEP
  // 给行加缩进 + 每级祖先一条导引线（淡墨竖线、非 accent——层级线不和选中蓝抢）。导引线 position:absolute，
  // 不进 flex 流；相邻行的线段连成通线。
  function applyIndent(row, depth, isFile) {
    row.style.paddingLeft = ((isFile ? 26 : 8) + depth * INDENT_STEP) + 'px';
    for (let i = 0; i < depth; i++) {
      const g = document.createElement('span');
      g.className = 'sb-guide';
      g.style.left = (GUIDE_X0 + i * INDENT_STEP) + 'px';
      row.appendChild(g);
    }
  }
  // Compact folders（VS Code explorer.compactFolders / JetBrains「Compact Middle Packages」同款，两家独立
  // 收敛=主力解法）：把「只有一个子文件夹、无文件」的链合并成一行（`a/b/c` → 一行），身份（rel/abs/折叠/
  // 拖放/右键）落**最深那级**（改名落最深段是 VS Code 已知边角、可接受）。render 时算、不动各根的 tree
  // ——其它消费方（collectDirRels/filterTree/allFiles/onTreeChanged）仍要看完整真 rel。
  function compactChain(node) {
    const names = [node.name];
    const rels = [node.rel]; // 链上每级的真 rel（折叠状态按整条链一致处理，见下）
    let cur = node;
    while (cur.children && cur.children.length === 1 && cur.children[0].isDir) {
      cur = cur.children[0];
      names.push(cur.name);
      rels.push(cur.rel);
    }
    return { names, rels, tail: cur };
  }

  // ---- 添加文件夹 / 根管理 ----
  // 侧栏骨架显隐：有根才显示树/筛选；一个根都没有回到空态（侧栏仍在，提示打开文件夹）。
  function syncChrome() {
    const has = rootsState.length > 0;
    emptyEl.hidden = has;
    treeEl.hidden = !has;
    filterWrap.hidden = !has;
    if (filesLabel) filesLabel.hidden = !has;
    if (rootNameEl) {
      rootNameEl.textContent = window.wsT('sidebar.localFiles');
      rootNameEl.title = rootsState.map((r) => r.path).join('\n');
    }
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.toggle('sb-on', has || tabState.entries.length > 0);
  }
  // 把主进程返回的 { root:{id,path,name,missing}, tree:{tree:[…], truncated?, entryCount?} } 装进 rootsState
  //（tree 标注 rootId + 默认全收起）。truncated（超条目预算的过大根，D3/P0b）：转 **lazy 模式**（简化模式）
  // ——不一次性建全树，st.tree 先留 null，由 loadLazyTop 读顶层、展开哪层读哪层（VS Code 路线）。
  function mkRootState(info, treeData) {
    const lazy = !!(treeData && treeData.truncated);
    const tree = !lazy && treeData && treeData.tree ? annotateTree(treeData.tree, info.id) : null;
    if (tree) collectDirRels(tree, info.id, collapsed);
    return { id: info.id, path: info.path, name: info.name, missing: !!info.missing, tree, lazy, entryCount: lazy ? (treeData.entryCount || 0) : 0 };
  }
  function adoptRoot(info, treeData, index) {
    const st = mkRootState(info, treeData);
    if (index != null) rootsState.splice(Math.min(index, rootsState.length), 0, st);
    else rootsState.push(st);
    rootsGen++; // 根集合变了：作废在飞的 loadTabs 结果
    syncChrome();
    render();
    if (st.lazy && !st.tree) loadLazyTop(st.id); // 吸收/撤销一个过大根 → 顶层懒加载
    mergeExternalDupes(info.id); // 吸收/撤销带树进来（不走 loadRootTree）也要收编外部标签；treeData=null 时是 no-op
    return st;
  }
  // 添加文件夹（头部按钮 / 空态按钮 / 树底常驻行 / ⋯ 菜单）：主进程弹框选目录 + classifyRoot 嵌套判定。
  // same/child 不重复开（toast 解释）；parent 出「并入并添加」确认；病灶路径出「仍要打开」确认；independent 正常加。
  async function pickFolder() {
    let r;
    try { r = await window.ws2.wsAddFolder(); } catch (e) { return; }
    await handleAddResult(r);
  }
  // 添加结果分流（ws-add-folder 与病灶确认后的 ws-add-folder-confirm 共用同一套结果处理）。
  async function handleAddResult(r) {
    if (!r) return; // 用户取消了原生框
    if (r.status === 'same') {
      showToast(window.wsT('sidebar.folderAlreadyOpen', { name: r.root.name }));
    } else if (r.status === 'child') {
      // 父根还在加载 / 是简化模式的大文件夹 →「去那个文件夹里展开」可能太深不好找（诊断 D5：~ 一注册，
      // 所有子文件夹全被拒）。给出口：引导去「管理文件夹」移除父根后单独打开这个子文件夹。正常态保持原文案。
      const pst = rootOf(r.parent.id);
      if (pst && (pst.loading || pst.lazy)) {
        const mode = pst.lazy ? window.wsT('sidebar.folderModeLazy') : window.wsT('sidebar.folderModeLoading');
        showToast(window.wsT('sidebar.folderChildParentStuck', { name: r.name, parent: r.parent.name, mode }), window.wsT('menu.manageRoots'), () => openManageRootsModal());
      } else {
        showToast(window.wsT('sidebar.folderIsChild', { name: r.name, parent: r.parent.name }));
      }
    } else if (r.status === 'limit') {
      showToast(window.wsT('sidebar.folderLimit', { max: r.max }));
    } else if (r.status === 'parent') {
      openAbsorbConfirm(r);
    } else if (r.status === 'confirm-huge') {
      openHugeConfirm(r); // 病灶路径（~、/、/Users、卷根）→ 劝导选具体工作文件夹（诊断 §6.3）
    } else if (r.status === 'stale') {
      showToast(window.wsT('sidebar.folderStateChangedRetry'));
    } else if (r.status === 'revived') {
      // 选的是失联根的路径且现在可达 → 主进程顺手复活了它。两段式：先转非失联 + 加载态渲染，再填树。
      const st = rootOf(r.root.id);
      if (st) { st.missing = false; st.path = r.root.path; st.name = r.root.name; st.tree = null; st.loading = true; }
      syncChrome();
      render();
      await loadRootTree(r.root.id, { validate: true, toast: window.wsT('sidebar.reconnected', { name: r.root.name }) });
    } else if (r.status === 'added') {
      // 两段式：先把根装进 rootsState（tree=null + loading），立刻渲染根 + 加载行；再异步 wsReadTree 填树。
      const st = adoptRoot(r.root, null);
      st.loading = true;
      render();
      await loadRootTree(r.root.id, { toast: window.wsT('sidebar.folderOpened', { name: r.root.name }) });
    }
  }
  // 病灶路径确认（诊断 §6.3）：选了整个用户目录 / 磁盘 / 卷根 → 劝导选具体工作文件夹。抄 openAbsorbConfirm
  // 的 token 模式；「仍要打开」走 ws-add-folder-confirm(token) 继续 resolveAdd（配合 U2 预算，海量根落「过大」态）。
  function openHugeConfirm(r) {
    if (document.querySelector('.sb-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'sb-modal-overlay';
    overlay.id = 'huge-confirm-overlay';
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    const modal = document.createElement('div');
    modal.className = 'sb-modal sb-modal-confirm';
    const body = document.createElement('div');
    body.className = 'sb-cc-body';
    const ico = document.createElement('div');
    ico.className = 'sb-cc-ico';
    ico.innerHTML = WARN_SVG20;
    const textWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'sb-cc-title';
    title.textContent = window.wsT('sidebar.hugeTitle', { name: r.name });
    const desc = document.createElement('div');
    desc.className = 'sb-modal-desc';
    desc.textContent = window.wsT('sidebar.hugeDesc');
    textWrap.append(title, desc);
    body.append(ico, textWrap);
    const foot = document.createElement('div');
    foot.className = 'sb-modal-foot';
    const cancel = document.createElement('button');
    cancel.className = 'sb-btn sb-btn-primary';
    cancel.textContent = window.wsT('sidebar.hugePickAnother');
    cancel.onclick = () => { close(); pickFolder(); }; // 直接再开选择框换一个（推荐路径，主按钮）
    const spacer = document.createElement('span');
    spacer.className = 'sb-modal-spacer';
    const ok = document.createElement('button');
    ok.className = 'sb-btn';
    ok.textContent = window.wsT('sidebar.hugeOpenAnyway');
    ok.onclick = async () => {
      close();
      let res;
      try { res = await window.ws2.wsAddFolderConfirm(r.token); } catch (e) { return; }
      await handleAddResult(res);
    };
    foot.append(cancel, spacer, ok);
    modal.append(body, foot);
    overlay.appendChild(modal);
    wireOverlayClose(overlay, close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }
  // 两段式添加/复活的第二段：异步读该根的树填进去、清 loading。期间根被移除/吸收 → rootOf 返回 null，放弃。
  // 读不到树（不可达）→ 转失联灰态（别当空树，否则 reconcile 会把标签清光——workspace.readTree 的 null 契约）。
  async function loadRootTree(rootId, opts = {}) {
    let data = null;
    try { data = await window.ws2.wsReadTree(rootId); } catch (e) { data = null; }
    const st = rootOf(rootId);
    if (!st) return; // 加载期间该根被移除/吸收
    st.loading = false;
    if (data && data.truncated) {
      // 过大根（D3/P0b）：超条目预算 → 转 **lazy 模式**（简化模式，可浏览）。清残留旧树；顶层懒加载。
      st.lazy = true; st.entryCount = data.entryCount || 0; st.tree = null; st.missing = false;
      syncChrome();
      await loadLazyTop(rootId); // 读顶层进 st.tree（内部 render）；期间被移除会自然放弃
    } else if (data) {
      st.lazy = false;
      st.tree = annotateTree(data.tree, rootId);
      collectDirRels(st.tree, rootId, collapsed);
    } else {
      st.missing = true; // 不可达 → 失联灰态，不当空树
    }
    mergeExternalDupes(rootId); // 新树到货：命中树内文件的外部标签并进 rel 身份（先开文件再添加其文件夹，↗ 不再永驻）
    syncChrome();
    render();
    if (opts.validate) validateRootEntries(rootId);
    if (opts.toast) showToast(opts.toast); // lazy 根现在可浏览了，报「已打开」不再自相矛盾（P0b 升级）
  }
  // ── lazy 模式（简化模式）懒加载：展开哪层读哪层，会话内缓存已加载的层 ──
  // 顶层加载：过大根转 lazy 后第一步，读根目录第一层进 st.tree。
  async function loadLazyTop(rootId) {
    const st = rootOf(rootId);
    if (!st || !st.lazy) return;
    st.loading = true;
    renderRoot(rootId); // 顶层读盘期间显示「正在读取…」loading 行
    let d = null;
    try { d = await window.ws2.wsReadDir(rootId, ''); } catch (e) { d = null; }
    const st2 = rootOf(rootId);
    if (!st2 || !st2.lazy) return; // 期间根被移除/退出 lazy
    st2.loading = false;
    st2.tree = d && Array.isArray(d.children) ? annotateTree(d.children, rootId) : [];
    st2.topTruncated = !!(d && d.truncated); // 根直接子项超单层预算（极罕见）
    collectDirRels(st2.tree, rootId, collapsed); // 新层默认全收起（展开才读下一层）
    renderRoot(rootId);
    mergeExternalDupes(rootId); // lazy 顶层到货同样收编（简化模式根也不让 ↗ 永驻）
  }
  // 展开一个未加载的 lazy 目录：读它这一层的 children 填进节点、标 childrenLoaded；会话内缓存（收起不丢）。
  async function loadDirChildren(rootId, dirRel) {
    const st = rootOf(rootId);
    if (!st || !st.lazy) return;
    const node = findNode(rootId, dirRel);
    if (!node || node.childrenLoaded || node._loading) return;
    node._loading = true;
    renderRoot(rootId); // 该目录下显示 loading 行
    let d = null;
    try { d = await window.ws2.wsReadDir(rootId, dirRel); } catch (e) { d = null; }
    const st2 = rootOf(rootId);
    if (!st2 || !st2.lazy) return;
    const n2 = findNode(rootId, dirRel); // 重新定位（期间 watcher 可能 patch 过树）
    if (!n2) return; // 该目录已从已加载树里消失（父层外部删除）
    n2._loading = false;
    n2.children = d && Array.isArray(d.children) ? annotateTree(d.children, rootId) : [];
    n2.childrenLoaded = true;
    n2.dirTruncated = !!(d && d.truncated); // 本目录直接子项超单层预算
    collectDirRels(n2.children, rootId, collapsed); // 新层默认全收起
    renderRoot(rootId);
    mergeExternalDupes(rootId); // 新展开的层里可能藏着外部标签指向的文件
  }
  // 「并入并添加」确认（对齐 ui-demo AddFolderModal 的 parent 通知 + 主按钮）：新文件夹包住了已打开的根，
  // 吸收后子根的标签不关、整体 rebase 进新根（文件都在磁盘原处，只换归属）。
  function openAbsorbConfirm(r) {
    if (document.querySelector('.sb-modal-overlay')) return;
    const childNames = r.children.map((c) => c.name).join(window.wsT('sidebar.listSep'));
    const overlay = document.createElement('div');
    overlay.className = 'sb-modal-overlay';
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    const modal = document.createElement('div');
    modal.className = 'sb-modal sb-modal-confirm';
    const body = document.createElement('div');
    body.className = 'sb-cc-body';
    const ico = document.createElement('div');
    ico.className = 'sb-cc-ico';
    ico.innerHTML = WARN_SVG20;
    const textWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'sb-cc-title';
    title.textContent = window.wsT('sidebar.absorbTitle', { name: r.name });
    const desc = document.createElement('div');
    desc.className = 'sb-modal-desc';
    const it = window.wsT(r.children.length > 1 ? 'sidebar.pronounThem' : 'sidebar.pronounIt');
    desc.textContent = window.wsT('sidebar.absorbDesc', { name: r.name, children: childNames, it });
    textWrap.append(title, desc);
    body.append(ico, textWrap);
    const foot = document.createElement('div');
    foot.className = 'sb-modal-foot';
    const cancel = document.createElement('button');
    cancel.className = 'sb-btn';
    cancel.textContent = window.wsT('common.cancel');
    cancel.onclick = close;
    const spacer = document.createElement('span');
    spacer.className = 'sb-modal-spacer';
    const ok = document.createElement('button');
    ok.className = 'sb-btn sb-btn-primary';
    ok.textContent = window.wsT('sidebar.absorbConfirm');
    ok.onclick = async () => {
      close();
      let res;
      try { res = await window.ws2.wsAbsorbConfirm(r.token); } catch (e) { return; }
      if (!res || res.status !== 'added') { showToast(window.wsT('sidebar.absorbChanged')); return; }
      // 标签 rebase：子根 entries 换归属到新根（key 变了但标签不关、激活跟随）
      for (const rb of res.rebases || []) {
        tabState = window.WS2Tabs.rebaseRoot(tabState, rb.fromRootId, rb.toRootId, rb.prefix);
      }
      // 子根从 rootsState 撤走（它们的 collapsed 键留着也无害，但清掉防泄漏）
      const dropIds = new Set((res.rebases || []).map((rb) => rb.fromRootId));
      for (const key of [...collapsed]) { if (dropIds.has(key.split(':')[0])) collapsed.delete(key); }
      for (const id of dropIds) rootClosed.delete(id);
      rootsState = rootsState.filter((x) => !dropIds.has(x.id));
      rootsGen++;
      adoptRoot(res.root, res.tree);
      persistTabs();
      renderZones();
      // 激活标签跟着 rebase 换了 key → 树里重新定位高亮
      const act = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
      if (act && act.rel) expandToFile(act.rootId, act.rel);
      showToast(window.wsT('sidebar.absorbedInto', { name: res.root.name }));
    };
    foot.append(cancel, spacer, ok);
    modal.append(body, foot);
    overlay.appendChild(modal);
    wireOverlayClose(overlay, close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }
  // 移除根（磁盘文件不动）：整节撤走 + 该根标签撤走，toast 可撤销原位放回（对齐 ui-demo removeRoot）。
  async function removeRootUI(rootId) {
    // 激活文档属于该根且还脏（1.2s 自动保存窗内/上次保存失败）→ 先冲一次保存（照 Cmd+W 的 flush 先例），
    // 别让「磁盘文件不受影响」的 toast 变谎话（MR-ADV-6）。保存失败就不移除，文档留在原地。
    const act = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
    if (act && act.rel && act.rootId === rootId && window.__shellIsDirty && window.__shellIsDirty()) {
      if (window.__shellSaveActive) await window.__shellSaveActive();
      if (window.__shellIsDirty && window.__shellIsDirty()) { showToast(window.wsT('sidebar.removeDirtyBlock')); return; }
    }
    let r;
    try { r = await window.ws2.wsRemoveRoot(rootId); } catch (e) { return; }
    if (!r) return;
    const idx = rootsState.findIndex((x) => x.id === rootId);
    if (idx >= 0) rootsState.splice(idx, 1);
    rootsGen++;
    for (const key of [...collapsed]) { if (key.indexOf(rootId + ':') === 0) collapsed.delete(key); }
    rootClosed.delete(rootId);
    const prevActive = tabState.activeRel;
    const dropped = window.WS2Tabs.dropRootEntries(tabState, rootId);
    tabState = dropped.state;
    persistTabs();
    syncChrome();
    render();
    // 激活标签被撤走 → 编辑器跟随回落（同 finishClose 的回落路径）
    if (prevActive !== tabState.activeRel && dropped.removed.some((e) => keyOf(e) === prevActive)) {
      const e = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
      if (e) openTabRow(e);
      else if (window.__shellCloseDoc) window.__shellCloseDoc();
    }
    showToast(window.wsT('sidebar.rootRemoved', { name: r.root.name }), window.wsT('common.undo'), async () => {
      let u;
      try { u = await window.ws2.wsUndoRemoveRoot(r.token); } catch (e) { return; }
      if (!u || u.status !== 'ok') {
        showToast(u && u.status === 'overlap' ? window.wsT('sidebar.undoRemoveOverlap') : u && u.status === 'limit' ? window.wsT('sidebar.undoRemoveLimit') : window.wsT('sidebar.undoRemoveFailed'));
        return;
      }
      adoptRoot(u.root, u.tree, u.index);
      tabState = window.WS2Tabs.undoDropRoot(tabState, dropped.removed, prevActive);
      mergeExternalDupes(rootId); // 撤销窗口期用「打开」按钮开过同根文件建的外部标签 → 并回 rel 身份
      persistTabs();
      renderZones();
      // 激活项恢复了 → 重新打开它（编辑器可能已回落/空态）
      const e = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
      if (e && keyOf(e) === prevActive) openTabRow(e);
      render();
    });
  }
  // 失联根重新定位：主进程弹框选新位置（rootId 不变 → 标签/置顶原样复活），随后按新树校验该根的标签。
  async function relocateRootUI(rootId) {
    let r;
    try { r = await window.ws2.wsRelocateRoot(rootId); } catch (e) { return; }
    if (!r) return; // 取消
    if (r.status === 'overlap') { showToast(window.wsT('sidebar.relocateOverlap')); return; }
    if (r.status !== 'ok') return;
    const st = rootOf(rootId);
    if (!st) return;
    st.path = r.root.path;
    st.name = r.root.name;
    st.missing = false;
    st.tree = annotateTree(r.tree.tree, rootId);
    collectDirRels(st.tree, rootId, collapsed);
    syncChrome();
    render();
    validateRootEntries(rootId);
    showToast(window.wsT('sidebar.reconnected', { name: r.root.name }));
  }
  // 根复活/重定位后校验它的标签：新树里没有的文件（换了位置的旧结构）静默丢，激活回落。
  function validateRootEntries(rootId) {
    const st = rootOf(rootId);
    if (!st || !st.tree || st.lazy) return; // lazy 根只加载了部分层，findNode 会误杀未加载层的标签——别校验（同失联根，保留标签）
    const gone = tabState.entries.filter((e) => e.rootId === rootId && e.rel && !findNode(rootId, e.rel));
    for (const e of gone) tabState = window.WS2Tabs.removeEntry(tabState, keyOf(e));
    mergeExternalDupes(rootId);
    if (gone.length) { persistTabs(); renderZones(); }
  }
  // 外部标签（abs 身份）的文件其实在某个已加载树里 → 并进 rel 身份（open/pinned 取并集、激活跟随），
  // 外部那条销毁。两类来源：①根失联/被移除期间开过它里面的文件，复活/撤销后 rel 身份回来（MR-ADV-5）；
  // ②先开工作区外文件、**再**添加它所在的文件夹为根（Wendi bug 2026-07-17）——不收编的话 ↗ 永驻、
  // 且树里再点同一文件会翻出第二条标签。所以挂在所有「树内容到货」的点：loadRootTree/loadLazyTop/
  // loadDirChildren/adoptRoot，外加 loadTabs 末尾（启动自愈存量坏状态）。
  // rootId 缺省 = 不限根、对全部已加载树收编；传了 = 只收编命中该根的（省得别的根白扫）。
  function mergeExternalDupes(rootId) {
    let changed = false;
    for (const ext of tabState.entries.filter((e) => !e.rel && !isTempEntry(e))) {
      const node = findNodeByAbs(ext.abs);
      if (!node || (rootId && node.rootId !== rootId)) continue;
      const key = colKey(node.rootId, node.rel);
      const relEntry = tabState.entries.find((e) => keyOf(e) === key);
      let entries;
      if (relEntry) {
        entries = tabState.entries
          .map((e) => (keyOf(e) === key ? { ...e, open: e.open || ext.open, pinned: e.pinned || ext.pinned } : e))
          .filter((e) => keyOf(e) !== ext.abs);
      } else {
        entries = tabState.entries.map((e) =>
          keyOf(e) === ext.abs ? { rootId: node.rootId, rel: node.rel, kind: e.kind, title: node.name, open: e.open, pinned: e.pinned } : e,
        );
      }
      const activeRel = tabState.activeRel === ext.abs ? key : tabState.activeRel;
      tabState = { entries, activeRel };
      changed = true;
    }
    if (changed) { persistTabs(); renderZones(); }
    adoptOpenFile(); // 树内容到货的统一会合点=本函数——viewer 收编搭同一趟车(plan 2026-07-17-001),现在/将来的调用点全自动继承
  }
  // 「当前打开面文件」(编辑器文档或查看器文件)是否已有标签——双域判定:abs 直配(外部 ↗ entry)
  // 或 findNodeByAbs → rootId:rel 命中(rel entry 不带 abs 字段,只查 abs 会把已收编文档误判缺失、
  // 重建出第二条)。shell 的 U2 兜底(hasTabFor)与下面 adoptOpenFile 共用。
  function hasEntryForAbs(abs) {
    if (!abs) return false;
    if (tabState.entries.some((e) => !e.rel && !isTempEntry(e) && e.abs === abs)) return true;
    const node = findNodeByAbs(abs);
    if (node && tabState.entries.some((e) => keyOf(e) === colKey(node.rootId, node.rel))) return true;
    return false;
  }
  // 0 根时打开的文件(单文件 viewer 态,不建标签是设计)在工作区出现后收编进标签系统
  // (Wendi/Colin 2026-07-17,plan docs/plans/2026-07-17-001)。取 shell 的「当前打开面文件」,
  // 无 entry 就走 onOpen 既有漏斗(树内=rel 身份+reveal,树外=classifyFile 建 abs ↗ 外部标签)。
  // KD3 门:web/temp 激活时整个跳过——①openEntry 无条件切 activeRel,web view 挂屏时抢激活会劈开
  // 「屏幕显示网页、⌘W/⌘S 作用到看不见的文档」(SH-4/浏览器 P1-2 同类病);②跳过还顺带消灭
  // 「用户关掉收编标签后被下一次树到货复活」。重入通道=用户树里点它(shell 同文档守卫的 U2 兜底)。
  async function adoptOpenFile() {
    if (window.__webIsActive && window.__webIsActive()) return;
    const act = tabState.activeRel && tabState.entries.find((e) => keyOf(e) === tabState.activeRel);
    if (act && isTempEntry(act)) return; // 临时文档在前台(其 docPath 为 null,但守一道)
    const abs = window.__shellOpenFileAbs ? window.__shellOpenFileAbs() : null;
    if (!abs || hasEntryForAbs(abs)) return;
    try { if (!(await window.ws2.pathExists(abs))) return; } catch (e) { return; } // 文件已被外删→别收编死标签(loadTabs 外部 entry 校验同款)
    if (hasEntryForAbs(abs)) return; // await 期间可能已被别的路径建上(如用户点树),别翻倍
    if (window.__sbHooks && window.__sbHooks.onOpen) void window.__sbHooks.onOpen(abs);
  }
  // 单根重读树（文件操作后/watcher 事件）：只刷新该根，别的根纹丝不动。
  async function refreshRoot(rootId) {
    const st = rootOf(rootId);
    if (!st || st.missing) return;
    // lazy 根：**绝不**走 wsReadTree（它对超预算根返回空树 truncated → 会把已加载的 lazy 树抹成空）。
    // 改重读已加载层（doLazyScan(null) = 重读已加载集），文件操作后的新增/删除在已加载层里就能刷出来。
    if (st.lazy) { await doLazyScan(rootId, null); return; }
    const data = await window.ws2.wsReadTree(rootId);
    if (!data || rootOf(rootId) !== st) return;
    if (data.truncated) {
      // 会话中普通根长过预算（极罕见：文件操作把它推过 15 万）→ 转 lazy，别拿空树盖掉全量树。
      st.lazy = true; st.entryCount = data.entryCount || 0; st.tree = null;
      await loadLazyTop(rootId);
      return;
    }
    st.tree = annotateTree(data.tree, rootId);
    render();
  }
  // 兼容旧调用点：不带根的 refresh = 刷新全部活根（少数场景，如落盘新文件后不确定哪根）。
  async function refresh(rootId) {
    if (rootId) return refreshRoot(rootId);
    await Promise.all(rootsState.filter((r) => !r.missing).map((r) => refreshRoot(r.id)));
  }

  // ---- 筛选：保留命中节点 + 其祖先 ----
  function filterTree(nodes, q) {
    const out = [];
    for (const n of nodes) {
      if (n.isDir) {
        const kids = filterTree(n.children, q);
        if (kids.length || n.name.toLowerCase().includes(q)) {
          out.push(Object.assign({}, n, { children: kids.length ? kids : n.children }));
        }
      } else if (n.name.toLowerCase().includes(q)) {
        out.push(n);
      }
    }
    return out;
  }

  // ---- 渲染 ----
  let dragRootId = null; // 根标题行拖拽重排（模块级，跨 RootSection）
  function render() {
    diagRenderStart = performance.now(); // 诊断探针
    treeEl.innerHTML = '';
    if (!rootsState.length) {
      renderZones(); // 标签区还可能有外部标签（根全移除后仍保留）
      clearSticky();
      return;
    }
    renderRail(); // 收起态图标轨（#4），与主树同步刷新
    renderZones(); // 置顶区 + 标签页区
    const q = query.trim().toLowerCase();
    let shown = 0;
    for (let i = 0; i < rootsState.length; i++) {
      if (renderRootSection(rootsState[i], i, q)) shown++;
    }
    if (!shown && q) {
      const e = document.createElement('div');
      e.className = 'sb-tree-empty';
      e.textContent = window.wsT('sidebar.noMatchingFiles');
      treeEl.appendChild(e);
    }
    if (!q) {
      // 树底常驻「添加文件夹…」行（对齐 ui-demo arc-add-root）
      const add = document.createElement('button');
      add.className = 'sb-add-root';
      add.id = 'sb-add-root';
      add.title = window.wsT('sidebar.addRootTitle');
      const ico = document.createElement('span');
      ico.className = 'sb-ico';
      ico.innerHTML = SVG.folder;
      const label = document.createElement('span');
      label.textContent = window.wsT('sidebar.addFolder');
      add.append(ico, label);
      add.onclick = pickFolder;
      treeEl.appendChild(add);
    }
    afterRender(); // 收尾（高亮 + sticky 缓存重算 + 强制浮层重建），与增量 renderRoot 共用一条出口
  }

  // 单根增量重渲染（性能：多根下每次展开/折叠/watcher 结构变化只重建这一个根的 DOM，不碰别的根）。
  // 实测背景：两文件夹全展开 1382 行时，全量 render() 每次 ~43ms（把两个根的行全拆了重建）；改成只重建
  // 受影响的根，另一个根的 DOM 原样不动，交互顿感大幅下降。做法=在扁平 treeEl 里定位该根的 DOM 区间
  // （它的 sb-root-head 到下一个根的 head / add-root 按钮之间），整段替换成新渲染的 fragment。
  // 保守兜底：筛选态（q 非空，筛选是全局的）、根节起点找不到（状态漂移）、根不在 → 退回全量 render()。
  function renderRoot(rootId) {
    diagRenderStart = performance.now(); // 诊断探针
    const q = query.trim().toLowerCase();
    const st = rootOf(rootId);
    const idx = st ? rootsState.indexOf(st) : -1;
    if (q || idx < 0) { render(); return; }
    const startEl = treeEl.querySelector('.sb-root-head[data-root="' + cssAttr(rootId) + '"]');
    if (!startEl) { render(); return; } // 该根还没渲染出来（首帧）→ 全量
    // 终点 = 后面第一个存在的根 head；都没有 → add-root 按钮；再没有 → null（末尾）
    let endEl = null;
    for (let j = idx + 1; j < rootsState.length && !endEl; j++) {
      endEl = treeEl.querySelector('.sb-root-head[data-root="' + cssAttr(rootsState[j].id) + '"]');
    }
    if (!endEl) endEl = document.getElementById('sb-add-root');
    const frag = document.createDocumentFragment();
    renderRootSection(st, idx, '', frag);
    // 删掉本根的旧节点（startEl 起，到 endEl 为止）。**边界守卫**（对抗/前端-竞态/可维护三家都点的
    // footgun）：本根的 DOM 是 head + 它自己的行（file/dir/空态/失联 note），下一节以别的根的 sb-root-head
    // 或 #sb-add-root 起头。除了撞 endEl，遇到「别的根的 head」或 add-root 按钮也必停——这样即便 endEl
    // 因状态/DOM 顺序漂移而算错，也绝不会删穿到别的根或删掉 add-root（robust-by-construction）。
    let node = startEl.nextSibling;
    treeEl.removeChild(startEl); // 先删本根 head（它自己就是 sb-root-head，不能被下面的守卫拦住）
    while (node && node !== endEl && !node.classList.contains('sb-root-head') && node.id !== 'sb-add-root') {
      const next = node.nextSibling;
      treeEl.removeChild(node);
      node = next;
    }
    treeEl.insertBefore(frag, node); // 插到停下来的位置（endEl / 下一根 head / add-root），不再盲信 endEl
    afterRender();
  }

  // 渲染收尾（全量 render() 与增量 renderRoot() 共用，防两条路径尾部逻辑漂移——可维护性 review）：
  // 高亮当前打开文件 + 全量重算 sticky 吸顶行缓存（只读 layout 遍历，便宜）+ 强制吸顶浮层下一帧重建。
  function afterRender() {
    highlightActive(window.__shellDocPath ? window.__shellDocPath() : null);
    cacheStickyRows();
    if (stickyEl) stickyEl.dataset.key = STICKY_FORCE; // 哨兵值：任何真 key（含空 pins 的 ''）都 ≠ 它 → 必重建
    renderSticky();
    const ms = performance.now() - diagRenderStart; // 诊断探针：这次渲染（含 cacheStickyRows 全量 offsetTop）耗时
    diagRender.lastMs = ms;
    diagRender.maxMs = Math.max(diagRender.maxMs, ms);
    diagRender.count++;
  }

  // 一节 = 根标题行 + 该根的树。返回是否渲染了（筛选时无命中的根整节隐藏 → false）。
  // parent = 追加目标（默认整棵 treeEl；renderRoot 单根增量时传一个 fragment，只重建这一节）。
  function renderRootSection(root, index, q, parent = treeEl) {
    if (root.missing) {
      if (q) return false; // 失联根不参与筛选
      renderMissingRoot(root, parent);
      return true;
    }
    const lazy = !!root.lazy; // 简化模式（超预算的大根，按层懒加载）
    const nodes = root.tree ? (q ? filterTree(root.tree, q) : root.tree) : [];
    // 筛选时无命中 → 整节隐藏；但 lazy 根即使无命中也要露头 + 提示（否则用户以为文件夹空了/搜漏了，V3）
    if (q && !nodes.length && !lazy) return false;
    const open = q ? true : !rootClosed.has(root.id); // 筛选时自动展开
    const head = document.createElement('div');
    head.className = 'sb-row sb-root-head' + (lazy ? ' sb-root-lazy' : '');
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.dataset.root = root.id;
    head.dataset.rel = '';
    head.dataset.depth = -1; // sticky ancestor：根标题是最外层祖先
    head.title = window.wsT(lazy ? 'sidebar.rootHeadTitleLazy' : 'sidebar.rootHeadTitle', { path: root.path });
    head.draggable = true;
    const caret = document.createElement('span');
    caret.className = 'sb-caret' + (open ? ' is-open' : '');
    caret.innerHTML = SVG.chevron;
    const ico = document.createElement('span');
    ico.className = 'sb-ico sb-root-ico';
    ico.innerHTML = HDD_SVG;
    const name = document.createElement('span');
    name.className = 'sb-name sb-root-name ws-truncate';
    name.textContent = root.name;
    head.append(caret, ico, name);
    if (lazy) {
      // 「简化模式」徽标：告诉用户这个大文件夹按需加载、部分功能受限（hover 解释）。复用失联根的小 tag 样式，
      // 零新增 CSS；tag 后不再挂 path（省空间），path 进 title。
      const tag = document.createElement('span');
      tag.className = 'sb-root-miss-tag';
      tag.textContent = window.wsT('sidebar.lazyTag');
      tag.title = window.wsT('sidebar.lazyTagTitle');
      head.appendChild(tag);
    } else {
      const pathEl = document.createElement('span');
      pathEl.className = 'sb-root-path ws-truncate';
      pathEl.textContent = root.path;
      head.appendChild(pathEl);
    }
    head.onclick = () => {
      if (rootClosed.has(root.id)) rootClosed.delete(root.id);
      else rootClosed.add(root.id);
      scheduleTreeStateSave(); // P3-07：根折叠态 → 持久化（防抖）
      renderRoot(root.id); // 只重建这个根（性能）
    };
    head.oncontextmenu = (e) => {
      e.preventDefault();
      const items = [{ label: window.wsT('sidebar.newDoc'), run: () => openCreateModal(root.id, '') }];
      if (index > 0) items.push({ label: window.wsT('sidebar.moveToTop'), run: () => reorderRootTo(root.id, 0) });
      items.push({ label: window.wsT('sidebar.removeRoot'), danger: true, run: () => removeRootUI(root.id) });
      showContextMenu(e.clientX, e.clientY, items);
    };
    // 根标题行双职：①拖别的根经过 → 上/下沿插入线做重排；②拖文件过来 → 移到该根顶层（同根内）。
    head.ondragstart = (e) => {
      dragRootId = root.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', root.name);
    };
    head.ondragend = () => {
      dragRootId = null;
      head.classList.remove('sb-insert-before', 'sb-insert-after');
    };
    head.ondragover = (e) => {
      if (dragRootId && dragRootId !== root.id) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = head.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        head.classList.toggle('sb-insert-before', before);
        head.classList.toggle('sb-insert-after', !before);
        return;
      }
      // 拖文件到根标题 = 移到该根顶层。跨根已放开;只挡「同根且已在顶层」的 no-op。
      if (!dragNode || (dragNode.rootId === root.id && parentDirOf(dragNode.rel) === '')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      head.classList.add('sb-drop');
    };
    head.ondragleave = (e) => {
      if (!head.contains(e.relatedTarget)) head.classList.remove('sb-drop', 'sb-insert-before', 'sb-insert-after');
    };
    head.ondrop = (e) => {
      if (dragRootId && dragRootId !== root.id) {
        e.preventDefault();
        const r = head.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        head.classList.remove('sb-insert-before', 'sb-insert-after');
        const ids = rootsState.map((x) => x.id).filter((id) => id !== dragRootId);
        let at = ids.indexOf(root.id);
        if (!before) at++;
        ids.splice(at, 0, dragRootId);
        applyRootOrder(ids);
        dragRootId = null;
        return;
      }
      if (!dragNode) return;
      e.preventDefault();
      head.classList.remove('sb-drop');
      if (dragNode.rootId === root.id) doMove(dragNode, '');
      else doMoveAcross(dragNode, root.id, ''); // 跨根移到该根顶层
    };
    parent.appendChild(head);
    if (!open) return true;
    if (root.loading) {
      // 两段式添加：树还在读盘（大文件夹/云盘 4-5s）→ 加载行占位，别显示成「空文件夹」。
      const e = document.createElement('div');
      e.className = 'sb-loading';
      e.textContent = window.wsT('sidebar.readingFolder');
      parent.appendChild(e);
      return true;
    }
    if (!nodes.length && !(lazy && q)) {
      const e = document.createElement('div');
      e.className = 'sb-tree-empty';
      e.textContent = window.wsT('sidebar.folderNoFiles');
      parent.appendChild(e);
      return true;
    }
    for (const n of nodes) renderNode(n, 0, parent, !!q, lazy);
    if (lazy && q) {
      // 简化模式筛选只覆盖「已浏览过（已加载）的目录」——行尾提示，别让用户以为搜全了（V3）。
      const hint = document.createElement('div');
      hint.className = 'sb-tree-empty';
      hint.textContent = window.wsT('sidebar.lazyFilterHint');
      hint.title = window.wsT('sidebar.lazyFilterHintTitle');
      parent.appendChild(hint);
    }
    if (lazy && !q && root.topTruncated) {
      // 根直接子项超单层预算（极罕见）——顶层只显示了前 N 个，提示一下。
      const hint = document.createElement('div');
      hint.className = 'sb-tree-empty';
      hint.textContent = window.wsT('sidebar.dirTruncatedNote');
      parent.appendChild(hint);
    }
    return true;
  }

  // 失联根：灰显标题 + 一行说明 +「重新定位 / 移除」（对齐 ui-demo is-missing；绝不静默丢——下面还挂着标签/折叠状态）。
  function renderMissingRoot(root, parent = treeEl) {
    const head = document.createElement('div');
    head.className = 'sb-row sb-root-head sb-root-missing';
    head.dataset.root = root.id;
    head.dataset.rel = '';
    head.dataset.depth = -1;
    head.title = window.wsT('sidebar.rootMissingTitle', { path: root.path });
    const ico = document.createElement('span');
    ico.className = 'sb-ico sb-root-miss-ic';
    ico.innerHTML = WARN_SVG20;
    const name = document.createElement('span');
    name.className = 'sb-name sb-root-name ws-truncate';
    name.textContent = root.name;
    const tag = document.createElement('span');
    tag.className = 'sb-root-miss-tag';
    tag.textContent = window.wsT('sidebar.missingTag');
    head.append(ico, name, tag);
    head.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: window.wsT('sidebar.relocateEllipsis'), run: () => relocateRootUI(root.id) },
        { label: window.wsT('common.remove'), danger: true, run: () => removeRootUI(root.id) },
      ]);
    };
    const note = document.createElement('div');
    note.className = 'sb-root-miss-note';
    const msg = document.createElement('span');
    msg.className = 'ws-truncate';
    msg.textContent = window.wsT('sidebar.missingNote');
    const acts = document.createElement('span');
    acts.className = 'sb-root-miss-acts';
    const relBtn = document.createElement('button');
    relBtn.className = 'sb-root-miss-act';
    relBtn.textContent = window.wsT('sidebar.relocate');
    relBtn.onclick = () => relocateRootUI(root.id);
    const rmBtn = document.createElement('button');
    rmBtn.className = 'sb-root-miss-act';
    rmBtn.textContent = window.wsT('common.remove');
    rmBtn.onclick = () => removeRootUI(root.id);
    acts.append(relBtn, rmBtn);
    note.append(msg, acts);
    parent.append(head, note);
  }

  // 应用新根顺序：本地立即生效（乐观），主进程校验持久化；被拒（集合不符=状态漂移）就按主进程真相重拉。
  async function applyRootOrder(ids) {
    const byId = new Map(rootsState.map((r) => [r.id, r]));
    if (ids.length === rootsState.length && ids.every((id) => byId.has(id))) {
      rootsState = ids.map((id) => byId.get(id));
      render();
    }
    try {
      const r = await window.ws2.wsReorderRoots(ids);
      if (!r) await resyncRoots();
    } catch (e) { /* 主进程拒绝：下次重启按 store 真相恢复 */ }
  }
  function reorderRootTo(rootId, toIndex) {
    const ids = rootsState.map((x) => x.id).filter((id) => id !== rootId);
    ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, rootId);
    applyRootOrder(ids);
  }
  // 与主进程注册表重对齐（乐观更新被拒时的兜底 / 运行时根状态变化广播）：重拉根列表。
  // 修 D2 同款：先按注册表重排 rootsState 并立刻渲染（已有活根保留其已渲染的树 + 展开态，不再 Promise.all
  // 全量重读把界面门控在大根读树上），再逐根串行只补「新出现 / 刚复活」的根的树——一根巨型不阻塞界面。
  // 已有活根的树由 watcher/focus 兜底保持新鲜，resync 不必重读它们（重读还会把展开态 collectDirRels 回收起）。
  async function resyncRoots() {
    try {
      const infos = await window.ws2.wsGetRoots();
      const toLoad = [];
      rootsState = infos.map((r) => {
        const prev = rootOf(r.id);
        if (prev) {
          prev.path = r.path; prev.name = r.name;
          if (r.missing) prev.missing = true;
          else if (prev.missing) { prev.missing = false; prev.loading = true; toLoad.push(prev.id); } // 复活 → 补树
          return prev;
        }
        const st = mkRootState(r, null);
        if (!r.missing) { st.loading = true; toLoad.push(st.id); } // 新出现的根 → 补树
        return st;
      });
      rootsGen++;
      syncChrome();
      render();
      for (const id of toLoad) await loadRootTree(id);
    } catch (e) { /* ignore */ }
  }

  // ===== sticky ancestor（祖先文件夹吸顶）=====
  // 扁平树没法用原生 CSS sticky 正确「释放」深层过时祖先（VS Code 也用独立浮层而非 sticky）→ JS 浮层：
  // 滚动时算出当前可视区顶部那一行的祖先文件夹链，克隆成行填进 #sb-sticky、绝对定位在可视区顶。
  // 性能：每次 render 缓存各行**在树内的相对 top**（= el.offsetTop − treeEl.offsetTop）。这样上方的置顶/标签区
  // 增高（开标签/置顶，只 renderZones 不 render）时缓存不失效——滚动帧里折线也换算成树内坐标（scrollTop −
  // treeEl.offsetTop），两边同参照，zone 高度变化自动抵消。每帧只多读一次 treeEl.offsetTop，不逐行读 layout。
  const STICKY_H = 30;
  // 强制吸顶浮层下一帧重建的哨兵：renderSticky 用 `key !== stickyEl.dataset.key` 判要不要重建，
  // 而空 pins 的真 key 是 ''——若用 '' 当强制值就撞成 no-op、残留旧克隆（对抗审查抓的）。用一个真 key
  // 永不产生的值（含 ，rootId/rel 都不含）当哨兵，任何真 key 都 ≠ 它 → 必重建。
  const STICKY_FORCE = '\u0000force';
  let stickyRows = [];
  let stickyRaf = 0;
  function cacheStickyRows() {
    if (!treeEl) return;
    const base = treeEl.offsetTop; // 树顶相对 #sb-body；下面减掉它 → 存树内相对位置（与 zone 高度无关）
    stickyRows = [...treeEl.querySelectorAll('.sb-row')].map((el) => ({
      el,
      top: el.offsetTop - base,
      // 根标题行 depth=-1（最外层祖先；失联根的说明行不是 .sb-row 不进缓存）。'|| 0' 会把 '-1' 保住（Number('-1')=-1 truthy）。
      depth: Number(el.dataset.depth) || 0,
      isDir: el.classList.contains('sb-dir') || el.classList.contains('sb-root-head'),
    }));
  }
  function stickyPins(fold) {
    // fold = 折线在树内坐标；anchor = 底边越过折线的第一行；其祖先 = 前面按 depth 递减的 dir 行，
    // 一路收到该节的根标题行（depth=-1）为止——滚多深都看得见「我在哪个文件夹里」。
    let ai = -1;
    for (let i = 0; i < stickyRows.length; i++) {
      if (stickyRows[i].top + STICKY_H > fold + 0.5) { ai = i; break; }
    }
    if (ai < 0) return [];
    const pins = [];
    let need = stickyRows[ai].depth - 1;
    for (let j = ai - 1; j >= 0 && need >= -1; j--) {
      if (stickyRows[j].depth === need && stickyRows[j].isDir) { pins.unshift(stickyRows[j]); need--; }
    }
    return pins;
  }
  function clearSticky() {
    stickyRows = [];
    if (stickyEl) { stickyEl.textContent = ''; stickyEl.dataset.key = ''; stickyEl.classList.remove('has-pins'); }
  }
  function renderSticky() {
    stickyRaf = 0;
    if (!bodyEl || !stickyEl || !treeEl) return;
    const scrollTop = bodyEl.scrollTop;
    const pins = stickyPins(scrollTop - treeEl.offsetTop); // 折线换成树内坐标（live 读 treeEl.offsetTop，zone 变高自动对）
    const key = pins.map((p) => (p.el.dataset.root || '') + ':' + (p.el.dataset.rel || '')).join('|'); // 键带根限定：不同根里同 rel 的祖先不算同一行
    if (key !== stickyEl.dataset.key) {
      stickyEl.dataset.key = key;
      stickyEl.textContent = '';
      for (const { el } of pins) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.sb-add').forEach((n) => n.remove()); // 去掉 hover「+」钮；导引线保留（相对克隆行定位正确，跟树里连贯）
        clone.removeAttribute('tabindex'); // a11y：浮层 aria-hidden，克隆不该可聚焦（否则 Tab 掉进隐藏子树）
        clone.removeAttribute('role');
        clone.classList.add('sb-sticky-row');
        clone.onclick = () => bodyEl.scrollTo({ top: Math.max(0, el.offsetTop - 2), behavior: 'smooth' });
        // 右键转发给真行的菜单（cloneNode 不复制 property 事件处理器，否则吸顶行右键是死区）
        clone.oncontextmenu = (e) => {
          e.preventDefault();
          el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
        };
        // p2-5：拖放三件同样要转发——否则吸顶的祖先行是拖放死区（.sb-sticky-row 是 pointer-events:auto，
        // 拖拽事件被克隆行截获、死在这里）。真行 drop handler 读的是模块级 dragNode（非 dataTransfer），
        // 把克隆行的真实拖拽事件直接喂进真行同一个 handler；高亮反馈另在克隆行同步（真行滚出视口、加在它
        // 身上用户看不见），并即时清掉真行的临时 class 免污染下一次 cloneNode。
        const cleanEl = () => el.classList.remove('sb-drop', 'sb-insert-before', 'sb-insert-after');
        clone.ondragover = (e) => { if (typeof el.ondragover === 'function') el.ondragover(e); clone.classList.toggle('sb-drop', e.defaultPrevented); cleanEl(); };
        clone.ondragleave = (e) => { if (typeof el.ondragleave === 'function') el.ondragleave(e); clone.classList.remove('sb-drop'); cleanEl(); };
        clone.ondrop = (e) => { if (typeof el.ondrop === 'function') el.ondrop(e); clone.classList.remove('sb-drop'); cleanEl(); };
        stickyEl.appendChild(clone);
      }
      stickyEl.classList.toggle('has-pins', pins.length > 0);
    }
    stickyEl.style.top = scrollTop + 'px'; // 浮层在 #sb-body 坐标系；单 CSSOM 属性，CSP 安全；跟住可视区顶
  }
  function onBodyScroll() { if (!stickyRaf) stickyRaf = requestAnimationFrame(renderSticky); }
  if (bodyEl) bodyEl.addEventListener('scroll', onBodyScroll, { passive: true });

  // ===== 整理操作（U6）：右键菜单 / hover+ / 内联改名 / 拖拽移动 / 删除撤销 + 当前文件边界同步 =====
  let dragNode = null;
  const PLUS_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

  const parentDirOf = (rel) => {
    const i = rel.lastIndexOf('/');
    return i >= 0 ? rel.slice(0, i) : '';
  };
  // p2-1：拖一个目录进它自己 / 自己的子孙 = 非法（后端 movePath 也有守卫兜底，前端先拒免出无效高亮）。
  const dropWouldNest = (dn, destRootId, destRel) =>
    !!dn && dn.isDir && dn.rootId === destRootId && (destRel === dn.rel || destRel.indexOf(dn.rel + '/') === 0);
  const openPath = () => (window.__shellDocPath ? window.__shellDocPath() : null);
  function isUnder(child, parentAbs) {
    if (!child || !parentAbs) return false;
    if (child === parentAbs) return true;
    return child.indexOf(parentAbs) === 0 && (child[parentAbs.length] === '/' || child[parentAbs.length] === '\\');
  }

  async function commitRenameOp(node, newLeaf) {
    const op = openPath();
    const wasOpen = !node.isDir && op === node.abs;
    // 修 SB-1：改的是「包含当前打开文档的文件夹」时也要给编辑器重指向——否则 docPath 仍指旧路径，
    // 此后每次（自动）保存都 ENOENT 失败、弹 alert 风暴（doDelete 早有 isUnder 处理，rename 漏了）。
    const openUnderDir = node.isDir && isUnder(op, node.abs);
    markInAppFileOp(); // U5：标记 in-app 操作，抑制紧随的外部改名探测二次提示
    let r;
    try { r = await window.ws2.wsRename(node.rootId, node.rel, newLeaf, op); } // op=打开中文档 abs，主进程重写时跳过它
    catch (e) { showToast(window.wsT('sidebar.renameFailed', { err: shortErr(e) })); await refreshRoot(node.rootId); return; } // 根刚失联/文件没了：别未捕获 rejection 把改名框晾在原地
    // P3-03：用户在改名框里换了文档后缀（如 .html 输成 .md）——改名不改格式，保原后缀并提示走另存为。
    if (r.formatKept) showToast(window.wsT('sidebar.formatKept'));
    if (wasOpen && window.__shellRetargetDoc) window.__shellRetargetDoc(r.abs, r.rel.split('/').pop());
    else if (openUnderDir && window.__shellRetargetDoc) {
      const newAbs = r.abs + op.slice(node.abs.length); // 前缀替换（isUnder 已确认 op 以 node.abs+分隔符 开头）
      window.__shellRetargetDoc(newAbs, newAbs.split(/[\\/]/).pop());
    }
    if (r.rel !== node.rel) {
      retargetTabsUnder(node.rootId, node.rel, r.rel, node.isDir); // 标签跟随改名（限定该根）
      // 修 SB-12：collapsed 以 rootId:rel 为键，改目录名后旧键残留、新键不在集合 → 被改名的收起文件夹连同子树全展开。
      // 把旧前缀的收起项迁到新前缀，保持展开/收起状态。
      if (node.isDir) {
        const oldK = colKey(node.rootId, node.rel);
        for (const key of [...collapsed]) {
          if (key === oldK || key.indexOf(oldK + '/') === 0) { collapsed.delete(key); collapsed.add(colKey(node.rootId, r.rel) + key.slice(oldK.length)); }
        }
      }
    }
    // U5 撤销：反向改名（新 rel → 旧基名，走同一套 commitRenameOp → 引用反向重写 + 标签/retarget 自然反转）。
    const oldAbs = node.abs, newRel = r.rel, rootId = node.rootId, oldBase = node.name.replace(/\.[^.]+$/, '');
    const reverse = r.rel !== node.rel ? (() => undoMoveOp(newRel, oldAbs, rootId, (nn) => commitRenameOp(nn, oldBase))) : null;
    await notifyRefsRewritten(r, reverse); // U5：更新打开中文档 + toast「已更新 N 篇」+ 撤销
    await refreshRoot(node.rootId);
  }
  // U5 改名/移动收口：主进程已重写非打开文档（r.rewritten），这里把 moves 应用到打开中文档的内存 DOM，
  // 合计后弹 toast（有引用被更新才弹）+「撤销」action（reverse=把这次改名/移动整个反着做一遍，含反向重写）。
  async function notifyRefsRewritten(r, reverse) {
    const openN = (r.moves && r.moves.length && window.__wsApplyMovesToOpenDoc) ? await window.__wsApplyMovesToOpenDoc(r.moves) : 0;
    const total = (r.rewritten || 0) + openN;
    if (total > 0) {
      if (reverse) showToast(window.wsT('sidebar.linksUpdated', { total }), window.wsT('common.undo'), reverse);
      else showToast(window.wsT('sidebar.linksUpdated', { total }));
    }
  }
  // U5 撤销：把改名/移动整个反着做一遍（L4：绝不快照回滚——反向 op 走同一套机器，引用/标签/retarget 自然反转）。
  // 前置校验：新文件还在、旧路径没被占（不满足→明说放弃、不做半套）。revOp = 反向操作的执行体。
  async function undoMoveOp(newRel, oldAbs, rootId, revOp) {
    if (!(await window.ws2.pathExists(await window.ws2.wsAbs(rootId, newRel))) || (await window.ws2.pathExists(oldAbs))) {
      showToast(window.wsT('sidebar.undoLinkFailed')); return;
    }
    const nn = findNode(rootId, newRel);
    if (nn) await revOp(nn);
  }
  // U5 外部改名/移动探测（询问式，绝不静默改盘）：reconcile 里 inode 匹配算「旧 rel → 新 rel」，
  // 若旧路径有文档引用 → toast「一键更新」；只有用户点了才重写引用。app 内改名走 lastInAppFileOp 抑制。
  async function detectExternalRenames(rootId, oldTree, inoToRel) {
    if (Date.now() - lastInAppFileOp < 3000) return; // app 内改动刚发生 → 别当外部重复提示
    const moves = new Map();
    (function w(nodes) {
      for (const n of nodes) {
        if (n.isDir) { w(n.children || []); continue; }
        if (n.ino == null || !/\.(html?|md)$/i.test(n.rel)) continue;
        const newRel = inoToRel.get(String(n.ino));
        if (newRel && newRel !== n.rel) moves.set(n.rel, newRel); // 同 inode 挪了位置 = 外部改名/移动
      }
    })(oldTree || []);
    if (!moves.size) return;
    let total = 0; const names = [];
    for (const [oldRel] of moves) {
      let bl = [];
      try { bl = await window.ws2.linksBacklinks(rootId, oldRel); } catch (e) {}
      if (bl && bl.length) { total += bl.length; names.push(oldRel.split('/').pop()); }
    }
    if (!total) return; // 没文档引用旧路径 → 不打扰
    const label = names.length === 1 ? window.wsT('sidebar.quotedName', { name: names[0] }) : window.wsT('sidebar.nFiles', { n: names.length });
    showToast(window.wsT('sidebar.externalRenameDetected', { label, total }), window.wsT('sidebar.updateNow'), async () => {
      const openAbs = window.__shellDocPath ? window.__shellDocPath() : null;
      try {
        const res = await window.ws2.wsRewriteMoves(rootId, [...moves], openAbs); // C：返回 abs moves + fan-out（跨根引用也修）
        const n = (res && res.rewritten) || 0;
        const openN = (res && res.moves && window.__wsApplyMovesToOpenDoc) ? await window.__wsApplyMovesToOpenDoc(res.moves) : 0;
        showToast(window.wsT('sidebar.linksUpdated', { total: n + openN }));
      } catch (e) {}
    });
  }
  async function doMove(node, destDirRel) {
    const op = openPath();
    const wasOpen = !node.isDir && op === node.abs;
    markInAppFileOp(); // U5：抑制外部改名探测二次提示
    let r;
    try { r = await window.ws2.wsMove(node.rootId, node.rel, destDirRel, op); } // op=打开中文档 abs，主进程重写时跳过它
    catch (e) { showToast(window.wsT('sidebar.moveFailed', { err: shortErr(e) })); await refreshRoot(node.rootId); return; }
    if (wasOpen && window.__shellRetargetDoc && r.abs !== node.abs) {
      window.__shellRetargetDoc(r.abs, r.rel.split('/').pop());
    }
    if (r.rel !== node.rel) retargetTabsUnder(node.rootId, node.rel, r.rel, node.isDir); // 标签跟随移动
    // U5 撤销：反向移动回原目录（走同一套 doMove → 引用反向重写 + 标签/retarget 自然反转）。
    const oldAbs = node.abs, newRel = r.rel, rootId = node.rootId;
    const oldDir = node.rel.indexOf('/') >= 0 ? node.rel.slice(0, node.rel.lastIndexOf('/')) : '';
    const reverse = r.rel !== node.rel ? (() => undoMoveOp(newRel, oldAbs, rootId, (nn) => doMove(nn, oldDir))) : null;
    await notifyRefsRewritten(r, reverse); // U5：更新打开中文档 + toast + 撤销
    await refreshRoot(node.rootId);
  }
  // U5 外部改名探测的抑制：app 内改名/移动已在 ws-rename/ws-move 重写过引用，别让紧随的 watcher
  // reconcile 又把同一次改动当「外部改名」二次提示。记最近一次 in-app 文件操作时间，探测在窗口内跳过。
  let lastInAppFileOp = 0;
  const markInAppFileOp = () => { lastInAppFileOp = Date.now(); };
  // 跨根移动进行中的根（引用计数，支持并发移动同根参与）：onTreeChanged 对这些根跳过 reconcile。
  // 见 onTreeChanged 里的说明（对抗审查 P2 竞态）。
  const crossMoveGuard = new Map();
  const guardRoot = (id) => crossMoveGuard.set(id, (crossMoveGuard.get(id) || 0) + 1);
  const unguardRoot = (id) => { const n = (crossMoveGuard.get(id) || 0) - 1; if (n <= 0) crossMoveGuard.delete(id); else crossMoveGuard.set(id, n); };

  // 跨根移动（node 从它自己的根搬到 toRootId 的 destDirRel）：v1 便宜档同盘 rename；跨盘 toast 提示不搬。
  // 标签换根跟随、collapsed 键换根迁移、打开中文档/其祖先目录重指向、两根树都刷。
  // 全程守卫两根的 reconcile（crossMoveGuard）：移动落盘到标签 retarget 之间有 IPC 往返窗口，期间
  // watcher 事件不能抢跑 reconcile（否则源根找不到已搬走文件的 inode → 误删标签）。
  async function doMoveAcross(node, toRootId, destDirRel) {
    // C2：跨根移动 = 自动重写所有根里的引用 + toast 撤销（不再弹 U-CR0 守卫；守卫是 C 落地前的临时保护）。
    const op = openPath();
    const wasOpen = !node.isDir && op === node.abs;
    const openUnderDir = node.isDir && isUnder(op, node.abs); // 移动的目录含当前打开文档
    markInAppFileOp(); // 抑制外部改名探测二次提示（跨根重写会动多根、别被 watcher 当外部改名）
    guardRoot(node.rootId);
    guardRoot(toRootId);
    try {
      let r;
      try { r = await window.ws2.wsMoveAcross(node.rootId, node.rel, toRootId, destDirRel, op); } // op=打开中文档 abs，主进程重写时跳过它
      catch (e) { showToast(window.wsT('sidebar.moveFailed', { err: shortErr(e) })); await refreshRoot(node.rootId); return; }
      if (r && r.crossDevice) { // 真跨盘：不搬，明确告知（此前没动任何状态）
        showToast(window.wsT('sidebar.crossDeviceMove'));
        return;
      }
      // 标签换根跟随（含撞名去重后的新 rel/title）
      tabState = window.WS2Tabs.retargetSubtreeAcross(tabState, node.rootId, node.rel, toRootId, r.rel, node.isDir);
      persistTabs();
      // collapsed 键换根迁移（照 commitRenameOp 的 SB-12，多换一个 rootId）：目录移动才有子树折叠状态
      if (node.isDir) {
        const oldK = colKey(node.rootId, node.rel);
        const newK = colKey(toRootId, r.rel);
        for (const key of [...collapsed]) {
          if (key === oldK || key.indexOf(oldK + '/') === 0) { collapsed.delete(key); collapsed.add(newK + key.slice(oldK.length)); }
        }
      }
      // 打开中文档重指向（否则 docPath 仍指旧根旧路径，后续保存 ENOENT）
      if (wasOpen && window.__shellRetargetDoc) window.__shellRetargetDoc(r.abs, r.rel.split('/').pop());
      else if (openUnderDir && window.__shellRetargetDoc) {
        const newAbs = r.abs + op.slice(node.abs.length); // 前缀替换（isUnder 确认 op 以 node.abs+分隔符 开头）
        window.__shellRetargetDoc(newAbs, newAbs.split(/[\\/]/).pop());
      }
      await refreshRoot(node.rootId); // 源根：文件走了
      await refreshRoot(toRootId); // 目标根：文件来了
      // C2 撤销：把它移回原根原目录（走同一套 doMoveAcross → 引用反向重写 + 标签/retarget 自然反转，L4）。
      const origDir = node.rel.indexOf('/') >= 0 ? node.rel.slice(0, node.rel.lastIndexOf('/')) : '';
      const fromRootId = node.rootId, oldAbs = node.abs, newRel = r.rel;
      const reverse = () => undoMoveOp(newRel, oldAbs, toRootId, (nn) => doMoveAcross(nn, fromRootId, origDir));
      await notifyRefsRewritten(r, reverse); // C2：更新打开中文档 + toast「已更新 N 篇 · 撤销」（有引用被改才弹）
      // 移动的正是激活标签对应文件 → 在目标根树里展开定位
      const act = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
      if (act && act.rootId === toRootId && act.rel) expandToFile(toRootId, act.rel);
    } finally {
      unguardRoot(node.rootId);
      unguardRoot(toRootId);
    }
  }
  // U6 删除守卫（父层 modal，抄 sb-modal 壳；用 createElement 装用户文件名，防 XSS）。resolve(true)=仍要删除。
  function deleteGuardModal(node, referrers) {
    return new Promise((resolve) => {
      const N = referrers.length;
      const overlay = document.createElement('div');
      overlay.className = 'sb-modal-overlay';
      const modal = document.createElement('div');
      modal.className = 'sb-modal ws-delguard';
      overlay.appendChild(modal);
      const h = document.createElement('div'); h.className = 'sb-modal-title';
      h.textContent = node.isDir ? window.wsT('sidebar.delGuardTitleDir', { name: node.name, n: N })
                                 : window.wsT('sidebar.delGuardTitleFile', { name: node.name, n: N });
      modal.appendChild(h);
      const desc = document.createElement('div'); desc.className = 'ws-delguard-desc';
      desc.textContent = window.wsT('sidebar.delGuardDesc');
      modal.appendChild(desc);
      const list = document.createElement('div'); list.className = 'ws-delguard-list';
      referrers.slice(0, 5).forEach((s) => {
        const it = document.createElement('div'); it.className = 'ws-delguard-item'; it.title = s.rel;
        const t = document.createElement('div'); t.className = 'ws-delguard-item-title'; t.textContent = s.title || s.rel;
        const p = document.createElement('div'); p.className = 'ws-delguard-item-path'; p.textContent = s.rel;
        it.appendChild(t); it.appendChild(p); list.appendChild(it);
      });
      if (N > 5) { const more = document.createElement('div'); more.className = 'ws-delguard-more'; more.textContent = window.wsT('sidebar.delGuardMore', { n: N }); list.appendChild(more); } // N=引用总数，非 remainder
      modal.appendChild(list);
      const acts = document.createElement('div'); acts.className = 'ws-delguard-actions';
      const cancel = document.createElement('button'); cancel.className = 'ws-delguard-btn'; cancel.textContent = window.wsT('common.cancel');
      const del = document.createElement('button'); del.className = 'ws-delguard-btn ws-delguard-danger'; del.textContent = window.wsT('sidebar.stillDelete');
      acts.appendChild(cancel); acts.appendChild(del); modal.appendChild(acts);
      const close = (v) => { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
      cancel.addEventListener('click', () => close(false));
      del.addEventListener('click', () => close(true));
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(false); }); // 点遮罩=取消
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      cancel.focus();
    });
  }
  // （U-CR0 的跨根移动守卫弹窗已退役：C2 让跨根移动自动重写引用 + 撤销，不再需要「移动会断链」的事前警告。）
  async function doDelete(node) {
    // U6 删除守卫：先查引用（文件→backlinks，文件夹→夹外引用）。有引用才弹守卫、用户确认才删；无引用直接删。
    let referrers = [];
    try {
      referrers = node.isDir ? await window.ws2.linksDirBacklinks(node.rootId, node.rel)
                             : await window.ws2.linksBacklinks(node.rootId, node.rel);
    } catch (e) { referrers = []; }
    if (referrers && referrers.length) {
      const ok = await deleteGuardModal(node, referrers);
      if (!ok) return; // 取消：不删
    }
    const op = openPath();
    const affectsOpen = op && (op === node.abs || (node.isDir && isUnder(op, node.abs)));
    // p3-05：删除前快照被删 rel（目录则含级联子孙）的标签 entry（pinned/open/kind/title）——removeTabsUnder
    // 会把这些整个删掉，撤销只还原磁盘、reconcile 当新文件，置顶/打开状态本会丢一半。撤销成功后按此恢复。
    const underRel = (rel) => rel === node.rel || rel.indexOf(node.rel + '/') === 0;
    const tabSnapshot = tabState.entries
      .filter((e) => e.rel && e.rootId === node.rootId && (node.isDir ? underRel(e.rel) : e.rel === node.rel))
      .map((e) => ({ rootId: e.rootId, rel: e.rel, kind: e.kind, title: e.title, open: !!e.open, pinned: !!e.pinned }));
    let r;
    try { r = await window.ws2.wsDelete(node.rootId, node.rel); }
    catch (e) { showToast(window.wsT('sidebar.deleteFailed', { err: shortErr(e) })); await refreshRoot(node.rootId); return; }
    removeTabsUnder(node); // 移除被删文件的标签
    await refreshRoot(node.rootId);
    if (affectsOpen) { // 删了当前打开的 → 切到下一个标签 / 回空态
      const e = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
      const n = e && e.rel ? findNode(e.rootId, e.rel) : null;
      if (n) openNode(n);
      else if (window.__shellCloseDoc) window.__shellCloseDoc();
    }
    showToast(window.wsT('sidebar.deleted', { name: node.name }), window.wsT('common.undo'), async () => {
      const undo = await window.ws2.wsUndoDelete(node.rootId, r.token); // { rel, abs }：真实恢复位置（原位被占会去重改名）
      await refreshRoot(node.rootId);
      // p3-05：撤销 = 回到删前，恢复置顶/打开状态。两个坑（对抗审查 CONFIRMED）：
      // ① 用 undo.rel 重映射快照 rel——撤销时原位被占会去重改名（文件回到新 rel），快照里存的是旧 rel，
      //    直接按旧 rel 找会「找不到=丢置顶」，更糟「旧 rel 现被别的文件占=置顶落到错文件」。
      // ② 恢复 open **别用会抢激活的 openEntry**——applyTabs 不载入编辑器，抢了激活只会让「高亮的激活标签
      //    ≠编辑器内容」。删前的激活项 activeBefore 在恢复后原样钉回，只补 open/pinned 标记、不动激活/编辑器。
      const remap = (rel) => (undo && undo.rel != null) ? undo.rel + rel.slice(node.rel.length) : rel;
      let next = tabState;
      const activeBefore = next.activeRel;
      for (const s of tabSnapshot) {
        const rel = remap(s.rel);
        if (!findNode(s.rootId, rel)) continue; // 文件没真回来 → 跳过，不硬塞不存在的 entry
        const file = { rootId: s.rootId, rel, kind: s.kind || 'other', title: s.title };
        if (s.open) next = window.WS2Tabs.openEntry(next, file);
        if (s.pinned) next = window.WS2Tabs.pinEntry(next, file);
      }
      next = { entries: next.entries, activeRel: activeBefore }; // 激活/编辑器原样不动，只恢复标记
      applyTabs(next);
    });
  }
  async function newSubfolder(rootId, dirRel) {
    try { await window.ws2.wsMakeDir(rootId, dirRel, window.wsT('common.newFolder')); }
    catch (e) { showToast(window.wsT('sidebar.newFolderFailed', { err: shortErr(e) })); return; }
    await refreshRoot(rootId);
  }
  // IPC 错误串裁短（Electron 会包一层 "Error invoking remote method 'ws-x': Error: ..."，只留最后一段）
  function shortErr(e) {
    const s = String((e && e.message) || e);
    return s.split('Error: ').pop().slice(0, 80);
  }

  function closeContextMenu() {
    const m = document.getElementById('sb-ctx');
    if (m) m.remove();
  }
  function showContextMenu(x, y, items) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'sb-ctx';
    menu.id = 'sb-ctx';
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'sb-ctx-item' + (it.danger ? ' is-danger' : '');
      b.textContent = it.label;
      b.onclick = () => {
        closeContextMenu();
        it.run();
      };
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    menu.style.left = x + 'px'; // 单 CSSOM 属性，CSP 安全
    menu.style.top = y + 'px';
    setTimeout(() => {
      const off = (e) => {
        if (!e.target.closest('#sb-ctx')) closeContextMenu();
        document.removeEventListener('mousedown', off);
      };
      document.addEventListener('mousedown', off);
    }, 0);
  }

  function startInlineRename(node, rowEl) {
    const nameEl = rowEl.querySelector('.sb-name');
    if (!nameEl) return;
    const dot = node.name.lastIndexOf('.');
    const base = !node.isDir && dot > 0 ? node.name.slice(0, dot) : node.name;
    const input = document.createElement('input');
    input.className = 'sb-rename';
    input.value = base;
    input.onclick = (e) => e.stopPropagation();
    input.onmousedown = (e) => e.stopPropagation();
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    input.onblur = async () => {
      if (done) return;
      done = true;
      if (input.value && input.value !== base) await commitRenameOp(node, input.value);
      else await refresh();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        done = true;
        refresh();
      }
    };
  }

  function renderNode(node, depth, parent, forceOpen, lazy) {
    if (node.isDir) {
      // compact folders：单子文件夹链合并成一行，身份落最深那级 dir。lazy 根**不压缩**——子层按需加载，
      // 压缩会把「还没加载的下一层」误判成单子链、身份/展开都乱（简化模式下每级独立展开更清楚）。
      const chain = lazy ? { names: [node.name], rels: [node.rel], tail: node } : compactChain(node);
      const dir = chain.tail;
      const open = forceOpen || !collapsed.has(colKey(dir.rootId, dir.rel));
      const row = document.createElement('div');
      row.className = 'sb-row sb-dir';
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.draggable = true; // p2-1：目录可拖拽移动（同根/跨根），复用文件行的 dragNode + dir/根标题的既有 drop
      row.dataset.rel = dir.rel;
      row.dataset.root = dir.rootId; // 多根：行归属哪个根（e2e/高亮/折叠都靠它限定）
      row.dataset.depth = depth; // sticky ancestor：按 depth 算祖先链
      const caret = document.createElement('span');
      caret.className = 'sb-caret' + (open ? ' is-open' : '');
      caret.innerHTML = SVG.chevron;
      const ico = document.createElement('span');
      ico.className = 'sb-ico';
      ico.innerHTML = SVG.folder;
      const name = document.createElement('span');
      name.className = 'sb-name ws-truncate';
      if (chain.names.length > 1) {
        // 合并链：各段用淡色「/」隔开显示
        chain.names.forEach((seg, i) => {
          if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'sb-seg-sep';
            sep.textContent = '/';
            name.appendChild(sep);
          }
          name.appendChild(document.createTextNode(seg));
        });
      } else {
        name.textContent = dir.name;
      }
      name.title = chain.names.join('/'); // 名字过长被截断时，悬停显示全名（含压缩链全路径）
      const add = document.createElement('button');
      add.className = 'sb-add';
      add.title = window.wsT('sidebar.addDocHere');
      add.innerHTML = PLUS_SVG;
      add.onclick = (e) => {
        e.stopPropagation();
        openCreateModal(dir.rootId, dir.rel);
      };
      row.append(caret, ico, name, add);
      applyIndent(row, depth, false);
      row.onclick = () => {
        // 折叠状态按**整条 compact 链**一致处理（不只 tail）：展开=删掉链上每级键、收起=每级都加。
        // 否则残留的祖先折叠键会在链日后断开（外部往中间级加文件）时命中新 tail、把已展开的链无声重折叠。
        const wasCollapsed = collapsed.has(colKey(dir.rootId, dir.rel));
        if (wasCollapsed) chain.rels.forEach((r) => collapsed.delete(colKey(dir.rootId, r)));
        else chain.rels.forEach((r) => collapsed.add(colKey(dir.rootId, r)));
        scheduleTreeStateSave(); // P3-07：展开/收起 → 持久化（防抖）
        // lazy 根：首次展开一个未加载目录 → 读它这一层（loadDirChildren 内部会 renderRoot）；否则只重建该根。
        if (lazy && wasCollapsed && !dir.childrenLoaded) loadDirChildren(dir.rootId, dir.rel);
        else renderRoot(dir.rootId); // 只重建该文件所在的根（性能）
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: window.wsT('sidebar.newDoc'), run: () => openCreateModal(dir.rootId, dir.rel) },
          { label: window.wsT('sidebar.newSubfolder'), run: () => newSubfolder(dir.rootId, dir.rel) },
          { label: window.wsT('common.rename'), run: () => startInlineRename(dir, row) },
          { label: window.wsT('common.delete'), danger: true, run: () => doDelete(dir) },
        ]);
      };
      row.ondragstart = (e) => {
        dragNode = dir; // p2-1：拖的是目录（compact 链落最深那级 tail = dir）
        e.dataTransfer.effectAllowed = 'all';
        e.dataTransfer.setData('text/plain', dir.rel);
        window.__wsDragFile = null; // 目录不能作为链接插进正文，别喂给文档 drop
      };
      row.ondragend = () => { dragNode = null; };
      row.ondragover = (e) => {
        // 跨根移动已放开（v1 便宜档：同盘 rename、跨盘 toast）。挡「同根且已在此文件夹」的 no-op +
        // p2-1：目录拖进自己/自己的子孙（会造环）。
        if (!dragNode || (dragNode.rootId === dir.rootId && parentDirOf(dragNode.rel) === dir.rel)) return;
        if (dropWouldNest(dragNode, dir.rootId, dir.rel)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('sb-drop');
      };
      row.ondragleave = (e) => {
        if (!row.contains(e.relatedTarget)) row.classList.remove('sb-drop');
      };
      row.ondrop = (e) => {
        if (!dragNode) return;
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove('sb-drop');
        if (dropWouldNest(dragNode, dir.rootId, dir.rel)) { showToast(window.wsT('sidebar.cantMoveIntoSelf')); dragNode = null; return; }
        // 同根→doMove(rename)；跨根→doMoveAcross(换根)
        if (dragNode.rootId === dir.rootId) doMove(dragNode, dir.rel);
        else doMoveAcross(dragNode, dir.rootId, dir.rel);
      };
      parent.appendChild(row);
      if (open) {
        if (lazy && dir._loading) {
          // lazy 目录正在读它这一层 → loading 行占位（别显示成「空文件夹」）
          const e = document.createElement('div');
          e.className = 'sb-loading';
          e.style.paddingLeft = (26 + (depth + 1) * INDENT_STEP) + 'px';
          e.textContent = window.wsT('sidebar.readingLevel');
          parent.appendChild(e);
        } else if (lazy && !dir.childrenLoaded) {
          // 展开了但这一层还没加载（如从持久化展开态恢复）→ 触发加载 + loading 行占位
          const e = document.createElement('div');
          e.className = 'sb-loading';
          e.style.paddingLeft = (26 + (depth + 1) * INDENT_STEP) + 'px';
          e.textContent = window.wsT('sidebar.readingLevel');
          parent.appendChild(e);
          loadDirChildren(dir.rootId, dir.rel);
        } else if (dir.children.length) {
          for (const c of dir.children) renderNode(c, depth + 1, parent, forceOpen, lazy);
        } else {
          const e = document.createElement('div');
          e.className = 'sb-tree-empty';
          e.style.paddingLeft = (26 + (depth + 1) * INDENT_STEP) + 'px';
          e.textContent = lazy && dir.dirTruncated ? window.wsT('sidebar.dirTruncatedNote') : window.wsT('sidebar.emptyFolder');
          parent.appendChild(e);
        }
      }
    } else {
      const row = document.createElement('button');
      row.className = 'sb-row sb-file sb-kind-' + (node.kind || 'other');
      row.dataset.rel = node.rel;
      row.dataset.root = node.rootId;
      row.dataset.abs = node.abs;
      row.dataset.depth = depth;
      row.dataset.kind = node.kind || 'other';
      row.draggable = true;
      const ico = document.createElement('span');
      ico.className = 'sb-ico';
      ico.innerHTML = kindSvg(node.kind); // T8：按类型换形状（颜色仍走 .sb-kind-*）
      const name = document.createElement('span');
      name.className = 'sb-name ws-truncate';
      name.textContent = node.name;
      name.title = node.name; // 名字过长被截断时，悬停显示全名
      row.append(ico, name);
      applyIndent(row, depth, true);
      row.onclick = () => openNode(node);
      row.ondragstart = (e) => {
        dragNode = node;
        // effectAllowed 'all'（不是 'move'）：正文 drop 想要 dropEffect 'link'，源声明 'move' 会让浏览器直接禁 drop（L9）。
        e.dataTransfer.effectAllowed = 'all';
        e.dataTransfer.setData('text/plain', node.rel);
        // 跨 iframe 拖拽 dataTransfer 不可靠 → 用全局传递被拖文件（对齐 ui-demo getDragFile）；正文 drop 读它插链接。
        window.__wsDragFile = { rootId: node.rootId, rel: node.rel, kind: node.kind, title: node.name };
      };
      row.ondragend = () => {
        dragNode = null;
        window.__wsDragFile = null;
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        const nodeKey = colKey(node.rootId, node.rel); // 标签身份键 = rootId:rel（与 WS2Tabs.keyOf 一致）
        showContextMenu(e.clientX, e.clientY, [
          { label: window.wsT('common.open'), run: () => openNode(node) },
          { label: isPinned(nodeKey) ? window.wsT('sidebar.unpin') : window.wsT('sidebar.pin'), run: () => (isPinned(nodeKey) ? unpinRel(nodeKey) : pinFromTree(node)) },
          { label: window.wsT('common.rename'), run: () => startInlineRename(node, row) },
          { label: window.wsT('common.delete'), danger: true, run: () => doDelete(node) },
        ]);
      };
      parent.appendChild(row);
    }
  }

  // ---- 打开节点：.html/.md 进编辑器（md 读盘处已转 HTML）；其余进应用内查看器（图片/PDF 预览，其余给外部打开卡片）----
  function openNode(node) {
    if (node.kind === 'html' || node.kind === 'md') {
      openDoc(node.abs); // shell.js 的漏斗（脏检查/载入/watch/recents）
    } else if (window.__shellShowViewer) {
      window.__shellShowViewer(node); // 编辑区出预览/卡片，不再直接外部打开（node 带 rootId，viewer 的 wsFileUrl 要用）
    } else {
      window.ws2.wsOpenExternal(node.rootId, node.rel);
    }
  }

  // ---- 当前打开文件高亮 ----
  function highlightActive(absPath) {
    treeEl.querySelectorAll('.sb-file.is-active').forEach((el) => el.classList.remove('is-active'));
    if (!absPath) return;
    const row = treeEl.querySelector('.sb-file[data-abs="' + cssAttr(absPath) + '"]');
    if (row) row.classList.add('is-active');
  }
  // 转义属性选择器里的引号/反斜杠
  function cssAttr(v) {
    return String(v).replace(/["\\]/g, '\\$&');
  }

  // ---- 收起态图标轨已删（Wendi B2：去掉竖排图标）。renderRail 留 no-op 兼容调用点。----
  function renderRail() {}

  // ===== 标签页 + 置顶（双标记模型，纯逻辑在 window.WS2Tabs，按根持久化）=====
  const pinnedEl = document.getElementById('sb-pinned'); // 置顶区
  const tabsEl = document.getElementById('sb-tabs'); // 标签页区
  const PIN_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
  const PIN_OFF_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h9"/><path d="M15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H10"/></svg>';
  const X_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  let dragTabRel = null;
  // 身份键（跟 tabs.js 一致）：根内 = rootId:rel（多根里同 rel 不同根是不同文件）、外 = abs。外部标签 = 没有 rel。
  const keyOf = (e) => (e.rel ? (e.rootId ? e.rootId + ':' + e.rel : e.rel) : e.abs);
  const isExternal = (e) => !e.rel;
  // 临时文档标签（从「标签页 +」/ Cmd+T 新建、未落盘）：身份键用 shell 生成的 'temp:…'（rel/abs 都没有 →
  // 塞进 abs 当身份，靠前缀识别，不用改 tabs.js）。不持久化、不进树，手动保存才落盘变真文件。
  const TEMP_PREFIX = 'temp:';
  const isTempKey = (k) => typeof k === 'string' && k.indexOf(TEMP_PREFIX) === 0;
  const isTempEntry = (e) => isTempKey(keyOf(e));
  const baseName = (p) => String(p).split(/[\\/]/).pop();
  // 外部标签的「↗」轻标记图标（shell.js 的 EXT_SVG 是 script 作用域 const、跨不到这里，单独定义）。
  const EXT_ICO_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M9 7h8v8"/></svg>';

  // 在指定根的树里按 rel 找节点（多根里同 rel 是不同文件，必须带根限定）。
  function findNode(rootId, rel) {
    const st = rootOf(rootId);
    if (!st || !st.tree) return null;
    let found = null;
    (function walk(nodes) {
      for (const n of nodes) {
        if (found) return;
        if (n.rel === rel) { found = n; return; }
        if (n.children && n.children.length) walk(n.children);
      }
    })(st.tree);
    return found;
  }
  // 按绝对路径跨全部根找（abs 全局唯一——嵌套根已被入口拦死，不会两个根同时命中）。
  function findNodeByAbs(abs) {
    let found = null;
    for (const st of rootsState) {
      if (found || !st.tree) continue;
      (function walk(nodes) {
        for (const n of nodes) {
          if (found) return;
          if (!n.isDir && n.abs === abs) { found = n; return; }
          if (n.children && n.children.length) walk(n.children);
        }
      })(st.tree);
    }
    return found;
  }
  // 按身份键找 entry 对应的树节点（key 可能是 rootId:rel 或 abs）。
  function findEntryNode(entry) {
    if (!entry) return null;
    return entry.rel ? findNode(entry.rootId, entry.rel) : findNodeByAbs(entry.abs);
  }
  function isPinned(key) {
    return tabState.entries.some((e) => keyOf(e) === key && e.pinned);
  }
  function persistTabs() {
    // 全局单一集合写盘（主进程滤掉已移除根的 entries，防在飞 persist 复活幽灵）。
    // 临时文档不落盘、重启无从恢复 → 从持久化副本里剔掉（内存里的 tabState 仍保留它们，只是不写盘）。
    if (!window.ws2.wsSetTabs) return;
    const clean = {
      entries: tabState.entries.filter((e) => !isTempEntry(e)),
      activeRel: isTempKey(tabState.activeRel) ? null : tabState.activeRel,
    };
    window.ws2.wsSetTabs(clean).catch(() => {});
  }
  function applyTabs(next) {
    tabState = next;
    persistTabs();
    renderZones();
    renderRail();
  }

  function pinFromTree(node) {
    applyTabs(window.WS2Tabs.pinEntry(tabState, { rootId: node.rootId, rel: node.rel, kind: node.kind || 'other', title: node.name }));
  }
  function pinRel(entry) {
    applyTabs(window.WS2Tabs.pinEntry(tabState, { rootId: entry.rootId, rel: entry.rel, abs: entry.abs, kind: entry.kind, title: entry.title }));
  }
  function unpinRel(key) {
    applyTabs(window.WS2Tabs.unpinEntry(tabState, key));
  }
  // 关/删一条标签：「临时文档（不管是否激活）/ 激活且有未保存改动的真文件」→ 弹未保存确认
  // modal（对齐 ui-demo）；否则直接关 + 回落。op = closeEntry（标签页区的 ×）/ removeEntry（置顶区的 ×）。
  // ⚠ 临时文档的守卫不能加 wasActive 前置（Colin 2026-07-05 抓的 bug）：临时 = 内容只在
  // tempStore、关掉即丢，从别的标签页上点它的 × 一样要确认；真文件才是「只有激活才可能脏」
  // （自动保存 + 切走守卫兜着，后台真文件必然已落盘）。
  function closeOrRemove(key, op) {
    const wasActive = tabState.activeRel === key;
    const entry = tabState.entries.find((e) => keyOf(e) === key);
    if (!entry) return; // 双击 × 第二下打在已 detach 的旧行上：key 已不存在，别让 keyOf(undefined) 抛 TypeError
    // web 标签没有脏态；shell 的 dirty 属于底下开着的后台文档,不该把它的确认弹到网页标签头上。
    const dirtyActive = wasActive && !window.WS2Tabs.isWebEntry(entry) && window.__shellIsDirty && window.__shellIsDirty();
    // 修 SB-4（bug-sweep #111 与本 PR 撞车,两家合一）：临时文档永远是未保存内容 → 无论激活
    // 与否都要确认,别让非激活 temp 的 × 零确认直接销毁。非激活 temp 先切到前台（编辑器渲染它 +
    // 设为激活）,确认框的「保存并关闭」才作用在正确目标上。
    // 本 PR 补的防御：__shellReopenTemp 内部走 canLeaveActive,若被「脏文件切走」守卫取消,它会
    // 静默 no-op——此时不能再 openTabEntry（否则侧栏高亮已切、shell 还在旧文档,状态分裂,后续
    // 「保存并关闭」会把别的文档存进去）。校验 shell 真切过去了才继续,否则保守放弃本次关闭。
    if (isTempEntry(entry) || dirtyActive) {
      if (isTempEntry(entry) && !wasActive) {
        // 切到该 temp；若切走守卫（活跃脏文档丢弃确认）被取消，__shellReopenTemp 内部 no-op、活跃 temp 不变 →
        // 校验切过去了才继续，否则保守放弃本次关闭（别让 tabState 标它激活而 shell 还停旧文档、状态分裂）。
        if (window.__shellReopenTemp) window.__shellReopenTemp(key);
        const now = window.__shellActiveTemp && window.__shellActiveTemp();
        if (!now || now.id !== key) return; // 切换被守卫取消 → 标签保留,可重试
        openTabEntry(entry);
      }
      openCloseConfirm(key, op, entry);
      return;
    }
    finishClose(key, op);
  }
  // 真正执行关/移出 + 回落（未保存确认已在上游处理）。临时文档丢弃其内容 + 清脏；真文件确认丢弃后清脏。
  function finishClose(key, op) {
    const wasActive = tabState.activeRel === key;
    const entry = tabState.entries.find((e) => keyOf(e) === key);
    // ⌘⇧T 重开栈：只记非文档标签（web / 非可编辑的外部文件,spec §4.4——文档标签在树里丢不了,临时文档重开也没内容）
    if (entry && (window.WS2Tabs.isWebEntry(entry) || (isExternal(entry) && !isTempEntry(entry) && entry.kind !== 'html' && entry.kind !== 'md'))) {
      closedStack = window.WS2Tabs.pushClosed(closedStack, entry, 15);
    }
    // ⚠ web 标签不走 __shellDiscard（P1,两路审查确认）：shell 的 dirty 属于 view 底下的**后台文档**,
    // web 标签本身没有脏态。原来 web 标签也 setDirty(false) 会把后台文档 1.2s 自动保存窗内/保存失败的
    // 未保存修改静默清零（autosave 因 dirty=false 跳过写盘、退出守卫也解除）→ 切走/退出即丢数据。
    if (entry && isTempEntry(entry)) { if (window.__shellDiscardTemp) window.__shellDiscardTemp(key); }
    else if (wasActive && !window.WS2Tabs.isWebEntry(entry) && window.__shellDiscard) window.__shellDiscard();
    applyTabs(op(tabState, key));
    // web 标签不再「开着」（关闭/移出置顶）→ 销毁主进程 view 释放内存（⌘⇧T 重开 = 按存的 url 重建,不复活旧 view）
    if (entry && window.WS2Tabs.isWebEntry(entry) && !tabState.entries.some((e) => keyOf(e) === key && e.open)) {
      if (window.__webCloseView) window.__webCloseView(key);
    }
    if (wasActive) {
      let e = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
      // 相邻回落项若落在失联根 → 它打不开（openTabRow 只弹 toast、不切编辑器），会把编辑器留在刚关掉的
      // 文档上=状态分裂（对抗审查抓的）。改沿显示序回落到最后一个「可开」的标签（跳过失联根的），都不可
      // 开则关文档回空态。（相邻回落仍是浏览器式，只是失联标签不配当落点。）
      const unopenable = (x) => x.rel && (rootOf(x.rootId) || {}).missing;
      if (e && unopenable(e)) {
        const openable = window.WS2Tabs.displayOrder(tabState.entries).filter((x) => x.open && !unopenable(x));
        e = openable[openable.length - 1] || null;
        applyTabs({ entries: tabState.entries, activeRel: e ? keyOf(e) : null });
      }
      if (e) openTabRow(e, false); // 回落到相邻可开标签：切编辑器+高亮，但不滚树（Colin：关标签不该让树跳到别处）
      else if (window.__shellCloseDoc) window.__shellCloseDoc();
    }
  }
  // —— 统一模态壳部件（T1，对齐 ui-demo ws-modal）：带关闭 X 的 head + 分隔线；调用方再挂 body/foot ——
  const X_SVG16 = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  const WARN_SVG20 = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  function modalHead(titleText, subText, onClose) {
    const head = document.createElement('div');
    head.className = 'sb-modal-head';
    const text = document.createElement('div');
    text.className = 'sb-modal-head-text';
    const title = document.createElement('div');
    title.className = 'sb-modal-title';
    title.textContent = titleText;
    text.appendChild(title);
    if (subText) {
      const sub = document.createElement('div');
      sub.className = 'sb-modal-where';
      sub.textContent = subText;
      sub.title = subText; // 截断时悬停显全文（sub 单行 ellipsis）
      text.appendChild(sub);
    }
    const x = document.createElement('button');
    x.className = 'sb-modal-x';
    x.setAttribute('aria-label', window.wsT('common.close'));
    x.innerHTML = X_SVG16;
    x.onclick = onClose;
    head.append(text, x);
    return head;
  }
  function modalBody() { const b = document.createElement('div'); b.className = 'sb-modal-body'; return b; }
  // 遮罩关闭用 mousedown（对齐 ui-demo）：拖拽选文本拖到遮罩再松手不会误关（click 会）。
  function wireOverlayClose(overlay, close) { overlay.onmousedown = (e) => { if (e.target === overlay) close(); }; }

  // 未保存关闭确认（对齐 ui-demo CloseConfirmModal）：橙色警告图标 + 保存并关闭 / 不保存直接关闭 / 取消。
  function openCloseConfirm(key, op, entry) {
    if (document.querySelector('.sb-modal-overlay')) return; // 单例守卫（同 aiax/fp 弹层惯例）：连按不叠层、Esc 不一键全关、finishClose 不双跑
    const temp = isTempEntry(entry);
    const name = entry ? entry.title : window.wsT('sidebar.thisFile');
    const overlay = document.createElement('div');
    overlay.className = 'sb-modal-overlay';
    if (window.__shellPauseAutosave) window.__shellPauseAutosave(); // 修 SH-3：弹窗期间挂起自动保存
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    // close() 里恢复自动保存：scheduleAutoSave 的落地回调有 dirty&&docPath&&!tempDoc 守卫，
    // 丢弃/保存并关闭随后关掉文档也不会误存（docPath 变 null）。
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); if (window.__shellResumeAutosave) window.__shellResumeAutosave(); }
    const modal = document.createElement('div');
    modal.className = 'sb-modal sb-modal-confirm';
    const body = document.createElement('div');
    body.className = 'sb-cc-body';
    const ico = document.createElement('div');
    ico.className = 'sb-cc-ico';
    ico.innerHTML = WARN_SVG20;
    const textWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'sb-cc-title';
    title.textContent = window.wsT('sidebar.unsavedTitle', { name });
    const desc = document.createElement('div');
    desc.className = 'sb-modal-desc';
    desc.textContent = temp
      ? window.wsT('sidebar.unsavedDescTemp')
      : window.wsT('sidebar.unsavedDescReal');
    textWrap.append(title, desc);
    body.append(ico, textWrap);
    const foot = document.createElement('div');
    foot.className = 'sb-modal-foot';
    const discard = document.createElement('button');
    discard.className = 'sb-btn sb-btn-danger';
    discard.textContent = window.wsT('sidebar.closeWithoutSaving');
    discard.onclick = () => { close(); finishClose(key, op); };
    const spacer = document.createElement('span');
    spacer.className = 'sb-modal-spacer';
    const cancel = document.createElement('button');
    cancel.className = 'sb-btn';
    cancel.textContent = window.wsT('common.cancel');
    cancel.onclick = close;
    const save = document.createElement('button');
    save.className = 'sb-btn sb-btn-primary';
    save.textContent = window.wsT('sidebar.saveAndClose');
    save.onclick = async () => {
      close();
      if (temp) {
        // 临时 → 选文件夹存，存完自动关。SaveModal 存的是「当前活跃临时文档」（__shellActiveTemp），
        // 所以后台临时标签要先激活它再弹保存框——否则会把别的文档存进去（后台关闭 bug 的另半边）。
        if (tabState.activeRel !== key) {
          if (window.__shellReopenTemp) window.__shellReopenTemp(key);
          const now = window.__shellActiveTemp && window.__shellActiveTemp();
          if (!now || now.id !== key) return; // 切换被「脏文件切走」守卫取消 → 放弃本次保存（标签保留，可重试）
          openTabEntry(entry); // activeRel 同步切过去：高亮、保存后关闭的回落基准才一致
        }
        openSaveModal(true);
        return;
      }
      if (window.__shellSaveActive) await window.__shellSaveActive(); // 已落盘的脏文档：存原路径
      if (!window.__shellIsDirty || !window.__shellIsDirty()) finishClose(key, op);
    };
    foot.append(discard, spacer, cancel, save);
    modal.append(body, foot);
    overlay.appendChild(modal);
    wireOverlayClose(overlay, close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }

  // 「保存到哪里」（对齐 ui-demo SaveModal）：可编辑文件名 + 列工作区根/各子文件夹 + 「浏览…」原生
  // 保存框（存工作区外，Colin 拍板方案 A）。Enter 确认、Esc 关。
  function openSaveModal(closeAfter) {
    if (document.querySelector('.sb-modal-overlay')) return; // 单例守卫：别与关闭确认/另一个保存框叠层互踩
    const t = window.__shellActiveTemp && window.__shellActiveTemp();
    if (!t) return;
    // 落点候选按根分组：每个活根先根目录、再它的各子文件夹（多根时标签带根名消歧）。
    const multi = liveRootCount() > 1;
    const targets = []; // { rootId, dir, label }
    for (const st of rootsState) {
      if (st.missing || !st.tree) continue;
      targets.push({ rootId: st.id, dir: '', label: window.wsT('sidebar.rootDirLabel', { name: st.name }) });
      (function walk(nodes) {
        for (const n of nodes) {
          if (n.isDir) {
            targets.push({ rootId: st.id, dir: n.rel, label: multi ? st.name + ' / ' + n.rel : n.rel });
            walk(n.children || []);
          }
        }
      })(st.tree);
    }
    let selected = targets[0] || null;
    const overlay = document.createElement('div');
    overlay.className = 'sb-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'sb-modal sb-modal-save';
    // 文件名可编辑（Colin：保存时让用户改名，别用模板名）。后缀 .html 固定显示、不进输入框。
    const nameRow = document.createElement('div');
    nameRow.className = 'sb-save-namerow';
    const nameInput = document.createElement('input');
    nameInput.className = 'sb-save-name';
    nameInput.type = 'text';
    nameInput.value = t.base;
    nameInput.placeholder = window.wsT('sidebar.fileName');
    nameInput.setAttribute('aria-label', window.wsT('sidebar.fileName'));
    const ext = document.createElement('span');
    ext.className = 'sb-save-ext';
    ext.textContent = '.html';
    nameRow.append(nameInput, ext);
    const list = document.createElement('div');
    list.className = 'sb-save-list';
    const rows = [];
    targets.forEach((tg) => {
      const row = document.createElement('button');
      row.className = 'sb-save-row' + (tg === selected ? ' is-on' : '');
      const ico = document.createElement('span'); ico.className = 'sb-ico'; ico.innerHTML = tg.dir ? SVG.folder : HDD_SVG;
      const label = document.createElement('span'); label.className = 'sb-name ws-truncate';
      label.textContent = tg.label;
      row.append(ico, label);
      row.onclick = () => { selected = tg; rows.forEach((r, i) => r.classList.toggle('is-on', targets[i] === selected)); };
      rows.push(row);
      list.appendChild(row);
    });
    const foot = document.createElement('div');
    foot.className = 'sb-modal-foot';
    const pickedName = () => (nameInput.value.trim() || t.base);
    const browse = document.createElement('button'); browse.className = 'sb-btn'; browse.textContent = window.wsT('sidebar.browse');
    browse.title = window.wsT('sidebar.browseTitle');
    browse.onclick = async () => {
      const cur = window.__shellActiveTemp && window.__shellActiveTemp(); // 存的一刻再取最新内容
      // 修 SH-5：防御——活跃临时文档若已不是打开这个 SaveModal 时的那个（加速器穿透切走），别静默存错/存空
      if (!cur || cur.id !== t.id) { close(); showToast(window.wsT('sidebar.docSwitched')); return; }
      let r;
      try { r = await window.ws2.wsSaveDocAs(pickedName(), cur.html); }
      catch (e) { showToast(window.wsT('sidebar.saveFailed', { err: (e && e.message) || e })); return; }
      if (!r || r.canceled) return; // 原生框取消 → 留在弹窗里
      close();
      await adoptSavedTemp(cur.id, r.abs, closeAfter);
    };
    const cancel = document.createElement('button'); cancel.className = 'sb-btn'; cancel.textContent = window.wsT('common.cancel'); cancel.onclick = close;
    const spacer = document.createElement('span'); spacer.className = 'sb-modal-spacer';
    const ok = document.createElement('button'); ok.className = 'sb-btn sb-btn-primary'; ok.textContent = window.wsT('sidebar.saveHere');
    ok.onclick = async () => {
      if (!selected) { browse.onclick(); return; } // 一个根都没有（全失联/全移除）→ 只能走「浏览…」
      close();
      const cur = window.__shellActiveTemp && window.__shellActiveTemp(); // 存的一刻再取一次最新内容
      if (!cur || cur.id !== t.id) { showToast(window.wsT('sidebar.docSwitched')); return; } // 修 SH-5：防御，同 browse
      await doSaveTemp(cur.id, pickedName(), cur.html, selected.rootId, selected.dir, closeAfter);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter') { e.preventDefault(); ok.onclick(); }
    };
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    foot.append(browse, spacer, cancel, ok);
    const body = modalBody();
    body.append(nameRow, list);
    modal.append(
      modalHead(window.wsT('sidebar.saveModalTitle'), window.wsT('sidebar.saveModalSub', { name: t.base }), close),
      body, foot,
    );
    overlay.appendChild(modal);
    wireOverlayClose(overlay, close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    nameInput.focus();
    nameInput.select();
  }

  // 把临时文档落盘（wsNewDoc）→ 去临时标签、建真 rel 标签、编辑器就地指向真文件（不重载）。closeAfter=存完即关。
  async function doSaveTemp(tempId, base, html, rootId, dir, closeAfter) {
    let r;
    try { r = await window.ws2.wsNewDoc(rootId, dir || '', base, html); }
    catch (e) { showToast(window.wsT('sidebar.saveFailed', { err: (e && e.message) || e })); return; }
    if (!r || !r.abs) { showToast(window.wsT('sidebar.saveFailedShort')); return; }
    await adoptSavedTemp(tempId, r.abs, closeAfter, rootId);
  }
  // 落盘后的收编（根内/外通用）：去临时标签 → 建真标签（根内 rootId:rel 身份 / 根外 abs 外部标签）→
  // 编辑器就地指向真文件 → 成功 toast（对齐 ui-demo 保存正反馈）。
  async function adoptSavedTemp(tempId, abs, closeAfter, rootId) {
    await refresh(rootId); // 树里出现新文件（rootId 未知=「浏览…」存的，全刷；根外保存树不变，无妨）
    const node = findNodeByAbs(abs);
    const leaf = abs.split('/').pop();
    applyTabs(window.WS2Tabs.removeEntry(tabState, tempId)); // 去掉临时标签
    if (node) openTabEntry({ rootId: node.rootId, rel: node.rel, kind: node.kind || 'html', title: node.name }); // 根内：真 rel 标签
    else openTabEntry({ abs, kind: 'html', title: leaf }); // 根外：abs 身份外部标签（↗），沿用外部文件标签模型
    if (window.__shellFinalizeTemp) await window.__shellFinalizeTemp(tempId, abs, node ? node.name : leaf);
    if (node) { expandToFile(node.rootId, node.rel); highlightActive(abs); }
    const nodeRoot = node ? rootOf(node.rootId) : null;
    const place = node
      ? (nodeRoot ? nodeRoot.name : window.wsT('sidebar.workspace')) + (node.rel.indexOf('/') >= 0 ? ' / ' + node.rel.split('/').slice(0, -1).join('/') : '')
      : abs.split('/').slice(0, -1).join('/');
    showToast(window.wsT('sidebar.savedTo', { place }));
    if (closeAfter) closeTabRel(node ? colKey(node.rootId, node.rel) : abs); // 「保存并关闭」
  }

  function closeTabRel(key) { closeOrRemove(key, window.WS2Tabs.closeEntry); } // 标签页区 ×
  function removeTabRel(key) { closeOrRemove(key, window.WS2Tabs.removeEntry); } // 置顶区 ×：整条移出置顶
  function dropTabRel(key, toPinned, toIndex) {
    applyTabs(window.WS2Tabs.dropEntry(tabState, key, toPinned, toIndex));
  }
  // 删文件(或目录下所有文件) → 移除其标签；改名/移动 → 标签 rel 跟随。限定在 node 的根内——别的根里
  // 同 rel 是不同文件。外部标签(无 rel)天然不被波及，但前缀匹配里 e.rel 可能是 undefined，必须加
  // e.rel && 守卫，否则 undefined.indexOf 抛错整个回调崩。
  function removeTabsUnder(node) {
    const under = (rel) => rel === node.rel || rel.indexOf(node.rel + '/') === 0;
    const targets = node.isDir
      ? tabState.entries.filter((e) => e.rel && e.rootId === node.rootId && under(e.rel)).map((e) => keyOf(e))
      : [colKey(node.rootId, node.rel)];
    for (const key of targets) tabState = window.WS2Tabs.removeEntry(tabState, key);
    persistTabs();
  }
  function retargetTabsUnder(rootId, oldRel, newRel, isDir) {
    if (!isDir) {
      tabState = window.WS2Tabs.retargetEntry(tabState, rootId, oldRel, newRel, newRel.split('/').pop());
    } else {
      const affected = tabState.entries
        .filter((e) => e.rel && e.rootId === rootId && (e.rel === oldRel || e.rel.indexOf(oldRel + '/') === 0))
        .map((e) => e.rel);
      for (const rel of affected) {
        const nr = newRel + rel.slice(oldRel.length);
        tabState = window.WS2Tabs.retargetEntry(tabState, rootId, rel, nr, nr.split('/').pop());
      }
    }
    persistTabs();
  }

  // 启动拉标签（全局单一集合）：清掉已不存在的文件、回落激活、恢复上次激活进编辑器。
  // 存在性校验分流：活根的内部 entry 看该根文件树里有没有；失联根的 entry 不校验、原样保留（磁盘不可达
  // 没法验，重新定位后由 validateRootEntries 校验）；外部 entry(无 rel) 问主进程 fs.stat 文件还在不在
  // （不在 = 静默丢，符合拍板①）。await 期间根集合可能变（快速手快移除）→ 用代数守卫放弃过期结果。
  let rootsGen = 0; // 根集合代数：加根/移除/吸收都会 ++（onTreeChanged 树内容变不算）
  async function loadTabs() {
    const genBefore = rootsGen;
    let st;
    try { st = await window.ws2.wsGetTabs(); } catch (e) { st = { entries: [], activeRel: null }; }
    if (rootsGen !== genBefore) return loadTabs(); // 作废后按新根集合重跑（集合稳定即终止），别让标签永不恢复
    const raw = st.entries || [];
    const checks = await Promise.all(raw.map((e) => {
      // web 标签：不查 fs（'web:…' 不是路径）,校验 url 形状即可（null=起始页 / http(s)）。
      if (window.WS2Tabs.isWebKey(keyOf(e))) return Promise.resolve(e.url == null || /^https?:\/\//i.test(e.url));
      if (e.rel) {
        const root = rootOf(e.rootId);
        if (!root) return Promise.resolve(false); // 根都不在了（store 与注册表漂移）→ 丢
        if (root.missing || root.lazy) return Promise.resolve(true); // 失联/lazy 根：保留标签（lazy 只加载了部分层，findNode 校验会误杀未加载层的文件，同失联根别丢）
        return Promise.resolve(!!findNode(e.rootId, e.rel));
      }
      return window.ws2.pathExists(e.abs).catch(() => false);
    }));
    if (rootsGen !== genBefore) return loadTabs();
    const entries = raw.filter((_e, i) => checks[i]);
    const activeRel = window.WS2Tabs.resolveActive(entries, st.activeRel);
    const changed = entries.length !== raw.length || activeRel !== st.activeRel;
    tabState = { entries, activeRel };
    if (changed) persistTabs();
    renderZones();
    renderRail();
    // 有冷启动 open-file 在路上（用户刚双击的文件该占 viewer）→ 别把上次激活的标签开进 viewer 抢走它；
    // 标签状态仍恢复，只是不自动载入。onOpen 随后会把冷启动文件设为激活。
    // 失联根的激活项也不自动载入（文件不可达，openTabRow 会空转）。
    if (activeRel && !window.__pendingColdOpen) {
      const e = tabState.entries.find((x) => keyOf(x) === activeRel);
      const eRoot = e && e.rel ? rootOf(e.rootId) : null;
      if (e && !(eRoot && (eRoot.missing || eRoot.lazy))) openTabRow(e); // 内部走 findNode→openNode、外部走 abs 分发（失联/lazy 根的激活项不自动载入——lazy 树只有部分层，findNode 可能空转）
    }
    // 启动自愈（放在激活恢复之后，不改上面的自动载入语义）：存量持久化的外部标签若其实落在某个根里
    // （修复前版本会留下这种状态），收编成 rel 身份——不然激活它的 onOpen 会按树解析再建一条内部标签，
    // 同一文件翻出两条（实测复现）。启动序保证此刻树已读完（loadTabs 本就排在读树之后）。
    mergeExternalDupes();
  }

  // ---- 渲染两区 ----
  // 点标签开它：内部文件走树节点 openNode；外部文件(无 rel)按 kind 分发 abs（跟「打开」按钮一条路，
  // shell.js 的 openDoc/showViewer 已支持纯 abs）。
  // 把文件树展开到 (rootId, rel) 指向的文件（展开根节 + 逐级删父文件夹 collapsed）。scroll=true 时再滚动定位。
  // scroll 拆出来：点标签要「展开+高亮但不滚动视口」（Colin 2026-07-14），滚动才是刺眼的「往下跳」本体。
  function expandToFile(rootId, rel, scroll = true) {
    let changed = false;
    if (rootClosed.has(rootId)) { rootClosed.delete(rootId); changed = true; } // 根节整个收着也要先展开
    const parts = rel.split('/'); parts.pop(); // 去掉文件名，只留父文件夹链
    let acc = '';
    for (const p of parts) {
      acc = acc ? acc + '/' + p : p;
      const key = colKey(rootId, acc);
      if (collapsed.has(key)) { collapsed.delete(key); changed = true; }
    }
    if (changed) renderRoot(rootId); // 只重建该文件所在的根（性能）
    if (!scroll) return; // 点标签：只展开+高亮，不 scrollIntoView（不把上方标签区顶走）
    const row = [...document.querySelectorAll('.sb-file')].find((el) => el.dataset.rel === rel && el.dataset.root === rootId);
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }
  // reveal 三态（口径 2026-07-14）：
  //  • true（默认）：展开到该文件 + 滚动定位——程序化重激活（drag-rebase / 冷启动恢复 / 外部删除回落）用。
  //  • 'expand'：展开到该文件 + 高亮，但**不滚动视口**——**点标签**用（Colin：折叠着也要展开露出来，
  //    只是别把视口往下跳；scrollIntoView 才是刺眼的「往下跳」本体）。原 UX4/F6-①（Wendi 2026-07-03）是
  //    「展开+滚动」，2026-07-14 Wendi 报滚动刺眼 → 拆成「展开保留、滚动去掉」。
  //  • false：只切编辑器 + 高亮，连展开都不做——关标签回落（Colin 2026-07-09）/ Ctrl+Tab 循环用。
  // ⚠ 树定位有两条路：①这里自己 expandToFile——覆盖「点的正是已载入文档的标签」时 openDoc 短路、onOpen
  // 不触发的情形；②openNode→openDoc→onOpen 里那次 expandToFile——覆盖真重载的情形。reveal 三态经
  // suppressRevealOnce / suppressScrollOnce 两个一次性开关让 onOpen 那条路跟这条保持一致（幂等、无害）。
  function openTabRow(entry, reveal = true) {
    if (isTempEntry(entry)) { // 临时文档：内容在 shell 的 tempStore，让它重渲染（切标签不丢）
      if (window.__shellReopenTemp) window.__shellReopenTemp(keyOf(entry)); // renderTemp 内部摘 web view（canLeaveActive 取消则不摘,网页态保留,P2-1）
      return;
    }
    // 网页标签（浏览器 feature）：激活 = openEntry（置顶纯快捷方式顺带变开）+ 交给 browser.js 的激活漏斗。
    // 活跃临时文档先 stash（切走不丢；文档不关闭,iframe 留在 view 底下,切回即恢复）。
    if (window.WS2Tabs.isWebEntry(entry)) {
      if (window.__shellIsTemp && window.__shellIsTemp() && window.__shellStashActiveTemp) window.__shellStashActiveTemp();
      tabState = window.WS2Tabs.openEntry(tabState, entry);
      persistTabs();
      renderZones();
      const cur = tabState.entries.find((x) => keyOf(x) === keyOf(entry));
      if (window.__webActivate) window.__webActivate(cur || entry);
      return;
    }
    // web view 的摘除交给下游 openNode→openDoc/showViewer（它们在各自脏守卫**通过后**才摘,P2-1）——
    // 这里不提前摘,否则失联根/findNode-miss 提前 return 时 view 已摘、activeRel 仍是 web = 状态劈开。
    if (entry.rel) {
      const root = rootOf(entry.rootId);
      if (root && root.missing) { showToast(window.wsT('sidebar.rootMissingOpen', { name: root.name })); return; }
      const n = findNode(entry.rootId, entry.rel);
      if (n) {
        // onOpen 那条路（真重载）的一次性开关：false → 整个不定位；'expand' → 定位但不滚。
        if (reveal === false) suppressRevealOnce = true;
        else if (reveal === 'expand') suppressScrollOnce = true;
        openNode(n);
        // 已载入文档点标签时 openDoc 短路、onOpen 不触发，靠这句定位（点标签走 'expand' = 展开不滚）。
        if (reveal === true) expandToFile(entry.rootId, entry.rel);
        else if (reveal === 'expand') expandToFile(entry.rootId, entry.rel, false);
      }
      return;
    }
    if (entry.kind === 'html' || entry.kind === 'md') openDoc(entry.abs); // 外部标签的可编辑文档（含 md）
    else if (window.__shellShowViewer) window.__shellShowViewer({ abs: entry.abs, rel: null, kind: entry.kind, name: entry.title });
  }
  // p3-06：同名跨根消歧。工作区内标签统一给 title=「根名 / rel」；仅当渲染中的标签（open||pinned）里出现
  // 「同名不同根」冲突时，冲突各方名字后加淡色「— 根名」后缀（无冲突不加，别把所有标签搞长）。
  const rootNameOf = (rootId) => { const st = rootOf(rootId); return st ? st.name : ''; };
  function sameNameConflict(entry) {
    if (!entry.rel || !entry.rootId) return false; // 只管工作区内标签（外部/网页/临时不算）
    const base = entry.rel.split('/').pop();
    return tabState.entries.some((e) => e.rel && e.rootId && (e.open || e.pinned)
      && e.rootId !== entry.rootId && e.rel.split('/').pop() === base);
  }
  function tabRow(entry, zone) {
    const key = keyOf(entry);
    const temp = isTempEntry(entry);
    const web = window.WS2Tabs.isWebEntry(entry);
    const external = isExternal(entry) && !temp && !web; // 临时文档/网页标签不算「工作区外」，不显示 ↗ 标记
    const missing = !!(entry.rel && rootOf(entry.rootId) && rootOf(entry.rootId).missing); // 所在根失联 → 灰态
    const row = document.createElement('div');
    row.className = 'sb-row sb-tab sb-kind-' + (entry.kind || 'other') + (external ? ' sb-tab-ext' : '') + (temp ? ' sb-tab-temp' : '') + (web ? ' sb-tab-web' : '') + (missing ? ' sb-tab-missing' : '');
    row.dataset.rel = entry.rel || entry.abs; // 属性名沿用 data-rel（e2e 选择器靠它）：内部=rel、外部=abs（根限定看 data-root）
    row.dataset.root = entry.rootId || '';
    row.dataset.key = key; // 完整身份键（rootId:rel || abs），拖拽/调试用
    row.setAttribute('role', 'button');
    row.draggable = true;
    if (external) row.title = entry.abs; // 外部标签悬停显完整绝对路径
    if (key === tabState.activeRel) row.classList.add('is-active');
    const ico = document.createElement('span');
    ico.className = 'sb-ico';
    if (web) {
      // 网页标签：favicon 优先（主进程拉好推来的 data:URL），取不到回落通用地球
      const st = window.__webStatus ? window.__webStatus(key) : null;
      if (st && st.loading) row.classList.add('is-loading'); // U3：加载中 → spinner 顶掉 favicon/地球（renderZones 重建时也保持）
      if (st && st.favicon) {
        const img = document.createElement('img');
        img.className = 'sb-tab-fav';
        img.src = st.favicon;
        img.onerror = () => { ico.innerHTML = kindSvg('web'); };
        ico.append(img);
      } else ico.innerHTML = kindSvg('web');
    } else ico.innerHTML = kindSvg(entry.kind); // T8：标签也按类型换形状（跟树一套）
    const name = document.createElement('span');
    name.className = 'sb-name ws-truncate';
    name.textContent = entry.title;
    // 网页悬停显 URL；外部显绝对路径；工作区内标签显「根名 / rel」（p3-06：普适有益，一眼看清是哪个根的哪个文件）
    name.title = web && entry.url ? entry.url : external ? entry.abs : (entry.rel && entry.rootId ? rootNameOf(entry.rootId) + ' / ' + entry.rel : entry.title);
    // p3-06：同名不同根冲突时，名字尾部补淡色「— 根名」后缀消歧（VS Code 收敛；置顶区同款，因 tabRow 两区共用）
    if (sameNameConflict(entry)) {
      const suffix = document.createElement('span');
      suffix.className = 'sb-tab-rootsuffix';
      suffix.textContent = ' — ' + rootNameOf(entry.rootId);
      name.append(suffix);
    }
    row.append(ico, name);
    if (external) {
      const ext = document.createElement('span');
      ext.className = 'sb-tab-ext-ico';
      ext.title = window.wsT('sidebar.externalFile');
      ext.innerHTML = EXT_ICO_SVG;
      row.append(ext);
    }
    // 未保存点（对齐 ui-demo arc-tab-dot：行尾 7px accent 圆点，hover 让位给按钮）：
    // 临时文档常显；活跃的脏真文件也显（自动保存的 1.2s 间隙 / 保存失败时有提示）——shell 脏态变化经
    // __sbHooks.onDirtyChange 同步开关，非活跃真文件切走前必经保存守卫、无脏态。
    const dot = document.createElement('span');
    dot.className = 'sb-tab-dot';
    dot.title = temp ? window.wsT('sidebar.unsavedDotTemp') : window.wsT('sidebar.unsavedDot');
    // web 标签没有脏态（shell 的 dirty 属于底下的后台文档,不挂到网页标签上）
    if (web || (!temp && !(key === tabState.activeRel && window.__shellIsDirty && window.__shellIsDirty()))) dot.hidden = true;
    row.append(dot);
    if (!temp) { // 临时文档不能置顶（置顶持久化、临时文档重启即弃）
      const pin = document.createElement('button');
      pin.className = 'sb-tab-pin' + (entry.pinned ? ' is-pinned' : '');
      pin.title = entry.pinned ? window.wsT('sidebar.unpin') : window.wsT('sidebar.pin');
      pin.innerHTML = entry.pinned ? PIN_OFF_SVG : PIN_SVG;
      pin.onclick = (e) => {
        e.stopPropagation();
        if (entry.pinned) unpinRel(key);
        else pinRel(entry);
      };
      row.append(pin);
    }
    // × 关闭：两个区都有。标签页区 = 关标签；置顶区 = 直接移出置顶（Wendi 要的，整条删掉、不只取消钉）。
    const x = document.createElement('button');
    x.className = 'sb-tab-close';
    x.title = zone === 'pinned' ? window.wsT('sidebar.removePin') : kbd(window.wsT('sidebar.closeTab'));
    x.innerHTML = X_SVG;
    x.onclick = (e) => {
      e.stopPropagation();
      (zone === 'pinned' ? removeTabRel : closeTabRel)(key);
      if (zone !== 'pinned') coachOnce('close-tab', window.wsT('sidebar.coachCloseTab', { key: kbd('⌘W') }));
    };
    row.append(x);
    row.onclick = () => openTabRow(entry, 'expand'); // 点标签：展开到该文件+高亮，但不滚动视口（Colin 2026-07-14 定）
    row.ondragstart = (e) => {
      dragTabRel = key;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
    };
    row.ondragend = () => {
      dragTabRel = null;
    };
    return row;
  }
  function dropIndex(list, y) {
    const rows = Array.prototype.slice.call(list.querySelectorAll('.sb-tab'));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return rows.length;
  }
  function zoneList(zone) {
    const list = document.createElement('div');
    list.className = 'sb-zone-list';
    list.dataset.zone = zone;
    const clearDropMarks = () => list.querySelectorAll('.sb-drop-before, .sb-drop-after').forEach((r) => r.classList.remove('sb-drop-before', 'sb-drop-after'));
    list.ondragover = (e) => {
      if (!dragTabRel) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.classList.add('sb-drop');
      // 精确插入线（对齐 ui-demo drop-before/after）：按光标 Y 对行中点，在目标行上/下缘画 2px accent 线
      clearDropMarks();
      const rows = Array.prototype.slice.call(list.querySelectorAll('.sb-tab'));
      if (rows.length) {
        const idx = dropIndex(list, e.clientY);
        if (idx < rows.length) rows[idx].classList.add('sb-drop-before');
        else rows[rows.length - 1].classList.add('sb-drop-after');
      }
    };
    list.ondragleave = (e) => {
      if (!list.contains(e.relatedTarget)) { list.classList.remove('sb-drop'); clearDropMarks(); }
    };
    list.ondrop = (e) => {
      if (!dragTabRel) return;
      // 修 SB-8：临时文档不能拖进置顶区——置顶是持久快捷入口，temp 重启即弃，拖进去得到一个「带常显未保存点、
      // 重启就失踪」的假置顶（tabRow 对 temp 本就不渲染 pin 钮，拖拽是绕过它的漏网路径）。
      if (zone === 'pinned' && isTempKey(dragTabRel)) { list.classList.remove('sb-drop'); clearDropMarks(); return; }
      e.preventDefault();
      e.stopPropagation();
      list.classList.remove('sb-drop');
      clearDropMarks();
      dropTabRel(dragTabRel, zone === 'pinned', dropIndex(list, e.clientY));
    };
    return list;
  }
  // key 给了 → 栏标可折叠（caret 右置 + 计数，抄收藏区 §4.3；点栏标翻转 localStorage 键、重渲）。
  // 默认展开（键值 '0' = 收起，缺省视为展开）；与收藏「默认收起」相反是拍板（置顶/标签页是主导航，别一装就藏）。
  function zoneHeader(text, key, count, onPlus, plusTitle) {
    const head = document.createElement('div');
    head.className = 'sb-zone-head';
    if (key) { head.setAttribute('role', 'button'); head.tabIndex = 0; }
    const label = document.createElement('span');
    label.className = 'sb-sec-label';
    label.textContent = text;
    head.appendChild(label);
    if (key) {
      const cnt = document.createElement('span');
      cnt.className = 'sb-zone-count';
      cnt.textContent = count ? String(count) : '';
      head.appendChild(cnt);
    }
    if (onPlus) {
      const plus = document.createElement('button');
      plus.className = 'sb-zone-add';
      plus.title = plusTitle || window.wsT('sidebar.newDoc');
      plus.innerHTML = PLUS_SVG;
      plus.onclick = (e) => { e.stopPropagation(); onPlus(); }; // 别冒泡触发栏标折叠
      head.appendChild(plus);
    }
    if (key) {
      const caret = document.createElement('span');
      caret.className = 'sb-zone-caret';
      caret.innerHTML = SVG.chevron;
      head.appendChild(caret);
      const toggle = () => {
        const open = localStorage.getItem(key) !== '0'; // 默认展开
        localStorage.setItem(key, open ? '0' : '1');
        renderZones(); // 全重建栏标 → 焦点会丢；把焦点还给重建后的新栏标（键盘用户连续折/展）
        const zoneEl = document.getElementById(key === 'ws-pinned-open' ? 'sb-pinned' : 'sb-tabs');
        const nh = zoneEl && zoneEl.querySelector('.sb-zone-head');
        if (nh) nh.focus();
      };
      head.onclick = toggle;
      // 只在栏标自身获焦时才折叠——别拦截冒泡上来的 + 按钮键盘激活（否则键盘用户按 + 会折叠分区而非新建，审查 P3）。
      head.onkeydown = (e) => { if (e.target === head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } };
    }
    return head;
  }
  function zoneHint(text, cls) {
    const d = document.createElement('div');
    d.className = 'sb-zone-hint' + (cls ? ' ' + cls : '');
    d.textContent = text;
    return d;
  }
  // 置顶 + 标签页两区恒显示（像浏览器标签栏区域常在，Wendi 反馈）：即使 0 置顶 0 标签也留着段标 + 空占位
  // 提示，空区仍是合法 drop 目标。注意要显式置 hidden=false——index.html 上两个 .sb-zone 带初始 hidden 属性，
  // 不主动清掉就算 append 了内容也看不见（renderZones 只在开工作区后跑，没工作区时侧栏整个 display:none）。
  function renderZones() {
    if (!pinnedEl || !tabsEl) return;
    const pinned = window.WS2Tabs.pinnedEntries(tabState.entries);
    const tabs = window.WS2Tabs.tabEntries(tabState.entries);
    // 折叠态每次从 localStorage 现读（renderZones 全重建，内存变量会随重渲丢失）。默认展开。
    const pinnedOpen = localStorage.getItem('ws-pinned-open') !== '0';
    const tabsOpen = localStorage.getItem('ws-tabs-open') !== '0';

    pinnedEl.innerHTML = '';
    pinnedEl.hidden = false;
    pinnedEl.classList.toggle('is-open', pinnedOpen);
    pinnedEl.appendChild(zoneHeader(window.wsT('sidebar.pinnedZone'), 'ws-pinned-open', pinned.length, null));
    if (pinnedOpen) {
      const plist = zoneList('pinned');
      if (pinned.length) for (const e of pinned) plist.appendChild(tabRow(e, 'pinned'));
      else plist.appendChild(zoneHint(window.wsT('sidebar.pinnedEmptyHint'), 'sb-zone-hint-drop')); // 虚线框空态（对齐 ui-demo arc-tabs-empty：看得出是可拖入目标）
      pinnedEl.appendChild(plist);
    }

    tabsEl.innerHTML = '';
    tabsEl.hidden = false;
    tabsEl.classList.toggle('is-open', tabsOpen);
    tabsEl.appendChild(zoneHeader(window.wsT('sidebar.tabsZone'), 'ws-tabs-open', tabs.length, () => {
      openCreateModal(null, '', { temp: true });
      coachOnce('new-tab', window.wsT('sidebar.coachNewTab', { key: kbd('⌘T') }));
    }, kbd(window.wsT('sidebar.newTabTitle'))));
    if (tabsOpen) {
      const tlist = zoneList('tabs');
      if (tabs.length) for (const e of tabs) tlist.appendChild(tabRow(e, 'tabs'));
      else tlist.appendChild(zoneHint(window.wsT('sidebar.tabsEmptyHint')));
      tabsEl.appendChild(tlist);
    }
    // 浏览器 feature：无工作区也能开网页标签——第一个 web 标签要能点亮侧栏（syncChrome 只在根变化时跑）。
    const sbEl = document.getElementById('sidebar');
    if (sbEl) sbEl.classList.toggle('sb-on', rootsState.length > 0 || tabState.entries.length > 0);
    if (window.__webChromeSync) window.__webChromeSync(); // 激活/标签变化 → 同步地址栏值/导航条 disabled/星标
  }

  // ---- 筛选输入（+ 清除钮，T8 对齐 ui-demo arc-filter-clear）----
  const filterClear = document.getElementById('sb-filter-clear');
  const syncFilterClear = () => { if (filterClear) filterClear.hidden = !query; };
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      query = filterInput.value;
      syncFilterClear();
      render();
    });
  }
  if (filterClear) filterClear.onclick = () => { query = ''; if (filterInput) { filterInput.value = ''; filterInput.focus(); } syncFilterClear(); render(); };
  if (openFolderBtn) openFolderBtn.onclick = pickFolder;
  if (emptyOpenBtn) emptyOpenBtn.onclick = pickFolder;
  const findBtn = document.getElementById('sb-find');
  if (findBtn) findBtn.onclick = () => openFindPalette(); // T7：查找的可见入口（openFindPalette 自守「无工作区不开」）
  const aiBtn = document.getElementById('sb-ai');
  if (aiBtn) aiBtn.onclick = () => { if (window.__shellOpenAiAccess) window.__shellOpenAiAccess(); }; // 左下角 AI 接入（同菜单那个弹窗）
  // B9（Wendi）：侧栏头部「新建文档」加号已删（跟标签页加号功能重复）。新建入口 = 标签页区加号 + Cmd+T + 右键文件夹。
  const homeOpenFolder = document.getElementById('home-open-folder'); // 首页空态的「打开文件夹」入口（无工作区时侧栏隐藏）
  if (homeOpenFolder) homeOpenFolder.onclick = pickFolder;

  // 「拖文件到根顶层」的落点改在各根标题行（renderRootSection 里，带同根校验）——多根后侧栏头
  // 不再是唯一根的化身，不能当 drop 目标（不知道该落哪个根）。

  // U3-B6 兜底：任何拖拽结束都清 __wsDragFile（源文件行若在拖拽中被树重渲染销毁，它自己的 ondragend 可能不触发 → 泄漏，
  // 下次正文内原生拖拽会被误当插链接）。document 级捕获一次，与源行 ondragend 双保险。
  document.addEventListener('dragend', () => { window.__wsDragFile = null; }, true);

  // ---- 轻量 toast（删除「撤销」用）。CSP 安全：classes，无 inline style。----
  // p2-2：栈式堆叠。每条 toast 是独立 DOM + 独立超时 + 独立撤销闭包——连删多个时上一条不再被顶掉，
  // 各撤各的（删除撤销 token 一删一个，堆叠后天然独立，不用动删除逻辑）。host 是底部锚定的纵向 flex，
  // 新条 append 到底、旧条被顶上去。带撤销的条超时放宽（15s），无撤销的短（6.5s）；超上限先挤掉最旧的
  // 无撤销条（带撤销的保命，别丢用户的撤销机会）。
  const TOAST_CAP = 4;
  // shell.js（先加载、无自己的 toast）复用这个：U0 断链/工作区外等占位提示，及后续互链 toast。
  window.__wsToast = (message, actionLabel, onAction) => showToast(message, actionLabel, onAction);
  function showToast(message, actionLabel, onAction, opts) {
    let host = document.getElementById('sb-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'sb-toast-host';
      host.className = 'sb-toast-host';
      document.body.appendChild(host);
    }
    const hasAction = !!(actionLabel && onAction);
    const hint = !!(opts && opts.hint); // 快捷键教学气泡：灯泡 + accent 色条 + 稍长停留（对齐 ui-demo hint tone）
    const t = document.createElement('div');
    t.className = hint ? 'sb-toast sb-toast-hint' : 'sb-toast';
    if (hasAction) t.dataset.action = '1';
    if (hint) {
      const bulb = document.createElement('span');
      bulb.className = 'sb-toast-bulb';
      bulb.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.1 14a5 5 0 1 0-6.2 0c.5.4.9 1 .9 1.7V17h4.4v-1.3c0-.7.4-1.3.9-1.7z"/></svg>';
      t.appendChild(bulb);
    }
    const msg = document.createElement('span');
    msg.textContent = message;
    t.appendChild(msg);
    let timer = null;
    const dismiss = () => { clearTimeout(timer); if (t.parentNode) t.remove(); };
    if (hasAction) {
      const btn = document.createElement('button');
      btn.className = 'sb-toast-action';
      btn.textContent = actionLabel;
      btn.onclick = () => { dismiss(); onAction(); };
      t.appendChild(btn);
    }
    host.appendChild(t);
    // 超上限：只挤「最旧的无撤销信息条」,且**绝不挤掉刚建的这条 t**、也**绝不挤撤销条**。
    // 撤销条保命（各自 15s 自行过期，别丢用户的撤销机会）；4 条撤销条占满时新来的错误/保存提示更不能被
    // 自己的清理逻辑当场吞掉（对抗审查 P2：那样失败的删除/保存会「视觉报成功、错误消失」，连删第 5 个也
    // 不该把最旧撤销条挤走=撤销机会丢失）。没有可挤的旧信息条（全是撤销条 / 只剩 t）→ 让它们暂时超限、
    // 各自超时收，不强挤。
    while (host.children.length > TOAST_CAP) {
      const victim = [...host.children].find((c) => c !== t && c.dataset.action !== '1');
      if (!victim) break;
      victim.remove();
    }
    timer = setTimeout(dismiss, hasAction ? 15000 : hint ? 4200 : 6500);
    return t;
  }

  // ---- 快捷键教学气泡（Wendi 2026-07-16，对齐 ui-demo src/mock/coach.ts）----
  // 用户**用鼠标**做了有快捷键的操作 → 弹一次「下次可以用 ⌘X」，每个操作一辈子只弹一次
  // （localStorage 记住）。键盘/程序化触发不弹（调用方用 e.isTrusted 过滤——如 ⌘R 菜单路径
  // 走 navReload.click()，isTrusted=false，不该弹）。
  const COACH_KEY = 'ws-coached-ops';
  function coachOnce(op, message) {
    let seen;
    try { seen = new Set(JSON.parse(localStorage.getItem(COACH_KEY) || '[]')); } catch { seen = new Set(); }
    if (seen.has(op)) return;
    seen.add(op);
    localStorage.setItem(COACH_KEY, JSON.stringify([...seen]));
    showToast(message, null, null, { hint: true });
  }
  window.__wsCoach = coachOnce; // browser.js（nav-reload）也要用
  // 平台化快捷键字形：mac 用 ⌘/⇧ 字形，其他平台展开成 Ctrl+/Shift+。（function 形式=提升，行渲染早于本行执行也安全）
  function kbd(combo) { return (navigator.platform || '').includes('Mac') ? combo : combo.replace('⌘', 'Ctrl+').replace('⇧', 'Shift+'); }
  window.__wsKbd = kbd;
  // index.html 静态 title 是 mac 字形（⌘…），非 mac 启动时归一成 Ctrl+…（动态 title 由各创建处用 kbd() 直接生成）。
  if (!(navigator.platform || '').includes('Mac')) {
    document.querySelectorAll('[title*="⌘"]').forEach((el) => { el.title = el.title.replace('⌘', 'Ctrl+').replace('⇧', 'Shift+'); });
  }

  // ---- 新建文档：模板选择台（空文档第一 + 内置模板，无 AI）。----
  // opts.temp：从「标签页 +」/ Cmd+T 来 → 建临时文档（不落盘，手动保存才进文件夹）；
  // 否则（文件夹 hover-+ / 右键新建）落点 dirRel、直接落盘。
  async function openCreateModal(rootId, dirRel, opts) {
    if (document.querySelector('.sb-modal-overlay')) return; // 修 SH-5：已有弹层（如 SaveModal）时不叠——Cmd+T 加速器穿透会走到这
    const temp = !!(opts && opts.temp);
    const targetRoot = temp ? null : rootOf(rootId);
    let templates = [];
    try {
      templates = await window.ws2.wsTemplates();
    } catch (e) {
      /* ignore */
    }
    const overlay = document.createElement('div');
    overlay.className = 'sb-modal-overlay';
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    const modal = document.createElement('div');
    modal.className = 'sb-modal';
    const head = modalHead(temp ? window.wsT('sidebar.newTab') : window.wsT('sidebar.newDoc'), temp
      ? window.wsT('sidebar.createTabSub')
      : window.wsT('sidebar.createDocSub', { location: (targetRoot ? targetRoot.name : '') + (dirRel ? ' / ' + dirRel : '') }), close);
    // ⌘T 二合一（spec §4.5.1）：顶部一条地址栏（自动聚焦）——Enter 开新网页标签并导航,关 modal。
    let omniRow = null;
    if (temp) {
      omniRow = document.createElement('div');
      omniRow.className = 'sb-cm-omni';
      const ico = document.createElement('span');
      ico.className = 'sb-cm-omni-ico';
      ico.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
      const omniIn = document.createElement('input');
      omniIn.className = 'sb-cm-omni-input';
      omniIn.type = 'text';
      omniIn.placeholder = window.wsT('sidebar.omniPlaceholder');
      omniIn.spellcheck = false;
      omniIn.onkeydown = (e) => {
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229) return; // IME 确认键不当提交
        if (e.key === 'Enter') {
          e.preventDefault();
          const v = omniIn.value.trim();
          if (!v) return;
          close();
          if (window.__webOpenInput) window.__webOpenInput(v);
        } else if (e.key === 'Escape') { e.preventDefault(); close(); }
      };
      omniRow.append(ico, omniIn);
      setTimeout(() => omniIn.focus(), 0);
    }
    const grid = document.createElement('div');
    grid.className = 'sb-modal-grid';
    for (const t of templates) {
      const card = document.createElement('button');
      card.className = 'sb-card' + (t.id === 'blank' ? ' sb-card-blank' : '');
      if (t.id !== 'blank' && t.accent) card.style.borderTopColor = t.accent; // 单 CSSOM 属性，CSP 安全
      const name = document.createElement('div');
      name.className = 'sb-card-name';
      name.textContent = t.name;
      const desc = document.createElement('div');
      desc.className = 'sb-card-desc';
      desc.textContent = t.desc || '';
      card.append(name, desc);
      card.onclick = async () => {
        close();
        // 新建文档一律默认名「未命名」（Colin 拍板：模板给内容不给名字，保存/落盘时用户再改名）。
        if (temp) {
          // 临时文档：不落盘，shell 建内容 + 渲染，侧栏建临时标签（身份 = shell 返回的 'temp:…'）。
          // 返回 null = 用户在「切走脏文件」守卫里取消了，不建标签。
          const id = window.__shellNewTemp(window.wsT('common.untitled'), t.html);
          if (id) openTabEntry({ abs: id, kind: 'html', title: window.wsT('common.untitled') });
          return;
        }
        const r = await window.ws2.wsNewDoc(rootId, dirRel || '', window.wsT('common.untitled'), t.html);
        await refreshRoot(rootId);
        if (r && r.abs) openDoc(r.abs);
      };
      grid.appendChild(card);
    }
    const body = modalBody();
    if (omniRow) {
      body.appendChild(omniRow);
      // 「新建文档」小节标 + 范式选择（范式 1 可用；2/3 灰态敬请期待,spec §4.5.1）
      const secRow = document.createElement('div');
      secRow.className = 'sb-cm-sec';
      const secLabel = document.createElement('span');
      secLabel.className = 'sb-cm-sec-label';
      secLabel.textContent = window.wsT('sidebar.newDoc');
      const p1 = document.createElement('span');
      p1.className = 'sb-cm-para is-on';
      p1.textContent = window.wsT('sidebar.paradigm1');
      const p2 = document.createElement('span');
      p2.className = 'sb-cm-para';
      p2.textContent = window.wsT('sidebar.paradigm2');
      p2.title = window.wsT('sidebar.comingSoon');
      const p3 = document.createElement('span');
      p3.className = 'sb-cm-para';
      p3.textContent = window.wsT('sidebar.paradigm3');
      p3.title = window.wsT('sidebar.comingSoon');
      secRow.append(secLabel, p1, p2, p3);
      body.appendChild(secRow);
    }
    body.appendChild(grid);
    modal.append(head, body);
    overlay.appendChild(modal);
    wireOverlayClose(overlay, close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }

  // ---- Cmd+P 命令面板（对齐 ui-demo FindPalette）：顶部锚定浮层，模糊搜文件名/路径，↑↓ 选、Enter 开、Esc 关。----
  const SEARCH_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>';
  function openFindPalette() {
    if (!rootsState.length) return; // 没打开文件夹没得搜
    if (document.getElementById('fp-overlay')) return; // 已开着，别叠一层
    if (document.querySelector('.sb-modal-overlay')) return; // 修 SH-5：SaveModal/关闭确认开着时 Cmd+P 加速器穿透不叠层
    const multi = liveRootCount() > 1;
    const allFiles = []; // 跨全部活根（节点带 rootId；多根时行内路径带根名消歧）
    let skippedLazy = false; // 有 lazy 根被跳过 → 面板底注提示（V3）
    for (const st of rootsState) {
      if (st.missing || !st.tree) continue;
      if (st.lazy) { skippedLazy = true; continue; } // lazy 根只加载了部分层，全量扁平化会漏 + 又触发全量扫 → 跳过，底注提示
      (function walk(nodes) { for (const n of nodes) { if (n.isDir) walk(n.children || []); else allFiles.push(n); } })(st.tree);
    }
    let q = '', sel = 0, hits = [];
    const overlay = document.createElement('div');
    overlay.className = 'sb-modal-overlay fp-overlay';
    overlay.id = 'fp-overlay';
    const onKeyGlobal = (e) => { if (e.key === 'Escape') close(); };
    function close() { overlay.remove(); document.removeEventListener('keydown', onKeyGlobal); }
    const panel = document.createElement('div');
    panel.className = 'fp';
    const bar = document.createElement('div');
    bar.className = 'fp-bar';
    const ico = document.createElement('span'); ico.className = 'fp-bar-ico'; ico.innerHTML = SEARCH_SVG;
    const input = document.createElement('input');
    input.className = 'fp-input'; input.type = 'text'; input.placeholder = window.wsT('sidebar.findPlaceholder'); input.spellcheck = false;
    const hint = document.createElement('span'); hint.className = 'fp-hint'; hint.textContent = window.wsT('sidebar.findHintOpen');
    bar.append(ico, input, hint);
    const list = document.createElement('div');
    list.className = 'fp-list';
    panel.append(bar, list);
    if (skippedLazy) {
      // 底注：简化模式的大文件夹未纳入快速打开（它们只按需加载、没法整根扁平化搜；提示别让用户以为搜漏了，V3）。
      const foot = document.createElement('div');
      foot.className = 'fp-foot';
      foot.id = 'fp-lazy-note';
      foot.textContent = window.wsT('sidebar.lazyQuickOpenNote');
      foot.style.padding = '8px 14px';
      foot.style.fontSize = 'var(--fs-sm)';
      foot.style.color = 'var(--c-text-3)';
      foot.style.borderTop = '1px solid var(--c-divider)';
      panel.append(foot);
    }
    overlay.appendChild(panel);
    overlay.onmousedown = (e) => { if (e.target === overlay) close(); };
    function computeHits() {
      const term = q.trim().toLowerCase();
      const matched = term ? allFiles.filter((n) => n.name.toLowerCase().includes(term) || n.rel.toLowerCase().includes(term)) : allFiles;
      hits = matched.slice(0, 12);
      if (sel >= hits.length) sel = Math.max(0, hits.length - 1);
    }
    function highlight() { [...list.querySelectorAll('.fp-row')].forEach((r, i) => r.classList.toggle('is-sel', i === sel)); }
    function scrollSel() { const r = list.querySelectorAll('.fp-row')[sel]; if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' }); }
    function renderList() {
      list.innerHTML = '';
      if (!hits.length) {
        const empty = document.createElement('div'); empty.className = 'fp-empty'; empty.textContent = window.wsT('sidebar.noMatchingFiles');
        list.appendChild(empty);
        return;
      }
      hits.forEach((n, i) => {
        const row = document.createElement('button');
        row.className = 'fp-row' + (i === sel ? ' is-sel' : '');
        const ic = document.createElement('span'); ic.className = 'fp-row-ico'; ic.innerHTML = kindSvg(n.kind); // T8：命令面板行也按类型换形状
        const nm = document.createElement('span'); nm.className = 'fp-name ws-truncate'; nm.textContent = n.name;
        const sub = document.createElement('span'); sub.className = 'fp-sub ws-truncate';
        const nRoot = multi ? rootOf(n.rootId) : null;
        sub.textContent = nRoot ? nRoot.name + ' / ' + n.rel : n.rel; // 多根时带根名消歧（两根里可能有同名同 rel）
        row.append(ic, nm, sub);
        row.onmouseenter = () => { sel = i; highlight(); };
        row.onclick = () => choose(n);
        list.appendChild(row);
      });
    }
    function choose(node) {
      if (!node) return;
      close();
      openNode(node);                        // .html 进编辑器 / 其余进查看器（同点树节点）
      expandToFile(node.rootId, node.rel);   // 顺带在树里展开定位（F6）
    }
    input.addEventListener('input', () => { q = input.value; sel = 0; computeHits(); renderList(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (sel < hits.length - 1) { sel++; highlight(); scrollSel(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (sel > 0) { sel--; highlight(); scrollSel(); } }
      else if (e.key === 'Enter') { e.preventDefault(); choose(hits[sel]); }
    });
    document.addEventListener('keydown', onKeyGlobal);
    document.body.appendChild(overlay);
    computeHits(); renderList();
    input.focus();
  }

  // ---- 收起/展开侧栏（真收起 = 全隐藏；Cmd+\ / 头部按钮收，编辑区悬浮按钮 / Cmd+\ 展开）----
  const sidebarEl = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sb-toggle');
  const edgeHot = document.getElementById('sb-edge-hot');
  // 沉浸收起（Arc 对标）：常驻浮钮 sb-reopen 已删（拍板「纯 Arc 式」零可见 UI），重开=左缘 hover peek / Cmd+\。
  // spec=docs/features/immersive-collapse.md
  if (window.ws2 && window.ws2.platform === 'darwin') document.body.classList.add('is-mac'); // 红绿灯让位（hiddenInset）

  // 沉浸窗框非全屏恒有（Colin 2026-07-18 扩展 #271）：真全屏（macOS enter-full-screen / F11）时摘框。
  // 主进程 win.on('enter/leave-full-screen') → webContents.send('fullscreen-changed', bool) → preload
  // onFullscreenChanged → 挂/摘 body.is-win-fullscreen（CSS 全部走 body:not(.is-win-fullscreen) 组合表达）。
  // 启动初值查一次（冷启动可能已在全屏，如上次全屏中退出后系统恢复）。这条接线是「全屏无框」的唯一来源，
  // 摘掉它 → 全屏态收不到 → 框不摘（immersive.spec「全屏无框」变异自检据此翻红）。
  function applyWinFullscreen(isFs) { document.body.classList.toggle('is-win-fullscreen', !!isFs); }
  if (window.ws2 && window.ws2.getFullscreen) {
    window.ws2.getFullscreen().then(applyWinFullscreen).catch(() => {});
    if (window.ws2.onFullscreenChanged) window.ws2.onFullscreenChanged(applyWinFullscreen);
  }

  // peek=完整侧栏悬浮盖在内容上，不推挤布局；进 120ms/出 240ms 缓冲防误触发/闪烁。
  // 红绿灯随收起藏、peek/展开时现（hiddenInset 下灯浮在内容上，收起不藏=悬空）。
  // web 态（Wendi 2026-07-17）：滑出前先对页面截帧垫底、摘掉原生 view（__webPeekSnap，照更新弹窗
  // 白背景的快照方案）——页面纹丝不动，替换原「同宽右移让位」的推挤。截图异步（≤250ms），
  // peekPending 是取消旗：截图期间鼠标已离开就不再滑出。
  let peekTimer = 0;
  let peekPending = false;
  const peekOn = () => document.body.classList.contains('is-sb-peek');
  function openPeek() {
    if (!sidebarEl || !sidebarEl.classList.contains('is-collapsed') || peekOn()) return;
    peekPending = true;
    const finish = () => {
      if (!peekPending || peekOn() || !sidebarEl.classList.contains('is-collapsed')) return;
      peekPending = false;
      document.body.classList.add('is-sb-peek');
      if (window.ws2 && window.ws2.setWindowButtons) window.ws2.setWindowButtons(true);
    };
    if (window.__webPeekSnap) window.__webPeekSnap(true, finish);
    else finish();
  }
  function closePeek(immediate) {
    peekPending = false;
    if (window.__webPeekSnap) window.__webPeekSnap(false); // 幂等：挂回 view/撤快照/取消在途截图
    if (!peekOn()) return;
    const done = () => {
      document.body.classList.remove('is-sb-peek', 'is-sb-peek-out');
      if (document.body.classList.contains('is-sb-collapsed') && window.ws2 && window.ws2.setWindowButtons) window.ws2.setWindowButtons(false);
    };
    if (immediate) done();
    else {
      document.body.classList.add('is-sb-peek-out');
      setTimeout(done, 340); // --dur-slow 320ms + 余量
    }
  }
  function peekEnter() { clearTimeout(peekTimer); peekTimer = setTimeout(openPeek, 120); }
  function peekLeave() { clearTimeout(peekTimer); peekTimer = setTimeout(() => closePeek(false), 240); }
  if (edgeHot) { edgeHot.addEventListener('mouseenter', peekEnter); edgeHot.addEventListener('mouseleave', peekLeave); }
  if (sidebarEl) {
    sidebarEl.addEventListener('mouseenter', () => { if (peekOn()) clearTimeout(peekTimer); });
    sidebarEl.addEventListener('mouseleave', () => { if (peekOn()) peekLeave(); });
  }
  // （原「网页 view 前台时主进程指针 watcher 代打」已删：沉浸窗框让 #main 内缩 10px，
  //   左边带永远是 DOM 地盘，#sb-edge-hot 在 web 态也能收到鼠标——触发只此一条。）

  function setSidebarCollapsed(v) {
    if (!sidebarEl) return;
    closePeek(true); // 状态翻转前清 peek 残留（peek 里点 toggle 展开走这里）
    sidebarEl.classList.toggle('is-collapsed', v);
    document.body.classList.toggle('is-sb-collapsed', v);
    if (window.ws2 && window.ws2.setWindowButtons) window.ws2.setWindowButtons(!v);
    // 侧栏宽度变 → 编辑区 iframe 横移 → 编辑器宿主浮层重定位（等下一帧布局落定再调）。
    if (window.__shellReposition) requestAnimationFrame(() => window.__shellReposition());
  }
  function toggleCollapsed() { if (sidebarEl) setSidebarCollapsed(!sidebarEl.classList.contains('is-collapsed')); }
  // 鼠标点按钮 → 顺手教一次快捷键（菜单加速器/keydown 路径直接调 toggleCollapsed，不经这里、不弹）。
  // （#234 原来还给 sb-reopen 浮钮挂 coach——沉浸收起已删该钮，只剩 toggle 这一条。）
  if (toggleBtn) toggleBtn.onclick = () => { toggleCollapsed(); coachOnce('toggle-sidebar', window.wsT('sidebar.coachToggleSidebar', { key: kbd('⌘\\') })); };
  // ⌘\ 切换侧栏的**主**通道是「视图」菜单加速器（sendMenu('toggle-sidebar') → shell onMenu → __sbHooks.toggleSidebar），
  // 它覆盖全部焦点域——含文档编辑 iframe 内的原失灵域（keydown 不冒泡出 iframe，靠 keydown 兜不住，必须走菜单）。
  // 下面这条主层 document keydown 保留作**主层 fallback**：macOS/Electron 真实按键会被原生菜单先吃掉、这条不触发
  // （所以不与菜单双触发）；只有绕过原生菜单的路径（如 e2e 的 CDP page.keyboard.press，或菜单未覆盖到的平台域）才落它。
  // ⚠ web view 焦点的 before-input 转发已删（web-tabs.js）——那条会与菜单**真**双触发（before-input 与菜单加速器是两层，
  // 都吃到=切两次），主层 keydown 不同、无此问题，故留。
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      toggleCollapsed();
    }
  });

  // 侧栏宽度可拖拽（UX5 / Wendi F1）：右边界拖拽柄改 --sb-width（夹 min/max），存 localStorage、重启恢复。
  // 最小 240（Wendi 2026-07-16）：.sb-head 顶排 7 图标（2026-07-18 加下载入口后钮宽收 22/26 凑 237px）+
  // 间距 + padding 需 ≤240px（账在 shell.css .sb-head 处），180 下限会让右端图标溢出被网页/编辑区盖掉
  // 「消失」。旧存值 <240 夹到 240（贴用户原意，不跳回默认宽）。
  const SB_MIN = 240, SB_MAX = 520, SB_KEY = 'ws2-sb-width';
  (function initSidebarResize() {
    if (!sidebarEl) return;
    const saved = parseInt(localStorage.getItem(SB_KEY), 10);
    if (Number.isFinite(saved)) sidebarEl.style.setProperty('--sb-width', Math.max(SB_MIN, Math.min(SB_MAX, saved)) + 'px');
    const handle = document.getElementById('sb-resize');
    if (!handle) return;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = sidebarEl.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      const onMove = (ev) => {
        const w = Math.max(SB_MIN, Math.min(SB_MAX, startW + (ev.clientX - startX)));
        sidebarEl.style.setProperty('--sb-width', w + 'px');
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        localStorage.setItem(SB_KEY, String(Math.round(sidebarEl.getBoundingClientRect().width)));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  })();

  function openTabEntry(entry) {
    tabState = window.WS2Tabs.openEntry(tabState, entry);
    persistTabs();
    renderZones();
    renderRail();
  }
  // abs 不在任何树里（从「打开」按钮选的、macOS /private 软链让 abs 字符串对不上、或刚建还没 refresh）：
  // 主进程把 abs 归一化、跨全部根算归属 (rootId, rel)（kindOf 只在主进程有）。在某根内 → 建 rel 标签；
  // 根外 rel=null → 建 abs 身份的外部标签（像浏览器开标签页）。竞态守卫放 rel 判定之前，对两条分支都生效。
  async function openTabFromAbs(abs) {
    if (!rootsState.length) return; // 单文件模式（没打开任何文件夹）：侧栏藏着，不建看不见的幽灵标签
    let meta = null;
    try { meta = await window.ws2.classifyFile(abs); } catch (e) { return; }
    if (!meta || !rootsState.length) return;
    if (meta.rel && meta.rootId && rootOf(meta.rootId)) { // await 期间该根可能被移除 → 校验还在才建 rel 标签
      openTabEntry({ rootId: meta.rootId, rel: meta.rel, kind: meta.kind || 'other', title: meta.name || meta.rel.split('/').pop() });
    } else {
      openTabEntry({ rel: null, abs, kind: meta.kind || 'other', title: meta.name || baseName(abs) });
    }
  }
  // ===== 子树补丁（大根性能）：watcher 报得出「受影响目录」时不再全量 readTree，只向主进程要那些
  // 目录的新 children（ws-read-subtrees），路径拷贝替换进旧树。路径拷贝 = 沿途节点浅拷贝、其余分支共享，
  // 旧树对象保持完好——detectExternalRenames 要拿「变化前的 ino」，原地改 children 会把旧树一起改坏。
  // 任何挂不上（目录不在旧树里 = 树漂移）→ 返回 null，调用方回落全量。 =====
  function replaceSubtreeAt(nodes, parts, children) {
    if (!parts.length) return null; // dir '' 不该到这（上游已回落全量）——防御
    const i = nodes.findIndex((n) => n.isDir && n.name === parts[0]);
    if (i < 0) return null;
    const kids = parts.length > 1 ? replaceSubtreeAt(nodes[i].children || [], parts.slice(1), children) : children;
    if (!kids) return null;
    const copy = nodes.slice();
    copy[i] = { ...nodes[i], children: kids };
    return copy;
  }
  function patchSubtrees(tree, subtrees) {
    let cur = tree;
    for (const s of subtrees) {
      if (!s || typeof s.dir !== 'string' || !s.dir || !Array.isArray(s.children)) return null;
      cur = replaceSubtreeAt(cur, s.dir.split('/').filter(Boolean), s.children);
      if (!cur) return null;
    }
    return cur;
  }

  // 某根的外部磁盘变化（主进程 per-root watcher 去抖后发 ws-tree-changed 带 rootId + 受影响目录）：
  // 重读该根的树（能子树级就子树级）+ reconcile 该根的标签，别的根纹丝不动。
  // 单飞（大根性能）：同根扫描在飞时新事件只并进 pending，飞完补跑一次——以前事件风暴会叠着跑
  // 多个全量 readTree。pending 合并语义：null（全量）吸收一切；目录列表取并集，超 8 个升级全量。
  const treeScanInFlight = new Set(); // rootId
  const treeScanPending = new Map(); // rootId → dirs|null
  async function onTreeChanged(rootId, changedDirs) {
    const dirs = Array.isArray(changedDirs) && changedDirs.length ? changedDirs : null;
    if (treeScanInFlight.has(rootId)) {
      const prev = treeScanPending.has(rootId) ? treeScanPending.get(rootId) : [];
      const merged = prev === null || dirs === null ? null : [...new Set([...prev, ...dirs])];
      treeScanPending.set(rootId, merged && merged.length > 8 ? null : merged);
      return;
    }
    treeScanInFlight.add(rootId);
    try {
      await doTreeScan(rootId, dirs);
    } finally {
      treeScanInFlight.delete(rootId);
      if (treeScanPending.has(rootId)) {
        const p = treeScanPending.get(rootId);
        treeScanPending.delete(rootId);
        onTreeChanged(rootId, p); // 扫描期间又有变化 → 补跑一次（fire-and-forget，同样受单飞管）
      }
    }
  }
  // 关键：先用「变化前的内存旧树」（st.tree，此刻磁盘已变但内存还列着消失的文件）给该根内部标签补 inode，
  // 再读新树——这样不用在每处建标签时穿 ino，消失文件的 ino 也一定取得到，给「改名/移动→标签跟随」做匹配。
  async function doTreeScan(rootId, dirs) {
    const st = rootOf(rootId);
    // missing/未加载（tree=null）跳过。lazy 根走 doLazyScan（只重读**已加载层与变化的交集**，永不全量——
    // 否则高 churn 的大根变永动机，诊断 D3/watcher 风暴）。
    if (!st || st.missing || !st.tree) return;
    if (st.lazy) return doLazyScan(rootId, dirs);
    // 跨根移动在飞（对抗审查 P2）：跳过 reconcile。跨根移动把文件的 inode 从源根移到目标根——若源根的
    // watcher 事件抢在 doMoveAcross 的 retargetSubtreeAcross 之前跑，reconcile 在源根树里找不到该 inode
    // → 当成「被删」removeEntry，把用户正在编辑/置顶的标签无声清掉（文件其实已好好搬到目标根）。
    // doMoveAcross 收尾自己 refreshRoot 两根，移动完成后再来的事件正常 reconcile（标签已属目标根、安全）。
    if (crossMoveGuard.has(rootId)) return;
    for (const e of tabState.entries) {
      if (e.rel && e.rootId === rootId) { const n = findNode(rootId, e.rel); if (n && n.ino != null) e.ino = n.ino; }
    }
    let newTree = null;
    if (dirs) {
      const res = await window.ws2.wsReadSubtrees(rootId, dirs);
      if (rootOf(rootId) !== st) return; // 期间该根被移除/重定位 → 放弃
      if (res && Array.isArray(res.subtrees)) newTree = patchSubtrees(st.tree, res.subtrees);
      // newTree 仍 null（主进程判全量/挂点丢失）→ 下面回落全量
    }
    if (!newTree) {
      const data = await window.ws2.wsReadTree(rootId);
      if (!data || rootOf(rootId) !== st) return; // 期间该根被移除/重定位 → 放弃
      newTree = data.tree;
    }
    const relSet = new Set();
    const inoToRel = new Map();
    (function w(nodes) {
      for (const n of nodes) {
        if (n.isDir) w(n.children || []);
        else { relSet.add(n.rel); if (n.ino != null) inoToRel.set(String(n.ino), n.rel); }
      }
    })(newTree);
    // 文件集合没变（只是某文件内容被改了，如保存）→ 不重渲染树：免得打断进行中的内联改名/拖拽，也省 DOM 重建。
    const oldRels = new Set();
    (function w(nodes) { for (const n of nodes) { if (n.isDir) w(n.children || []); else oldRels.add(n.rel); } })(st.tree);
    const sameStructure = oldRels.size === relSet.size && [...relSet].every((r) => oldRels.has(r));
    const oldTree = st.tree; // U5：捕获旧树（带 ino），给外部改名探测做 inode 匹配（下一行就被新树覆盖）
    st.tree = annotateTree(newTree, rootId); // 总更新：保持树/ino 新鲜（即使不重渲染）
    // p3-04：外部新增的目录默认收起（与 app 内建 wsMakeDir / 重启一致——watcher 路径原本漏了 collectDirRels，
    // 新 rel 不在 collapsed 就渲染成展开）。只收「真·新目录」：新树有、旧树无该 rel，且子树里没有从旧树挪来的
    // 文件 inode（有 = 外部改名/移动来的目的地，展开态维持现状、不误收）。dir 节点自身无 ino，靠子文件 ino 判定。
    {
      const oldDirRels = new Set();
      const oldFileInos = new Set();
      (function w(nodes) { for (const n of nodes) { if (n.isDir) { oldDirRels.add(n.rel); w(n.children || []); } else if (n.ino != null) oldFileInos.add(String(n.ino)); } })(oldTree);
      const cameFromOld = (nodes) => nodes.some((n) => (n.isDir ? cameFromOld(n.children || []) : (n.ino != null && oldFileInos.has(String(n.ino)))));
      (function w(nodes) {
        for (const n of nodes) {
          if (!n.isDir) continue;
          if (!oldDirRels.has(n.rel) && !cameFromOld(n.children || [])) collapsed.add(colKey(rootId, n.rel));
          w(n.children || []);
        }
      })(st.tree);
    }
    if (sameStructure) return;
    // 结构变了（增/删/改名/移动）→ reconcile 该根标签 + 重渲染 + 同步编辑器
    const prevEntry = tabState.entries.find((e) => keyOf(e) === tabState.activeRel);
    const activeRelGone = prevEntry && prevEntry.rel && prevEntry.rootId === rootId && !relSet.has(prevEntry.rel);
    const activeIno = prevEntry && prevEntry.ino;
    tabState = window.WS2Tabs.reconcileTree(tabState, rootId, relSet, inoToRel);
    persistTabs();
    renderRoot(rootId); // 只重建变化的那个根（性能：watcher 事件不再全量重建两个根）
    renderZones();
    renderRail();
    if (activeRelGone) {
      const newRel = activeIno != null ? inoToRel.get(String(activeIno)) : undefined;
      if (newRel) {
        const n = findNode(rootId, newRel); // 激活文档被外部改名/移动 → 编辑器重指向（保内容/脏态），不重载
        if (n && window.__shellRetargetDoc) window.__shellRetargetDoc(n.abs, n.name);
      } else {
        // p2-6：激活文档被外部删。回落到别的标签 / 关文档都会换掉编辑器内容——先过 dirty 检查：有未保存
        // 改动就别静默丢，转成临时文档 + 建临时标签 + 弹「保存到哪里」挽救（取消 = 保留为未保存临时文档，
        // 可稍后再存/关，不丢数据）。非 dirty 才照旧回落/空态。
        const fallback = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
        const rescued = (window.__shellIsDirty && window.__shellIsDirty() && window.__shellRescueDeletedDirty)
          ? window.__shellRescueDeletedDirty() : null;
        if (rescued) {
          openTabEntry({ abs: rescued.id, kind: 'html', title: rescued.base }); // 临时标签（temp: 身份），设为激活
          openSaveModal(true);
        } else if (fallback) openTabRow(fallback); // 回落到新激活项
        else if (window.__shellCloseDoc) window.__shellCloseDoc(); // 没得回落 → 空态
      }
    }
    detectExternalRenames(rootId, oldTree, inoToRel); // U5：外部改名/移动 → 询问式「一键更新」引用（fire-and-forget）
  }

  // ===== lazy 根的 watcher（V2）：只重读「已加载层 ∩ 变化目录」，永不全量。 =====
  // 已加载目录集：st.tree 里 childrenLoaded 的目录 rel，外加根本身 ''（顶层永远算已加载）。
  function loadedLazyDirs(st) {
    const set = new Set(['']);
    (function w(nodes) {
      for (const n of nodes) if (n.isDir) { if (n.childrenLoaded) set.add(n.rel); w(n.children || []); }
    })(st.tree || []);
    return set;
  }
  // 把某已加载层的新 children 并进树：保留仍存在的子目录的**已加载子树 + 展开态**（否则 watcher 一响就把
  // 用户展开的深层全重置成未加载）；新出现的子目录默认收起。返回是否成功挂上（目录已从树消失 → false，父层重读会处理）。
  function patchLazyLevel(st, rootId, dirRel, data) {
    const fresh = data && Array.isArray(data.children) ? annotateTree(data.children, rootId) : [];
    const target = dirRel ? findNode(rootId, dirRel) : null;
    if (dirRel && (!target || !target.isDir)) return false;
    const old = dirRel ? (target.children || []) : (st.tree || []);
    const oldByRel = new Map(old.filter((n) => n.isDir).map((n) => [n.rel, n]));
    for (const n of fresh) {
      if (!n.isDir) continue;
      const prev = oldByRel.get(n.rel);
      if (prev && prev.childrenLoaded) { n.childrenLoaded = true; n.children = prev.children; n.dirTruncated = prev.dirTruncated; }
      else collapsed.add(colKey(rootId, n.rel)); // 新目录默认收起
    }
    if (dirRel) { target.children = fresh; target.dirTruncated = !!(data && data.truncated); }
    else { st.tree = fresh; st.topTruncated = !!(data && data.truncated); }
    return true;
  }
  async function doLazyScan(rootId, dirs) {
    const st = rootOf(rootId);
    if (!st || !st.lazy || !st.tree) return;
    const loaded = loadedLazyDirs(st);
    let toReread;
    if (dirs) {
      // 受影响目录（affectedDirsOf 已归一成父目录列表）与已加载集求交——变化都在未加载层 → **不扫**（V2 核心，
      // dirReads 不涨即为证）。
      toReread = [...new Set(dirs.filter((d) => loaded.has(d)))];
      if (!toReread.length) return;
    } else {
      // overflow / 根层变化 / 平台没给路径 → 只重读**已加载集**，永不全量（否则大根一次几十万条 = 冻死）。
      toReread = [...loaded];
    }
    toReread.sort((a, b) => a.split('/').length - b.split('/').length); // 浅层先（父先于子，父 patch 保留子的已加载子树、子再更新）
    let dirty = false;
    for (const dirRel of toReread) {
      let d = null;
      try { d = await window.ws2.wsReadDir(rootId, dirRel); } catch (e) { d = null; }
      if (rootOf(rootId) !== st || !st.lazy) return; // 期间根被移除/退出 lazy
      if (patchLazyLevel(st, rootId, dirRel, d)) dirty = true;
    }
    if (dirty) renderRoot(rootId);
  }

  // ===== 浏览器 feature：web 标签桥 + 顺序循环切换 + ⌘⇧T 重开栈（spec §4.4/§7）=====
  let closedStack = []; // 最近关闭的非文档标签（web / 非可编辑外部文件）,内存态,cap 15,重启即清
  let webSeq = 0; // mkWebId 的会话内序号（id 还带时间戳,跨重启不撞键）
  function openOrder() { return window.WS2Tabs.displayOrder(tabState.entries).filter((e) => e.open); }
  // Ctrl+Tab / Ctrl+⇧Tab：按条顺序循环（置顶组在前、普通组在后；不做 MRU）。
  function cycleTab(prev) {
    const order = openOrder();
    if (order.length < 2) return;
    let idx = order.findIndex((e) => keyOf(e) === tabState.activeRel);
    if (idx < 0) idx = 0;
    const next = order[(idx + (prev ? -1 : 1) + order.length) % order.length];
    if (next) openTabRow(next, false); // 循环切换不滚树（同关标签回落的口径）
  }
  // ⌘1..8 直达第 N 条、⌘9 直达最后一条（浏览器语义）。
  function tabByIndex(n) {
    const order = openOrder();
    if (!order.length) return;
    const e = n >= 9 ? order[order.length - 1] : order[n - 1];
    if (e) openTabRow(e, false);
  }
  // ⌘⇧T：后进先出重开（原 url/title/pinned 恢复成新标签并激活）。
  function reopenClosedTab() {
    const popped = window.WS2Tabs.popClosed(closedStack);
    if (!popped.entry) return;
    closedStack = popped.rest;
    const entry = popped.entry;
    tabState = window.WS2Tabs.openEntry(tabState, entry);
    if (entry.pinned) tabState = window.WS2Tabs.pinEntry(tabState, entry);
    persistTabs();
    renderZones();
    const cur = tabState.entries.find((x) => keyOf(x) === keyOf(entry));
    if (cur) openTabRow(cur);
  }
  // 新开网页标签。background=true 后台加载不抢激活（⌘点链接/右键后台打开）。返回身份键。
  function openWebTab(url, title, background) {
    const key = window.WS2Tabs.mkWebId(++webSeq, Date.now());
    const entry = { abs: key, kind: 'web', title: title || url || window.wsT('sidebar.newWebTab'), url: url || null };
    if (background) {
      tabState = { entries: [...tabState.entries, { ...entry, open: true, pinned: false }], activeRel: tabState.activeRel };
      persistTabs();
      renderZones();
      if (url && window.__webEnsureLoaded) window.__webEnsureLoaded(key, url); // 后台建 view 加载,不 attach
    } else {
      openTabRow(entry); // web 分支：openEntry + 激活漏斗（懒建 view）
    }
    return key;
  }
  // 点收藏/补全里的「开着的标签」：已开同址（含置顶）→ 聚焦过去（拍板#3），返回是否命中。
  function focusWebByUrl(url) {
    if (!url) return false;
    const hit = tabState.entries.find((e) => window.WS2Tabs.isWebEntry(e) && e.url === url);
    if (!hit) return false;
    openTabRow(hit);
    return true;
  }
  // 主进程导航状态推送 → 标签行标题/URL 跟随 + 落盘（url/title 变了才写）。
  function updateWebEntry(key, patch) {
    const prev = tabState;
    tabState = window.WS2Tabs.updateEntry(tabState, key, patch);
    if (tabState !== prev) {
      persistTabs();
      renderZones();
    }
  }
  window.__sbWeb = {
    entries: () => tabState.entries,
    active: () => (tabState.activeRel ? tabState.entries.find((e) => keyOf(e) === tabState.activeRel) || null : null),
    openWeb: openWebTab,
    focusWebByUrl,
    updateWeb: updateWebEntry,
    // U3：加载态轻量刷（loading 翻转不落盘、不整区 renderZones，直接 toggle 对应标签行的 spinner 类）。
    setTabLoading: (key, loading) => {
      const sel = '.sb-tab[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]';
      document.querySelectorAll(sel).forEach((r) => r.classList.toggle('is-loading', !!loading));
    },
  };
  window.__sbCycleTab = (prev) => cycleTab(prev); // shell 的 iframe keydown 转发（焦点在编辑器里也能切标签）
  window.__sbTabByIndex = (n) => tabByIndex(n);
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.sb-modal-overlay, #fp-overlay, .aiax-overlay')) return; // 弹层守卫（§7,含 AI 接入面板,#11）
    if (e.ctrlKey && !e.metaKey && e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey); return; }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); tabByIndex(+e.key); }
  });

  // 「管理文件夹…」逃生门（诊断 D4）：唯一的移除入口原本与根行渲染强耦合——根行没渲染出来（D2 死门）
  // 就没有任何移除路径。这个菜单栏入口**只依赖注册表 IPC（wsGetRoots/wsRemoveRoot），不依赖 rootsState/树**，
  // 是 D2 修复万一失效时的兜底。复用现有 sb-modal 壳 + modalHead/modalBody；列表行用内联样式（CSP 安全，
  // 不动 shell.css）。移除走 removeRootUI（顺带清标签 + 撤销 toast），移除后重拉列表。
  async function openManageRootsModal() {
    if (document.querySelector('.sb-modal-overlay')) return; // 单例守卫（同其它弹层）
    const overlay = document.createElement('div');
    overlay.className = 'sb-modal-overlay';
    overlay.id = 'manage-roots-overlay';
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    const modal = document.createElement('div');
    modal.className = 'sb-modal';
    modal.append(
      modalHead(window.wsT('sidebar.manageRootsTitle'), window.wsT('sidebar.manageRootsDesc'), close),
    );
    const body = modalBody();
    const list = document.createElement('div');
    list.id = 'manage-roots-list';
    body.appendChild(list);
    modal.appendChild(body);
    overlay.appendChild(modal);
    wireOverlayClose(overlay, close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    async function renderList() {
      let infos = [];
      try { infos = await window.ws2.wsGetRoots(); } catch (e) { infos = []; }
      list.innerHTML = '';
      if (!infos.length) {
        const empty = document.createElement('div');
        empty.className = 'sb-tree-empty';
        empty.textContent = window.wsT('sidebar.noOpenFolders');
        list.appendChild(empty);
        return;
      }
      for (const info of infos) {
        const row = document.createElement('div');
        row.className = 'mr-row';
        row.dataset.root = info.id;
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '10px';
        row.style.padding = '8px 2px';
        row.style.borderBottom = '1px solid var(--c-divider)';
        const col = document.createElement('div');
        col.style.flex = '1';
        col.style.minWidth = '0';
        const nm = document.createElement('div');
        nm.className = 'mr-name ws-truncate';
        nm.style.fontWeight = 'var(--fw-semibold)';
        nm.textContent = info.name + (info.missing ? window.wsT('sidebar.missingSuffix') : '');
        const pth = document.createElement('div');
        pth.className = 'ws-truncate';
        pth.style.fontSize = 'var(--fs-sm)';
        pth.style.color = 'var(--c-text-3)';
        pth.textContent = info.path;
        pth.title = info.path;
        col.append(nm, pth);
        const rm = document.createElement('button');
        rm.className = 'sb-btn sb-btn-danger mr-remove';
        rm.dataset.root = info.id;
        rm.textContent = window.wsT('common.remove');
        rm.onclick = async () => {
          await removeRootUI(info.id); // 复用：wsRemoveRoot + rootsState/标签清理 + 可撤销 toast
          await renderList(); // 移除后重拉（不依赖 rootsState 事件）
        };
        row.append(col, rm);
        list.appendChild(row);
      }
    }
    await renderList();
  }

  window.__sbHooks = {
    // shell 脏态变化 → 同步活跃真文件标签的未保存点（T2 arc-tab-dot；临时文档的点常显、不经这里）
    onDirtyChange: (d) => {
      document.querySelectorAll('.sb-tab.is-active:not(.sb-tab-temp):not(.sb-tab-web) .sb-tab-dot').forEach((el) => { el.hidden = !d; });
    },
    pickFolder: () => pickFolder(), // ⋯ 菜单/菜单栏「打开文件夹…」= 添加根（单文件模式也要有开工作区的入口）
    manageRoots: () => openManageRootsModal(), // 菜单栏「管理文件夹…」= 不依赖树/rootsState 的逃生门（D4 兜底）
    hasTabFor: (abs) => hasEntryForAbs(abs), // shell 同文档守卫的 U2 兜底用（双域判定,见 hasEntryForAbs）
    // 仅测试用：按 abs 直接删一条 entry（构造「viewer 有文档、tabState 无 entry」态给 U2 兜底/不复活 e2e
    // ——closeTab 路线到不了：finishClose 无相邻 entry 时会 __shellCloseDoc 清掉文档）。双域解析同 hasEntryForAbs。
    dropEntryForTest: (abs) => {
      let key = null;
      const direct = tabState.entries.find((e) => !e.rel && !isTempEntry(e) && e.abs === abs);
      if (direct) key = keyOf(direct);
      else {
        const n = findNodeByAbs(abs);
        if (n) key = colKey(n.rootId, n.rel);
      }
      if (!key) return;
      tabState = { entries: tabState.entries.filter((e) => keyOf(e) !== key), activeRel: tabState.activeRel === key ? null : tabState.activeRel };
      persistTabs();
      renderZones();
    },
    onOpen: async (abs) => {
      // 等启动恢复整条跑完再建标签：冷启动时这一句让 open-file 排在 loadTabs 之后，标签不再被覆盖/中止。
      // 热路径（app 已开）restoreReady 早已 resolved，await 立即过、不阻塞。文档内容由 shell.openDoc
      // 已经先载入了，这里只补标签，不影响打开速度。
      await restoreReady;
      const node = abs ? findNodeByAbs(abs) : null;
      // reveal 一次性开关（见 openTabRow 三态说明）：关标签回落走 openTabRow(e,false) 置 suppressRevealOnce
      // → 这里整个不定位（Colin：关标签不该让树跳走）；点标签走 openTabRow(e,'expand') 置 suppressScrollOnce
      // → 展开定位但不滚（Colin 2026-07-14）。其余入口（命令面板/「打开」按钮/Finder 双击）不置标记 →
      // reveal 恒 true、scroll 恒 true，行为不变。
      const reveal = !suppressRevealOnce;
      const scroll = !suppressScrollOnce;
      suppressRevealOnce = false;
      suppressScrollOnce = false;
      // Wendi 2026-07-03：外部（Finder 双击等）打开根内文件 → 树展开到所在文件夹（scroll 时再滚动定位）。
      // 树默认全收起，不展开的话文件在树里根本不可见、也高亮不上（is-active 行没渲染出来）。
      // 先展开（内部会 render 重建行）再高亮，顺序不能反。命令面板/「打开」按钮同走此路，行为一致。
      if (node && reveal) {
        // 筛选词挡住目标文件时先清筛选（外部打开是显式意图，优先于残留筛选词）——否则过滤树里
        // 该行根本不渲染，展开/滚动/高亮三个动作全部静默落空（审计发现）
        if (query && !treeEl.querySelector('.sb-file[data-rel="' + cssAttr(node.rel) + '"][data-root="' + cssAttr(node.rootId) + '"]')) {
          query = '';
          if (filterInput) filterInput.value = '';
          const fc = document.getElementById('sb-filter-clear');
          if (fc) fc.hidden = true;
          render();
        }
        expandToFile(node.rootId, node.rel, scroll);
      }
      highlightActive(abs);
      if (node) {
        openTabEntry({ rootId: node.rootId, rel: node.rel, kind: node.kind || 'other', title: node.name });
      } else if (abs) {
        await openTabFromAbs(abs);
      }
      window.__pendingColdOpen = null; // 标签已建，撤销 loadTabs 的「别抢 viewer」抑制
    },
    refresh,
    // Cmd+T：二合一新建 modal（地址栏 + 新建文档,spec §4.5.1）。不再要求先开工作区——
    // 网页标签不依赖工作区；临时文档保存时 SaveModal 有「浏览…」兜底。
    newTab: () => openCreateModal(null, '', { temp: true }),
    cycleTab: (prev) => cycleTab(prev),           // Ctrl+Tab / Ctrl+⇧Tab
    tabByIndex: (n) => tabByIndex(n),             // ⌘1-9
    reopenClosedTab: () => reopenClosedTab(),     // ⌘⇧T（菜单加速器）
    expandSidebar: () => setSidebarCollapsed(false), // ⌘L 侧栏收起时先展开（browser.js 用）
    toggleSidebar: () => toggleCollapsed(), // ⌘\ 视图菜单加速器 → shell onMenu（覆盖全焦点域，含文档编辑 iframe 内；主层另有 keydown fallback）
    openEntryRow: (entry) => openTabRow(entry),   // browser.js 起始页置顶行/补全「开着的标签」聚焦用
    // Cmd+W：有活跃标签关标签；无标签但还有内容（工作区外查看器 / 单文件模式的文档）先关内容回空态；
    // 真·空态 → 关窗口（Wendi 2026-07-03：macOS=隐藏驻留、后台开着；Windows/Linux 按平台惯例退出）。
    closeActiveTab: () => {
      // 弹层开着（保存到哪里/关闭确认）时 Cmd+W 不做分层动作：菜单加速器不被 DOM 弹层拦，
      // 不守这行会叠出第二层确认框、两边对同一文档双执行（审计发现）
      if (document.querySelector('.sb-modal-overlay')) return;
      if (tabState.activeRel) {
        const act = tabState.entries.find((e) => keyOf(e) === tabState.activeRel);
        if (act && act.pinned) {
          // ⌘W 不销毁置顶标签（spec §4.4/§7,同浏览器防误关）——但也不再是「死无操作」。
          // Wendi 2026-07-17：关光普通标签后激活项回落到置顶标签,此时 ⌘W 什么都不发生=被困死、
          // 又没有关 app 的路。改为：取消激活、回起始页（置顶标签留着,下次点还在）。此时已是真·空态,
          // 再按 ⌘W 就命中下面的 winClose 分支 → 关窗口。⌘W 永远有反馈 + 始终有关 app 的路径。
          applyTabs({ entries: tabState.entries, activeRel: null }); // 清激活 + 重渲染（置顶行不再高亮）
          if (window.__shellCloseDoc) window.__shellCloseDoc(); // 摘 web view（内部自带 __webDetach）+ 露出起始页 + 清 docPath
          return;
        }
        closeTabRel(tabState.activeRel);
        return;
      }
      const v = document.getElementById('viewer');
      const hasDoc = window.__shellDocPath && window.__shellDocPath();
      if ((v && !v.hidden) || hasDoc) {
        // 无标签的文档（单文件模式）：关之前先冲一次保存（对齐自动保存语义与有标签路径的脏守卫），
        // 别让 1.2s 防抖窗内的编辑无确认静默丢；保存失败（alert 已弹、仍脏）则不关、文档留在原地。
        const dirtyDoc = hasDoc && window.__shellIsDirty && window.__shellIsDirty();
        const flush = dirtyDoc && window.__shellSaveActive ? window.__shellSaveActive() : null;
        Promise.resolve(flush).then(() => {
          if (window.__shellIsDirty && window.__shellIsDirty()) return;
          if (window.__shellCloseDoc) window.__shellCloseDoc();
        });
        return;
      }
      window.ws2.winClose();
    },
    focusFilter: () => { setSidebarCollapsed(false); if (filterInput) { filterInput.focus(); filterInput.select(); } }, // Cmd+F：展开侧栏 + 聚焦筛选框
    findPalette: () => openFindPalette(),                                              // Cmd+P：命令面板（模糊搜文件跳转）
    openSaveModal: (closeAfter) => openSaveModal(closeAfter),                          // shell.save() 遇临时文档 → 弹「保存到哪里」
  };
  // 外部磁盘变化实时跟随：watcher 推送（mac/win 原生）+ 窗口重新聚焦兜底。
  if (window.ws2.onWsTreeChanged) window.ws2.onWsTreeChanged(onTreeChanged);
  // 运行时根状态变化（拔盘/根被删 → 主进程转失联并广播）：重拉根列表，失联节灰态即刻可见。
  if (window.ws2.onWsRootsChanged) window.ws2.onWsRootsChanged(() => resyncRoots());
  // 聚焦兜底收口（大根性能）：以前每次 focus 对所有根全量重扫——大根一次几万个 stat，「切回 app 就卡」
  // 的直接来源。现在 focus 只做两件便宜事：① 冲掉该根 watcher 的在途去抖（改完盘马上切回来 → 立即走
  // 正常事件管线，e2e 的 focus 触发保持确定性）；② watcher 不活（平台不支持递归 watch/挂了）的根才
  // 全量重扫——watcher 活着时它本来就会推事件，focus 重扫是纯白烧。wsWatchFlush 缺失（旧 preload）回落老行为。
  window.addEventListener('focus', async () => {
    for (const st of rootsState) {
      if (st.missing) continue;
      if (!window.ws2.wsWatchFlush) { onTreeChanged(st.id); continue; }
      try {
        const r = await window.ws2.wsWatchFlush(st.id);
        if (!r || !r.alive) onTreeChanged(st.id);
      } catch { onTreeChanged(st.id); }
    }
  });

  // ── 性能诊断模式（隐藏，菜单「Wordspace Next → 性能诊断…」或 Cmd+Shift+D 手动开）────────────
  // 普通用户零感知：默认不显示任何 debug 内容，只有主动从菜单打开才出面板。Wendi 报「两文件夹贼卡」，我们本地
  // 量不出她环境；这个面板让她/开发者在真环境上看清时间花在哪。既然是 opt-in，做详尽：每根 readTree/文件数/
  // watcher，渲染耗时，**主线程长任务（抓滚动等任何卡顿，不预判来源）**，内存，+ 一键录 CPU Profile（catch-anything）。
  let perfPanel = null;      // 面板 DOM（null=关）
  let perfTimer = 0;         // 实时刷新计时器
  // 主线程长任务观察器（always-on，near-zero 成本）：浏览器自动上报 >50ms 的任务=一帧卡顿。滚动/渲染/readTree
  // 回调处理——任何 block 主线程的东西都会被记到这里，不靠我预判在哪（补掉「只量我假设的地方」那个盲区）。
  const longTasks = { count: 0, totalMs: 0, maxMs: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTasks.count++;
        longTasks.totalMs += e.duration;
        longTasks.maxMs = Math.max(longTasks.maxMs, e.duration);
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* longtask 不支持就算了，其余照常 */ }
  function memMB() {
    const m = performance.memory;
    return m ? Math.round(m.usedJSHeapSize / 1048576) + ' / ' + Math.round(m.jsHeapSizeLimit / 1048576) + ' MB' : 'n/a';
  }
  async function buildDiagReport() {
    let roots = [];
    try { roots = (await window.ws2.wsDiag()) || []; } catch {}
    let version = '';
    try { version = await window.ws2.appVersion(); } catch {}
    const domRows = treeEl ? treeEl.querySelectorAll('.sb-row').length : 0;
    const L = [];
    L.push(window.wsT('sidebar.diagTitle', { version, date: new Date().toLocaleString() }));
    L.push('');
    if (!roots.length) L.push(window.wsT('sidebar.diagNoRoots'));
    roots.forEach((r, i) => {
      const name = r.path.split('/').filter(Boolean).pop() || r.path;
      L.push(window.wsT('sidebar.diagRootLine', { n: i + 1, name, info: r.cloud ? window.wsT('sidebar.diagCloud', { name: r.cloud }) : window.wsT('sidebar.diagLocal') }));
      L.push('   ' + r.path);
      const kb = r.payloadBytes ? window.wsT('sidebar.diagIpcPayload', { kb: Math.round(r.payloadBytes / 1024).toLocaleString() }) : '';
      L.push(window.wsT('sidebar.diagFileStats', { files: r.fileCount.toLocaleString(), dirs: (r.dirCount || 0).toLocaleString(), kb, last: r.lastReadMs, max: r.maxReadMs, reads: r.reads, scoped: r.scopedReads || 0, dirReads: r.dirReads || 0, events: r.watchEvents }));
    });
    L.push('');
    L.push(window.wsT('sidebar.diagRenderLine', { last: diagRender.lastMs.toFixed(0), max: diagRender.maxMs.toFixed(0), count: diagRender.count, rows: domRows }));
    L.push(window.wsT('sidebar.diagLongTask', { count: longTasks.count, total: Math.round(longTasks.totalMs), max: Math.round(longTasks.maxMs) }));
    L.push(window.wsT('sidebar.diagMem', { mem: memMB() }));
    return L.join('\n');
  }
  async function renderPerfPanel() {
    if (!perfPanel) return;
    const report = await buildDiagReport();
    const pre = perfPanel.querySelector('pre');
    if (pre) pre.textContent = report;
  }
  async function togglePerfPanel() {
    if (perfPanel) { perfPanel.remove(); perfPanel = null; if (perfTimer) { clearInterval(perfTimer); perfTimer = 0; } return; }
    const panel = document.createElement('div');
    panel.id = 'perf-panel';
    // 非模态、固定右上：不挡操作，用户可以一边滚动一边看「长任务」数字实时涨（抓滚动卡顿）。
    panel.style.position = 'fixed'; panel.style.top = '10px'; panel.style.right = '10px'; panel.style.zIndex = '9999';
    panel.style.width = 'min(520px, 46vw)'; panel.style.maxHeight = '80vh'; panel.style.overflow = 'auto';
    panel.style.background = 'rgba(24,24,24,0.97)'; panel.style.color = '#e6e6e6';
    panel.style.font = '11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace';
    panel.style.padding = '12px 14px'; panel.style.borderRadius = '10px';
    panel.style.border = '1px solid #444'; panel.style.boxShadow = '0 10px 40px rgba(0,0,0,.5)';
    const pre = document.createElement('pre');
    pre.style.margin = '0 0 10px'; pre.style.whiteSpace = 'pre-wrap';
    const bar = document.createElement('div');
    bar.style.display = 'flex'; bar.style.gap = '7px'; bar.style.flexWrap = 'wrap'; bar.style.alignItems = 'center';
    const mkBtn = (label) => { const b = document.createElement('button'); b.textContent = label; b.style.font = 'inherit'; b.style.padding = '4px 10px'; b.style.borderRadius = '6px'; b.style.border = '1px solid #555'; b.style.background = '#2d2d2d'; b.style.color = '#e6e6e6'; b.style.cursor = 'pointer'; return b; };
    const copy = mkBtn(window.wsT('sidebar.diagCopy'));
    const record = mkBtn(window.wsT('sidebar.diagRecord'));
    const close = mkBtn(window.wsT('common.close'));
    copy.onclick = async () => { try { await navigator.clipboard.writeText(await buildDiagReport()); copy.textContent = window.wsT('sidebar.diagCopied'); setTimeout(() => (copy.textContent = window.wsT('sidebar.diagCopy')), 1500); } catch { copy.textContent = window.wsT('sidebar.diagCopyFailed'); } };
    // catch-anything：录一段真 CPU profile，记录每个函数/帧，主进程存成 .cpuprofile 文件并在访达里高亮，发回来。
    record.onclick = async () => {
      record.disabled = true; record.textContent = window.wsT('sidebar.diagRecording');
      try {
        const res = await window.ws2.diagRecordProfile(5000);
        record.textContent = res && res.path ? window.wsT('sidebar.diagSaved', { name: res.path.split('/').pop() }) : window.wsT('sidebar.diagRecordFailed');
      } catch { record.textContent = window.wsT('sidebar.diagRecordFailedPkg'); }
      record.disabled = false; setTimeout(() => (record.textContent = window.wsT('sidebar.diagRecord')), 4000);
    };
    close.onclick = () => togglePerfPanel();
    const hint = document.createElement('span');
    hint.textContent = window.wsT('sidebar.diagHint');
    hint.style.opacity = '0.6'; hint.style.width = '100%';
    bar.append(copy, record, close, hint);
    panel.append(pre, bar);
    document.body.appendChild(panel);
    perfPanel = panel;
    await renderPerfPanel();
    perfTimer = setInterval(renderPerfPanel, 1000); // 实时刷新
  }
  if (window.__sbHooks) window.__sbHooks.perfDiag = () => togglePerfPanel(); // 菜单「性能诊断…」入口
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); togglePerfPanel(); } // 开发者备用快捷键
    else if (e.key === 'Escape' && perfPanel) { togglePerfPanel(); }
  });

  // 启动恢复上次打开的全部根（含失联的灰态）+ 全局标签。整条跑完才 resolveRestore，
  // 让冷启动的 open-file 建标签等在这后面（无根 / 出错也要 resolve，否则 onOpen 永久挂起）。
  (async () => {
    try {
      const infos = await window.ws2.wsGetRoots();
      if (infos && infos.length) {
        // 修 D2（大根死锁陷阱）：**不再把首帧门控在「全部根读完树」上**。先把根装进 rootsState（loading 态、
        // tree=null）+ 立刻渲染——根行（含 loading 行）与右键「移除」入口即刻可见可点，即便某根读树巨慢/
        // 永不返回也救得回来（照抄添加路径 adoptRoot 的两段式形状，见 pickFolder 的 'added' 分支）。
        rootsState = infos.map((r) => { const st = mkRootState(r, null); if (!r.missing) st.loading = true; return st; });
        rootsGen++;
        if (filterInput) filterInput.value = '';
        syncChrome();
        render();
        // 逐根串行读树（不再 Promise.all 并发全量扫）：一根巨型不阻塞其他根的树到货，也不再让读不完的根
        // 卡死后续的 loadTabs / resolveRestore（U2 的条目预算再给每根读树本身封顶）。加载期间被移除的根由
        // loadRootTree 的 `rootOf` 守卫自然跳过。
        for (const st of [...rootsState]) {
          if (st.missing) continue;
          await loadRootTree(st.id); // 读树 + 填树/转失联/过大 + 清 loading（与添加路径同一函数）
        }
        await restoreTreeState(); // 树到齐后把上次展开的目录/收起的根灌回（loadRootTree 已 collectDirRels 全收起）
        render();
      }
      // loadTabs 在无根时也要跑（对抗审查 MR-ADV-2）：根全移除后外部标签（abs 身份）仍持久化着，
      // 只走「有根才恢复」的分支会让它们重启即丢、还被下一次 persist 从盘上抹掉。
      // ⚠ 冷启动竞态红线（cold-start.spec）：loadTabs 仍在「树读完」之后跑（findNode 依赖树），resolveRestore
      // 仍在 loadTabs 之后（finally）——open-file 建标签排在 loadTabs 之后、不被覆盖的语义原封不动，只是首帧提前了。
      await loadTabs(); // 全局标签/置顶恢复 + 上次激活进编辑器（冷启动 open-file 在路上则不抢 viewer）
      syncChrome(); // 恢复出的外部标签要点亮侧栏（sb-on 依赖 tabState.entries）
    } catch (e) {
      /* 无根 / 已不存在：保持空态 */
    } finally {
      resolveRestore();
    }
  })();
})();
