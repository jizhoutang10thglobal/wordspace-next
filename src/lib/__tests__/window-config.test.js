const { getWindowConfig } = require('../window-config');

describe('window-config', () => {
  it('getWindowConfig returns positive width and height', () => {
    const config = getWindowConfig();
    expect(config.width).toBeGreaterThan(0);
    expect(config.height).toBeGreaterThan(0);
  });

  it('getWindowConfig returns expected default dimensions', () => {
    const config = getWindowConfig();
    expect(config.width).toBe(1024);
    expect(config.height).toBe(768);
  });

  it('getWindowConfig sets contextIsolation to true', () => {
    expect(getWindowConfig().webPreferences.contextIsolation).toBe(true);
  });

  it('getWindowConfig sets nodeIntegration to false', () => {
    expect(getWindowConfig().webPreferences.nodeIntegration).toBe(false);
  });

  it('getWindowConfig sets sandbox to false so preload can require local modules', () => {
    expect(getWindowConfig().webPreferences.sandbox).toBe(false);
  });
});
