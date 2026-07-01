#!/usr/bin/env node
// Schema #1 校验 CLI —— 外部 agent「产出 .html → 校验」文件式回路的「门」。
// 用法：node scripts/validate-schema.js <file.html>
//   stdout = 机器可读 JSON：{conform, violations:[{rule,tag,msg}]}
//   stderr = 人读摘要（✓ 合规 / ✗ 逐条 violation）
//   退出码：0 = conform；1 = 有 violation；2 = 用法错 / 读不了文件
// §4.3 铁律③：判「磁盘字节 reparse 出的 Document」——jsdom 正好干这个，不判活 DOM。
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { validate } = require('../src/lib/schema-validate.js');

function main(argv) {
  const p = argv[2];
  if (!p) {
    process.stderr.write('用法：node scripts/validate-schema.js <file.html>\n');
    return 2;
  }
  let html;
  try {
    html = fs.readFileSync(p, 'utf8');
  } catch (e) {
    process.stderr.write('读不了文件：' + p + '（' + ((e && e.message) || e) + '）\n');
    return 2;
  }
  const doc = new JSDOM(html).window.document;
  const r = validate(doc);
  process.stdout.write(JSON.stringify(r) + '\n');
  if (r.conform) {
    process.stderr.write('✓ 合规\n');
  } else {
    process.stderr.write('✗ 不合规（' + r.violations.length + ' 处）：\n');
    for (const x of r.violations) process.stderr.write('  [' + x.rule + '] <' + x.tag + '> ' + x.msg + '\n');
  }
  return r.conform ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { main };
