// 外观三态的 renderer 侧胶水。chrome 暗色走 documentElement 的 [data-theme="dark"] 属性
// （不用 prefers-color-scheme：Electron 里 nativeTheme.themeSource 不 live 更新已加载 renderer 的媒询）。
// 职责：
//   ① 按 main 广播的 effective 主题挂/摘 documentElement 的 data-theme（chrome 全站随之变色）;
//   ② 三入口勾选态同步（⋯菜单三项 + settings 选择器，都从 main 查同一真相源 pref）;
//   ③ 切换时挂 [data-theme-switching] ~200ms 让 token 过渡（§4，reduced-motion 下 CSS 自动关）;
//   ④ 派发 window 'ws-theme-changed' 事件让 doc-theme.js 对 iframe 文档注/摘反色滤镜。
//   ⑤ 点 ⋯菜单三项 → ws2.setAppearance(pref)。
(function () {
  let currentPref = 'system';

  function applyDataTheme(effective) {
    const root = document.documentElement;
    if (effective === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    // 通知文档反色滤镜层（doc-theme.js 监听此事件按 data-theme 重判 iframe 滤镜）
    try { window.dispatchEvent(new CustomEvent('ws-theme-changed', { detail: { effective } })); } catch (e) { /* 老环境无 CustomEvent */ }
  }

  function applySwitchTransition() {
    const root = document.documentElement;
    root.setAttribute('data-theme-switching', '');
    setTimeout(() => root.removeAttribute('data-theme-switching'), 200);
  }

  function refreshPrefUI(pref) {
    currentPref = pref || 'system';
    document.querySelectorAll('.ws-appearance-item').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.pref === currentPref);
    });
    const sel = document.getElementById('wp-appearance-select');
    if (sel && sel.value !== currentPref) sel.value = currentPref;
  }

  function wireMenuItems() {
    document.querySelectorAll('.ws-appearance-item').forEach((el) => {
      if (el.dataset.wsAppWired) return;
      el.dataset.wsAppWired = '1';
      el.addEventListener('click', () => {
        if (window.ws2 && window.ws2.setAppearance) window.ws2.setAppearance(el.dataset.pref);
      });
    });
  }

  function boot() {
    wireMenuItems();
    if (window.ws2 && window.ws2.getEffectiveTheme) {
      window.ws2.getEffectiveTheme().then(applyDataTheme).catch(() => {});
      if (window.ws2.getAppearance) window.ws2.getAppearance().then(refreshPrefUI).catch(() => {});
      window.ws2.onAppearanceChanged((payload) => {
        const pref = payload && payload.pref;
        const effective = payload && payload.effective;
        applySwitchTransition();
        applyDataTheme(effective);
        refreshPrefUI(pref);
      });
    }
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.__wsAppearance = { getPref: () => currentPref, refresh: refreshPrefUI, wire: wireMenuItems };
})();
