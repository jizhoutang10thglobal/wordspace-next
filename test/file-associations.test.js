// 打包 fileAssociations ↔ app 实际支持的文档扩展名 双向防漂移锁。
// Bug 背景（2026-07-05 报告）：md 后端上线时 package.json 的 fileAssociations 没跟着加 md，
// 装出来的 Info.plist（CFBundleDocumentTypes）不含 .md → macOS「打开方式」里 Wordspace 灰的、
// 没法绑定/双击打开。这个配置只在安装包生效、跑 app 测不出来，所以用配置锁兜底：
// ① app 认的每个可编辑扩展名（html/htm/md，与 assertDocPath / htmlPathFromArgv 口径一致）
//    在 mac 和 win 的 fileAssociations 里都必须声明——防「app 学会了新格式、系统绑定忘了加」。
// ② 反向：fileAssociations 声明的每个扩展名 app 必须真认——防「绑了 .markdown 之类，
//    双击启动了 app 却被 assertDocPath 拒开」的半死状态。
const test = require('node:test');
const assert = require('node:assert');
const pkg = require('../package.json');
const { htmlPathFromArgv } = require('../src/lib/path-url');

const DOC_EXTS = ['html', 'htm', 'md']; // 可编辑文档口径的单一列举（变更时两个方向都会翻红提醒）
// 查看器类型（只看不编，fileAssociations role=Viewer）：双击/「打开方式」进内置查看器。
// 2026-07-17 +pdf（Wendi「PDF 默认打开设为 Wordspace」——此前没声明，macOS 打开方式里根本选不了）。
const VIEWER_EXTS = ['pdf'];

const declaredExts = (platform) => {
  const assocs = (pkg.build && pkg.build[platform] && pkg.build[platform].fileAssociations) || [];
  return assocs.flatMap((a) => a.ext);
};

for (const platform of ['mac', 'win']) {
  test(`fileAssociations(${platform})：app 认的每个扩展名都已声明（文档 + 查看器）`, () => {
    const declared = declaredExts(platform);
    for (const ext of [...DOC_EXTS, ...VIEWER_EXTS]) {
      assert.ok(declared.includes(ext), `build.${platform}.fileAssociations 缺 "${ext}"`);
    }
  });

  test(`fileAssociations(${platform})：声明的每个扩展名 app 都真的认（不绑打不开的类型）`, () => {
    for (const ext of declaredExts(platform)) {
      assert.equal(
        htmlPathFromArgv(['app', `/abs/doc.${ext}`], '/cwd'),
        `/abs/doc.${ext}`,
        `声明了 "${ext}" 但 htmlPathFromArgv/assertDocPath 不认——双击会启动 app 却拒开文件`
      );
    }
  });
}

test('DOC_EXTS/VIEWER_EXTS 与 htmlPathFromArgv 口径一致（列举本身不许漂）', () => {
  for (const ext of [...DOC_EXTS, ...VIEWER_EXTS]) {
    assert.ok(htmlPathFromArgv(['app', `/x/a.${ext}`], '/c'), `app 不认 .${ext}，列举过期了`);
  }
});
