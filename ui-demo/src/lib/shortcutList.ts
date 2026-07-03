// 快捷键速查面板（Cmd+/）的数据源——只列「当前 demo 里真的能用」的键位，
// 按作用域分组（§1 上下文模型）。完整调研/裁决/UseCase 见 public/shortcuts.html。
export interface ShortcutItem {
  keys: string[] // 每个元素渲染成一个 <kbd>
  label: string
}
export interface ShortcutGroup {
  title: string
  hint?: string
  items: ShortcutItem[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '应用壳 · 全局',
    items: [
      { keys: ['⌘', 'T'], label: '新建标签页（新文档）' },
      { keys: ['⌘', 'W'], label: '关闭当前标签页' },
      { keys: ['⌃', 'Tab'], label: '下一个标签页（+⇧ 上一个）' },
      { keys: ['⌘', '1…8'], label: '直达第 N 个标签页' },
      { keys: ['⌘', '9'], label: '最后一个标签页' },
      { keys: ['⌘', 'S'], label: '保存（临时文档弹「保存到哪里」）' },
      { keys: ['⌘', '⇧', 'S'], label: '另存为…' },
      { keys: ['⌘', 'P'], label: '快速打开（搜文件名）' },
      { keys: ['⌘', '⇧', 'F'], label: '聚焦文件筛选框' },
      { keys: ['⌘', '\\'], label: '收起 / 展开侧栏' },
      { keys: ['⌘', ','], label: '设置' },
      { keys: ['⌘', '/'], label: '本面板' },
    ],
  },
  {
    title: '编辑器 · 文本态（光标在块里）',
    hint: '格式键作用于选中文字；无选区时放行原生',
    items: [
      { keys: ['⌘', 'B'], label: '加粗' },
      { keys: ['⌘', 'I'], label: '斜体' },
      { keys: ['⌘', 'U'], label: '下划线' },
      { keys: ['⌘', '⇧', 'X'], label: '删除线' },
      { keys: ['⌘', 'E'], label: '行内代码' },
      { keys: ['⌘', 'K'], label: '插入链接' },
      { keys: ['⌘', '⇧', 'V'], label: '粘贴为纯文本' },
      { keys: ['⌘', 'Z'], label: '撤销（+⇧ 重做）' },
      { keys: ['/'], label: '斜杠插入菜单' },
      { keys: ['Enter'], label: '新块（⇧+Enter 块内换行）' },
      { keys: ['Tab'], label: '列表缩进（⇧+Tab 反缩进）' },
      { keys: ['Esc'], label: '退到块选中态' },
    ],
  },
  {
    title: '编辑器 · 块操作（文本态或块选中态）',
    items: [
      { keys: ['⌘', 'D'], label: '复制当前块' },
      { keys: ['⌘', '⇧', '↑/↓'], label: '上移 / 下移当前块' },
      { keys: ['⌘', '⌥', '0'], label: '转为正文' },
      { keys: ['⌘', '⌥', '1…3'], label: '转为标题 1 / 2 / 3' },
      { keys: ['⌘', '⌥', '4…6'], label: '转为待办 / 无序 / 有序列表' },
      { keys: ['⌘', 'Enter'], label: '待办打勾 / 取消' },
      { keys: ['↑', '↓'], label: '块选中态：移动选择' },
      { keys: ['Enter'], label: '块选中态：进入编辑' },
      { keys: ['⌫'], label: '块选中态：删除块' },
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
