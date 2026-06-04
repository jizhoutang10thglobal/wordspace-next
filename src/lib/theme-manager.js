const THEMES = { LIGHT: 'light', DARK: 'dark' };
const DEFAULT_THEME = THEMES.LIGHT;

function toggleTheme(current) {
  return current === THEMES.LIGHT ? THEMES.DARK : THEMES.LIGHT;
}

function getShellClass(theme) {
  return theme === THEMES.DARK ? 'theme-dark' : 'theme-light';
}

function getDocContainerStyles() {
  return { background: '#ffffff', color: '#000000' };
}

module.exports = { THEMES, DEFAULT_THEME, toggleTheme, getShellClass, getDocContainerStyles };
