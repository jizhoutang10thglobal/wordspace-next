// S6 编辑的纯逻辑（不带 require('electron')，vitest 直测——S1 教训）。
// DOM 读写、localStorage、事件接线在 renderer；这里只管「粘贴文本怎么规范」「算不算编辑过」。

// 剪贴板纯文本规范化：换行统一为 \n（Windows \r\n、老 Mac \r 都归一），其余原样。
// 不 trim、不去空格——粘贴语义是「原文进来」，只去样式不去内容。
function normalizePasteText(raw) {
  return String(raw == null ? '' : raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// 脏标记判定：当前文档串 ≠ 基线串即「编辑过」。
// 基线必须是「内置文档渲染完成后的 innerHTML 快照」，不是源文件字符串——
// 浏览器序列化会做属性引号/实体等规范化，拿源串比对会恒报已编辑。
function isEdited(currentHtml, baselineHtml) {
  return String(currentHtml == null ? '' : currentHtml) !== String(baselineHtml == null ? '' : baselineHtml);
}

module.exports = { normalizePasteText, isEdited };
