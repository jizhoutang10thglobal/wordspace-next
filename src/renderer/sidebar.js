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
    current = data;
    query = '';
    tabState = { entries: [], activeRel: null }; // 先清旧工作区的标签，loadTabs 再按新根拉回
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
    const wasOpen = !node.isDir && openPath() === node.abs;
    const r = await window.ws2.wsRename(node.rel, newLeaf);
    if (wasOpen && window.__shellRetargetDoc) window.__shellRetargetDoc(r.abs, r.rel.split('/').pop());
    if (r.rel !== node.rel) retargetTabsUnder(node.rel, r.rel, node.isDir); // 标签跟随改名
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
    // 带上当前 root：主进程校验 === activeRoot，防 fire-and-forget 的写在切工作区后到达、把标签写错桶。
    // 临时文档不落盘、重启无从恢复 → 从持久化副本里剔掉（内存里的 tabState 仍保留它们，只是不写盘）。
    if (!window.ws2.wsSetTabs) return;
    const clean = {
      entries: tabState.entries.filter((e) => !isTempEntry(e)),
      activeRel: isTempKey(tabState.activeRel) ? null : tabState.activeRel,
    };
    window.ws2.wsSetTabs(clean, current && current.root).catch(() => {});
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
  // 关/删一条标签：关激活的「临时文档 / 有未保存改动的真文件」→ 弹未保存确认 modal（对齐 ui-demo）；
  // 否则直接关 + 回落。op = closeEntry（标签页区的 ×）/ removeEntry（置顶区的 ×）。
  function closeOrRemove(key, op) {
    const wasActive = tabState.activeRel === key;
    const entry = tabState.entries.find((e) => keyOf(e) === key);
    const dirtyActive = wasActive && window.__shellIsDirty && window.__shellIsDirty();
    if (wasActive && (isTempEntry(entry) || dirtyActive)) {
      openCloseConfirm(key, op, entry);
      return;
    }
    finishClose(key, op);
  }
  // 真正执行关/移出 + 回落（未保存确认已在上游处理）。临时文档丢弃其内容 + 清脏；真文件确认丢弃后清脏。
  function finishClose(key, op) {
    const wasActive = tabState.activeRel === key;
    const entry = tabState.entries.find((e) => keyOf(e) === key);
    if (entry && isTempEntry(entry)) { if (window.__shellDiscardTemp) window.__shellDiscardTemp(key); }
    else if (wasActive && window.__shellDiscard) window.__shellDiscard();
    applyTabs(op(tabState, key));
    if (wasActive) {
      const e = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
      if (e) openTabRow(e); // 回落项可能是外部/临时标签 → 走统一分发
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
      if (temp) { openSaveModal(true); return; } // 临时 → 选文件夹存，存完自动关
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
    let st;
    try { st = await window.ws2.wsGetTabs(); } catch (e) { st = { entries: [], activeRel: null }; }
    if (!current || current.root !== rootBefore) return;
    const raw = st.entries || [];
    const checks = await Promise.all(raw.map((e) =>
      e.rel ? Promise.resolve(!!findNode(e.rel)) : window.ws2.pathExists(e.abs).catch(() => false),
    ));
    if (!current || current.root !== rootBefore) return;
    const entries = raw.filter((_e, i) => checks[i]);
    const activeRel = window.WS2Tabs.resolveActive(entries, st.activeRel);
    const changed = entries.length !== raw.length || activeRel !== st.activeRel;
    tabState = { entries, activeRel };
    if (changed) persistTabs();
    renderZones();
    renderRail();
    // 有冷启动 open-file 在路上（用户刚双击的文件该占 viewer）→ 别把上次激活的标签开进 viewer 抢走它；
    // 标签状态仍恢复，只是不自动载入。onOpen 随后会把冷启动文件设为激活。
    if (activeRel && !window.__pendingColdOpen) {
      const e = tabState.entries.find((x) => keyOf(x) === activeRel);
      if (e) openTabRow(e); // 内部走 findNode→openNode、外部走 abs 分发
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
  function openTabRow(entry) {
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
  function tabRow(entry, zone) {
    const key = keyOf(entry);
    const temp = isTempEntry(entry);
    const external = isExternal(entry) && !temp; // 临时文档不算「工作区外」，不显示 ↗ 标记
    const row = document.createElement('div');
    row.className = 'sb-row sb-tab sb-kind-' + (entry.kind || 'other') + (external ? ' sb-tab-ext' : '') + (temp ? ' sb-tab-temp' : '');
    row.dataset.rel = key; // 属性名沿用 data-rel（e2e 选择器靠它）；值=keyOf（内部=rel、外部=abs）
    row.setAttribute('role', 'button');
    row.draggable = true;
    if (external) row.title = entry.abs; // 外部标签悬停显完整绝对路径
    if (key === tabState.activeRel) row.classList.add('is-active');
    const ico = document.createElement('span');
    ico.className = 'sb-ico';
    ico.innerHTML = kindSvg(entry.kind); // T8：标签也按类型换形状（跟树一套）
    const name = document.createElement('span');
    name.className = 'sb-name ws-truncate';
    name.textContent = entry.title;
    name.title = external ? entry.abs : entry.title; // 截断时悬停显全名（外部标签显完整绝对路径）
    row.append(ico, name);
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
    tabsEl.appendChild(zoneHeader('标签页', () => openCreateModal('', { temp: true })));
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
    const head = modalHead('新建文档', temp
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
    if (!current) return; // 没工作区没得搜
    if (document.getElementById('fp-overlay')) return; // 已开着，别叠一层
    const allFiles = [];
    (function walk(nodes) { for (const n of nodes) { if (n.isDir) walk(n.children || []); else allFiles.push(n); } })(current.tree);
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
    input.className = 'fp-input'; input.type = 'text'; input.placeholder = '按文件名查找…'; input.spellcheck = false;
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
      hits = matched.slice(0, 12);
      if (sel >= hits.length) sel = Math.max(0, hits.length - 1);
    }
    function highlight() { [...list.querySelectorAll('.fp-row')].forEach((r, i) => r.classList.toggle('is-sel', i === sel)); }
    function scrollSel() { const r = list.querySelectorAll('.fp-row')[sel]; if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' }); }
    function renderList() {
      list.innerHTML = '';
      if (!hits.length) {
        const empty = document.createElement('div'); empty.className = 'fp-empty'; empty.textContent = '没有匹配的文件';
        list.appendChild(empty);
        return;
      }
      hits.forEach((n, i) => {
        const row = document.createElement('button');
        row.className = 'fp-row' + (i === sel ? ' is-sel' : '');
        const ic = document.createElement('span'); ic.className = 'fp-row-ico'; ic.innerHTML = kindSvg(n.kind); // T8：命令面板行也按类型换形状
        const nm = document.createElement('span'); nm.className = 'fp-name ws-truncate'; nm.textContent = n.name;
        const sub = document.createElement('span'); sub.className = 'fp-sub ws-truncate'; sub.textContent = n.rel;
        row.append(ic, nm, sub);
        row.onmouseenter = () => { sel = i; highlight(); };
        row.onclick = () => choose(n);
        list.appendChild(row);
      });
    }
    function choose(node) {
      if (!node) return;
      close();
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
    // 侧栏宽度变 → 编辑区 iframe 横移 → 编辑器宿主浮层重定位（等下一帧布局落定再调）。
    if (window.__shellReposition) requestAnimationFrame(() => window.__shellReposition());
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
    onOpen: async (abs) => {
      // 等启动恢复整条跑完再建标签：冷启动时这一句让 open-file 排在 loadTabs 之后，标签不再被覆盖/中止。
      // 热路径（app 已开）restoreReady 早已 resolved，await 立即过、不阻塞。文档内容由 shell.openDoc
      // 已经先载入了，这里只补标签，不影响打开速度。
      await restoreReady;
      const node = abs ? findNodeByAbs(abs) : null;
      // Wendi 2026-07-03：外部（Finder 双击等）打开工作区内文件 → 树展开到所在文件夹并滚动定位。
      // 树默认全收起，不展开的话文件在树里根本不可见、也高亮不上（is-active 行没渲染出来）。
      // 先展开（内部会 render 重建行）再高亮，顺序不能反。命令面板/「打开」按钮同走此路，行为一致。
      if (node) expandToFile(node.rel);
      highlightActive(abs);
      if (node) {
        openTabEntry({ rel: node.rel, kind: node.kind || 'other', title: node.name });
      } else if (abs) {
        await openTabFromAbs(abs);
      }
      window.__pendingColdOpen = null; // 标签已建，撤销 loadTabs 的「别抢 viewer」抑制
    },
    refresh,
    newTab: () => { if (current) openCreateModal('', { temp: true }); },              // Cmd+T：新建临时文档（无工作区时不建，没地方保存）
    // Cmd+W：有活跃标签关标签；无标签但还有内容（工作区外查看器 / 单文件模式的文档）先关内容回空态；
    // 真·空态 → 关窗口（Wendi 2026-07-03：macOS=隐藏驻留、后台开着；Windows/Linux 按平台惯例退出）。
    closeActiveTab: () => {
      if (tabState.activeRel) { closeTabRel(tabState.activeRel); return; }
      const v = document.getElementById('viewer');
      const hasDoc = window.__shellDocPath && window.__shellDocPath();
      if ((v && !v.hidden) || hasDoc) { if (window.__shellCloseDoc) window.__shellCloseDoc(); return; }
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

  // 启动恢复上次工作区。await setWorkspace（含 loadTabs）整条跑完才 resolveRestore，
  // 让冷启动的 open-file 建标签等在这后面（无工作区 / 出错也要 resolve，否则 onOpen 永久挂起）。
  (async () => {
    try {
      const root = await window.ws2.wsGetRoot();
      if (root) {
        const data = await window.ws2.wsReadTree();
        if (data) await setWorkspace(data);
      }
    } catch (e) {
      /* 无工作区 / 已不存在：保持空态 */
    } finally {
      resolveRestore();
    }
  })();
})();
