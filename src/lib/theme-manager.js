const THEMES = { LIGHT: 'light', DARK: 'dark' };
const DEFAULT_THEME = THEMES.LIGHT;

function toggleTheme(current) {
  return current === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
}

function getShellClass(theme) {
  return theme === THEMES.DARK ? 'theme-dark' : 'theme-light';
}

// Document container styles are fixed regardless of theme — the model never
// derives doc styles from theme state. This is the testable proof of that invariant.
function getDocContainerStyles(theme) {
  return { background: '#ffffff', color: '#000000' };
}

module.exports = { THEMES, DEFAULT_THEME, toggleTheme, getShellClass, getDocContainerStyles };
