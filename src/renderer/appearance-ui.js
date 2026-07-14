// 外观三态的 renderer 侧 UI 胶水。chrome 变暗本身是纯 CSS(nativeTheme 翻 prefers-color-scheme,U4/U5),
// 这里只管三入口的「入口 UI 勾选态 + 切换过渡类」,不碰主题值:
//   ① ⋯菜单三项 + settings 选择器同步当前态(都从 main 查,三入口永远一致);
//   ② 切换时给 documentElement 挂 [data-theme-switching] ~200ms 让 token 过渡(§4,reduced-motion 下 CSS 自动关);
//   ③ 点 ⋯菜单三项 → ws2.setAppearance(pref)。
(function () {
  let current = 'system';

  function applySwitchTransition() {
    const root = document.documentElement;
    root.setAttribute('data-theme-switching', '');
    setTimeout(() => root.removeAttribute('data-theme-switching'), 200);
  }

  function refreshUI(pref) {
    current = pref || 'system';
    document.querySelectorAll('.ws-appearance-item').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.pref === current);
    });
    const sel = document.getElementById('wp-appearance-select');
    if (sel && sel.value !== current) sel.value = current;
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
    if (window.ws2 && window.ws2.getAppearance) {
      window.ws2.getAppearance().then(refreshUI).catch(() => {});
      window.ws2.onAppearanceChanged((pref) => { applySwitchTransition(); refreshUI(pref); });
    }
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 供 settings 页(browser.js)渲染后回读当前态 + 重新 wire(设置项是动态创建的)。
  window.__wsAppearance = { get: () => current, refresh: refreshUI, wire: wireMenuItems };
})();
