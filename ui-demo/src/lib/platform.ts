// 平台探测：快捷键的显示（⌘ vs Ctrl）与少数平台分歧键（Ctrl+Y 重做仅 Windows）用。
// 判定逻辑上大多数键无需分平台——代码统一收 metaKey||ctrlKey 双通道。
export const IS_MAC: boolean =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
