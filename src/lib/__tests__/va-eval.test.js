const { luminance, evaluateChecks, selectorsOf, statesOf } = require('../va-eval');
const va = require('../../../specs/f46-theme-demo.va.json');

// 修好后的真实 computed 颜色（宿主实测值）
const GOOD = {
  light: { '#status-bar': 'rgb(224, 224, 224)', '#doc-container': 'rgb(255, 255, 255)', body: 'rgb(240, 240, 240)' },
  dark: { '#status-bar': 'rgb(42, 42, 42)', '#doc-container': 'rgb(255, 255, 255)', body: 'rgb(26, 26, 26)' },
  lightAgain: { '#status-bar': 'rgb(224, 224, 224)', '#doc-container': 'rgb(255, 255, 255)', body: 'rgb(240, 240, 240)' },
};

describe('luminance', () => {
  it('白≈1，黑≈0', () => {
    expect(luminance('rgb(255, 255, 255)')).toBeGreaterThan(0.95);
    expect(luminance('rgb(26, 26, 26)')).toBeLessThan(0.05);
  });
  it('transparent(alpha=0) 报错——不能当黑色误判', () => {
    expect(() => luminance('rgba(0, 0, 0, 0)')).toThrow();
  });
  it('解析不了的颜色报错', () => {
    expect(() => luminance('not-a-color')).toThrow();
  });
  it('吃空格/斜杠语法 rgb(255 255 255) / rgb(0 0 0 / a)', () => {
    expect(luminance('rgb(255 255 255)')).toBeGreaterThan(0.95);
    expect(() => luminance('rgb(0 0 0 / 0)')).toThrow();
    expect(() => luminance('rgb(0 0 0 / 50%)')).toThrow();
  });
  it('近透明(alpha<0.99)报错——不当实色判', () => {
    expect(() => luminance('rgba(0, 0, 0, 0.004)')).toThrow();
    expect(() => luminance('rgba(26, 26, 26, 0.5)')).toThrow();
  });
  it('分量解析不出数字时报错而非静默 NaN', () => {
    expect(() => luminance('rgb(foo, bar, baz)')).toThrow();
  });
});

describe('evaluateChecks — 好快照全过', () => {
  it('修好的 app 颜色让 spec2 的 VA 全 pass', () => {
    const { passed, results } = evaluateChecks(GOOD, va.checks);
    const red = results.filter((r) => !r.pass);
    expect(red, JSON.stringify(red)).toEqual([]);
    expect(passed).toBe(true);
  });
});

describe('evaluateChecks — 坏快照必判红（这是门有牙的核心）', () => {
  it('CSP 失效→背景全 transparent：状态栏/外壳/文档都该红', () => {
    const bad = {
      light: { '#status-bar': 'rgba(0, 0, 0, 0)', '#doc-container': 'rgba(0, 0, 0, 0)', body: 'rgba(0, 0, 0, 0)' },
      dark: { '#status-bar': 'rgba(0, 0, 0, 0)', '#doc-container': 'rgba(0, 0, 0, 0)', body: 'rgba(0, 0, 0, 0)' },
      lightAgain: { '#status-bar': 'rgba(0, 0, 0, 0)', '#doc-container': 'rgba(0, 0, 0, 0)', body: 'rgba(0, 0, 0, 0)' },
    };
    const { passed, results } = evaluateChecks(bad, va.checks);
    expect(passed).toBe(false);
    expect(results.find((r) => r.id === 'status-bar-darkens').pass).toBe(false);
    expect(results.find((r) => r.id === 'doc-stays-white').pass).toBe(false);
  });

  it('状态栏暗态没变暗（停在亮色）：status-bar-darkens 该红', () => {
    const bad = { ...GOOD, dark: { ...GOOD.dark, '#status-bar': 'rgb(224, 224, 224)' } };
    const { passed, results } = evaluateChecks(bad, va.checks);
    expect(passed).toBe(false);
    const c = results.find((r) => r.id === 'status-bar-darkens');
    expect(c.pass).toBe(false);
    expect(c.reasons.length).toBeGreaterThan(0);
  });

  it('文档暗态被主题染暗：doc-stays-white 该红（equals + invariant）', () => {
    const bad = { ...GOOD, dark: { ...GOOD.dark, '#doc-container': 'rgb(26, 26, 26)' } };
    const { results } = evaluateChecks(bad, va.checks);
    const c = results.find((r) => r.id === 'doc-stays-white');
    expect(c.pass).toBe(false);
  });
});

describe('helpers', () => {
  it('selectorsOf 收集所有 check 的 selector', () => {
    expect(selectorsOf(va).sort()).toEqual(['#doc-container', '#status-bar', 'body'].sort());
  });
  it('statesOf 收集 steps 里的快照名', () => {
    expect(statesOf(va)).toEqual(['light', 'dark', 'lightAgain']);
  });
});
