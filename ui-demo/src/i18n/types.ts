// i18n 类型。LangPref = 用户偏好（三态，跟随系统 / 中 / 英）；Lang = 生效语言（二态）。
// 与外观三态（appearance.ts）同构：pref 是用户选的，effective/Lang 是算出来真正用的。
export type LangPref = 'system' | 'zh' | 'en'
export type Lang = 'zh' | 'en'

// 一份命名空间字典 = 扁平 key→文案（key 在合并前不带命名空间前缀，index.ts 合并时加）。
export type Dict = Record<string, string>

// t(key, params)：按当前 Lang 取文案，{name} 这类占位用 params 插值。
export type TFunc = (key: string, params?: Record<string, string | number>) => string
