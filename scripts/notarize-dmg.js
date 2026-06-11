// electron-builder afterAllArtifactBuild hook：给 dmg 补公证 + staple（B 瑕疵①）。
// electron-builder 的 mac.notarize:true 只公证 .app；dmg 容器不公证的话，
// 下载打开 dmg 仍有「从网上下载」提示——checklist 声称4 的金标准是零提示。
// dmg 签名由 build.dmg.sign:true 负责（公证前提）；这里 notarytool submit --wait + stapler staple。
// 缺 Apple 凭证（本地 unsigned dry-run）则跳过，不挡本地打包。
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// staple 会改 dmg 文件内容。若 latest-mac.yml 在本 hook 之前已生成，里面 dmg 条目的
// sha512/size 就是 staple 前的旧值——元数据撒谎（auto-update 本身走 zip、不受影响，但不能留）。
// staple 完逐条修正；yml 在 hook 之后才生成的话这里没有文件可修、checksum 天然算在新文件上。
function patchUpdateInfo(dmg) {
  const ymlPath = path.join(path.dirname(dmg), 'latest-mac.yml');
  if (!fs.existsSync(ymlPath)) return;
  const name = path.basename(dmg);
  const sha512 = crypto.createHash('sha512').update(fs.readFileSync(dmg)).digest('base64');
  const size = fs.statSync(dmg).size;
  const lines = fs.readFileSync(ymlPath, 'utf8').split('\n');
  const urlIdx = lines.findIndex((l) => l.includes(`url: ${name}`));
  if (urlIdx === -1) return;
  for (let i = urlIdx + 1; i < lines.length && !lines[i].includes('- url:'); i++) {
    if (/^\s+sha512:/.test(lines[i])) lines[i] = lines[i].replace(/sha512:.*/, `sha512: ${sha512}`);
    if (/^\s+size:/.test(lines[i])) lines[i] = lines[i].replace(/size:.*/, `size: ${size}`);
  }
  fs.writeFileSync(ymlPath, lines.join('\n'));
  console.log(`[notarize-dmg] ✓ latest-mac.yml 的 dmg sha512/size 已按 staple 后文件修正`);
}

exports.default = async function notarizeDmg(context) {
  const dmgs = (context.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  if (dmgs.length === 0) return [];

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize-dmg] 缺 Apple 凭证环境变量，跳过 dmg 公证（本地 dry-run 的正常路径）');
    return [];
  }

  for (const dmg of dmgs) {
    console.log(`[notarize-dmg] notarytool submit --wait: ${dmg}（第二轮 Apple 队列，可能再等几分钟）`);
    execFileSync('xcrun', [
      'notarytool', 'submit', dmg,
      '--apple-id', APPLE_ID,
      '--password', APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id', APPLE_TEAM_ID,
      '--wait',
    ], { stdio: 'inherit' });
    execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
    console.log(`[notarize-dmg] ✓ dmg 已公证并 staple: ${dmg}`);
    patchUpdateInfo(dmg);
  }
  return [];
};
