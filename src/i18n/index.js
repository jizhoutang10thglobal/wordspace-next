// 字典装配：把各命名空间模块合并成 { ZH, EN }，key 统一加命名空间前缀(t('sidebar.open'))。
// 主进程 require 它做 configureI18n；preload require 它经 contextBridge 一次性注入给 renderer。
//
// 加一个模块 = 往 NAMESPACES 加一行 + 建 zh/en 同名文件；加一门语言 = 建 zh/en 同级新目录 + 扩
// lib/i18n.js 的 makeT(现二态)。命名空间分文件是为了「多 PR 改不同模块不撞同一文件」(Phase 1 教训)。
'use strict';

const NAMESPACES = [
  'common', 'menu', 'dialog', 'sidebar', 'shell', 'browser', 'settings', 'editor',
  'link', 'find', 'update', 'schema', 'template', 'bookmark', 'misc', 'start',
];

// 文件里 key 不带前缀，合并时统一加。
function ns(prefix, dict) {
  const out = {};
  for (const k in dict) out[prefix + '.' + k] = dict[k];
  return out;
}

function build(lang) {
  const merged = {};
  for (let i = 0; i < NAMESPACES.length; i++) {
    const name = NAMESPACES[i];
    const dict = require('./' + lang + '/' + name); // 每个命名空间文件都必须存在(桩=空对象)
    Object.assign(merged, ns(name, dict));
  }
  return merged;
}

const ZH = build('zh');
const EN = build('en');

module.exports = { NAMESPACES, ZH, EN };
