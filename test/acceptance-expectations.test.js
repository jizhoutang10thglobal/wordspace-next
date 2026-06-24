const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// expectations.mjs 是 ESM；用子进程 import 它的纯函数做断言（避免在 CJS 测试里 import ESM 的坑）。
// 既验解析逻辑，也顺带验它真能读到 main 上的 canonical（端到端解析这份共享契约）。
const MOD = path.join(__dirname, '..', 'scripts', 'acceptance-audit', 'expectations.mjs');

function evalInModule(code) {
  const src = `import * as M from ${JSON.stringify(MOD)};\n${code}`;
  const out = execFileSync('node', ['--input-type=module', '-e', src], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('parseExpectations: status 缺省为 built，planned 被解析出来', () => {
  const r = evalInModule(`
    const md = [
      '### E:a · 已建功能','- **surface:** both','- **severity:** high','- **expect:** x','- **fail-if:** y','',
      '### E:b · 计划功能','- **surface:** app','- **severity:** high','- **status:** planned','- **expect:** x','- **fail-if:** y',
    ].join('\\n');
    const m = M.parseExpectations(md);
    console.log(JSON.stringify({ aStatus: m.a.status, bStatus: m.b.status, aSurface: m.a.surface }));
  `);
  assert.equal(r.aStatus, 'built'); // 缺省 built
  assert.equal(r.bStatus, 'planned');
  assert.equal(r.aSurface, 'both');
});

test('forSurface(app): 取 surface∈{app,both}，丢 ui-demo', () => {
  const r = evalInModule(`
    const md = [
      '### E:both1 · t','- **surface:** both','- **expect:** x','',
      '### E:app1 · t','- **surface:** app','- **expect:** x','',
      '### E:ud1 · t','- **surface:** ui-demo','- **expect:** x',
    ].join('\\n');
    const f = M.forSurface(M.parseExpectations(md), 'app');
    console.log(JSON.stringify(Object.keys(f).sort()));
  `);
  assert.deepEqual(r, ['app1', 'both1']); // ui-demo 被排除
});

test('pendingFor(app): 只挑 status=planned 的适用项', () => {
  const r = evalInModule(`
    const md = [
      '### E:built1 · t','- **surface:** both','- **status:** built','- **expect:** x','',
      '### E:planned1 · t','- **surface:** app','- **status:** planned','- **expect:** x','',
      '### E:udplanned · t','- **surface:** ui-demo','- **status:** planned','- **expect:** x',
    ].join('\\n');
    const p = M.pendingFor(M.parseExpectations(md), 'app').map((e) => e.id).sort();
    console.log(JSON.stringify(p));
  `);
  assert.deepEqual(r, ['planned1']); // built 不算 pending；ui-demo 的 planned 不适用 app
});

test('端到端：能解析 main 上的 canonical，app 适用含迁入的红线、两条 app 判 pending', () => {
  const r = evalInModule(`
    const m = M.loadExpectations();
    const app = M.forSurface(m, 'app');
    const pending = M.pendingFor(m, 'app').map((e) => e.id).sort();
    console.log(JSON.stringify({
      ids: Object.keys(app).sort(),
      pending,
      safetyDanger: !!app['safety-dangerous-link'],
      safetyFidelity: !!app['safety-fidelity'],
      formatBold: !!app['format-bold'],
      aiEntrySkipped: !app['ai-entry-slash'],
    }));
  `);
  // 迁入的 both 红线在 app 适用集合里
  assert.equal(r.safetyDanger, true);
  assert.equal(r.safetyFidelity, true);
  assert.equal(r.formatBold, true);
  // ui-demo-only 的 AI 入口不在 app 集合
  assert.equal(r.aiEntrySkipped, true);
  // 两条 surface:app 是 planned → pending
  assert.deepEqual(r.pending, ['app-ai-generates-content', 'app-export-produces-file']);
});
