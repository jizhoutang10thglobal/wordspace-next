import { IS_MAC } from './platform'

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

const GROUPS: ShortcutGroup[] = [
  {
    title: '应用壳 · 全局',
    items: [
      { keys: ['Mod', 'T'], label: '新建标签页（新文档）' },
      { keys: ['Mod', 'W'], label: '关闭当前标签页' },
      { keys: ['Ctrl', 'Tab'], label: '下一个标签页（+Shift 上一个）' },
      { keys: ['Mod', '1…8'], label: '直达第 N 个标签页' },
      { keys: ['Mod', '9'], label: '最后一个标签页' },
      { keys: ['Mod', 'S'], label: '保存（临时文档弹「保存到哪里」）' },
      { keys: ['Mod', 'Shift', 'S'], label: '另存为…' },
      { keys: ['Mod', 'P'], label: '快速打开（搜文件名）' },
      { keys: ['Mod', 'Shift', 'F'], label: '聚焦文件筛选框' },
      { keys: ['Mod', '\\'], label: '收起 / 展开侧栏' },
      { keys: ['Mod', ','], label: '设置' },
      { keys: ['Mod', '/'], label: '本面板' },
    ],
  },
  {
    title: '编辑器 · 查找与选择',
    items: [
      { keys: ['Mod', 'F'], label: '在文档中查找（Enter 下一个 · Shift+Enter 上一个）' },
      { keys: ['Mod', 'A'], label: '全选块内文字，再按升到块选中态' },
    ],
  },
  {
    title: '编辑器 · 文本态（光标在块里）',
    hint: '格式键作用于选中文字；无选区时放行原生',
    items: [
      { keys: ['Mod', 'B'], label: '加粗' },
      { keys: ['Mod', 'I'], label: '斜体' },
      { keys: ['Mod', 'U'], label: '下划线' },
      { keys: ['Mod', 'Shift', 'X'], label: '删除线' },
      { keys: ['Mod', 'Shift', 'H'], label: '高亮' },
      { keys: ['Mod', 'E'], label: '行内代码' },
      { keys: ['Mod', 'K'], label: '插入链接' },
      { keys: ['Mod', 'Shift', 'V'], label: '粘贴为纯文本' },
      { keys: ['Mod', 'Z'], label: '撤销（+Shift 重做）', macOnly: true },
      { keys: ['Mod', 'Z'], label: '撤销（+Shift 或 Ctrl+Y 重做）', winOnly: true },
      { keys: ['/'], label: '斜杠插入菜单' },
      { keys: ['Enter'], label: '新块（Shift+Enter 块内换行）' },
      { keys: ['Tab'], label: '列表缩进（Shift+Tab 反缩进）' },
      { keys: ['Esc'], label: '退到块选中态' },
    ],
  },
  {
    title: '编辑器 · 块操作（文本态或块选中态）',
    items: [
      { keys: ['Mod', 'D'], label: '复制当前块' },
      { keys: ['Mod', 'Shift', 'K'], label: '删除当前块' },
      { keys: ['Mod', 'Shift', '↑/↓'], label: '上移 / 下移当前块' },
      { keys: ['Mod', 'Alt', '0'], keysWin: ['Ctrl', 'Shift', '0'], label: '转为正文' },
      { keys: ['Mod', 'Alt', '1…3'], keysWin: ['Ctrl', 'Shift', '1…3'], label: '转为标题 1 / 2 / 3' },
      { keys: ['Mod', 'Alt', '4…6'], keysWin: ['Ctrl', 'Shift', '4…6'], label: '转为待办 / 无序 / 有序列表' },
      { keys: ['Mod', 'Shift', '8'], label: '无序列表' },
      { keys: ['Mod', 'Shift', '7'], label: '有序列表' },
      { keys: ['Mod', 'Enter'], label: '待办打勾 / 取消' },
      { keys: ['↑', '↓'], label: '块选中态：移动选择' },
      { keys: ['Enter'], label: '块选中态：进入编辑' },
      { keys: ['⌫'], label: '块选中态：删除块' },
    ],
  },
  {
    title: '光标导航 · 系统原生',
    hint: '操作系统直接提供，编辑器不拦截',
    items: [
      { keys: ['Alt', '⌫'], keysWin: ['Ctrl', '⌫'], label: '按词删除' },
      { keys: ['Alt', '←/→'], keysWin: ['Ctrl', '←/→'], label: '按词左右移动（+Shift 扩选）' },
      { keys: ['Mod', '←/→'], label: '到行首 / 行尾', macOnly: true },
      { keys: ['Mod', '↑/↓'], label: '跳到文档首 / 尾', macOnly: true },
    ],
  },
  {
    title: 'Markdown 触发（行首输入 + 空格）',
    items: [
      { keys: ['#', '##', '###'], label: '标题 1 / 2 / 3' },
      { keys: ['-'], label: '无序列表' },
      { keys: ['1.'], label: '有序列表' },
      { keys: ['[]'], label: '待办' },
      { keys: ['>'], label: '引用' },
    ],
  },
]

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
  return GROUPS.map((g) => ({
    ...g,
    items: g.items
      .filter((it) => (IS_MAC ? !it.winOnly : !it.macOnly))
      .map((it) => ({ ...it, keys: !IS_MAC && it.keysWin ? it.keysWin : it.keys })),
  }))
}
