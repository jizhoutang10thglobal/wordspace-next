// 真 app 文档反色滤镜（U6）。深色下给 #doc-frame 的 contentDocument 注反色滤镜（配方 = WS2DocDark），
// 可摘除、零入盘（adoptedStyleSheets 不在 DOM、不进序列化）。三条渲染路径（file:// / srcdoc / reload）
// 全覆盖：注入 + 采样统一在 onload（与 applyZoom 同点位，样式已生效才采得准）。
// 防白闪走「导航期遮罩」：载入起点遮住 frame，syncDocDark 判完一次性揭开——深/浅文档都零闪。
// 主题实时切换（nativeTheme → prefers-color-scheme 变）对 live 文档注/摘，不重挂。
// realm 铁律：CSSStyleSheet 必须取自 iframe realm（linkview.js:47），跨 realm 会被 adoptedStyleSheets 拒收。
(function (root) {
  'use strict';
  const FRAME_ID = 'doc-frame';
  function frameEl() { return document.getElementById(FRAME_ID); }
  function effectiveDark() {
    return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  let darkSheet = null; // 绑当前 contentDocument；换文档后 includes() 判不到即重建

  // 载入起点：深色下遮住 frame（visibility:hidden 保留布局、不影响 iframe 内 rect 测量），防未反色白闪。
  function maskForLoad() {
    const f = frameEl();
    if (f && effectiveDark()) f.style.visibility = 'hidden';
  }
  function unmask() {
    const f = frameEl();
    if (f) f.style.visibility = '';
  }

  function removeSheet(cd) {
    if (darkSheet && cd && cd.adoptedStyleSheets.includes(darkSheet)) {
      cd.adoptedStyleSheets = cd.adoptedStyleSheets.filter((s) => s !== darkSheet);
    }
    darkSheet = null;
  }

  function applyOrRemove(cd, cw, dark) {
    if (!dark) { removeSheet(cd); return; }
    // 已暗启发式：采样 html→body 有效背景（此刻样式已生效），透明/半透明视为浅色。
    const htmlBg = cw.getComputedStyle(cd.documentElement).backgroundColor;
    const bodyBg = cd.body ? cw.getComputedStyle(cd.body).backgroundColor : '';
    const lum = root.WS2Luminance && root.WS2Luminance.relativeLuminance;
    if (root.WS2DocDark && lum && root.WS2DocDark.isAlreadyDark(lum, [htmlBg, bodyBg])) {
      removeSheet(cd); return; // 文档本身已暗 → 不二次反转
    }
    if (darkSheet && cd.adoptedStyleSheets.includes(darkSheet)) return; // 防重注
    try {
      darkSheet = new (cw.CSSStyleSheet || CSSStyleSheet)(); // realm：取自 iframe window
      darkSheet.replaceSync(root.WS2DocDark.recipeCss('html'));
      cd.adoptedStyleSheets = [...cd.adoptedStyleSheets, darkSheet];
    } catch (e) { /* 构造样式表不可用：放弃反色，不影响编辑 */ }
  }

  // 对当前 contentDocument 注/摘反色滤镜；无论注没注，判完都揭开遮罩。
  function syncDocDark() {
    const f = frameEl();
    if (!f) return;
    try {
      const cd = f.contentDocument, cw = f.contentWindow;
      if (cd && cw) applyOrRemove(cd, cw, effectiveDark());
    } catch (e) { /* contentDocument 跨源/不可达：忽略 */ } finally {
      unmask();
    }
  }

  // 主题实时切换：live 文档注/摘（frame 可见时才动）。
  if (root.matchMedia) {
    const mql = root.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { const f = frameEl(); if (f && !f.hidden && f.contentDocument) syncDocDark(); };
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange);
  }

  root.WS2DocTheme = { maskForLoad, syncDocDark, unmask, effectiveDark };
})(window);
