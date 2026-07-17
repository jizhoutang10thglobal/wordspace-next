// i18n renderer 胶水。wsT 本体由 preload 同步建好(window.wsT，见 preload.js)；本文件只管两件事：
//   ① boot 时把 index.html 静态外壳(标了 data-i18n* 属性的元素)按当前语言写进 DOM;
//   ② 语言切换(main 广播 language-changed)→ 整窗 reload——静态外壳建一次不重建，reload 最省，
//      reload 后 preload 用新语言重建 wsT + 本文件重刷静态外壳(plan 决策1)。
// 动态构建的 UI(sidebar/shell/编辑器菜单/toast…)各模块直接调 window.wsT，不经本文件。
(function () {
  var T = typeof window.wsT === 'function' ? window.wsT : function (k) { return k; };

  // 快捷键字形平台归一(#227 kbd:mac 保 ⌘/其他 ⌘→Ctrl+)。i18n-ui 用字典值(含 ⌘)覆盖 title 会撤销
  // sidebar.js 启动时对静态 title 的归一,故这里对 title 再过一次 kbd(非快捷键文案里没 ⌘/⇧,kbd 无影响)。
  var kbd = typeof window.__wsKbd === 'function' ? window.__wsKbd : function (s) { return s; };

  // data-i18n=key → textContent；data-i18n-title/ph/aria/alt=key → 对应属性。
  function applyStatic(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = T(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', kbd(T(el.getAttribute('data-i18n-title'))));
    });
    root.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      el.setAttribute('placeholder', T(el.getAttribute('data-i18n-ph')));
    });
    root.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', T(el.getAttribute('data-i18n-aria')));
    });
    root.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
      el.setAttribute('alt', T(el.getAttribute('data-i18n-alt')));
    });
  }

  function boot() {
    // <html lang> 跟随当前语言(a11y / 拼写检查)。
    try { document.documentElement.lang = window.wsLang === 'en' ? 'en' : 'zh-CN'; } catch (e) { /* noop */ }
    applyStatic(document);
    if (window.ws2 && window.ws2.onLanguageChanged) {
      window.ws2.onLanguageChanged(function () {
        // 语言变了 → 整窗 reload。已保存文档有自动保存兜底；未保存的临时文档在此(用户主动切语言)会丢，记欠账。
        try { location.reload(); } catch (e) { /* noop */ }
      });
    }
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 供其它模块在动态插入静态外壳片段后手动重刷(如设置页渲染完)。
  window.__wsI18n = { apply: applyStatic, t: T };
})();
