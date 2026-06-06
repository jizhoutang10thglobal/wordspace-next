const DEFAULT_VIEW = 'rendered';

function toggleView(current) {
  return current === 'rendered' ? 'source' : 'rendered';
}

// 'html'  → renderer writes innerHTML (formatted document)
// 'text'  → renderer writes textContent (raw HTML shown as literal text)
function getDisplayMode(view) {
  return view === 'source' ? 'text' : 'html';
}

module.exports = { DEFAULT_VIEW, toggleView, getDisplayMode };
