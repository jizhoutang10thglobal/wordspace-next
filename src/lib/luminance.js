// 纯逻辑:sRGB → WCAG 相对亮度 + 对比度比值 + 颜色解析。
// 双载:node/vitest `require`(module.exports) + renderer 经 <script> 用全局 WS2Luminance(无 require,S3)。
// 一份共用:U1 palette 自检、U4 chrome 亮度门、U6 已暗启发式、U7 对比度门,别各写各的。
(function (root) {
  'use strict';

  // 解析 #rgb / #rrggbb / rgb(...) / rgba(...) → {r,g,b,a}（0-255,a 0-1）。
  // 半透明可选合成到 over 背景（默认白），供「已暗启发式向白合成」之类口径复用。
  function parseColor(input, over) {
    if (input == null) return null;
    const s = String(input).trim();
    if (!s) return null;
    let r, g, b, a = 1;
    if (s[0] === '#') {
      let hex = s.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      if (hex.length === 8) { a = parseInt(hex.slice(6, 8), 16) / 255; hex = hex.slice(0, 6); }
      if (hex.length !== 6) return null;
      r = parseInt(hex.slice(0, 2), 16); g = parseInt(hex.slice(2, 4), 16); b = parseInt(hex.slice(4, 6), 16);
    } else {
      const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)/i);
      if (!m) return null;
      r = +m[1]; g = +m[2]; b = +m[3];
      if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    }
    if (![r, g, b].every((v) => Number.isFinite(v))) return null;
    if (a < 1 && over) {
      const bg = parseColor(over) || { r: 255, g: 255, b: 255 };
      r = Math.round(r * a + bg.r * (1 - a));
      g = Math.round(g * a + bg.g * (1 - a));
      b = Math.round(b * a + bg.b * (1 - a));
      a = 1;
    }
    return { r, g, b, a };
  }

  function channel(v) {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  // WCAG 相对亮度 0(黑)..1(白)。入参可为 {r,g,b} 或颜色字符串。
  function relativeLuminance(color) {
    const c = typeof color === 'string' ? parseColor(color) : color;
    if (!c) return null;
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }

  // WCAG 对比度比值(1..21)。入参可为字符串或 {r,g,b}。
  function contrastRatio(fg, bg) {
    const l1 = relativeLuminance(fg);
    const l2 = relativeLuminance(bg);
    if (l1 == null || l2 == null) return null;
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  const api = { parseColor, relativeLuminance, contrastRatio };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WS2Luminance = api;
})(typeof window !== 'undefined' ? window : globalThis);
