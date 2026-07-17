// mac app bundle 归属修复的纯逻辑（路径推导 + 提权命令构造）。不带 require('electron')，vitest 直测（S1）。
//
// 背景（2026-07-16 实锤，Colin 机器）：某次更新走了 Squirrel ShipIt 的提权兜底后，
// /Applications/Wordspace Next.app 整个 bundle 变成 root:wheel 所有——此后每次更新替换 bundle
// 都需要管理员授权（密码/指纹弹窗），且提权装出来的新 bundle 又是 root 的 → 死循环。
// 修法：装更新前检测 bundle 是否当前用户可写，不可写则提示用户授权一次，把归属 chown 回当前用户；
// 之后 ShipIt 恢复无提权替换，更新永久免密。这里只做两件纯函数的事，真正的 access 检查/弹窗/execFile 在 main。

// 从主进程可执行文件路径推导 .app bundle 根：/Applications/X.app/Contents/MacOS/X → /Applications/X.app。
// 取「最外层」以 .app 结尾的段（对 Helper 内的路径也修最外层 bundle——chown 目标始终是整个安装单元）。
// 推不出（开发态 node_modules/electron/dist/Electron.app 也能推出，但调用方以 app.isPackaged 闸住）返回 null。
function bundlePathFromExe(exePath) {
  if (typeof exePath !== 'string' || !exePath.startsWith('/')) return null;
  const segs = exePath.split('/');
  for (let i = 1; i < segs.length - 1; i++) { // 最后一段是可执行文件本身，bundle 不可能是它
    if (segs[i].endsWith('.app')) return segs.slice(0, i + 1).join('/');
  }
  return null;
}

// POSIX shell 单引号包裹（内部单引号用 '\'' 逃逸）——路径进 shell 的唯一安全形态。
function shellSingleQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// AppleScript 字符串字面量转义（反斜杠先行，再双引号）。
function appleScriptQuote(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// 构造 execFile('osascript', args) 的 args：以管理员权限 chown -R <uid> <bundle>。
// uid 走数字校验（绝不接受字符串拼接进命令）；chown 只改属主不动属组——owner 可写即满足 ShipIt 无提权替换。
function buildRepairArgs(uid, bundlePath) {
  if (!Number.isInteger(uid) || uid < 0) throw new Error('invalid uid: ' + uid);
  if (typeof bundlePath !== 'string' || !bundlePath.startsWith('/') || !bundlePath.endsWith('.app')) {
    throw new Error('invalid bundle path: ' + bundlePath);
  }
  const shellCmd = '/usr/sbin/chown -R ' + uid + ' ' + shellSingleQuote(bundlePath);
  return ['-e', 'do shell script ' + appleScriptQuote(shellCmd) + ' with administrator privileges'];
}

module.exports = { bundlePathFromExe, buildRepairArgs, shellSingleQuote, appleScriptQuote };
