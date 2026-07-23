// Schema #2「分页文档」descriptor（Word 向：纸张 / 边距 / 后续页眉页脚）。
// 判定 = 结构合规（复用 schema-validate 全部规则）+ head 首个 <style data-ws-schema-css="page">
// 能被 parsePageCss 解析成 canonical @page。
//   · 结构不合规 → 本 schema 不认（violations 透传，交给 registry 继续试 → 兜底走基础编辑）。
//   · page 块写坏 / 解析不出 → 本 schema 不认 → 宽容回退 schema-1 流式文档（不降级，不惩罚；
//     见 docs/features/paged-doc.md 与拆分计划 §2）。
//   · 多余 page 块 → 一律取 head 里的「首个」（detect/validate 同口径；创作规范写明恰好一个）。
// 归类只认内容：绝不看 <meta wordspace-schema> 自称（校验器三铁律①，正本 docs/schema-1-draft-v0.md §4.3）。
//
// 被动数据模块：只导出一个纯 descriptor { id, detect, validate }，**绝不自注册、绝不 require
// schema-registry**——注册收口唯一在 schema-registry.js（防 CJS 循环 require：registry 的 IIFE
// 到末尾才赋 module.exports，descriptor 若反向 require 会拿到半成品 register）。
// 双导出：node require / 渲染层 window.WS2Schema2Paged（index.html 里 <script> 排在 registry 之前）。
(function (global) {
  const WSV = (typeof require === 'function') ? require('./schema-validate.js') : (global.WS2SchemaValidate || {});
  const PAGE = (typeof require === 'function') ? require('./schema-page.js') : (global.WS2SchemaPage || {});
  const PAGE_STYLE_SEL = 'style[data-ws-schema-css="page"]';

  // i18n：违规消息双上下文取 t（同 schema-validate.js）——renderer <script> 全局用 window.wsT；node 用 require('./i18n')。
  const _i18nMod = (typeof require === 'function') ? (function () { try { return require('./i18n'); } catch (_) { return null; } })() : null;
  function _t(key, params) {
    if (typeof window !== 'undefined' && typeof window.wsT === 'function') return window.wsT(key, params);
    if (_i18nMod) return _i18nMod.t(key, params);
    return key;
  }

  // 首个 page 块（querySelector 天然取首个；多余块不影响判定）。
  function firstPageStyle(doc) {
    return (doc && doc.head) ? doc.head.querySelector(PAGE_STYLE_SEL) : null;
  }

  // 宽容候选筛（允许 false-positive，性能用）：head 有 page 块就算命中。
  function detect(doc) {
    return firstPageStyle(doc) != null;
  }

  // 权威判定：① 复用 schema-validate 的全部结构规则；② head 首个 page 块必须解析成功。
  function validate(doc) {
    const base = WSV.validate(doc);
    if (!base || !base.conform) return base || { conform: false, violations: [] }; // 结构不合规 → 不认，violations 透传
    const st = firstPageStyle(doc);
    const cfg = (st && typeof PAGE.parsePageCss === 'function') ? PAGE.parsePageCss(st.textContent) : null;
    if (!cfg) return { conform: false, violations: [{ rule: 'page-css-unparseable', tag: 'STYLE', msg: _t('schema.pageCssUnparseable') }] };
    return { conform: true, violations: [] };
  }

  const descriptor = { id: 'schema-2', detect: detect, validate: validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = descriptor;
  else global.WS2Schema2Paged = descriptor;
})(typeof window !== 'undefined' ? window : globalThis);
