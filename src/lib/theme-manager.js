const DEFAULT_THEME = 'light';

function toggleTheme(current) {
  return current === 'light' ? 'dark' : 'light';
}

function getShellClass(theme) {
  return theme === 'dark' ? 'dark-theme' : 'light-theme';
}

// Returns a constant regardless of theme — proves doc style is not derived from theme.
function getDocStyle() {
  return {};
}

module.exports = { DEFAULT_THEME, toggleTheme, getShellClass, getDocStyle };
