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
      row.append(caret, ico, name);
      row.onclick = () => {
        if (collapsed.has(node.rel)) collapsed.delete(node.rel);
        else collapsed.add(node.rel);
        render();
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
      const ico = document.createElement('span');
      ico.className = 'sb-ico';
      ico.innerHTML = SVG.file;
      const name = document.createElement('span');
      name.className = 'sb-name ws-truncate';
      name.textContent = node.name;
      row.append(ico, name);
      row.onclick = () => openNode(node);
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
