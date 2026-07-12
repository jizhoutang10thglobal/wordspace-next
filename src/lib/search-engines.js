// 搜索引擎表（spec §2.4/§4.10）。真 app 无 glass（ui-demo 虚构引擎，仅存在于 demo，spec §13）；
// 默认 Bing（Colin 2026-07-10 拍板）。双导出：主进程（右键搜索/omnibox parse）与 renderer（设置下拉）共用。
(function () {
  var ENGINES = {
    bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
    google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
    ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  };
  var DEFAULT_ENGINE = 'bing';
  var ORDER = ['bing', 'google', 'ddg'];
  function engineOf(key) {
    return ENGINES[key] || ENGINES[DEFAULT_ENGINE];
  }
  function validKey(key) {
    return Object.prototype.hasOwnProperty.call(ENGINES, key) ? key : DEFAULT_ENGINE;
  }
  var API = { ENGINES: ENGINES, ORDER: ORDER, DEFAULT_ENGINE: DEFAULT_ENGINE, engineOf: engineOf, validKey: validKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.WS2Engines = API;
})();
