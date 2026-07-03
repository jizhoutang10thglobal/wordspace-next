// AI 创作指南的分发拷贝防漂移门：docs/ 正本改了、分发拷贝忘同步 → 这里红。
// 三份必须逐字节一致：
//   正本   docs/schema-1-ai-authoring.md（校验器绑定的教学文档，U3 conformance 测它）
//   Skill  skills/schema-1-authoring/references/schema-1-authoring.md（npx skills 装走的那份）
//   Prompt ui-demo/src/lib/schema-prompt.md（ui-demo「AI 接入」页复制按钮吐的那份）
// 同步方式 = 复制正本覆盖两份拷贝（cp docs/schema-1-ai-authoring.md <target>），不做内容变体。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const canonical = path.join(ROOT, 'docs', 'schema-1-ai-authoring.md');
const copies = [
  path.join(ROOT, 'skills', 'schema-1-authoring', 'references', 'schema-1-authoring.md'),
  path.join(ROOT, 'ui-demo', 'src', 'lib', 'schema-prompt.md'),
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
