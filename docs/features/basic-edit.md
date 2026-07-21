# 基础编辑器（非合规 HTML）—— 对齐 spec

不符合 Wordspace Schema 的野生 HTML 走基础编辑：全保真沙箱 iframe 渲染 + 顶部降级条 +
最小编辑能力。设计源头 `docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md`。

## 行为契约

- **渲染**：文件原样进沙箱 iframe（文档 `<style>` 隔离生效、`<script>` 不执行）。顶部一条降级提示
  「该文件不符合 Wordspace Schema，仅支持基础编辑。」，不展开违规清单。
- **文字编辑**：body contentEditable，点字就改。选中文字弹浮动格式条（B/I/U/S + 文字色/高亮/清除格式），
  样式同合规编辑器的 `.ws-fmtbar`。
- **删块（原生「选中 + Delete」，唯一路径）**：删除整段/整块一律走 contenteditable 原生——选中内容（或选中
  图片/表格等原子块）按 Delete/Backspace 即删。**无任何删除 chrome**：不出「删除此块」按钮、不设 Esc 块模式，
  鼠标扫过 / 点块 / 选中 / 按 Esc 都不冒任何浮层。编辑器保持「安静的纸」。
  - **历史**：曾有 Esc 块模式（accent focus 框 + 方向键按渲染几何切块 + Delete 删块 + Enter 进块内编辑）+ 右上
    「删除此块」chip。Wendi 2026-07-18 报按钮「有时不灵、要点很多次才删」，Colin 2026-07-21 真机走查更进一步
    「压根找不到删除」——按钮既不可靠又不可发现。**Colin 2026-07-21 拍板：整体撤除按钮 + Esc 块模式**，删除只留
    原生路径（连带撤掉焦点框、chip、块导航、块级二次确认、`.nce-focus*` CSS、collectBlocks/nearestInDir 的内部调用）。
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
- 两侧同 PR 撤除「删除此块」按钮 + Esc 块模式，删除改走原生「选中 + Delete」：分支 `fix/basic-edit-delete-chip`
  （Wendi 2026-07-18 报按钮不灵 → Colin 2026-07-21 拍板整体撤除）。真 app e2e `nonconform-basic-edit.spec.js`：
  「B 原生选中 + Delete」+「无删除 chrome（点块/选中/Esc 都不出按钮或焦点框）」两门；旧的块模式/chip 用例全删。

## 欠账

- （无）
