const { DEFAULT_THEME, toggleTheme, getShellClass, getDocContainerStyles } = require('../theme-manager');

describe('theme-manager', () => {
  describe('DEFAULT_THEME', () => {
    it('is light', () => {
      expect(DEFAULT_THEME).toBe('light');
    });
  });

  describe('toggleTheme', () => {
    it('toggles from light to dark after 1 toggle', () => {
      expect(toggleTheme(DEFAULT_THEME)).toBe('dark');
    });

    it('returns to light after 2 toggles', () => {
      expect(toggleTheme(toggleTheme(DEFAULT_THEME))).toBe('light');
    });

    it('matches parity: odd toggles → dark, even → light', () => {
      let theme = DEFAULT_THEME;
      for (let i = 1; i <= 3; i++) {
        theme = toggleTheme(theme);
        expect(theme).toBe(i % 2 === 1 ? 'dark' : 'light');
      }
    });
  });

  describe('getShellClass', () => {
    it('returns different values for light and dark themes', () => {
      expect(getShellClass('light')).not.toBe(getShellClass('dark'));
    });
  });

  describe('getDocContainerStyles', () => {
    it('returns the same styles for light and dark themes', () => {
      expect(getDocContainerStyles('light')).toEqual(getDocContainerStyles('dark'));
    });

    it('returns a non-empty styles object', () => {
      const styles = getDocContainerStyles('light');
      expect(Object.keys(styles).length).toBeGreaterThan(0);
    });
  });
});
