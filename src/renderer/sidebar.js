// 左侧本地文件栏（F06）。跑在父层 shell 作用域（classic script，shell.js 之后加载）→ 直接调
// shell.js 的 openDoc / __shellRetargetDoc 等。所有 fs 经 window.ws2.ws*（主进程）。
// CSP 约束：不用 setAttribute('style')/cssText（会被 style-src 拦）；缩进走 class（sb-d0..9），
// 数据走 dataset（data-* 不受 CSP 限制）。样式全在 shell.css。
(function () {
  const rootNameEl = document.getElementById('sb-root-name');
  const filterWrap = document.getElementById('sb-filter');
  const filesLabel = document.getElementById('sb-files-label');
  const filterInput = document.getElementById('sb-filter-input');
  const emptyEl = document.getElementById('sb-empty');
  const treeEl = document.getElementById('sb-tree');
  const openFolderBtn = document.getElementById('sb-open-folder');
  const emptyOpenBtn = document.getElementById('sb-empty-open');
  if (!treeEl) return;

  let current = null; // { root, name, tree }
  let query = '';
  let tabState = { entries: [], activeRel: null }; // 标签/置顶模型（src/lib/tabs.js → window.WS2Tabs，按根持久化）
  // 启动恢复完成信号：冷启动（app 没开就双击 .html）时，open-file 建标签必须等「恢复上次工作区 + 标签」
  // 整条跑完才做，否则会被 loadTabs 整体覆盖 / 被 openTabFromAbs 的过期根守卫中止（Colin 报的「文档开了没标签」）。
  // 一旦 resolve 永久 resolved：app 已开着时再 open（热路径）不阻塞，立即建标签。
  let resolveRestore;
  const restoreReady = new Promise((r) => { resolveRestore = r; });
  const collapsed = new Set(); // 收起的文件夹 rel（打开工作区时全部收起，只显示顶层）

  // 收集树里所有文件夹的 rel（打开工作区时一次性塞进 collapsed → 默认全收起）。
  function collectDirRels(nodes, acc) {
    for (const n of nodes) {
      if (n.isDir) {
        acc.add(n.rel);
        collectDirRels(n.children, acc);
      }
    }
    return acc;
  }

  // ---- 内联 SVG 图标（CSP 允许 SVG 元素；用 innerHTML 注入，非脚本）----
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
  KIND_PATH.web = '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'; // 地球（无 favicon 时的通用 web 图标）
  const kindSvg = (kind) =>
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    (KIND_PATH[kind] || '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>') +
    '</svg>';

  const indentClass = (depth) => 'sb-d' + Math.min(depth, 9);

  // ---- 打开 / 刷新 ----
  async function pickFolder() {
    const data = await window.ws2.pickFolder();
    if (data) setWorkspace(data);
  }
  function setWorkspace(data) {
    // Colin 2026-07-06 拍板:网页标签**全局**——切工作区**不再** destroyAll web view(它们跨工作区活着,
    // 像真浏览器切文件夹标签不丢)。旧 KD-17「web workspace-gated + 切根销毁」已废。
    current = data;
    query = '';
    // 清掉旧工作区的**文档**标签,保留网页标签(全局);loadTabs 再按新根拉回文档 + 合并全局 web。
    tabState = { entries: tabState.entries.filter(isWebEntry), activeRel: null };
    collapsed.clear();
    collectDirRels(current.tree, collapsed); // 默认全部收起：一打开只露顶层，要看哪层自己点开
    if (filterInput) filterInput.value = '';
    const fc = document.getElementById('sb-filter-clear');
    if (fc) fc.hidden = true; // 换工作区清筛选 → 清除钮跟着藏
    rootNameEl.textContent = data.name;
    rootNameEl.title = data.root;
    emptyEl.hidden = true;
    treeEl.hidden = false;
    filterWrap.hidden = false;
    if (filesLabel) filesLabel.hidden = false;
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.add('sb-on'); // 打开工作区才显示侧栏（单文件编辑保持全宽）
    render();
    return loadTabs(); // 异步按新根拉标签/置顶，到了再 render + 恢复上次激活（返回 promise 给启动恢复 await）
  }
  async function refresh() {
    if (!current) return;
    const data = await window.ws2.wsReadTree();
    if (data) {
      current = data;
      render();
    }
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
  function render() {
    treeEl.innerHTML = '';
    if (!current) {
      if (railEl) railEl.innerHTML = '';
      return;
    }
    renderRail(); // 收起态图标轨（#4），与主树同步刷新
    renderZones(); // 置顶区 + 标签页区
    const q = query.trim().toLowerCase();
    const nodes = q ? filterTree(current.tree, q) : current.tree;
    if (!nodes.length) {
      const e = document.createElement('div');
      e.className = 'sb-tree-empty';
      e.textContent = q ? '没有匹配的文件' : '这个文件夹还没有文件';
      treeEl.appendChild(e);
      return;
    }
    for (const n of nodes) renderNode(n, 0, treeEl, !!q);
    highlightActive(window.__shellDocPath ? window.__shellDocPath() : null);
  }

  // ===== 整理操作（U6）：右键菜单 / hover+ / 内联改名 / 拖拽移动 / 删除撤销 + 当前文件边界同步 =====
  let dragNode = null;
  const PLUS_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

  const parentDirOf = (rel) => {
    const i = rel.lastIndexOf('/');
    return i >= 0 ? rel.slice(0, i) : '';
  };
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
    const r = await window.ws2.wsRename(node.rel, newLeaf);
    if (wasOpen && window.__shellRetargetDoc) window.__shellRetargetDoc(r.abs, r.rel.split('/').pop());
    else if (openUnderDir && window.__shellRetargetDoc) {
      const newAbs = r.abs + op.slice(node.abs.length); // 前缀替换（isUnder 已确认 op 以 node.abs+分隔符 开头）
      window.__shellRetargetDoc(newAbs, newAbs.split(/[\\/]/).pop());
    }
    if (r.rel !== node.rel) {
      retargetTabsUnder(node.rel, r.rel, node.isDir); // 标签跟随改名
      // 修 SB-12：collapsed 以 rel 为键，改目录名后旧键残留、新键不在集合 → 被改名的收起文件夹连同子树全展开。
      // 把旧 rel 前缀的收起项迁到新 rel 前缀，保持展开/收起状态。
      if (node.isDir) {
        for (const rel of [...collapsed]) {
          if (rel === node.rel || rel.indexOf(node.rel + '/') === 0) { collapsed.delete(rel); collapsed.add(r.rel + rel.slice(node.rel.length)); }
        }
      }
    }
    await refresh();
  }
  async function doMove(node, destDirRel) {
    const wasOpen = !node.isDir && openPath() === node.abs;
    const r = await window.ws2.wsMove(node.rel, destDirRel);
    if (wasOpen && window.__shellRetargetDoc && r.abs !== node.abs) {
      window.__shellRetargetDoc(r.abs, r.rel.split('/').pop());
    }
    if (r.rel !== node.rel) retargetTabsUnder(node.rel, r.rel, node.isDir); // 标签跟随移动
    await refresh();
  }
  async function doDelete(node) {
    const op = openPath();
    const affectsOpen = op && (op === node.abs || (node.isDir && isUnder(op, node.abs)));
    const r = await window.ws2.wsDelete(node.rel);
    removeTabsUnder(node); // 移除被删文件的标签
    await refresh();
    if (affectsOpen) { // 删了当前打开的 → 切到下一个标签 / 回空态
      const n = tabState.activeRel ? findNode(tabState.activeRel) : null;
      if (n) openNode(n);
      else if (window.__shellCloseDoc) window.__shellCloseDoc();
    }
    showToast('已删除「' + node.name + '」', '撤销', async () => {
      await window.ws2.wsUndoDelete(r.token);
      await refresh();
    });
  }
  async function newSubfolder(dirRel) {
    await window.ws2.wsMakeDir(dirRel, '新建文件夹');
    await refresh();
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

  function renderNode(node, depth, parent, forceOpen) {
    if (node.isDir) {
      const open = forceOpen || !collapsed.has(node.rel);
      const row = document.createElement('div');
      row.className = 'sb-row sb-dir ' + indentClass(depth);
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.dataset.rel = node.rel;
      const caret = document.createElement('span');
      caret.className = 'sb-caret' + (open ? ' is-open' : '');
      caret.innerHTML = SVG.chevron;
      const ico = document.createElement('span');
      ico.className = 'sb-ico';
      ico.innerHTML = SVG.folder;
      const name = document.createElement('span');
      name.className = 'sb-name ws-truncate';
      name.textContent = node.name;
      name.title = node.name; // 名字过长被截断时，悬停显示全名
      const add = document.createElement('button');
      add.className = 'sb-add';
      add.title = '在此文件夹新建文档';
      add.innerHTML = PLUS_SVG;
      add.onclick = (e) => {
        e.stopPropagation();
        openCreateModal(node.rel);
      };
      row.append(caret, ico, name, add);
      row.onclick = () => {
        if (collapsed.has(node.rel)) collapsed.delete(node.rel);
        else collapsed.add(node.rel);
        render();
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: '新建文档', run: () => openCreateModal(node.rel) },
          { label: '新建子文件夹', run: () => newSubfolder(node.rel) },
          { label: '重命名', run: () => startInlineRename(node, row) },
          { label: '删除', danger: true, run: () => doDelete(node) },
        ]);
      };
      row.ondragover = (e) => {
        if (!dragNode || parentDirOf(dragNode.rel) === node.rel) return;
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
        doMove(dragNode, node.rel);
      };
      parent.appendChild(row);
      if (open) {
        if (node.children.length) {
          for (const c of node.children) renderNode(c, depth + 1, parent, forceOpen);
        } else {
          const e = document.createElement('div');
          e.className = 'sb-tree-empty ' + indentClass(depth + 1);
          e.textContent = '空文件夹';
          parent.appendChild(e);
        }
      }
    } else {
      const row = document.createElement('button');
      row.className = 'sb-row sb-file sb-kind-' + (node.kind || 'other') + ' ' + indentClass(depth);
      row.dataset.rel = node.rel;
      row.dataset.abs = node.abs;
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
      row.onclick = () => openNode(node);
      row.ondragstart = (e) => {
        dragNode = node;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', node.rel);
      };
      row.ondragend = () => {
        dragNode = null;
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: '打开', run: () => openNode(node) },
          { label: isPinned(node.rel) ? '取消置顶' : '置顶', run: () => (isPinned(node.rel) ? unpinRel(node.rel) : pinFromTree(node)) },
          { label: '重命名', run: () => startInlineRename(node, row) },
          { label: '删除', danger: true, run: () => doDelete(node) },
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
      window.__shellShowViewer(node); // 编辑区出预览/卡片，不再直接外部打开
    } else {
      window.ws2.wsOpenExternal(node.rel);
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
  // 身份键：工作区内用 rel、工作区外用 abs（跟 tabs.js 一致）。外部标签 = 没有 rel。
  const keyOf = (e) => e.rel || e.abs;
  const isExternal = (e) => !e.rel;
  // 临时文档标签（从「标签页 +」/ Cmd+T 新建、未落盘）：身份键用 shell 生成的 'temp:…'（rel/abs 都没有 →
  // 塞进 abs 当身份，靠前缀识别，不用改 tabs.js）。不持久化、不进树，手动保存才落盘变真文件。
  const TEMP_PREFIX = 'temp:';
  const isTempKey = (k) => typeof k === 'string' && k.indexOf(TEMP_PREFIX) === 0;
  const isTempEntry = (e) => isTempKey(keyOf(e));
  // 网页标签（第三身份类）：身份键 'web:<seq>:<ts>' 塞 abs（同 temp: 先例,靠前缀识别,tabs.js 已有 isWebKey）。
  const isWebKey = (k) => window.WS2Tabs.isWebKey(k);
  const isWebEntry = (e) => isWebKey(keyOf(e));
  let webSeq = 0;
  const nextWebId = () => window.WS2Tabs.mkWebId(++webSeq, Date.now());
  const baseName = (p) => String(p).split(/[\\/]/).pop();
  // 外部标签的「↗」轻标记图标（shell.js 的 EXT_SVG 是 script 作用域 const、跨不到这里，单独定义）。
  const EXT_ICO_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M9 7h8v8"/></svg>';

  function findNode(rel) {
    let found = null;
    (function walk(nodes) {
      for (const n of nodes) {
        if (found) return;
        if (n.rel === rel) { found = n; return; }
        if (n.children && n.children.length) walk(n.children);
      }
    })(current ? current.tree : []);
    return found;
  }
  function findNodeByAbs(abs) {
    let found = null;
    (function walk(nodes) {
      for (const n of nodes) {
        if (found) return;
        if (!n.isDir && n.abs === abs) { found = n; return; }
        if (n.children && n.children.length) walk(n.children);
      }
    })(current ? current.tree : []);
    return found;
  }
  function isPinned(key) {
    return tabState.entries.some((e) => keyOf(e) === key && e.pinned);
  }
  function persistTabs() {
    // 网页标签**全局**(Colin 拍板:跟工作区无关、切文件夹不丢)→ 单独全局桶 + 全局激活键(浏览状态自足)。
    if (window.ws2.wsSetWebTabs) {
      const webActive = isWebKey(tabState.activeRel) ? tabState.activeRel : null;
      window.ws2.wsSetWebTabs(tabState.entries.filter(isWebEntry), webActive).catch(() => {});
    }
    // 文档标签仍按 root 存。临时文档不落盘。root 桶里剔掉 web(它们全局了)。activeRel 可能指向 web(全局),照存,
    // 恢复时 resolveActive 在合并后的 entries 里找得到。带上 current.root:主进程校验防跨工作区写错桶。
    if (!window.ws2.wsSetTabs || !current || !current.root) return;
    const clean = {
      entries: tabState.entries.filter((e) => !isTempEntry(e) && !isWebEntry(e)),
      activeRel: isTempKey(tabState.activeRel) ? null : tabState.activeRel,
    };
    window.ws2.wsSetTabs(clean, current.root).catch(() => {});
  }
  function applyTabs(next) {
    tabState = next;
    persistTabs();
    renderZones();
    renderRail();
  }

  function pinFromTree(node) {
    applyTabs(window.WS2Tabs.pinEntry(tabState, { rel: node.rel, kind: node.kind || 'other', title: node.name }));
  }
  function pinRel(entry) {
    applyTabs(window.WS2Tabs.pinEntry(tabState, { rel: entry.rel, abs: entry.abs, kind: entry.kind, title: entry.title }));
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
    const dirtyActive = wasActive && window.__shellIsDirty && window.__shellIsDirty();
    // 修 SB-4（bug-sweep #111 与本 PR 撞车,两家合一）：临时文档永远是未保存内容 → 无论激活
    // 与否都要确认,别让非激活 temp 的 × 零确认直接销毁。非激活 temp 先切到前台（编辑器渲染它 +
    // 设为激活）,确认框的「保存并关闭」才作用在正确目标上。
    // 本 PR 补的防御：__shellReopenTemp 内部走 canLeaveActive,若被「脏文件切走」守卫取消,它会
    // 静默 no-op——此时不能再 openTabEntry（否则侧栏高亮已切、shell 还在旧文档,状态分裂,后续
    // 「保存并关闭」会把别的文档存进去）。校验 shell 真切过去了才继续,否则保守放弃本次关闭。
    if (isTempEntry(entry) || dirtyActive) {
      if (isTempEntry(entry) && !wasActive) {
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
    const wasWeb = entry && isWebEntry(entry);
    if (entry && isTempEntry(entry)) { if (window.__shellDiscardTemp) window.__shellDiscardTemp(key); }
    else if (wasWeb) { /* 网页标签无脏文档概念,下面统一销毁 view */ }
    else if (wasActive && window.__shellDiscard) window.__shellDiscard();
    // op 可能是 closeEntry（销毁未置顶）或 removeEntry（整条删）——若该 key 已不再是任何区的条目,销毁其 view。
    applyTabs(op(tabState, key));
    if (wasWeb && !tabState.entries.some((e) => keyOf(e) === key) && window.__webCloseView) window.__webCloseView(key);
    if (wasActive) {
      const e = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
      if (e) openTabRow(e); // 回落项可能是外部/临时/网页标签 → 走统一分发（漏斗）
      else { if (window.__webDetach) window.__webDetach(); if (window.__shellCloseDoc) window.__shellCloseDoc(); }
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
    x.setAttribute('aria-label', '关闭');
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
    const name = entry ? entry.title : '这个文件';
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
    title.textContent = '「' + name + '」还没保存';
    const desc = document.createElement('div');
    desc.className = 'sb-modal-desc';
    desc.textContent = temp
      ? '这是一个还没存进文件夹的临时文档。关掉后未保存的内容会丢失。'
      : '这个文档有未保存的修改，关掉后会丢失。';
    textWrap.append(title, desc);
    body.append(ico, textWrap);
    const foot = document.createElement('div');
    foot.className = 'sb-modal-foot';
    const discard = document.createElement('button');
    discard.className = 'sb-btn sb-btn-danger';
    discard.textContent = '不保存，直接关闭';
    discard.onclick = () => { close(); finishClose(key, op); };
    const spacer = document.createElement('span');
    spacer.className = 'sb-modal-spacer';
    const cancel = document.createElement('button');
    cancel.className = 'sb-btn';
    cancel.textContent = '取消';
    cancel.onclick = close;
    const save = document.createElement('button');
    save.className = 'sb-btn sb-btn-primary';
    save.textContent = '保存并关闭';
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
    const dirs = ['']; // '' = 工作区根
    (function walk(nodes) { for (const n of nodes) { if (n.isDir) { dirs.push(n.rel); walk(n.children || []); } } })(current ? current.tree : []);
    let selectedDir = '';
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
    nameInput.placeholder = '文件名';
    nameInput.setAttribute('aria-label', '文件名');
    const ext = document.createElement('span');
    ext.className = 'sb-save-ext';
    ext.textContent = '.html';
    nameRow.append(nameInput, ext);
    const list = document.createElement('div');
    list.className = 'sb-save-list';
    const rows = [];
    dirs.forEach((d) => {
      const row = document.createElement('button');
      row.className = 'sb-save-row' + (d === selectedDir ? ' is-on' : '');
      const ico = document.createElement('span'); ico.className = 'sb-ico'; ico.innerHTML = SVG.folder;
      const label = document.createElement('span'); label.className = 'sb-name ws-truncate';
      label.textContent = d || ((current ? current.name : '工作区') + '（根目录）');
      row.append(ico, label);
      row.onclick = () => { selectedDir = d; rows.forEach((r, i) => r.classList.toggle('is-on', dirs[i] === selectedDir)); };
      rows.push(row);
      list.appendChild(row);
    });
    const foot = document.createElement('div');
    foot.className = 'sb-modal-foot';
    const pickedName = () => (nameInput.value.trim() || t.base);
    const browse = document.createElement('button'); browse.className = 'sb-btn'; browse.textContent = '浏览…';
    browse.title = '用系统保存框选任意位置（可存到工作区外）';
    browse.onclick = async () => {
      const cur = window.__shellActiveTemp && window.__shellActiveTemp(); // 存的一刻再取最新内容
      if (!cur) { close(); return; }
      let r;
      try { r = await window.ws2.wsSaveDocAs(pickedName(), cur.html); }
      catch (e) { showToast('保存失败：' + ((e && e.message) || e)); return; }
      if (!r || r.canceled) return; // 原生框取消 → 留在弹窗里
      close();
      await adoptSavedTemp(cur.id, r.abs, closeAfter);
    };
    const cancel = document.createElement('button'); cancel.className = 'sb-btn'; cancel.textContent = '取消'; cancel.onclick = close;
    const spacer = document.createElement('span'); spacer.className = 'sb-modal-spacer';
    const ok = document.createElement('button'); ok.className = 'sb-btn sb-btn-primary'; ok.textContent = '保存到这里';
    ok.onclick = async () => {
      close();
      const cur = window.__shellActiveTemp && window.__shellActiveTemp(); // 存的一刻再取一次最新内容
      if (cur) await doSaveTemp(cur.id, pickedName(), cur.html, selectedDir, closeAfter);
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
      modalHead('保存到哪里', '「' + t.base + '」· 默认存到工作区根目录，也可以选别的文件夹或「浏览…」到其他位置', close),
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
  async function doSaveTemp(tempId, base, html, dir, closeAfter) {
    let r;
    try { r = await window.ws2.wsNewDoc(dir || '', base, html); }
    catch (e) { showToast('保存失败：' + ((e && e.message) || e)); return; }
    if (!r || !r.abs) { showToast('保存失败'); return; }
    await adoptSavedTemp(tempId, r.abs, closeAfter);
  }
  // 落盘后的收编（工作区内/外通用）：去临时标签 → 建真标签（区内 rel 身份 / 区外 abs 外部标签）→
  // 编辑器就地指向真文件 → 成功 toast（对齐 ui-demo 保存正反馈）。
  async function adoptSavedTemp(tempId, abs, closeAfter) {
    await refresh(); // 树里出现新文件（工作区外保存则树不变，无妨）
    const node = findNodeByAbs(abs);
    const leaf = abs.split('/').pop();
    applyTabs(window.WS2Tabs.removeEntry(tabState, tempId)); // 去掉临时标签
    if (node) openTabEntry({ rel: node.rel, kind: node.kind || 'html', title: node.name }); // 区内：真 rel 标签
    else openTabEntry({ abs, kind: 'html', title: leaf }); // 区外：abs 身份外部标签（↗），沿用外部文件标签模型
    if (window.__shellFinalizeTemp) await window.__shellFinalizeTemp(tempId, abs, node ? node.name : leaf);
    if (node) { expandToFile(node.rel); highlightActive(abs); }
    const place = node
      ? (current ? current.name : '工作区') + (node.rel.indexOf('/') >= 0 ? ' / ' + node.rel.split('/').slice(0, -1).join('/') : '')
      : abs.split('/').slice(0, -1).join('/');
    showToast('已保存到 ' + place);
    if (closeAfter) closeTabRel(node ? node.rel : abs); // 「保存并关闭」
  }

  function closeTabRel(key) { closeOrRemove(key, window.WS2Tabs.closeEntry); } // 标签页区 ×
  function removeTabRel(key) { closeOrRemove(key, window.WS2Tabs.removeEntry); } // 置顶区 ×：整条移出置顶
  function dropTabRel(key, toPinned, toIndex) {
    applyTabs(window.WS2Tabs.dropEntry(tabState, key, toPinned, toIndex));
  }
  // 删文件(或目录下所有文件) → 移除其标签；改名/移动 → 标签 rel 跟随。外部标签(无 rel)天然不被波及，
  // 但前缀匹配里 e.rel 可能是 undefined，必须加 e.rel && 守卫，否则 undefined.indexOf 抛错整个回调崩。
  function removeTabsUnder(node) {
    const under = (rel) => rel === node.rel || rel.indexOf(node.rel + '/') === 0;
    const targets = node.isDir ? tabState.entries.filter((e) => e.rel && under(e.rel)).map((e) => e.rel) : [node.rel];
    for (const rel of targets) tabState = window.WS2Tabs.removeEntry(tabState, rel);
    persistTabs();
  }
  function retargetTabsUnder(oldRel, newRel, isDir) {
    if (!isDir) {
      tabState = window.WS2Tabs.retargetEntry(tabState, oldRel, newRel, newRel.split('/').pop());
    } else {
      const affected = tabState.entries
        .filter((e) => e.rel && (e.rel === oldRel || e.rel.indexOf(oldRel + '/') === 0))
        .map((e) => e.rel);
      for (const rel of affected) {
        const nr = newRel + rel.slice(oldRel.length);
        tabState = window.WS2Tabs.retargetEntry(tabState, rel, nr, nr.split('/').pop());
      }
    }
    persistTabs();
  }

  // 按根拉标签：清掉已不存在的文件、回落激活、恢复上次激活进编辑器。
  // 存在性校验分流：内部 entry 看文件树里有没有；外部 entry(无 rel) 问主进程 fs.stat 文件还在不在
  // （不在 = 静默丢，符合拍板①）。两处 await 都加「期间切了工作区就放弃」的竞态守卫。
  async function loadTabs() {
    const rootBefore = current && current.root;
    let st, web = { entries: [], activeKey: null };
    try { st = await window.ws2.wsGetTabs(); } catch (e) { st = { entries: [], activeRel: null }; }
    try { web = (await window.ws2.wsGetWebTabs()) || web; } catch (e) { /* keep default */ }
    if (!current || current.root !== rootBefore) return;
    // 合并:全局网页标签 + 本工作区文档标签(root 桶里理论无 web,防御性过滤)。
    const raw = [...(web.entries || []), ...(st.entries || []).filter((e) => !isWebKey(keyOf(e)))];
    // 存在性校验三分流：网页标签(web:)恒有效(不做 fs 检查——store 已校验 url);内部看树;外部问 fs.stat。
    const checks = await Promise.all(raw.map((e) =>
      isWebKey(keyOf(e)) ? Promise.resolve(true) : e.rel ? Promise.resolve(!!findNode(e.rel)) : window.ws2.pathExists(e.abs).catch(() => false),
    ));
    if (!current || current.root !== rootBefore) return;
    const entries0 = raw.filter((_e, i) => checks[i]);
    // ⚠ 最后一刻才 union 内存里的 web 标签:从进 loadTabs 到这里隔着**三个 await**(getTabs/getWebTabs/
    // pathExists 批),期间用户新建的网页标签(开文件夹后立刻输网址)若不补进来会被这次赋值 clobber。
    // 早抓(第 2 个 await 后)不够——checks 那批 IPC 往返窗口更宽,e2e 套件负载下必现 flake,真用户也可能踩。
    const liveWeb = tabState.entries.filter(isWebEntry).filter((e) => !entries0.some((x) => keyOf(x) === keyOf(e)));
    const entries = [...liveWeb, ...entries0];
    // 激活:内存里的当前激活优先(可能正是 loadTabs 飞行期间刚建的 web 标签,别把用户视图抢走);
    // 其次 root 桶 activeRel(工作区上下文);最后全局 web 激活键(上次看的网页)。
    const activeRel = window.WS2Tabs.resolveActive(entries, tabState.activeRel || st.activeRel || web.activeKey);
    const changed = entries.length !== raw.length || activeRel !== st.activeRel;
    tabState = { entries, activeRel };
    if (changed) persistTabs();
    renderZones();
    renderRail();
    // 有冷启动 open-file 在路上（用户刚双击的文件该占 viewer）→ 别把上次激活的标签开进 viewer 抢走它；
    // 标签状态仍恢复，只是不自动载入。onOpen 随后会把冷启动文件设为激活。
    let openedActive = false;
    if (activeRel && !window.__pendingColdOpen) {
      const e = tabState.entries.find((x) => keyOf(x) === activeRel);
      // 恢复上次激活标签,全部走漏斗（含 web）。adversarial 抓的:web 激活标签若只当占位、不走 __webActivate,
      // tabState.activeRel 与 browser-chrome 的 activeWebEntry 脱钩 → 高亮它但内容空、Cmd+R 死键、omnibox 建重复标签。
      // 激活标签加载=Chrome 重启行为(后台标签仍惰性:它们不是 activeRel、永不自动打开)。修正 KD-2「占位不加载」到「仅激活标签加载」。
      if (e) { openTabRow(e); openedActive = true; }
    }
    // 没有要自动打开的激活标签、也没有冷启动文件在路上 → 内容区落到 NewTab 页,别留空白(审计 05)。
    if (!openedActive && !window.__pendingColdOpen && !(window.__shellDocPath && window.__shellDocPath()) && window.__webShowEmpty) {
      window.__webShowEmpty();
    }
  }

  // ---- 渲染两区 ----
  // 点标签开它：内部文件走树节点 openNode；外部文件(无 rel)按 kind 分发 abs（跟「打开」按钮一条路，
  // shell.js 的 openDoc/showViewer 已支持纯 abs）。
  // UX4（Wendi F6-①）：把文件树展开到 rel 指向的文件（逐级删父文件夹 collapsed）并滚动定位。
  function expandToFile(rel) {
    const parts = rel.split('/'); parts.pop(); // 去掉文件名，只留父文件夹链
    let acc = '';
    let changed = false;
    for (const p of parts) { acc = acc ? acc + '/' + p : p; if (collapsed.has(acc)) { collapsed.delete(acc); changed = true; } }
    if (changed) render();
    const row = [...document.querySelectorAll('.sb-file')].find((el) => el.dataset.rel === rel);
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }
  // 激活漏斗（KD-5）：所有激活路径（点标签 / loadTabs 恢复 / finishClose·doDelete·onTreeChanged 回落 /
  // Cmd+T 新标签 / window.open / 历史命中）都收口到这里。web 分支交给 browser-chrome 的 __webActivate;
  // 非 web 分支先 __webDetach 摘掉任何 attach 的 view（否则原生 view 永久盖住编辑器 = blocker #1）,再走原路。
  function openTabRow(entry) {
    const key = keyOf(entry);
    const tracked = tabState.entries.some((e) => keyOf(e) === key);
    if (isWebEntry(entry)) { // 网页标签：交给 browser-chrome 漏斗（显示 chrome + attach/show view 或新标签页）
      // P1#2:统一设激活态。web/temp/no-op 分支原来不设 activeRel → 高亮错标签、Cmd+W 关错标签。
      // openEntry 同时补 open=true(点未打开的置顶书签也能激活)+ 设 activeRel。
      if (tracked) applyTabs(window.WS2Tabs.openEntry(tabState, entry));
      if (window.__webActivate) window.__webActivate(entry);
      return;
    }
    if (window.__webDetach) window.__webDetach(); // 切到任何文档/查看器表面前,先摘掉 web view
    // P1#2:temp/no-op 文档分支下游没有 onOpen 回拨 active → 这里统一设。真文件走 onOpen 会再设一次(幂等)。
    if (tracked) applyTabs(window.WS2Tabs.setActive(tabState, key));
    if (isTempEntry(entry)) { // 临时文档：内容在 shell 的 tempStore，让它重渲染（切标签不丢）
      if (window.__shellReopenTemp) window.__shellReopenTemp(keyOf(entry));
      return;
    }
    if (entry.rel) {
      const n = findNode(entry.rel);
      if (n) { openNode(n); expandToFile(entry.rel); } // 点标签 → 文件树展开到该文件并滚动定位
      return;
    }
    if (entry.kind === 'html' || entry.kind === 'md') openDoc(entry.abs); // 外部标签的可编辑文档（含 md）
    else if (window.__shellShowViewer) window.__shellShowViewer({ abs: entry.abs, rel: null, kind: entry.kind, name: entry.title });
  }

  // ---- 网页标签的创建/激活（KD-9/KD-15/KD-16 的入口都收口到这，全走漏斗）----
  // 新标签页（Cmd+T）：打开「新建」modal（模板 + 顶部地址栏）——输网址浏览、选模板建文档（对齐 ui-demo）。
  function openNewWebTab() { openCreateModal('', { temp: true, omni: true }); }
  // 直接建一个 url=null 的空网页标签（modal 里点「打开空标签页」或程序内调用）。无工作区也可建（浏览不依赖工作区）。
  function openBlankWebTab() {
    const id = nextWebId();
    applyTabs(window.WS2Tabs.openEntry(tabState, { abs: id, kind: 'web', title: '新标签页', url: null }));
    openTabRow(tabState.entries.find((e) => keyOf(e) === id));
  }
  // 带 URL 开网页标签（omnibox / window.open / 历史命中 / 外部链接）：建 entry(有 url),前台则激活。无工作区也可建。
  function openWebTabUrl(url, background) {
    if (!url) return;
    const prevActive = tabState.activeRel;
    const id = nextWebId();
    let next = window.WS2Tabs.openEntry(tabState, { abs: id, kind: 'web', title: url, url });
    if (background) next = { entries: next.entries, activeRel: prevActive }; // P2#3:后台标签不抢激活态(否则高亮跳走、Cmd+W 关错)
    applyTabs(next);
    if (background) { window.ws2.webLoad(id, url); } // 后台:主进程建 view 后台加载,不 show;不激活
    else openTabRow(tabState.entries.find((e) => keyOf(e) === id));
  }
  // browser-chrome 首次导航后回调：url=null 的新标签页原地变真网页标签 → 更新 entry.url + 落盘。
  window.__sbWebNavigated = (key, url) => {
    applyTabs(window.WS2Tabs.updateEntry(tabState, key, { url, title: url }));
  };
  // browser-chrome 推来 web 标签状态（title/favicon/loading/audible/error）→ 更新缓存 + 标签行（含 entry.title/url 落盘）。
  window.__sbWebStatus = (s) => {
    webStatus[s.key] = { favicon: s.favicon, loading: s.loading, audible: s.audible, error: s.error };
    const e = tabState.entries.find((x) => keyOf(x) === s.key);
    if (e && (s.title || s.url)) {
      const patch = {};
      if (s.title) patch.title = s.title;
      if (s.url != null) patch.url = s.url;
      applyTabs(window.WS2Tabs.updateEntry(tabState, s.key, patch));
    } else {
      renderZones(); // 只刷图标态（favicon/spinner/喇叭/错误）,不动 entry
    }
  };
  window.__sbOpenWebTab = (url, background) => openWebTabUrl(url, background);
  // 新标签页 surface 上的入口：新建文档（走老模板台）/ 打开文件夹。
  window.__sbNewDoc = () => { if (current) openCreateModal('', { temp: true }); };
  // 网页存成本地文档（融合桥）:在工作区根建一个 .html、刷新树、用编辑器打开。需要工作区。
  window.__sbHasWorkspace = () => !!current;
  window.__sbToast = (msg) => showToast(msg);
  window.__sbClipToDoc = async (name, html, note) => {
    if (!current) return;
    try {
      const r = await window.ws2.wsNewDoc('', name, html);
      await refresh();
      if (r && r.abs) { openDoc(r.abs); showToast((note || '已把网页存成文档：') + name); }
    } catch (e) { showToast('保存失败'); }
  };
  const webStatus = Object.create(null); // key -> { favicon, loading, audible, error }（browser-chrome 经 __sbWebStatus 喂）
  function tabRow(entry, zone) {
    const key = keyOf(entry);
    const temp = isTempEntry(entry);
    const web = isWebEntry(entry);
    const external = isExternal(entry) && !temp && !web; // 临时文档/网页标签都不算「工作区外」，不显示 ↗ 标记
    const row = document.createElement('div');
    row.className = 'sb-row sb-tab sb-kind-' + (entry.kind || 'other') + (external ? ' sb-tab-ext' : '') + (temp ? ' sb-tab-temp' : '') + (web ? ' sb-tab-web' : '');
    row.dataset.rel = key; // 属性名沿用 data-rel（e2e 选择器靠它）；值=keyOf（内部=rel、外部=abs、网页=web:id）
    row.setAttribute('role', 'button');
    row.draggable = true;
    if (external) row.title = entry.abs; // 外部标签悬停显完整绝对路径
    if (key === tabState.activeRel) row.classList.add('is-active');
    const ico = document.createElement('span');
    ico.className = 'sb-ico';
    if (web) {
      // 网页标签图标位：加载中→spinner；有 favicon→图；否则地球通用图标（favicon 拉取失败是高频态）
      const st = webStatus[key] || {};
      if (st.loading) { ico.innerHTML = '<span class="sb-tab-spinner"></span>'; }
      else if (st.favicon) { const img = document.createElement('img'); img.className = 'sb-tab-fav'; img.src = st.favicon; img.onerror = () => { ico.innerHTML = kindSvg('web'); }; ico.innerHTML = ''; ico.append(img); }
      else ico.innerHTML = kindSvg('web');
    } else {
      ico.innerHTML = kindSvg(entry.kind); // T8：标签也按类型换形状（跟树一套）
    }
    const name = document.createElement('span');
    name.className = 'sb-name ws-truncate';
    name.textContent = entry.title; // textContent：网页 title 是不可信内容,只走文本插入（KD-4）
    name.title = external ? entry.abs : (web && entry.url ? entry.url : entry.title); // 网页悬停显 URL
    row.append(ico, name);
    if (web) {
      const st = webStatus[key] || {};
      if (st.audible) { const a = document.createElement('span'); a.className = 'sb-tab-audio'; a.title = '正在播放音频'; a.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>'; row.append(a); }
      if (st.error) { const er = document.createElement('span'); er.className = 'sb-tab-err'; er.title = '加载失败'; er.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>'; row.append(er); }
    }
    if (external) {
      const ext = document.createElement('span');
      ext.className = 'sb-tab-ext-ico';
      ext.title = '工作区外的文件';
      ext.innerHTML = EXT_ICO_SVG;
      row.append(ext);
    }
    // 未保存点（对齐 ui-demo arc-tab-dot：行尾 7px accent 圆点，hover 让位给按钮）：
    // 临时文档常显；活跃的脏真文件也显（自动保存的 1.2s 间隙 / 保存失败时有提示）——shell 脏态变化经
    // __sbHooks.onDirtyChange 同步开关，非活跃真文件切走前必经保存守卫、无脏态。
    const dot = document.createElement('span');
    dot.className = 'sb-tab-dot';
    dot.title = temp ? '未保存（还没存进文件夹）' : '有未保存的修改';
    if (!temp && !(key === tabState.activeRel && window.__shellIsDirty && window.__shellIsDirty())) dot.hidden = true;
    row.append(dot);
    if (!temp) { // 临时文档不能置顶（置顶持久化、临时文档重启即弃）
      const pin = document.createElement('button');
      pin.className = 'sb-tab-pin' + (entry.pinned ? ' is-pinned' : '');
      pin.title = entry.pinned ? '取消置顶' : '置顶';
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
    x.title = zone === 'pinned' ? '移出置顶' : '关闭';
    x.innerHTML = X_SVG;
    x.onclick = (e) => {
      e.stopPropagation();
      (zone === 'pinned' ? removeTabRel : closeTabRel)(key);
    };
    row.append(x);
    row.onclick = () => openTabRow(entry);
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
  function zoneHeader(text, onPlus) {
    const head = document.createElement('div');
    head.className = 'sb-zone-head';
    const label = document.createElement('span');
    label.className = 'sb-sec-label';
    label.textContent = text;
    head.appendChild(label);
    if (onPlus) {
      const plus = document.createElement('button');
      plus.className = 'sb-zone-add';
      plus.title = '新建文档';
      plus.innerHTML = PLUS_SVG;
      plus.onclick = onPlus;
      head.appendChild(plus);
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
    pinnedEl.innerHTML = '';
    pinnedEl.hidden = false;
    pinnedEl.appendChild(zoneHeader('置顶', null));
    const plist = zoneList('pinned');
    if (pinned.length) for (const e of pinned) plist.appendChild(tabRow(e, 'pinned'));
    else plist.appendChild(zoneHint('把标签页拖到这里置顶', 'sb-zone-hint-drop')); // 虚线框空态（对齐 ui-demo arc-tabs-empty：看得出是可拖入目标）
    pinnedEl.appendChild(plist);

    tabsEl.innerHTML = '';
    tabsEl.hidden = false;
    tabsEl.appendChild(zoneHeader('标签页', () => openNewWebTab()));
    const tlist = zoneList('tabs');
    if (tabs.length) for (const e of tabs) tlist.appendChild(tabRow(e, 'tabs'));
    else tlist.appendChild(zoneHint('没有打开的标签'));
    tabsEl.appendChild(tlist);
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

  // 侧栏头作根目录 drop 目标：拖文件到这里 = 移到工作区根。
  const headEl = document.querySelector('.sb-head');
  if (headEl) {
    headEl.ondragover = (e) => {
      if (!dragNode || parentDirOf(dragNode.rel) === '') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      headEl.classList.add('sb-drop');
    };
    headEl.ondragleave = (e) => {
      if (!headEl.contains(e.relatedTarget)) headEl.classList.remove('sb-drop');
    };
    headEl.ondrop = (e) => {
      if (!dragNode) return;
      e.preventDefault();
      headEl.classList.remove('sb-drop');
      doMove(dragNode, '');
    };
  }

  // ---- 轻量 toast（删除「撤销」用）。CSP 安全：classes，无 inline style。----
  let toastTimer = null;
  function showToast(message, actionLabel, onAction) {
    let host = document.getElementById('sb-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'sb-toast-host';
      host.className = 'sb-toast-host';
      document.body.appendChild(host);
    }
    host.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'sb-toast';
    const msg = document.createElement('span');
    msg.textContent = message;
    t.appendChild(msg);
    if (actionLabel && onAction) {
      const btn = document.createElement('button');
      btn.className = 'sb-toast-action';
      btn.textContent = actionLabel;
      btn.onclick = () => {
        clearTimeout(toastTimer);
        host.innerHTML = '';
        onAction();
      };
      t.appendChild(btn);
    }
    host.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      host.innerHTML = '';
    }, 6500);
  }

  // ---- 新建文档：模板选择台（空文档第一 + 内置模板，无 AI）。----
  // opts.temp：从「标签页 +」/ Cmd+T 来 → 建临时文档（不落盘，手动保存才进文件夹）；
  // 否则（文件夹 hover-+ / 右键新建）落点 dirRel、直接落盘。
  async function openCreateModal(dirRel, opts) {
    const temp = !!(opts && opts.temp);
    const omni = !!(opts && opts.omni); // Cmd+T：顶部加地址栏——输网址浏览、选模板建文档（对齐 ui-demo cm-omni）
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
    modal.className = 'sb-modal' + (omni ? ' sb-modal-omni' : '');
    // 顶部地址栏（omni 模式）：globe 图标 + 输入 + 「⏎ 打开」提示 + 关闭 X。Enter=新建网页标签浏览并关弹窗。
    if (omni) {
      const bar = document.createElement('div');
      bar.className = 'cm-omnibar';
      const gico = document.createElement('span');
      gico.className = 'cm-omnibar-ico';
      gico.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
      const uin = document.createElement('input');
      uin.className = 'cm-omnibar-input';
      uin.type = 'text'; uin.placeholder = '搜索，或输入网址'; uin.spellcheck = false;
      const kbd = document.createElement('span');
      kbd.className = 'cm-omnibar-kbd'; kbd.textContent = '⏎ 打开'; kbd.hidden = true;
      uin.addEventListener('input', () => { kbd.hidden = !uin.value.trim(); });
      uin.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && uin.value.trim()) {
          e.preventDefault();
          const parsed = window.WS2UrlInput.parse(uin.value);
          close();
          if (parsed.kind === 'blocked') return;
          if (parsed.kind === 'url' || parsed.kind === 'search') openWebTabUrl(parsed.url, false);
        }
      });
      const x = document.createElement('button');
      x.className = 'ws-modal-x cm-omnibar-x'; x.title = '关闭'; x.setAttribute('aria-label', '关闭');
      x.innerHTML = X_SVG16; x.onclick = close;
      bar.append(gico, uin, kbd, x);
      modal.appendChild(bar);
      setTimeout(() => uin.focus(), 0);
    }
    const head = omni ? null : modalHead('新建文档', temp
      ? '新建的是临时文档，编辑后保存时再选存到哪个文件夹'
      : '在 ' + (current ? current.name : '') + (dirRel ? ' / ' + dirRel : ''), close);
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
          const id = window.__shellNewTemp('未命名', t.html);
          if (id) openTabEntry({ abs: id, kind: 'html', title: '未命名' });
          return;
        }
        const r = await window.ws2.wsNewDoc(dirRel || '', '未命名', t.html);
        await refresh();
        if (r && r.abs) openDoc(r.abs);
      };
      grid.appendChild(card);
    }
    const body = modalBody();
    if (omni) {
      const label = document.createElement('div');
      label.className = 'cm-pane-label';
      label.textContent = '或新建文档';
      body.appendChild(label);
    }
    body.appendChild(grid);
    if (head) modal.appendChild(head);
    modal.appendChild(body);
    overlay.appendChild(modal);
    wireOverlayClose(overlay, close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }

  // ---- Cmd+P 命令面板（对齐 ui-demo FindPalette）：顶部锚定浮层，模糊搜文件名/路径，↑↓ 选、Enter 开、Esc 关。----
  const SEARCH_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>';
  function openFindPalette() {
    if (document.getElementById('fp-overlay')) return; // 已开着，别叠一层
    // 不再要求工作区(U6 尾):没开文件夹也能搜浏览历史(历史是全局的,像 Chrome 地址栏)。
    const allFiles = [];
    if (current) (function walk(nodes) { for (const n of nodes) { if (n.isDir) walk(n.children || []); else allFiles.push(n); } })(current.tree);
    let q = '', sel = 0, hits = [];
    // 浏览历史(全局,主进程权威副本)。异步到货后重算——先渲染文件,历史晚一拍补进来。
    let webHist = [];
    if (window.ws2.wsGetWebHistory) {
      window.ws2.wsGetWebHistory().then((h) => {
        if (!document.getElementById('fp-overlay')) return; // 面板已关,别动 DOM
        webHist = Array.isArray(h) ? h : [];
        computeHits(); renderList();
      }).catch(() => {});
    }
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
    input.className = 'fp-input'; input.type = 'text'; input.placeholder = '搜索文件与浏览历史…'; input.spellcheck = false;
    const hint = document.createElement('span'); hint.className = 'fp-hint'; hint.textContent = '⏎ 打开';
    bar.append(ico, input, hint);
    const list = document.createElement('div');
    list.className = 'fp-list';
    panel.append(bar, list);
    overlay.appendChild(panel);
    overlay.onmousedown = (e) => { if (e.target === overlay) close(); };
    function computeHits() {
      const term = q.trim().toLowerCase();
      const matched = term ? allFiles.filter((n) => n.name.toLowerCase().includes(term) || n.rel.toLowerCase().includes(term)) : allFiles;
      // 历史混排:有词=文件优先(≤8)+历史命中(≤4);空词=文件照旧,没工作区时给最近历史打底(面板别空着)。
      let webRows = [];
      if (term) {
        webRows = webHist
          .filter((e) => e && ((e.title || '').toLowerCase().includes(term) || (e.url || '').toLowerCase().includes(term)))
          .slice(0, 4)
          .map((e) => ({ web: true, url: e.url, title: e.title || e.url }));
      } else if (!allFiles.length) {
        webRows = webHist.slice(0, 8).map((e) => ({ web: true, url: e.url, title: e.title || e.url }));
      }
      hits = [...matched.slice(0, term && webRows.length ? 8 : 12), ...webRows];
      if (sel >= hits.length) sel = Math.max(0, hits.length - 1);
    }
    function highlight() { [...list.querySelectorAll('.fp-row')].forEach((r, i) => r.classList.toggle('is-sel', i === sel)); }
    function scrollSel() { const r = list.querySelectorAll('.fp-row')[sel]; if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' }); }
    function renderList() {
      list.innerHTML = '';
      if (!hits.length) {
        const empty = document.createElement('div'); empty.className = 'fp-empty'; empty.textContent = '没有匹配的文件或历史';
        list.appendChild(empty);
        return;
      }
      hits.forEach((n, i) => {
        const row = document.createElement('button');
        row.className = 'fp-row' + (i === sel ? ' is-sel' : '');
        const ic = document.createElement('span'); ic.className = 'fp-row-ico'; ic.innerHTML = kindSvg(n.web ? 'web' : n.kind); // T8：命令面板行也按类型换形状;历史行=地球
        const nm = document.createElement('span'); nm.className = 'fp-name ws-truncate'; nm.textContent = n.web ? n.title : n.name;
        const sub = document.createElement('span'); sub.className = 'fp-sub ws-truncate'; sub.textContent = n.web ? n.url : n.rel;
        row.append(ic, nm, sub);
        row.onmouseenter = () => { sel = i; highlight(); };
        row.onclick = () => choose(n);
        list.appendChild(row);
      });
    }
    function choose(node) {
      if (!node) return;
      close();
      if (node.web) { openWebTabUrl(node.url, false); return; } // 历史命中:开(或复用)网页标签浏览
      openNode(node);           // .html 进编辑器 / 其余进查看器（同点树节点）
      expandToFile(node.rel);   // 顺带在树里展开定位（F6）
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
  const reopenBtn = document.getElementById('sb-reopen');
  // body.is-sb-collapsed 让编辑区那颗悬浮「展开」按钮现身（侧栏全隐后自己的 toggle 也没了）。
  function setSidebarCollapsed(v) {
    if (!sidebarEl) return;
    sidebarEl.classList.toggle('is-collapsed', v);
    document.body.classList.toggle('is-sb-collapsed', v);
    // 侧栏宽度变 → 编辑区 iframe 横移 → 编辑器宿主浮层重定位 + web view 重发 bounds（否则原生 view 停在旧位、
    // 露出空白条,adversarial:__webRebound 原来零调用=死钩）。都等下一帧布局落定再调。
    requestAnimationFrame(() => { if (window.__shellReposition) window.__shellReposition(); if (window.__webRebound) window.__webRebound(); });
  }
  function toggleCollapsed() { if (sidebarEl) setSidebarCollapsed(!sidebarEl.classList.contains('is-collapsed')); }
  if (toggleBtn) toggleBtn.onclick = toggleCollapsed;
  if (reopenBtn) reopenBtn.onclick = () => setSidebarCollapsed(false);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      toggleCollapsed();
    }
  });

  // 侧栏宽度可拖拽（UX5 / Wendi F1）：右边界拖拽柄改 --sb-width（夹 min/max），存 localStorage、重启恢复。
  const SB_MIN = 180, SB_MAX = 520, SB_KEY = 'ws2-sb-width';
  (function initSidebarResize() {
    if (!sidebarEl) return;
    const saved = parseInt(localStorage.getItem(SB_KEY), 10);
    if (saved >= SB_MIN && saved <= SB_MAX) sidebarEl.style.setProperty('--sb-width', saved + 'px');
    const handle = document.getElementById('sb-resize');
    if (!handle) return;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = sidebarEl.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      const onMove = (ev) => {
        const w = Math.max(SB_MIN, Math.min(SB_MAX, startW + (ev.clientX - startX)));
        sidebarEl.style.setProperty('--sb-width', w + 'px');
        if (window.__webRebound) window.__webRebound(); // 拖拽分隔条时 web view 跟随(rAF 合并,adversarial)
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
  // abs 不在当前树里（从「打开」按钮选的、macOS /private 软链让 abs 字符串对不上、或刚建还没 refresh）：
  // 主进程把 abs 归一化算 workspace 内 rel（kindOf 只在主进程有）。是工作区内 → 建 rel 标签；
  // 工作区外 rel=null → 建 abs 身份的外部标签（像浏览器开标签页）。竞态守卫放 rel 判定之前，对两条分支都生效。
  async function openTabFromAbs(abs) {
    const rootBefore = current && current.root;
    let meta = null;
    try { meta = await window.ws2.classifyFile(abs); } catch (e) { return; }
    if (!meta || !current || current.root !== rootBefore) return; // await 期间切了工作区 → 放弃
    if (meta.rel) {
      openTabEntry({ rel: meta.rel, kind: meta.kind || 'other', title: meta.name || meta.rel.split('/').pop() });
    } else {
      openTabEntry({ rel: null, abs, kind: meta.kind || 'other', title: meta.name || baseName(abs) });
    }
  }
  // shell.js 用的钩子：打开文件 → 树高亮 + 建/激活标签。命中树节点走同步快路；没命中（工作区内但 abs 对不上、
  // 或工作区外）走 openTabFromAbs 异步兜底（工作区外不建标签）。
  // 工作区根的外部磁盘变化（主进程 workspace-watcher 去抖后发 ws-tree-changed）：重读树 + reconcile 标签。
  // 关键：先用「变化前的内存旧树」（current.tree，此刻磁盘已变但内存还列着消失的文件）给内部标签补 inode，
  // 再读新树——这样不用在每处建标签时穿 ino，消失文件的 ino 也一定取得到，给「改名/移动→标签跟随」做匹配。
  async function onTreeChanged() {
    if (!current) return;
    const rootBefore = current.root;
    for (const e of tabState.entries) {
      if (e.rel) { const n = findNode(e.rel); if (n && n.ino != null) e.ino = n.ino; }
    }
    const data = await window.ws2.wsReadTree();
    if (!data || !current || current.root !== rootBefore) return; // 期间切了工作区 → 放弃
    const relSet = new Set();
    const inoToRel = new Map();
    (function w(nodes) {
      for (const n of nodes) {
        if (n.isDir) w(n.children || []);
        else { relSet.add(n.rel); if (n.ino != null) inoToRel.set(String(n.ino), n.rel); }
      }
    })(data.tree);
    // 文件集合没变（只是某文件内容被改了，如保存）→ 不重渲染树：免得打断进行中的内联改名/拖拽，也省 DOM 重建。
    const oldRels = new Set();
    (function w(nodes) { for (const n of nodes) { if (n.isDir) w(n.children || []); else oldRels.add(n.rel); } })(current.tree);
    const sameStructure = oldRels.size === relSet.size && [...relSet].every((r) => oldRels.has(r));
    current = data; // 总更新：保持树/ino 新鲜（即使不重渲染）
    if (sameStructure) return;
    // 结构变了（增/删/改名/移动）→ reconcile 标签 + 重渲染 + 同步编辑器
    const prevEntry = tabState.entries.find((e) => keyOf(e) === tabState.activeRel);
    const activeRelGone = prevEntry && prevEntry.rel && !relSet.has(prevEntry.rel);
    const activeIno = prevEntry && prevEntry.ino;
    tabState = window.WS2Tabs.reconcileTree(tabState, relSet, inoToRel);
    persistTabs();
    render();
    renderZones();
    renderRail();
    if (activeRelGone) {
      const newRel = activeIno != null ? inoToRel.get(String(activeIno)) : undefined;
      if (newRel) {
        const n = findNode(newRel); // 激活文档被外部改名/移动 → 编辑器重指向（保内容/脏态），不重载
        if (n && window.__shellRetargetDoc) window.__shellRetargetDoc(n.abs, n.name);
      } else {
        const e = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
        if (e) openTabRow(e); // 激活文档被外部删 → 回落到新激活项
        else if (window.__shellCloseDoc) window.__shellCloseDoc(); // 没得回落 → 空态
      }
    }
  }

  window.__sbHooks = {
    // shell 脏态变化 → 同步活跃真文件标签的未保存点（T2 arc-tab-dot；临时文档的点常显、不经这里）
    onDirtyChange: (d) => {
      document.querySelectorAll('.sb-tab.is-active:not(.sb-tab-temp) .sb-tab-dot').forEach((el) => { el.hidden = !d; });
    },
    pickFolder: () => pickFolder(), // ⋯ 菜单/菜单栏「打开文件夹…」（单文件模式也要有开工作区的入口）
    onOpen: async (abs) => {
      // 等启动恢复整条跑完再建标签：冷启动时这一句让 open-file 排在 loadTabs 之后，标签不再被覆盖/中止。
      // 热路径（app 已开）restoreReady 早已 resolved，await 立即过、不阻塞。文档内容由 shell.openDoc
      // 已经先载入了，这里只补标签，不影响打开速度。
      await restoreReady;
      const node = abs ? findNodeByAbs(abs) : null;
      // Wendi 2026-07-03：外部（Finder 双击等）打开工作区内文件 → 树展开到所在文件夹并滚动定位。
      // 树默认全收起，不展开的话文件在树里根本不可见、也高亮不上（is-active 行没渲染出来）。
      // 先展开（内部会 render 重建行）再高亮，顺序不能反。命令面板/「打开」按钮同走此路，行为一致。
      if (node) {
        // 筛选词挡住目标文件时先清筛选（外部打开是显式意图，优先于残留筛选词）——否则过滤树里
        // 该行根本不渲染，展开/滚动/高亮三个动作全部静默落空（审计发现）
        if (query && !treeEl.querySelector('.sb-file[data-rel="' + cssAttr(node.rel) + '"]')) {
          query = '';
          if (filterInput) filterInput.value = '';
          const fc = document.getElementById('sb-filter-clear');
          if (fc) fc.hidden = true;
          render();
        }
        expandToFile(node.rel);
      }
      highlightActive(abs);
      if (node) {
        openTabEntry({ rel: node.rel, kind: node.kind || 'other', title: node.name });
      } else if (abs) {
        await openTabFromAbs(abs);
      }
      window.__pendingColdOpen = null; // 标签已建，撤销 loadTabs 的「别抢 viewer」抑制
    },
    refresh,
    // Cmd+T：新建网页标签（KD-9,传统浏览器习惯）——新标签页 surface 地址栏聚焦,下方留「新建文档」入口。
    newTab: () => openNewWebTab(),
    // Cmd+W：有活跃标签关标签；无标签但还有内容（工作区外查看器 / 单文件模式的文档）先关内容回空态；
    // 真·空态 → 关窗口（Wendi 2026-07-03：macOS=隐藏驻留、后台开着；Windows/Linux 按平台惯例退出）。
    closeActiveTab: () => {
      // 弹层开着（保存到哪里/关闭确认）时 Cmd+W 不做分层动作：菜单加速器不被 DOM 弹层拦，
      // 不守这行会叠出第二层确认框、两边对同一文档双执行（审计发现）
      if (document.querySelector('.sb-modal-overlay')) return;
      if (tabState.activeRel) { closeTabRel(tabState.activeRel); return; }
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
  // 外部磁盘变化实时跟随：watcher 推送（mac/win 原生）+ 窗口重新聚焦兜底（从 Finder 切回来时补刷一次，
  // 兼顾 watcher 在某平台失灵 / 偶尔漏事件）。
  if (window.ws2.onWsTreeChanged) window.ws2.onWsTreeChanged(onTreeChanged);
  window.addEventListener('focus', () => { if (current) onTreeChanged(); });

  // 侧栏始终显示（对齐 ui-demo：omnibox + 标签栏常在,不再「无工作区就整个隐藏」）。renderZones 让标签/置顶区可见。
  (function ensureShellAlwaysOn() {
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.add('sb-on');
    const emptyHint = document.getElementById('sb-empty');
    if (emptyHint) emptyHint.hidden = true; // 老「打开文件夹」占位收起（头部图标 + NewTab 页都有入口）
    renderZones();
  })();

  // 启动恢复上次工作区。await setWorkspace（含 loadTabs）整条跑完才 resolveRestore，
  // 让冷启动的 open-file 建标签等在这后面（无工作区 / 出错也要 resolve，否则 onOpen 永久挂起）。
  (async () => {
    let hadWorkspace = false;
    try {
      const root = await window.ws2.wsGetRoot();
      if (root) {
        const data = await window.ws2.wsReadTree();
        if (data) { await setWorkspace(data); hadWorkspace = true; }
      }
    } catch (e) {
      /* 无工作区 / 已不存在：保持空态 */
    } finally {
      // 无工作区也要显示全局网页标签(Colin 拍板:浏览不依赖工作区),并恢复上次激活的网页(浏览状态自足,像 Chrome)。
      // 有工作区时 loadTabs 已合并过全局 web。
      if (!hadWorkspace) {
        let web = { entries: [], activeKey: null };
        try { web = (await window.ws2.wsGetWebTabs()) || web; } catch (e2) { /* keep default */ }
        const entries = web.entries || [];
        const activeRel = window.WS2Tabs.resolveActive(entries, web.activeKey);
        tabState = { entries, activeRel };
        renderZones();
        if (activeRel && !window.__pendingColdOpen) {
          const e = entries.find((x) => keyOf(x) === activeRel);
          if (e) openTabRow(e); // 恢复上次看的网页(走漏斗,activeWebEntry 同步)
        }
      }
      resolveRestore();
      // 开屏空态（对齐 ui-demo）：没有工作区/没有恢复出激活标签/没有冷启动文件在路上 → 显示 NewTab 页,
      // 而不是空白「打开文档/文件夹」选择屏。有工作区但无激活标签也显示 NewTab（内容区不留空）。
      // ⚠ browser-chrome.js 可能还没定义 __webShowEmpty（脚本加载/异步顺序不定）→ 用 pending 标志,
      // browser-chrome 加载完自己兜底消费；此刻已就绪就直接调。
      const hasActive = tabState.activeRel != null;
      const hasDoc = window.__shellDocPath && window.__shellDocPath();
      if (!hasActive && !hasDoc && !window.__pendingColdOpen) {
        if (window.__webShowEmpty) window.__webShowEmpty();
        else window.__pendingEmptyState = true;
      }
    }
  })();
})();
