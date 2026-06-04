const { DEFAULT_THEME, toggleTheme, getShellClass, getDocStyle } = require('../theme-manager');

describe('theme-manager', () => {
  describe('DEFAULT_THEME', () => {
    it('is light', () => {
      expect(DEFAULT_THEME).toBe('light');
    });
  });

  describe('toggleTheme', () => {
    it('toggles light to dark', () => {
      expect(toggleTheme('light')).toBe('dark');
    });

    it('toggles dark to light', () => {
      expect(toggleTheme('dark')).toBe('light');
    });

    it('returns to start after even number of toggles', () => {
      let theme = DEFAULT_THEME;
      for (let i = 0; i < 4; i++) theme = toggleTheme(theme);
      expect(theme).toBe(DEFAULT_THEME);
    });

    it('differs from start after odd number of toggles', () => {
      let theme = DEFAULT_THEME;
      for (let i = 0; i < 3; i++) theme = toggleTheme(theme);
      expect(theme).not.toBe(DEFAULT_THEME);
    });
  });

  describe('getShellClass', () => {
    it('returns a non-empty string for light', () => {
      expect(typeof getShellClass('light')).toBe('string');
      expect(getShellClass('light').length).toBeGreaterThan(0);
    });

    it('returns a different value for dark vs light', () => {
      expect(getShellClass('dark')).not.toBe(getShellClass('light'));
    });
  });

  describe('getDocStyle', () => {
    it('returns deeply equal objects for light and dark — doc style is theme-invariant', () => {
      expect(getDocStyle('light')).toEqual(getDocStyle('dark'));
    });
  });
});
