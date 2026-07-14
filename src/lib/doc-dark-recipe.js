// 文档反色滤镜配方（U3 spike 定稿 = U6 真 app 直接复用的唯一正本）。纯逻辑,无 DOM/electron。
// 双载:node/vitest `require` + renderer 经 <script> 用全局 WS2DocDark(无 require,S3)。
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
//   ① ui-demo 用容器滤镜(非根,有包含块副作用,子树内 fixed 浮层要 portal 出去);真 app 用根滤镜(iframe html,豁免)。
//   ② 真 app 里 themeSource 会把 prefers-color-scheme 翻进文档 iframe,自带 @media(dark) 的文档会先自暗——
//      这个输入类在 ui-demo spike 里不存在,配方移植后须在真 app 用自适暗 fixture 重校 isAlreadyDark。
(function (root) {
  'use strict';

  const FILTER = 'invert(1) hue-rotate(180deg)';
  const MEDIA_SELECTORS = 'img, video, canvas, svg image, picture, [style*="background-image"]';

  // 生成滤镜规则文本。rootSelector: iframe 内注入用 'html'。bg 强制白 → 被 invert 翻近黑,保证无背景声明的浅色文档也有暗画布。
  function recipeCss(rootSelector) {
    const rootSel = rootSelector || 'html';
    return (
      rootSel + '{filter:' + FILTER + ' !important;background-color:#ffffff !important;}' +
      rootSel + ' :is(' + MEDIA_SELECTORS + '){filter:' + FILTER + ';}'
    );
  }

  // 「已暗文档」判定:采样有效画布色(html→body,半透明/透明视为浅色),低于阈值 = 已暗 → 跳过滤镜。
  // luminanceOf: (colorString)=>number|null;samples: 有序候选背景色串;threshold 默认 0.35。
  function isAlreadyDark(luminanceOf, samples, threshold) {
    const t = typeof threshold === 'number' ? threshold : 0.35;
    const list = Array.isArray(samples) ? samples : [samples];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s) continue;
      const str = String(s).trim().toLowerCase();
      if (!str || str === 'transparent') continue;
      if (/[,/]\s*0(\.0+)?\s*\)$/.test(str)) continue; // alpha 0 = 浅色,顺延下一个候选
      const lum = luminanceOf(str);
      if (lum == null) continue;
      return lum < t;
    }
    return false; // 全透明/无有效色 = 浅色文档 → 施滤镜
  }

  const api = { FILTER, MEDIA_SELECTORS, recipeCss, isAlreadyDark };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WS2DocDark = api;
})(typeof window !== 'undefined' ? window : globalThis);
