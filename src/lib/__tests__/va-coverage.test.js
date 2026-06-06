const fs = require('fs');
const path = require('path');

// VA 覆盖门：标了 requires_va: true 的 spec 必须有对应 specs/<slug>.va.json。
// 这把"新的可见 spec 偷偷不带 VA → 可见效果零门验 → 绿着进 main"这条病根复发路径，
// 变成 vitest 权威门当场判红（容器内快门 + CI 都跑），不靠 run-spec.sh 的软告警。
const SPECS = path.join(__dirname, '../../../specs');

describe('VA 覆盖：requires_va 的 spec 必须有 va.json', () => {
  const mds = fs.readdirSync(SPECS).filter((f) => f.endsWith('.md'));

  it('specs/ 下至少扫到一个 spec', () => {
    expect(mds.length).toBeGreaterThan(0);
  });

  for (const md of mds) {
    const txt = fs.readFileSync(path.join(SPECS, md), 'utf8');
    if (!/^requires_va:\s*true\s*$/im.test(txt)) continue; // 纯逻辑无 UI 的 spec 不强制
    it(`${md} 标了 requires_va: true，必须有对应 .va.json`, () => {
      const va = md.replace(/\.md$/, '.va.json');
      expect(fs.existsSync(path.join(SPECS, va)), `缺 specs/${va} —— 可见效果没有验收门`).toBe(true);
    });
  }
});
