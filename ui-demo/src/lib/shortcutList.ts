import { IS_MAC } from './platform'
import { t } from '../i18n'

// 快捷键速查面板（Cmd+/ / Ctrl+/）的数据源——只列「当前 demo 里真的能用」的键位，
// 按作用域分组（§1 上下文模型）。键位写成平台无关 token，渲染时按平台出字
// （mac: ⌘⌥⌃⇧ 符号 / Windows: Ctrl·Alt·Shift 文字）。
// 完整调研/裁决/UseCase 与 Windows 分歧说明见 public/shortcuts.html（§7）。
export interface ShortcutItem {
  keys: string[] // token：'Mod'(⌘/Ctrl) 'Alt'(⌥/Alt) 'Ctrl'(⌃/Ctrl) 'Shift'(⇧/Shift) 或字面键
  keysWin?: string[] // Windows 键位与 mac 结构不同时的覆盖（如转块）
  label: string
  macOnly?: boolean
  winOnly?: boolean
}
export interface ShortcutGroup {
  title: string
  hint?: string
  items: ShortcutItem[]
}

// 每次调用时按当前语言重建（t() 即时求值）——面板渲染时调，切语言即出新文案。
function buildGroups(): ShortcutGroup[] {
  return [
    {
      title: t('shortcuts.grpAppShell'),
      items: [
        { keys: ['Mod', 'T'], label: t('shortcuts.newTab') },
        { keys: ['Mod', 'W'], label: t('shortcuts.closeTab') },
        { keys: ['Ctrl', 'Tab'], label: t('shortcuts.nextTab') },
        { keys: ['Mod', '1…8'], label: t('shortcuts.jumpTab') },
        { keys: ['Mod', '9'], label: t('shortcuts.lastTab') },
        { keys: ['Mod', 'S'], label: t('shortcuts.save') },
        { keys: ['Mod', 'Shift', 'S'], label: t('shortcuts.saveAs') },
        { keys: ['Mod', 'P'], label: t('shortcuts.quickOpen') },
        { keys: ['Mod', 'Shift', 'F'], label: t('shortcuts.focusFilter') },
        { keys: ['Mod', '\\'], label: t('shortcuts.toggleSidebar') },
        { keys: ['Mod', ','], label: t('shortcuts.settings') },
        { keys: ['Mod', '/'], label: t('shortcuts.thisPanel') },
      ],
    },
    {
      title: t('shortcuts.grpFindSelect'),
      items: [
        { keys: ['Mod', 'F'], label: t('shortcuts.findInDoc') },
        { keys: ['Mod', 'A'], label: t('shortcuts.selectAll') },
      ],
    },
    {
      title: t('shortcuts.grpTextMode'),
      hint: t('shortcuts.hintTextMode'),
      items: [
        { keys: ['Mod', 'B'], label: t('shortcuts.bold') },
        { keys: ['Mod', 'I'], label: t('shortcuts.italic') },
        { keys: ['Mod', 'U'], label: t('shortcuts.underline') },
        { keys: ['Mod', 'Shift', 'X'], label: t('shortcuts.strikethrough') },
        { keys: ['Mod', 'Shift', 'H'], label: t('shortcuts.highlight') },
        { keys: ['Mod', 'E'], label: t('shortcuts.inlineCode') },
        { keys: ['Mod', 'K'], label: t('shortcuts.insertLink') },
        { keys: ['Mod', 'Shift', 'V'], label: t('shortcuts.pastePlain') },
        { keys: ['Mod', 'Z'], label: t('shortcuts.undoMac'), macOnly: true },
        { keys: ['Mod', 'Z'], label: t('shortcuts.undoWin'), winOnly: true },
        { keys: ['/'], label: t('shortcuts.slashMenu') },
        { keys: ['Enter'], label: t('shortcuts.newBlock') },
        { keys: ['Tab'], label: t('shortcuts.listIndent') },
        { keys: ['Esc'], label: t('shortcuts.escToBlock') },
      ],
    },
    {
      title: t('shortcuts.grpBlockOps'),
      items: [
        { keys: ['Mod', 'D'], label: t('shortcuts.duplicateBlock') },
        { keys: ['Mod', 'Shift', 'K'], label: t('shortcuts.deleteBlock') },
        { keys: ['Mod', 'Shift', '↑/↓'], label: t('shortcuts.moveBlock') },
        { keys: ['Mod', 'Alt', '0'], keysWin: ['Ctrl', 'Shift', '0'], label: t('shortcuts.toText') },
        { keys: ['Mod', 'Alt', '1…3'], keysWin: ['Ctrl', 'Shift', '1…3'], label: t('shortcuts.toHeading') },
        { keys: ['Mod', 'Alt', '4…6'], keysWin: ['Ctrl', 'Shift', '4…6'], label: t('shortcuts.toList') },
        { keys: ['Mod', 'Shift', '8'], label: t('shortcuts.bulletedList') },
        { keys: ['Mod', 'Shift', '7'], label: t('shortcuts.numberedList') },
        { keys: ['Mod', 'Enter'], label: t('shortcuts.toggleTodo') },
        { keys: ['↑', '↓'], label: t('shortcuts.blockMove') },
        { keys: ['Enter'], label: t('shortcuts.blockEnter') },
        { keys: ['⌫'], label: t('shortcuts.blockDelete') },
      ],
    },
    {
      title: t('shortcuts.grpNav'),
      hint: t('shortcuts.hintNav'),
      items: [
        { keys: ['Alt', '⌫'], keysWin: ['Ctrl', '⌫'], label: t('shortcuts.deleteWord') },
        { keys: ['Alt', '←/→'], keysWin: ['Ctrl', '←/→'], label: t('shortcuts.moveWord') },
        { keys: ['Mod', '←/→'], label: t('shortcuts.lineEnds'), macOnly: true },
        { keys: ['Mod', '↑/↓'], label: t('shortcuts.docEnds'), macOnly: true },
      ],
    },
    {
      title: t('shortcuts.grpMarkdown'),
      items: [
        { keys: ['#', '##', '###'], label: t('shortcuts.mdHeading') },
        { keys: ['-'], label: t('shortcuts.bulletedList') },
        { keys: ['1.'], label: t('shortcuts.numberedList') },
        { keys: ['[]'], label: t('shortcuts.mdTodo') },
        { keys: ['>'], label: t('shortcuts.mdQuote') },
      ],
    },
  ]
}

// token → 当前平台显示文字
const GLYPH: Record<string, [mac: string, win: string]> = {
  Mod: ['⌘', 'Ctrl'],
  Alt: ['⌥', 'Alt'],
  Ctrl: ['⌃', 'Ctrl'],
  Shift: ['⇧', 'Shift'],
  Esc: ['Esc', 'Esc'],
}
export function renderKey(token: string): string {
  const g = GLYPH[token]
  return g ? (IS_MAC ? g[0] : g[1]) : token
}

/** 当前平台的分组（应用平台过滤 + keysWin 覆盖） */
export function shortcutGroupsForPlatform(): ShortcutGroup[] {
  return buildGroups().map((g) => ({
    ...g,
    items: g.items
      .filter((it) => (IS_MAC ? !it.winOnly : !it.macOnly))
      .map((it) => ({ ...it, keys: !IS_MAC && it.keysWin ? it.keysWin : it.keys })),
  }))
}
