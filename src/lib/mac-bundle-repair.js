// mac app bundle 路径推导（纯逻辑，不带 require('electron')，node:test 直测，S1）。
//
// 历史：这里原有 osascript+chown 提权修复命令构造（buildRepairArgs），已删——macOS App
// Management(TCC) 连 root 的 chown 都拦（2026-07-17 Colin 机器实锤：授权后每个文件
// Operation not permitted），应用内改自身 bundle 归属是死路。现只保留路径推导，供 main
// 检测 bundle 可写性后弹「授权说明」对话框（maybeExplainInstallAuth）。

// 从主进程可执行文件路径推导 .app bundle 根：/Applications/X.app/Contents/MacOS/X → /Applications/X.app。
// 取「最外层」以 .app 结尾的段（对 Helper 内的路径也归最外层 bundle——检测目标始终是整个安装单元）。
// 推不出返回 null（开发态由调用方以 app.isPackaged 闸住）。
function bundlePathFromExe(exePath) {
  if (typeof exePath !== 'string' || !exePath.startsWith('/')) return null;
  const segs = exePath.split('/');
  for (let i = 1; i < segs.length - 1; i++) { // 最后一段是可执行文件本身，bundle 不可能是它
    if (segs[i].endsWith('.app')) return segs.slice(0, i + 1).join('/');
  }
  return null;
}

module.exports = { bundlePathFromExe };
