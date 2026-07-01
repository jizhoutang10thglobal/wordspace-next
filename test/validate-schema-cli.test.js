const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'scripts', 'validate-schema.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-vcli-'));

// 真跑 CLI 子进程：断言退出码 + stdout 的机器 JSON（这是外部 agent 回路真会用的接口）
function run(html) {
  const f = path.join(TMP, 'doc-' + Math.abs(hash(html)) + '.html');
  fs.writeFileSync(f, html, 'utf8');
  const r = spawnSync('node', [CLI, f], { encoding: 'utf8' });
  return { code: r.status, json: JSON.parse(r.stdout), stderr: r.stderr };
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
const DOC = (body) => '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>';
const hasRule = (json, rule) => json.violations.some((x) => x.rule === rule);

test('CLI 合规文档 → 退出 0、conform:true、violations 空', () => {
  const r = run(DOC('<h1>标题</h1><p>正文 <b>粗</b></p><ul><li>a</li></ul>'));
  assert.equal(r.code, 0);
  assert.equal(r.json.conform, true);
  assert.equal(r.json.violations.length, 0);
});

test('CLI 含 <script> → 退出 1、含 rule script（断言用「含」：script 同时命中 block-tag）', () => {
  const r = run(DOC('<p>hi</p><script>steal()</' + 'script>'));
  assert.equal(r.code, 1);
  assert.equal(r.json.conform, false);
  assert.ok(hasRule(r.json, 'script'));
});

test('CLI <h5> 块 → 退出 1、含 block-tag', () => {
  const r = run(DOC('<h5>五级</h5>'));
  assert.equal(r.code, 1);
  assert.ok(hasRule(r.json, 'block-tag'));
});

test('CLI 表格 colspan → 退出 1、含 table-merge', () => {
  const r = run(DOC('<table class="ws-table"><tbody><tr><td colspan="2">m</td></tr></tbody></table>'));
  assert.equal(r.code, 1);
  assert.ok(hasRule(r.json, 'table-merge'));
});

test('CLI 容器嵌块（blockquote>ul）→ 退出 1、含 nested-block（不用 p 嵌 div，那会被 reparse 拆成 block-tag）', () => {
  const r = run(DOC('<blockquote><ul><li>a</li></ul></blockquote>'));
  assert.equal(r.code, 1);
  assert.ok(hasRule(r.json, 'nested-block'));
});

test('CLI 坏 toggle（无 summary）→ 退出 1、含 details-summary（U0 的门 end-to-end）', () => {
  const r = run(DOC('<details><p>x</p></details>'));
  assert.equal(r.code, 1);
  assert.ok(hasRule(r.json, 'details-summary'));
});

test('CLI 不存在的文件 → 退出码 2、stderr 有提示', () => {
  const r = spawnSync('node', [CLI, path.join(TMP, 'nope-does-not-exist.html')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /读不了文件/);
});

test('CLI 无参数 → 退出码 2、打印用法', () => {
  const r = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /用法/);
});
