// AI 创作指南的分发拷贝防漂移门：docs/ 正本改了、分发拷贝忘同步 → 这里红。
// 三份必须逐字节一致：
//   正本   docs/schema-1-ai-authoring.md（校验器绑定的教学文档，U3 conformance 测它）
//   Skill  skills/wordspace/references/schema-1.md（npx skills 装走的那份；skill=单入口多 schema
//          框架，见 docs/design/2026-07-03-skills-framework.md——将来每个 schema 一份 reference，
//          正本↔拷贝的锁在这里逐对加行）
//   Prompt ui-demo/src/lib/schema-prompt.md（ui-demo「AI 接入」页复制按钮吐的那份）
// 同步方式 = 复制正本覆盖两份拷贝（cp docs/schema-1-ai-authoring.md <target>），不做内容变体。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const canonical = path.join(ROOT, 'docs', 'schema-1-ai-authoring.md');
const copies = [
  path.join(ROOT, 'skills', 'wordspace', 'references', 'schema-1.md'),
  path.join(ROOT, 'ui-demo', 'src', 'lib', 'schema-prompt.md'),
  path.join(ROOT, 'src', 'renderer', 'ai-guide.md'), // 真 app「AI 接入」弹窗复制按钮吐的那份（打包进 app）
];

test('AI 创作指南的分发拷贝与 docs/ 正本逐字节一致（防漂移）', () => {
  const src = fs.readFileSync(canonical, 'utf8');
  for (const p of copies) {
    assert.ok(fs.existsSync(p), '分发拷贝不存在: ' + path.relative(ROOT, p));
    assert.equal(
      fs.readFileSync(p, 'utf8'),
      src,
      '分发拷贝与正本不一致（改了 docs/ 正本要 cp 覆盖同步）: ' + path.relative(ROOT, p),
    );
  }
});

// 每个 schema 一份 reference：正本 docs/schema-<N>-ai-authoring.md ↔ 拷贝 skills/wordspace/references/schema-<N>.md，
// 逐对锁在这里（skill = 单入口多 schema 框架）。Schema #2 分页文档只在 skill 里分发一份 reference
//（不进 ai-guide/schema-prompt——那两处是 schema-1 的 app/ui-demo UI 复制按钮）。
const schemaPairs = [
  { canonical: 'docs/schema-2-ai-authoring.md', copy: 'skills/wordspace/references/schema-2.md' },
];
for (const { canonical: c, copy } of schemaPairs) {
  test(`${c} ↔ ${copy} 逐字节一致（防漂移）`, () => {
    const cp = path.join(ROOT, c), pp = path.join(ROOT, copy);
    assert.ok(fs.existsSync(cp), '正本不存在: ' + c);
    assert.ok(fs.existsSync(pp), '拷贝不存在: ' + copy);
    assert.equal(fs.readFileSync(pp, 'utf8'), fs.readFileSync(cp, 'utf8'), `拷贝与正本不一致（cp ${c} ${copy}）`);
  });
}
