// 文档反色滤镜配方（U3 spike 定稿 = U6 真 app 直接复用的唯一正本）。纯逻辑,无 DOM/electron,可单测。
//
// 机理:invert(1) hue-rotate(180deg) → 亮度翻转、色相大体保留(蓝仍蓝);媒体元素二次施同款滤镜 =
// 反反色(把图片/视频还原真色)。CSS filter 沿子树复合,父子各一次 invert 相互抵消,故媒体回原色。
//
// ⚠ 选择器钉死 html(documentElement),不是 body,两条硬理由:
//   ① 编辑器活跃 UI(手柄/格式条/斜杠菜单)挂在 documentElement 下、是 body 的兄弟节点——
//      挂 body 它们整体逃出滤镜、以浅色白菜单浮在暗文档上;
//   ② Filter Effects 规范只豁免根元素:非根元素 filter≠none 会给 fixed/absolute 后代创建包含块
//      (本仓在 transform 入场动画上栽过同类劫持),挂 html 则 fixed 定位不被劫持。
//
// ⚠ 移植警示(ui-demo spike → 真 app):
//   ① ui-demo 用容器滤镜(Canvas .ws-doc 是非根,有包含块副作用,子树内 fixed 浮层必须 portal 出去);
//      真 app 用根滤镜(iframe 的 html,有规范豁免)。几何行为不同,别照搬挂载元素。
//   ② 真 app 里 themeSource 会把 prefers-color-scheme 翻进文档 iframe,自带 @media(dark) 的文档会
//      先自行变暗——这个输入类在 ui-demo spike 里不存在(BasicEditor iframe 媒询跟 OS 不跟 data-theme),
//      配方移植后须在真 app 用自适暗 fixture 重校 isAlreadyDark 的判定。
'use strict';

const FILTER = 'invert(1) hue-rotate(180deg)';
// 媒体元素:施同款滤镜抵消根滤镜 = 还原真色。背景图元素也要(内联 background-image)。
const MEDIA_SELECTORS = 'img, video, canvas, svg image, picture, [style*="background-image"]';

// 生成滤镜规则文本。rootSelector: iframe 内注入用 'html'(=documentElement);
// ui-demo 容器场景用具体容器类名。bg 强制白 → 被 invert 翻成近黑,保证无背景声明的浅色文档也有暗画布。
function recipeCss(rootSelector) {
  const root = rootSelector || 'html';
  return (
    `${root}{filter:${FILTER} !important;background-color:#ffffff !important;}` +
    `${root} :is(${MEDIA_SELECTORS}){filter:${FILTER};}`
  );
}

// 「已暗文档」判定:采样有效画布色(html→body,半透明向白合成)算相对亮度,低于阈值 = 已暗 → 跳过滤镜。
// luminanceOf: (colorString) => number|null（注入 src/lib/luminance 的 relativeLuminance,便于单测）。
// samples: 有序候选背景色串数组（如 [htmlBg, bodyBg]）,取第一个非透明的;全透明 = 浅色(返回 false)。
// threshold: 默认 0.35——低于此判为「文档本身已暗」。
function isAlreadyDark(luminanceOf, samples, threshold) {
  const t = typeof threshold === 'number' ? threshold : 0.35;
  const list = Array.isArray(samples) ? samples : [samples];
  for (const s of list) {
    if (!s) continue;
    const str = String(s).trim().toLowerCase();
    if (!str || str === 'transparent') continue;
    // 完全透明(alpha 0)视为浅色/无声明:跳过这个候选,继续找下一个。
    const m = str.match(/rgba?\([^)]*[,/]\s*0?\.?0*\s*\)/);
    if (m && /[,/]\s*0(\.0+)?\s*\)$/.test(str)) continue;
    const lum = luminanceOf(str);
    if (lum == null) continue;
    return lum < t; // 找到第一个有效画布色即定夺
  }
  return false; // 全透明/无有效色 = 浅色文档 → 施滤镜
}

module.exports = { FILTER, MEDIA_SELECTORS, recipeCss, isAlreadyDark };
