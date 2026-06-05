window.addEventListener('DOMContentLoaded', () => {
  window.api.getDocContent()
    .then((html) => {
      document.getElementById('doc-container').innerHTML = html;
    })
    .catch((err) => {
      document.getElementById('doc-container').textContent = 'Error loading document: ' + err.message;
    });

  let currentTheme = window.api.theme.DEFAULT_THEME;

  document.getElementById('theme-toggle').addEventListener('click', () => {
    currentTheme = window.api.theme.toggleTheme(currentTheme);
    document.body.className = window.api.theme.getShellClass(currentTheme);
  });
});
