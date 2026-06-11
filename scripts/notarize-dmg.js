// electron-builder afterAllArtifactBuild hook：给 dmg 补公证 + staple（B 瑕疵①）。
// electron-builder 的 mac.notarize:true 只公证 .app；dmg 容器不公证的话，
// 下载打开 dmg 仍有「从网上下载」提示——checklist 声称4 的金标准是零提示。
// dmg 签名由 build.dmg.sign:true 负责（公证前提）；这里 notarytool submit --wait + stapler staple。
// 缺 Apple 凭证（本地 unsigned dry-run）则跳过，不挡本地打包。
const { execFileSync } = require('child_process');

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
  }
  return [];
};
