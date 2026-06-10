const { buildUpdateDialogOptions, shouldInstall } = require('../update-prompt');

describe('update-prompt（S5 显式更新弹窗决策逻辑）', () => {
  it('弹窗选项：message 含版本号、两个按钮、默认聚焦「立即重启」、Esc 落「稍后」', () => {
    const opts = buildUpdateDialogOptions('0.0.3');
    expect(opts.message).toContain('v0.0.3');
    expect(opts.buttons).toEqual(['立即重启', '稍后']);
    expect(opts.buttons[opts.defaultId]).toBe('立即重启');
    expect(opts.buttons[opts.cancelId]).toBe('稍后');
  });

  it('拿不到版本号时不显示 undefined', () => {
    const opts = buildUpdateDialogOptions(undefined);
    expect(opts.message).not.toContain('undefined');
    expect(opts.message).toContain('已下载');
  });

  it('选「立即重启」判装，选「稍后」判不装', () => {
    const opts = buildUpdateDialogOptions('0.0.3');
    expect(shouldInstall(opts.defaultId)).toBe(true);
    expect(shouldInstall(opts.cancelId)).toBe(false);
  });
});
