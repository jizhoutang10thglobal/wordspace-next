#!/usr/bin/env node
// Shipping 真门 —— 验「造出来的 app 真签名 + 真公证了」，不是「CI 跑绿了」。
// 对应 docs/shipping-verification-checklist.md 的 声称2(签名) / 声称3(公证+staple)。
// 延续 host-verify.js 的「别信绿、真验产物」文化，只是对象从 renderer 视觉换成 shipping 产物。
//
// 只能在 macOS 宿主跑（codesign / spctl / stapler 是 mac 系统工具，容器没有）。
// 天然是变异探针(声称6)：指向未签名 build（如 `electron-builder --dir` 的产物）必全红 → 证门有牙。
//
// 用法：
//   node scripts/shipping-verify.js                  # 自动找 release/ 下的 .app（+ .dmg）
//   node scripts/shipping-verify.js path/to/X.app    # 指定 .app
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');

function sh(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || e.message || '') };
  }
}

function findApp(arg) {
  if (arg && arg.endsWith('.app')) return arg;
  if (!fs.existsSync(RELEASE)) return null;
  for (const d of fs.readdirSync(RELEASE).filter((x) => x.startsWith('mac'))) {
    const dir = path.join(RELEASE, d);
    if (!fs.lstatSync(dir).isDirectory()) continue; // mac* 可能是文件（如 mac.zip）或坏符号链接，跳过免 ENOTDIR/ENOENT 崩
    const app = fs.readdirSync(dir).find((f) => f.endsWith('.app'));
    if (app) return path.join(dir, app);
  }
  return null;
}

function findDmg() {
  if (!fs.existsSync(RELEASE)) return null;
  const dmg = fs.readdirSync(RELEASE).find((f) => f.endsWith('.dmg'));
  return dmg ? path.join(RELEASE, dmg) : null;
}

const issues = [];
function check(name, pass, detail) {
  console.log(`  ${pass ? '✓' : '✗'} ${name}${pass ? '' : '  ::  ' + (detail || '').split('\n')[0]}`);
  if (!pass) issues.push(name);
}

const appPath = findApp(process.argv[2]);
if (!appPath || !fs.existsSync(appPath)) {
  console.log('找不到 .app —— 先用 electron-builder 打包出 release/，或传入 .app 路径。');
  process.exit(1);
}
console.log(`▶ Shipping 真门: ${appPath}`);

// 声称 2：真签名（codesign --verify 无报错；身份是 Developer ID Application）
const verify = sh(`codesign --verify --deep --strict --verbose=2 "${appPath}"`);
check('声称2 codesign --verify 无报错', verify.ok, verify.out);
const auth = sh(`codesign -dvv "${appPath}" 2>&1`);
check(
  '声称2 签名身份 = Developer ID Application',
  /Authority=Developer ID Application/.test(auth.out),
  '未签名/adhoc: ' + ((auth.out.match(/Authority=.*/) || ['(无 Authority 行)'])[0]),
);

// 声称 3：真公证 + 通行证 staple（.app 用 --type execute，dmg/pkg 才用 install）
const assess = sh(`spctl --assess --type execute --verbose "${appPath}" 2>&1`);
check(
  '声称3 spctl accepted + Notarized Developer ID',
  /: accepted/.test(assess.out) && /source=Notarized Developer ID/.test(assess.out),
  assess.out,
);
const staple = sh(`xcrun stapler validate "${appPath}" 2>&1`);
check('声称3 stapler validate 通过', /The validate action worked/.test(staple.out), staple.out);

// dmg 顺带验（下载入口；dmg 用 --type install）
const dmg = findDmg();
if (dmg) {
  const dmgAssess = sh(`spctl --assess --type install --verbose "${dmg}" 2>&1`);
  check('声称3 dmg spctl install accepted', /: accepted/.test(dmgAssess.out), dmgAssess.out);
}

console.log('\n════════════════════════════════════════════');
if (issues.length) {
  console.log('❌ Shipping 真门否决（签名/公证未真生效）：');
  issues.forEach((i) => console.log('   - ' + i));
  console.log('   指向未签名 build 时本就该全红 = 门有牙；指向真发布 build 还红 = 签名/公证坏了，别发这版。');
  console.log('════════════════════════════════════════════');
  process.exit(1);
}
console.log('✅ Shipping 真门通过：app 真签名 + 真公证 + 通行证已 staple。');
console.log('ℹ 声称5（两版本自动更新）是 U6 的活：需两个真签名版本，装 v1 看是否自动更新到 v2。');
console.log('  见 docs/shipping-verification-checklist.md §声称5。');
console.log('════════════════════════════════════════════');
