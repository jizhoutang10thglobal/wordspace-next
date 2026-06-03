window.addEventListener('DOMContentLoaded', () => {
  window.api.getDocContent()
    .then((html) => {
      document.getElementById('doc-container').innerHTML = html;
    })
    .catch((err) => {
      document.getElementById('doc-container').textContent = 'Error loading document: ' + err.message;
    });
});
