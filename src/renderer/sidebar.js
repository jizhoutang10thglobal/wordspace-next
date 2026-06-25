// 左侧本地文件栏（F06）。跑在父层 shell 作用域（classic script，shell.js 之后加载）→ 直接调
// shell.js 的 openDoc / __shellRetargetDoc 等。所有 fs 经 window.ws2.ws*（主进程）。
// CSP 约束：不用 setAttribute('style')/cssText（会被 style-src 拦）；缩进走 class（sb-d0..9），
// 数据走 dataset（data-* 不受 CSP 限制）。样式全在 shell.css。
(function () {
  const rootNameEl = document.getElementById('sb-root-name');
  const filterWrap = document.getElementById('sb-filter');
  const filterInput = document.getElementById('sb-filter-input');
  const emptyEl = document.getElementById('sb-empty');
  const treeEl = document.getElementById('sb-tree');
  const openFolderBtn = document.getElementById('sb-open-folder');
  const emptyOpenBtn = document.getElementById('sb-empty-open');
  if (!treeEl) return;

  let current = null; // { root, name, tree }
  let query = '';
  const collapsed = new Set(); // 收起的文件夹 rel（默认全展开）

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
    if (filterInput) filterInput.value = '';
    rootNameEl.textContent = data.name;
    rootNameEl.title = data.root;
    emptyEl.hidden = true;
    treeEl.hidden = false;
    filterWrap.hidden = false;
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.add('sb-on'); // 打开工作区才显示侧栏（单文件编辑保持全宽）
    render();
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
    if (!current) return;
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
    await refresh();
  }
  async function doMove(node, destDirRel) {
    const wasOpen = !node.isDir && openPath() === node.abs;
    const r = await window.ws2.wsMove(node.rel, destDirRel);
    if (wasOpen && window.__shellRetargetDoc && r.abs !== node.abs) {
      window.__shellRetargetDoc(r.abs, r.rel.split('/').pop());
    }
    await refresh();
  }
  async function doDelete(node) {
    const op = openPath();
    const affectsOpen = op && (op === node.abs || (node.isDir && isUnder(op, node.abs)));
    const r = await window.ws2.wsDelete(node.rel);
    if (affectsOpen && window.__shellCloseDoc) window.__shellCloseDoc();
    await refresh();
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
          { label: '重命名', run: () => startInlineRename(node, row) },
          { label: '删除', danger: true, run: () => doDelete(node) },
        ]);
      };
      parent.appendChild(row);
    }
  }

  // ---- 打开节点：.html 进编辑器；其余走系统默认程序 ----
  function openNode(node) {
    if (node.kind === 'html') {
      openDoc(node.abs); // shell.js 的漏斗（脏检查/载入/watch/recents）
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

  // ---- 筛选输入 ----
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      query = filterInput.value;
      render();
    });
  }
  if (openFolderBtn) openFolderBtn.onclick = pickFolder;
  if (emptyOpenBtn) emptyOpenBtn.onclick = pickFolder;
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

  // shell.js 用的钩子：打开文件 → 高亮。
  window.__sbHooks = {
    onOpen: (abs) => highlightActive(abs),
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
