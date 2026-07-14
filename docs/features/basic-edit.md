# 基础编辑器（非合规 HTML）—— 对齐 spec

不符合 Wordspace Schema 的野生 HTML 走基础编辑：全保真沙箱 iframe 渲染 + 顶部降级条 +
最小编辑能力。设计源头 `docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md`。

## 行为契约

- **渲染**：文件原样进沙箱 iframe（文档 `<style>` 隔离生效、`<script>` 不执行）。顶部一条降级提示
  「该文件不符合 Wordspace Schema，仅支持基础编辑。」，不展开违规清单。
- **文字编辑**：body contentEditable，点字就改。选中文字弹浮动格式条（B/I/U/S + 文字色/高亮/清除格式），
  样式同合规编辑器的 `.ws-fmtbar`。
- **删块**：按 Esc 进块模式 → 实线 accent 焦点框（`.nce-focus`）+ 右上「删除此块」按钮；方向键按渲染
  几何切块，Delete/Backspace 删当前块，Enter 进入块内编辑（只读块除外）。删几乎整篇的块（面积
  >85% body）有二次确认。选中内容/图片直接 Delete 是 contenteditable 原生路径，同样可用。
- **无悬停 chrome**：鼠标扫过内容**不出现任何浮层**。原「悬停块 → 蓝色虚线框（`.nce-hover`）+ 右上
  🗑 + 只读 🔒」已整体撤除——Wendi 2026-07-14 反馈：整篇是一张大表格的文档（Word 导出常态）悬停
  即被框成几屏高的巨型蓝框，🗑 锚在框右上角、在视口外根本看不见，用户读作渲染 bug。Colin 拍板
  撤掉（同日）。块级删除保留上面两条路径，编辑器保持「安静的纸」。
- **保存**：结构级保真——只剥编辑态标记（contenteditable 等），不做 Schema 规整、不动文档结构。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 编辑器本体 | `ui-demo/src/components/BasicEditor.tsx` | `src/editor/basic-edit.js` |
| 样式 | `ui-demo/src/components/BasicEditor.css` | `src/renderer/basic-edit.css` |
| e2e | —（无） | `e2e/nonconform-basic-edit.spec.js` |

## 有意分歧

- ui-demo 有「编辑/预览」双态切换（预览态跑文档 JS、只读）；真 app 只有编辑态。demo 展示用，
  未拍板移植。（现状记录，2026-07-14）
- 真 app 有 Cmd+Z 撤销/重做（走菜单加速器，Colin 2026-07-02）；ui-demo 无。

## 对齐锚点

- 两侧同 PR 撤除悬停 chrome：分支 `fix/basic-edit-hover-box`（2026-07-14）。

## 欠账

- （无）
