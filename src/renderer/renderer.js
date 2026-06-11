window.addEventListener('DOMContentLoaded', () => {
  const docContainer = document.getElementById('doc-container');
  const editIndicator = document.getElementById('edit-indicator');
  const STORAGE_KEY = 'wordspace.doc.html';

  // S6 脏标记基线 = 内置文档渲染完成后的 innerHTML 快照（序列化规范化后），不是源文件串
  let baselineHtml;
  let currentTheme = window.api.theme.DEFAULT_THEME;
  let currentView = window.api.view.DEFAULT_VIEW;

  function refreshIndicator() {
    const edited = window.api.editing.isEdited(docContainer.innerHTML, baselineHtml);
    editIndicator.textContent = edited ? '● Edited' : '';
  }

  function persist() {
    const html = docContainer.innerHTML;
    if (window.api.editing.isEdited(html, baselineHtml)) {
      localStorage.setItem(STORAGE_KEY, html);
    } else {
      // 改回与原文一致（如全撤销）= 没编辑，存档清掉，别留一份等于原文的副本
      localStorage.removeItem(STORAGE_KEY);
    }
    refreshIndicator();
  }

  window.api.getDocContent()
    .then((html) => {
      // 先渲内置文档取序列化基线，再覆盖 localStorage 存档（若有）
      docContainer.innerHTML = html;
      baselineHtml = docContainer.innerHTML;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        docContainer.innerHTML = saved;
      }
      docContainer.contentEditable = 'true';
      refreshIndicator();
    })
    .catch((err) => {
      docContainer.textContent = 'Error loading document: ' + err.message;
    });

  // S6 纯文本粘贴：只取 text/plain、去来源样式；insertText 并入原生撤销栈
  docContainer.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = window.api.editing.normalizePasteText(e.clipboardData.getData('text/plain'));
    document.execCommand('insertText', false, text);
  });

  docContainer.addEventListener('input', persist);

  document.getElementById('reset-doc').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    if (window.api.view.getDisplayMode(currentView) === 'text') {
      // 源码态下 Reset：先回渲染态（编辑/原文都以渲染态呈现，心智简单）
      currentView = window.api.view.toggleView(currentView);
    }
    docContainer.innerHTML = baselineHtml;
    docContainer.contentEditable = 'true';
    refreshIndicator();
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    currentTheme = window.api.theme.toggleTheme(currentTheme);
    document.body.className = window.api.theme.getShellClass(currentTheme);
  });

  document.getElementById('view-toggle').addEventListener('click', () => {
    // S6：源码视图显示「当前编辑后」文档的实时 HTML（不再用启动缓存原串）、只读；
    // 切回渲染态从源码文本原样恢复继续编辑。仍纯同步、不发 IPC（S3 flaky 教训）。
    currentView = window.api.view.toggleView(currentView);
    if (window.api.view.getDisplayMode(currentView) === 'text') {
      const live = docContainer.innerHTML;
      docContainer.contentEditable = 'false';
      docContainer.textContent = live;
    } else {
      const src = docContainer.textContent;
      docContainer.innerHTML = src;
      docContainer.contentEditable = 'true';
    }
  });
});
