# PDF 导出 —— 对齐 spec

## 行为契约

**总原则：所见即所得。** 导出的 PDF 应与 app 里看到的渲染一致（合规文档=编辑器排版；野文档=其自带样式）。
UI 只有一个导出入口（右上角 ⋯ → 导出 PDF / Cmd+E），无样式选择——模式按文档自动定：

| 文档 | 模式 | 打印内容 | 分页方式 |
|---|---|---|---|
| Schema 合规 HTML（无分页设置） | wordspace | 编辑器排版烤成静态 HTML | 连续单页 |
| Schema 合规 + 分页设置（@page 入盘） | wordspace + paged | 烤排版 + PAGED_PRINT_CSS | 标准分页（文档 @page 定纸张/边距，可选页脚页码） |
| .md（合规或非合规） | wordspace | md→html 烤排版 | 连续单页 |
| 非合规 HTML（basicEdit，含外部/野文档） | raw | 直印磁盘源文件（自带 CSS，不注入编辑器样式） | 见下 |

**raw / 连续单页路径的分页判定**（2026-07-13，Wendi 白间隙 bug 修复）：
- 文档**自带分页版式**（`<style>` 里有 `@page`，或 CSS / 内联 style 里有强制分页符
  `break-after|before: page/left/right`、`page-break-after|before: always/left/right`——Word/WPS 导出惯用）
  → **按文档自己的 @page 标准分页**（preferCSSPageSize，纸张/边距全交给它），像 Word 一样一页一页出。
  检测收窄防误伤：`@page` 只认 `<style>` 块（正文提到不触发）；`break-inside` / `avoid` 等排版微调不算。
- 否则 → **连续单页**：页宽 A4、页高=内容高，零分页不切断。量高在 **print 媒介**下做
  （CDP Emulation.setEmulatedMedia）——printToPDF 在 print 媒介渲染，同媒介量高才不会因文档的
  `@media print`（藏元素/去间隙）量出偏大的高、页尾多白。
- 内容高 > Chromium 单页上限（~200in）→ 退标准 A4 分页，保内容不丢。

已知局限（有意）：外链 CSS（`<link>`）里的 @page 检测不到（本地野文档几乎都内联）；
文档内自绘页眉页脚不做，页码只有 Chromium 页脚模板（分页文档可选）。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 导出实现 | `ui-demo/src/lib/printExport.ts`（window.print） | `src/main/pdf-export.js`（隐藏窗口 + printToPDF） |
| 自分页检测 | （无） | `src/lib/self-paged.js` |
| 模式判定 | （无） | `src/renderer/shell.js` `pdfExportMode()` / `exportPdf()` |
| 分页文档 | 见 `paged-doc.md` | 同左 |

## 有意分歧

ui-demo 无真 PDF 导出（走浏览器打印预览演示），真 app 是唯一正式实现——不算漂移。

## 对齐锚点

- app 侧：本 PR（2026-07-13）

## 欠账

（无）
