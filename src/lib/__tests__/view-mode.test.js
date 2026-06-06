const { DEFAULT_VIEW, toggleView, getDisplayMode } = require('../view-mode');

describe('view-mode', () => {
  describe('DEFAULT_VIEW', () => {
    it('is rendered', () => {
      expect(DEFAULT_VIEW).toBe('rendered');
    });
  });

  describe('toggleView', () => {
    it('toggles rendered to source', () => {
      expect(toggleView('rendered')).toBe('source');
    });

    it('toggles source to rendered', () => {
      expect(toggleView('source')).toBe('rendered');
    });

    it('returns to start after even number of toggles', () => {
      let view = DEFAULT_VIEW;
      for (let i = 0; i < 4; i++) view = toggleView(view);
      expect(view).toBe(DEFAULT_VIEW);
    });

    it('differs from start after odd number of toggles', () => {
      let view = DEFAULT_VIEW;
      for (let i = 0; i < 3; i++) view = toggleView(view);
      expect(view).not.toBe(DEFAULT_VIEW);
    });
  });

  describe('getDisplayMode', () => {
    it('differs between rendered and source', () => {
      expect(getDisplayMode('rendered')).not.toBe(getDisplayMode('source'));
    });

    it('returns html for rendered', () => {
      expect(getDisplayMode('rendered')).toBe('html');
    });

    it('returns text for source', () => {
      expect(getDisplayMode('source')).toBe('text');
    });
  });
});
