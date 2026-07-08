// electron-builder afterPack 钩子（仅冒烟构建用）：把打包产物 asar 内 package.json 的
// name/productName 改成 "Wordspace Smoke"，让运行时 app.getName() 解析成独立身份 → userData 隔离，
// 不与生产版 Wordspace Next 共用 ~/Library/Application Support/wordspace-next（撞锁 + 碰真实数据）。
//
// 为什么不用 electron-builder 的 extraMetadata：实测它会把合并后的精简 package.json 写回**源文件**，
// 删掉 build/scripts/devDependencies（file-associations 单测因此变红）。afterPack 只改打包产物 asar，源文件不动。
// 修改 asar 安全：Electron dist 的 adhoc 签名 Sealed Resources=none，app.asar 不在签名封存范围（实测重打包后 app 照常启动）。
const path = require('path');
const fs = require('fs');
const os = require('os');
const asar = require('@electron/asar');

exports.default = async function smokeAfterPack(context) {
  const appDir = fs.readdirSync(context.appOutDir).find((f) => f.endsWith('.app'));
  if (!appDir) { console.warn('  • smoke afterPack: 没找到 .app，跳过'); return; }
  const asarPath = path.join(context.appOutDir, appDir, 'Contents', 'Resources', 'app.asar');
  if (!fs.existsSync(asarPath)) { console.warn('  • smoke afterPack: 没找到 app.asar，跳过'); return; }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-asar-'));
  asar.extractAll(asarPath, tmp);
  const pjPath = path.join(tmp, 'package.json');
  const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
  pj.name = 'wordspace-smoke';
  pj.productName = 'Wordspace Smoke'; // app.getName() 优先读 productName → userData = "Wordspace Smoke"
  fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2), 'utf8');
  await asar.createPackage(tmp, asarPath);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('  • smoke afterPack: asar package.json name/productName → Wordspace Smoke（userData 隔离）');
};
