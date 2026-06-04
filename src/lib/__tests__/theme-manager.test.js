const { DEFAULT_THEME, toggleTheme, getShellClass, getDocContainerStyles } = require('../theme-manager');

describe('theme-manager', () => {
  it('DEFAULT_THEME is light', () => {
    expect(DEFAULT_THEME).toBe('light');
  });

  it('toggleTheme parity: 1 toggle → dark, 2 → light, 3 → dark', () => {
    let t = DEFAULT_THEME;
    t = toggleTheme(t); expect(t).toBe('dark');
    t = toggleTheme(t); expect(t).toBe('light');
    t = toggleTheme(t); expect(t).toBe('dark');
  });

  it('getShellClass differs between light and dark', () => {
    expect(getShellClass('light')).not.toBe(getShellClass('dark'));
  });

  it('getDocContainerStyles returns the same value regardless of theme', () => {
    expect(getDocContainerStyles('light')).toEqual(getDocContainerStyles('dark'));
  });

  it('getDocContainerStyles returns a non-empty object', () => {
    const styles = getDocContainerStyles('light');
    expect(Object.keys(styles).length).toBeGreaterThan(0);
  });
});
