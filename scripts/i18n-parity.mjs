// 字典中英一致性检查（真 app 版，配合 i18n-scan 的第二道门）。
// 逐命名空间比对 zh/en 的 key 集：
//   - zh 有、en 无 → en 缺翻译（警告，不阻断：运行时 fallback 到 zh，界面能用；但该补，PR 列出来）。
//   - en 有、zh 无 → en 多余 key（阻断：zh 是源语言，en 冒出 zh 没有的 key = 拼错/死键，永远取不到）。
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const I18N = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'i18n');

const namespaces = readdirSync(join(I18N, 'zh')).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
let missing = 0;
let extra = 0;
const missingList = [];
const extraList = [];

for (const ns of namespaces) {
  const zh = Object.keys(require(join(I18N, 'zh', ns + '.js')));
  const en = Object.keys(require(join(I18N, 'en', ns + '.js')));
  const enSet = new Set(en);
  const zhSet = new Set(zh);
  for (const k of zh) if (!enSet.has(k)) { missing++; missingList.push(`${ns}.${k}`); }
  for (const k of en) if (!zhSet.has(k)) { extra++; extraList.push(`${ns}.${k}`); }
}

if (missing) console.warn(`⚠ en 缺 ${missing} 个翻译（fallback 到中文，不阻断；建议补齐）：\n  ${missingList.join('\n  ')}\n`);
if (extra) console.error(`✗ en 有 ${extra} 个 zh 没有的多余 key（拼错/死键，阻断）：\n  ${extraList.join('\n  ')}\n`);

if (extra) process.exit(1);
console.log(`✓ i18n-parity: zh/en key 对齐${missing ? `（en 缺 ${missing} 个，走 fallback）` : ''}`);
