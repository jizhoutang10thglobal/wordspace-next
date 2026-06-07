window.addEventListener('DOMContentLoaded', () => {
  const docContainer = document.getElementById('doc-container');
  let rawHtml;

  window.api.getDocContent()
    .then((html) => {
      rawHtml = html;
      docContainer.innerHTML = rawHtml;
    })
    .catch((err) => {
      docContainer.textContent = 'Error loading document: ' + err.message;
    });

  let currentTheme = window.api.theme.DEFAULT_THEME;

  document.getElementById('theme-toggle').addEventListener('click', () => {
    currentTheme = window.api.theme.toggleTheme(currentTheme);
    document.body.className = window.api.theme.getShellClass(currentTheme);
  });

  let currentView = window.api.view.DEFAULT_VIEW;

  document.getElementById('view-toggle').addEventListener('click', () => {
    currentView = window.api.view.toggleView(currentView);
    if (window.api.view.getDisplayMode(currentView) === 'text') {
      docContainer.textContent = rawHtml;
    } else {
      docContainer.innerHTML = rawHtml;
    }
  });
});
