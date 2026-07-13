// 文件日志单测：写行、轮转、错误不抛。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createFileLogger } = require('../src/lib/file-log');

const tmpFile = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws2-log-')), name);

test('写入带时间戳与级别的行；Error 记 stack；对象 JSON 化', () => {
  const f = tmpFile('u.log');
  const log = createFileLogger(f);
  log.info('hello', { a: 1 });
  log.warn('careful');
  log.error(new Error('boom'));
  // Error 的 stack 多行落盘（排查要看全栈）→ 条目按时间戳前缀数，不按物理行
  const entries = fs.readFileSync(f, 'utf8').trim().split('\n').filter((l) => /^\d{4}-\d{2}-\d{2}T/.test(l));
  assert.strictEqual(entries.length, 3);
  assert.match(entries[0], /\[info\] hello \{"a":1\}$/);
  assert.match(entries[1], /\[warn\] careful$/);
  assert.ok(entries[2].includes('[error]') && entries[2].includes('boom'));
});

test('超过 maxBytes 轮转到 .old，新文件从头写', () => {
  const f = tmpFile('r.log');
  const log = createFileLogger(f, { maxBytes: 200 });
  for (let i = 0; i < 10; i++) log.info('x'.repeat(50), i);
  assert.ok(fs.existsSync(f + '.old'));
  assert.ok(fs.statSync(f).size < 400); // 轮转后新文件有界
  assert.ok(fs.statSync(f + '.old').size < 400); // 旧文件同样有界（每次轮转覆盖上一代，总量恒 ≤ 两代）
  assert.ok(fs.readFileSync(f, 'utf8').includes(' 9')); // 最近的日志永远在当前文件里
});

test('目录建不出来时静默放弃、绝不抛', () => {
  // 拿一个真实文件当「父目录」→ mkdir 必失败
  const blocker = tmpFile('plain-file');
  fs.writeFileSync(blocker, 'x');
  const log = createFileLogger(path.join(blocker, 'sub', 'u.log'));
  assert.doesNotThrow(() => { log.info('a'); log.error(new Error('b')); log.debug('c'); });
});
