'use strict';
// i18n 纯核心 + 字典装配单测(node:test)。真 app 用 node --test，不是 vitest。
const { test } = require('node:test');
const assert = require('node:assert');
const i18n = require('../src/lib/i18n');
const { ZH, EN, NAMESPACES } = require('../src/i18n');

test('normalizeLangPref: 合法透传，非法/空/null 回落 system', () => {
  assert.equal(i18n.normalizeLangPref('zh'), 'zh');
  assert.equal(i18n.normalizeLangPref('en'), 'en');
  assert.equal(i18n.normalizeLangPref('system'), 'system');
  assert.equal(i18n.normalizeLangPref('fr'), 'system');
  assert.equal(i18n.normalizeLangPref(''), 'system');
  assert.equal(i18n.normalizeLangPref(null), 'system');
  assert.equal(i18n.normalizeLangPref(undefined), 'system');
});

test('langOfSystem: 无 locale→zh，zh 开头→zh，其余→en，大小写不敏感', () => {
  assert.equal(i18n.langOfSystem(null), 'zh');
  assert.equal(i18n.langOfSystem(''), 'zh');
  assert.equal(i18n.langOfSystem(undefined), 'zh');
  assert.equal(i18n.langOfSystem('zh-CN'), 'zh');
  assert.equal(i18n.langOfSystem('zh-Hant-TW'), 'zh');
  assert.equal(i18n.langOfSystem('ZH'), 'zh');
  assert.equal(i18n.langOfSystem('en-US'), 'en');
  assert.equal(i18n.langOfSystem('fr-FR'), 'en');
  assert.equal(i18n.langOfSystem('ja'), 'en');
});

test('effectiveLang: 显式两态无视系统，system 跟随，无 locale 回 zh', () => {
  assert.equal(i18n.effectiveLang('zh', 'en-US'), 'zh');
  assert.equal(i18n.effectiveLang('en', 'zh-CN'), 'en');
  assert.equal(i18n.effectiveLang('system', 'zh-CN'), 'zh');
  assert.equal(i18n.effectiveLang('system', 'en-US'), 'en');
  assert.equal(i18n.effectiveLang('system', null), 'zh');
  assert.equal(i18n.effectiveLang('garbage', 'en-US'), 'en'); // 非法 pref→system→跟随
});

test('makeT: 按语言取，en 缺 key fallback zh，两缺显示 key，空串是合法翻译不 fallback', () => {
  const zh = { a: '甲', b: '乙', empty: '' };
  const en = { a: 'A', empty: 'EN' };
  const tzh = i18n.makeT(zh, en, 'zh');
  const ten = i18n.makeT(zh, en, 'en');
  assert.equal(tzh('a'), '甲');
  assert.equal(ten('a'), 'A');
  assert.equal(ten('b'), '乙'); // en 缺 → fallback zh
  assert.equal(tzh('missing'), 'missing'); // zh 缺 → 显示 key
  assert.equal(ten('missing'), 'missing');
  assert.equal(tzh('empty'), ''); // 空串是合法翻译，不当缺失
});

test('makeT: 参数替换(单个/多个/重复占位/数字)', () => {
  const zh = { greet: '你好 {name}', two: '{a} 到 {b}', rep: '{x} 和 {x}', num: '共 {n} 个' };
  const t = i18n.makeT(zh, {}, 'zh');
  assert.equal(t('greet', { name: '张三' }), '你好 张三');
  assert.equal(t('two', { a: '甲', b: '乙' }), '甲 到 乙');
  assert.equal(t('rep', { x: 'X' }), 'X 和 X');
  assert.equal(t('num', { n: 3 }), '共 3 个');
});

test('imperative t: 未 configure 显示 key；configure+setActiveLang 后按当前语言取', () => {
  assert.equal(i18n.t('common.cancel'), 'common.cancel'); // 未 configure → key 名
  i18n.configureI18n(ZH, EN);
  i18n.setActiveLang('zh');
  assert.equal(i18n.getActiveLang(), 'zh');
  assert.equal(i18n.t('common.cancel'), '取消');
  i18n.setActiveLang('en');
  assert.equal(i18n.getActiveLang(), 'en');
  assert.equal(i18n.t('common.cancel'), 'Cancel');
  i18n.setActiveLang('garbage'); // 非 en 一律 zh
  assert.equal(i18n.getActiveLang(), 'zh');
});

test('字典装配: 命名空间加前缀，common 已填，zh/en 同 key 集(桩为空不影响)', () => {
  assert.ok(NAMESPACES.includes('common'));
  assert.equal(ZH['common.cancel'], '取消');
  assert.equal(EN['common.cancel'], 'Cancel');
  // common 的 zh/en key 集必须一致(源语言=zh，en 补齐)
  const zhCommon = Object.keys(ZH).filter((k) => k.indexOf('common.') === 0).sort();
  const enCommon = Object.keys(EN).filter((k) => k.indexOf('common.') === 0).sort();
  assert.deepEqual(zhCommon, enCommon);
});
