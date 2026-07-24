#!/usr/bin/env node
// Schema #1 校验 CLI —— 外部 agent「产出 .html/.md → 校验」文件式回路的「门」。
// 用法：node scripts/validate-schema.js <file.html|file.md>
//   stdout = 机器可读 JSON：{conform, violations:[{rule,tag,msg}]}
//   stderr = 人读摘要（✓ 合规 / ✗ 逐条 violation）
//   退出码：0 = conform；1 = 有 violation；2 = 用法错 / 读不了文件
// §4.3 铁律③：判「磁盘字节 reparse 出的 Document」——jsdom 正好干这个，不判活 DOM。
// .md（审计整改）：与 app 同一条链路——先过 md-adapter 的 mdToHtml 再校验（app 打开 .md 就是这么分流的）；
// 直接把裸 markdown 当 HTML 解析会给出「必不合规」的错误结论、误导 agent 反复瞎修。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { validate } = require('../src/lib/schema-validate.js');
const mdAdapter = require('../src/main/md-adapter.js'); // 纯字符串进出、无 electron 依赖，Node 直接可用
// schema-validate 的违规消息走 i18n t()；本 CLI 是 node 消费者(非 app)，必须自己 configureI18n，
// 否则 msg 出成裸 key 名(schema.blockNoStyle 而非「块级不能带 style 属性」)——AI 创作回路读的就是这个 msg。
// 默认 zh(保持 CLI 原中文输出);WS2_LANG=en 可切英文。
const i18n = require('../src/lib/i18n');
i18n.configureI18n(require('../src/i18n').ZH, require('../src/i18n').EN);
i18n.setActiveLang(process.env.WS2_LANG === 'en' ? 'en' : 'zh');

async function main(argv) {
  const p = argv[2];
  if (!p) {
    process.stderr.write('用法：node scripts/validate-schema.js <file.html|file.md>\n');
    return 2;
  }
  let html;
  try {
    html = fs.readFileSync(p, 'utf8');
  } catch (e) {
    process.stderr.write('读不了文件：' + p + '（' + ((e && e.message) || e) + '）\n');
    return 2;
  }
  const isMd = mdAdapter.isMdPath(p);
  if (isMd) {
    try {
      html = await mdAdapter.mdToHtml(html, { title: path.basename(p).replace(/\.md$/i, '') });
    } catch (e) {
      process.stderr.write('md→html 转换失败：' + ((e && e.message) || e) + '\n');
      return 2;
    }
  }
  // 修 KV-4：深嵌套（details/ul 深链）会让 jsdom 解析或 validate 递归 RangeError。原来不 catch → 崩，stdout 空、
  // exit 1 冒充「非合规」违反契约（外部 agent 会误读成「去改文档」）。翻车归到 exit 2（用法/处理错），与读不了文件同类。
  let r;
  try {
    const doc = new JSDOM(html).window.document;
    r = validate(doc);
  } catch (e) {
    process.stderr.write('校验失败（文档过深或畸形）：' + ((e && e.message) || e) + '\n');
    return 2;
  }
  process.stdout.write(JSON.stringify(r) + '\n');
  const via = isMd ? '（已按 md→html 转换后校验，与 app 打开 .md 的分流同链路）' : '';
  if (r.conform) {
    process.stderr.write('✓ 合规' + via + '\n');
  } else {
    process.stderr.write('✗ 不合规（' + r.violations.length + ' 处）' + via + '：\n');
    for (const x of r.violations) process.stderr.write('  [' + x.rule + '] <' + x.tag + '> ' + x.msg + '\n');
  }
  return r.conform ? 0 : 1;
}

if (require.main === module) main(process.argv).then((code) => process.exit(code));
module.exports = { main };
