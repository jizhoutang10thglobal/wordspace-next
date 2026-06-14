// 跨平台：本地绝对路径 → 渲染层加载文档所需的 { fileUrl, dirUrl, name }。
// 关键：用 Node 内置 url.pathToFileURL —— 它在 Windows 上正确处理盘符（C:\ → file:///C:/）、
// 反斜杠、UNC 路径，并按 RFC 3986 编码空格 / 中文 / # / ? 等。renderer 自己拼 'file://' + split('/')
// 是 POSIX-only 的，Windows 上产出畸形 URL、文档加载不出来——这是本模块要根除的 bug。
//
// 纯 Node 模块（无 require('electron')）→ node:test 可在 node 环境直接 require（CLAUDE.md S1 教训）。
// pathToFileURL / path 按运行平台取语义（Windows 上即 win32），所以同一份代码在 mac/win 各自正确。
const path = require('path');
const { pathToFileURL } = require('url');

function withTrailingSlash(u) {
  return u.endsWith('/') ? u : u + '/';
}

// 给定本地文件绝对路径，返回渲染层真实 file:// 载入 + 显示所需的全部派生值（已按平台正确编码）。
function pathInfo(p) {
  return {
    fileUrl: pathToFileURL(p).href, // file:///... 指向文档本身，iframe src 直接用
    // 目录 URL 带尾斜杠：作 srcdoc 历史恢复时的 <base href>，让相对资源正确解析到原文件目录
    dirUrl: withTrailingSlash(pathToFileURL(path.dirname(p)).href),
    name: path.basename(p), // 纯文件名，标题栏 / 最近列表显示
  };
}

// 从进程 argv 选出第一个 .html/.htm 文件参数，解析为绝对路径（Windows/Linux 双击文件经 argv 传入，
// macOS 走 open-file 事件不经此）。cwd 显式传入：second-instance 时要用「第二次启动」的工作目录
// （Electron second-instance 事件的 workingDirectory），而非当前已运行实例的 process.cwd()。
// 纯函数（仅 path）→ 可单测，给「无 Windows 机器」补一层自动化覆盖。
function htmlPathFromArgv(argv, cwd) {
  const a = (argv || []).slice(1).find((x) => /\.html?$/i.test(x));
  return a ? path.resolve(cwd || process.cwd(), a) : null;
}

module.exports = { pathInfo, withTrailingSlash, htmlPathFromArgv };
