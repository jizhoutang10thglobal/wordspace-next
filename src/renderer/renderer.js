const themeManager = require('../lib/theme-manager');

let currentTheme = themeManager.DEFAULT_THEME;

function applyTheme(theme) {
  document.documentElement.className = themeManager.getShellClass(theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☾ Dark' : '☀ Light';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);

  window.api.getDocContent()
    .then((html) => {
      document.getElementById('doc-container').innerHTML = html;
    })
    .catch((err) => {
      document.getElementById('doc-container').textContent = 'Error loading document: ' + err.message;
    });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    currentTheme = themeManager.toggleTheme(currentTheme);
    applyTheme(currentTheme);
  });
});
