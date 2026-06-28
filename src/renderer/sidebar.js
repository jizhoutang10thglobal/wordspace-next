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
    rootNameEl.textContent = data.name;
    rootNameEl.title = data.root;
    emptyEl.hidden = true;
    treeEl.hidden = false;
    filterWrap.hidden = false;
    if (filesLabel) filesLabel.hidden = false;
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.add('sb-on'); // 打开工作区才显示侧栏（单文件编辑保持全宽）
    render();
    loadTabs(); // 异步按新根拉标签/置顶，到了再 render + 恢复上次激活
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
      ico.innerHTML = SVG.file;
      const name = document.createElement('span');
      name.className = 'sb-name ws-truncate';
      name.textContent = node.name;
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

  // ---- 打开节点：.html 进编辑器；其余进应用内查看器（图片/PDF 预览，其余给外部打开卡片）----
  function openNode(node) {
    if (node.kind === 'html') {
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

  // ---- 收起态图标轨（#4）：顶层文件夹/文件迷你图标 + hover 气泡（名字 + 文件夹内容缩略）----
  const railEl = document.getElementById('sb-rail');
  const KIND_TEXT = { html: 'HTML 文档', image: '图片', pdf: 'PDF', word: 'Word 文档', sheet: '表格', slides: '演示文稿', other: '文件' };
  let railPopEl = null;
  function hideRailPop() {
    if (railPopEl) {
      railPopEl.remove();
      railPopEl = null;
    }
  }
  function showRailPop(anchor, node) {
    hideRailPop();
    const r = anchor.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'sb-rail-pop';
    const title = document.createElement('div');
    title.className = 'sb-rail-pop-title ws-truncate';
    title.textContent = node.name;
    pop.appendChild(title);
    if (node.isDir) {
      const kids = node.children || [];
      if (kids.length) {
        const list = document.createElement('div');
        list.className = 'sb-rail-pop-list';
        for (const c of kids.slice(0, 8)) {
          const it = document.createElement('div');
          it.className = 'sb-rail-pop-item ws-truncate';
          it.textContent = c.name;
          list.appendChild(it);
        }
        pop.appendChild(list);
        if (kids.length > 8) {
          const more = document.createElement('div');
          more.className = 'sb-rail-pop-more';
          more.textContent = '+' + (kids.length - 8) + ' 项';
          pop.appendChild(more);
        }
      } else {
        const sub = document.createElement('div');
        sub.className = 'sb-rail-pop-sub';
        sub.textContent = '空文件夹';
        pop.appendChild(sub);
      }
    } else {
      const sub = document.createElement('div');
      sub.className = 'sb-rail-pop-sub';
      sub.textContent = KIND_TEXT[node.kind] || '文件';
      pop.appendChild(sub);
    }
    document.body.appendChild(pop);
    pop.style.left = r.right + 8 + 'px'; // 单 CSSOM 属性，CSP 安全
    pop.style.top = r.top + 'px';
    railPopEl = pop;
  }
  function railIcon(node) {
    const btn = document.createElement('button');
    btn.className = 'sb-rail-ico' + (node.isDir ? ' is-dir' : ' sb-kind-' + (node.kind || 'other'));
    btn.dataset.rel = node.rel;
    btn.innerHTML = node.isDir ? SVG.folder : SVG.file;
    if (!node.isDir && openPath() === node.abs) btn.classList.add('is-active');
    btn.title = node.name;
    btn.onmouseenter = () => showRailPop(btn, node);
    btn.onmouseleave = hideRailPop;
    btn.onclick = () => {
      hideRailPop();
      if (node.isDir) {
        collapsed.delete(node.rel); // 点文件夹：展开侧栏 + 展开这个文件夹
        if (sidebarEl) sidebarEl.classList.remove('is-collapsed');
        render();
      } else {
        openNode(node);
      }
    };
    return btn;
  }
  function renderRail() {
    if (!railEl || !current) return;
    hideRailPop();
    railEl.innerHTML = '';
    // 置顶 + 开着的标签 的图标（去重：pinned 优先）
    const tabbed = [
      ...window.WS2Tabs.pinnedEntries(tabState.entries),
      ...window.WS2Tabs.tabEntries(tabState.entries),
    ];
    let shown = 0;
    for (const e of tabbed) {
      const n = findNode(e.rel);
      if (!n) continue;
      const btn = railIcon(n);
      if (e.pinned) btn.classList.add('sb-rail-pin');
      railEl.appendChild(btn);
      shown++;
    }
    if (shown && current.tree.length) {
      const div = document.createElement('div');
      div.className = 'sb-rail-div';
      railEl.appendChild(div);
    }
    for (const n of current.tree) railEl.appendChild(railIcon(n));
  }

  // ===== 标签页 + 置顶（双标记模型，纯逻辑在 window.WS2Tabs，按根持久化）=====
  const pinnedEl = document.getElementById('sb-pinned'); // 置顶区
  const tabsEl = document.getElementById('sb-tabs'); // 标签页区
  const PIN_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
  const PIN_OFF_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h9"/><path d="M15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H10"/></svg>';
  const X_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  let dragTabRel = null;
  // 身份键：工作区内用 rel、工作区外用 abs（跟 tabs.js 一致）。外部标签 = 没有 rel。
  const keyOf = (e) => e.rel || e.abs;
  const isExternal = (e) => !e.rel;
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
    if (window.ws2.wsSetTabs) window.ws2.wsSetTabs(tabState, current && current.root).catch(() => {});
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
  function closeTabRel(key) {
    const wasActive = tabState.activeRel === key;
    if (wasActive && window.__shellIsDirty && window.__shellIsDirty() &&
        !confirm('这个文档有未保存的修改，关闭标签会丢弃，确定吗？')) return;
    if (wasActive && window.__shellDiscard) window.__shellDiscard(); // 已确认丢弃 → 切下一个时不再追问
    applyTabs(window.WS2Tabs.closeEntry(tabState, key));
    if (wasActive) {
      const e = tabState.activeRel ? tabState.entries.find((x) => keyOf(x) === tabState.activeRel) : null;
      if (e) openTabRow(e); // 回落项可能是外部标签 → 走 abs 分发，不只 findNode
      else if (window.__shellCloseDoc) window.__shellCloseDoc();
    }
  }
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
    if (activeRel) {
      const e = tabState.entries.find((x) => keyOf(x) === activeRel);
      if (e) openTabRow(e); // 内部走 findNode→openNode、外部走 abs 分发
    }
  }

  // ---- 渲染两区 ----
  // 点标签开它：内部文件走树节点 openNode；外部文件(无 rel)按 kind 分发 abs（跟「打开」按钮一条路，
  // shell.js 的 openDoc/showViewer 已支持纯 abs）。
  function openTabRow(entry) {
    if (entry.rel) {
      const n = findNode(entry.rel);
      if (n) openNode(n);
      return;
    }
    if (entry.kind === 'html') openDoc(entry.abs);
    else if (window.__shellShowViewer) window.__shellShowViewer({ abs: entry.abs, rel: null, kind: entry.kind, name: entry.title });
  }
  function tabRow(entry, zone) {
    const key = keyOf(entry);
    const external = isExternal(entry);
    const row = document.createElement('div');
    row.className = 'sb-row sb-tab sb-kind-' + (entry.kind || 'other') + (external ? ' sb-tab-ext' : '');
    row.dataset.rel = key; // 属性名沿用 data-rel（e2e 选择器靠它）；值=keyOf（内部=rel、外部=abs）
    row.setAttribute('role', 'button');
    row.draggable = true;
    if (external) row.title = entry.abs; // 外部标签悬停显完整绝对路径
    if (key === tabState.activeRel) row.classList.add('is-active');
    const ico = document.createElement('span');
    ico.className = 'sb-ico';
    ico.innerHTML = SVG.file;
    const name = document.createElement('span');
    name.className = 'sb-name ws-truncate';
    name.textContent = entry.title;
    row.append(ico, name);
    if (external) {
      const ext = document.createElement('span');
      ext.className = 'sb-tab-ext-ico';
      ext.title = '工作区外的文件';
      ext.innerHTML = EXT_ICO_SVG;
      row.append(ext);
    }
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
    if (zone === 'tabs') {
      const x = document.createElement('button');
      x.className = 'sb-tab-close';
      x.title = '关闭';
      x.innerHTML = X_SVG;
      x.onclick = (e) => {
        e.stopPropagation();
        closeTabRel(key);
      };
      row.append(x);
    }
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
    list.ondragover = (e) => {
      if (!dragTabRel) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.classList.add('sb-drop');
    };
    list.ondragleave = (e) => {
      if (!list.contains(e.relatedTarget)) list.classList.remove('sb-drop');
    };
    list.ondrop = (e) => {
      if (!dragTabRel) return;
      e.preventDefault();
      e.stopPropagation();
      list.classList.remove('sb-drop');
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
  function zoneHint(text) {
    const d = document.createElement('div');
    d.className = 'sb-zone-hint';
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
    else plist.appendChild(zoneHint('把标签拖到这里置顶'));
    pinnedEl.appendChild(plist);

    tabsEl.innerHTML = '';
    tabsEl.hidden = false;
    tabsEl.appendChild(zoneHeader('标签页', () => openCreateModal('')));
    const tlist = zoneList('tabs');
    if (tabs.length) for (const e of tabs) tlist.appendChild(tabRow(e, 'tabs'));
    else tlist.appendChild(zoneHint('没有打开的标签'));
    tabsEl.appendChild(tlist);
  }

  // ---- 筛选输入 ----
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      query = filterInput.value;
      render();
    });
  }
  if (openFolderBtn) openFolderBtn.onclick = pickFolder;
  if (emptyOpenBtn) emptyOpenBtn.onclick = pickFolder;
  const newDocBtn = document.getElementById('sb-new-doc'); // 侧栏头「+新建文档」→ 模板台（落在工作区根）
  if (newDocBtn) newDocBtn.onclick = () => openCreateModal('');
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

  // ---- 新建文档：模板选择台（空文档第一 + 内置模板，无 AI）。落点 dirRel。----
  async function openCreateModal(dirRel) {
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
    const head = document.createElement('div');
    head.className = 'sb-modal-head';
    const title = document.createElement('div');
    title.className = 'sb-modal-title';
    title.textContent = '新建文档';
    const where = document.createElement('div');
    where.className = 'sb-modal-where';
    where.textContent = '在 ' + (current ? current.name : '') + (dirRel ? ' / ' + dirRel : '');
    head.append(title, where);
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
        const r = await window.ws2.wsNewDoc(dirRel || '', t.base, t.html);
        await refresh();
        if (r && r.abs) openDoc(r.abs);
      };
      grid.appendChild(card);
    }
    modal.append(head, grid);
    overlay.appendChild(modal);
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }

  // ---- 收起/展开侧栏（最简版：收成细条；Cmd+\ 或头部按钮）----
  const sidebarEl = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sb-toggle');
  function toggleCollapsed() {
    if (sidebarEl) sidebarEl.classList.toggle('is-collapsed');
  }
  if (toggleBtn) toggleBtn.onclick = toggleCollapsed;
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      toggleCollapsed();
    }
  });

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
  window.__sbHooks = {
    onOpen: (abs) => {
      highlightActive(abs);
      const node = abs ? findNodeByAbs(abs) : null;
      if (node) {
        openTabEntry({ rel: node.rel, kind: node.kind || 'other', title: node.name });
      } else if (abs) {
        openTabFromAbs(abs);
      }
    },
    refresh,
  };

  // 启动恢复上次工作区。
  (async () => {
    try {
      const root = await window.ws2.wsGetRoot();
      if (root) {
        const data = await window.ws2.wsReadTree();
        if (data) setWorkspace(data);
      }
    } catch (e) {
      /* 无工作区 / 已不存在：保持空态 */
    }
  })();
})();
