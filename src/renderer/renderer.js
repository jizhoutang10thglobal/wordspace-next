window.addEventListener('DOMContentLoaded', () => {
  window.api.getDocContent()
    .then((html) => {
      document.getElementById('doc-container').innerHTML = html;
    })
    .catch((err) => {
      document.getElementById('doc-container').textContent = 'Error loading document: ' + err.message;
    });

  let currentTheme = window.api.theme.defaultTheme;

  function applyTheme(theme) {
    document.documentElement.className = window.api.theme.getShellClass(theme);
    const btn = document.getElementById('theme-toggle');
    btn.textContent = theme === 'dark' ? '☾ Dark' : '☀ Light';
  }

  applyTheme(currentTheme);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    currentTheme = window.api.theme.toggle(currentTheme);
    applyTheme(currentTheme);
  });
});
