---
title: "用 PDF.js 替换 Chromium 内置 PDF viewer（Wendi B7/B8）"
type: feat
status: active
date: 2026-07-01
source: ~/Desktop/wordpace_修改清单(1).md（B7 两行工具栏合并 / B8 默认不显示预览栏）
---

# PDF.js viewer plan（精简）

**目标**：真 app 打开 PDF 时,不再用 Chromium 内置 viewer（iframe src=url）,改用 **PDF.js**（Mozilla 开源,纯前端渲染成 canvas）。这样工具栏/预览栏/缩放全是 wordspace 自己的 UI——彻底解决 B7（合并成一行工具栏）+ B8（默认不显示左侧预览栏）,风格统一。
**分支**：worktree `wordspace-next-ux`（分支 `feat/ux-fixes`,跟其余 Wendi UX 一批）。

## 可行性结论（已探）

技术可行（PDF.js 是纯前端库,Electron renderer/contextIsolation:true/nodeIntegration:false 能跑）。三个要定的点：
1. **worker 加载 = 最大风险**：CSP 现为 `default-src 'self' file:; script-src 'self' file:`,**无 `worker-src`**。PDF.js 4.x worker 是 module/blob worker,很可能要加 `worker-src 'self' file: blob:`（甚至 `script-src` 加 blob:）。**U1 先验证,通了再往下。**
2. **依赖本地打包**：`pdfjs-dist` 本地装 + worker 文件（`pdf.worker.min.mjs`）放本地路径,`workerSrc` 指 file://。不走 CDN（CSP connect-src 挡）。
3. **现有 PDF 渲染替换点**：`src/renderer/shell.js` 的 `kind==='pdf'` 分支（现在 `<iframe class=pdfv-frame src=url>`,~196-226）整段换成 PDF.js canvas 渲染。

## 待 Colin 拍的 UI 决策（实现前定）

- **多页浏览**：连续滚动（所有页竖排,像 Chrome PDF / Notion）✅ 默认 / 还是翻页（一次一页 + 上下页按钮）?
- **工具栏（一行,B7）放哪些**：建议 = 文件名 + 页码（3/12）+ 缩放 −/＋ + 适应宽度 + 在外部打开。要不要下载/打印?（Wendi 说下载没必要）
- **缩放方式**：按钮 −/＋ + Ctrl/Cmd+滚轮 ✅ 默认。
- **默认缩放**：适应宽度（fit-width）✅ 默认。

（未答的我先按 ✅ 默认实现,你 review 时调。）

## Implementation Units

### U1. 验证 PDF.js worker 在 Electron file:// + CSP 能加载（风险前置）
**Goal**：装 `pdfjs-dist`,写最小 demo（renderer 加载 PDF.js + workerSrc 本地 + 渲染一个测试 PDF 第一页到 canvas）,真跑确认 worker 加载 + CSP 不挡。**这一单元通不过则整个方案要换路（如 PDF.js 无 worker 模式 / 主线程渲染）,先确认再投入。**
**Files**：`package.json`（+pdfjs-dist）、临时 demo（renderer）、`src/renderer/index.html`（CSP 加 worker-src 试）。
**Verify**：e2e/手动真开一个 PDF,canvas 画出第一页 + 控制台无 CSP worker 报错。**通过 → 继续;不通 → 停下报告 Colin 换方案。**
**难易**：中（最大不确定点,但前置）。

### U2. PDF.js 渲染（连续滚动多页 + 缩放）
**Goal**：shell.js 的 pdf 分支换成 PDF.js：加载 PDF document → 逐页渲染 canvas → 连续竖排滚动容器;缩放（fit-width 默认 + −/＋ + Ctrl 滚轮）重渲染。
**Files**：`src/renderer/shell.js`（pdf 分支）、`src/renderer/shell.css`（viewer 容器/canvas 样式）。
**Verify**：多页 PDF 全部渲染、可滚动、缩放生效;e2e。
**难易**：中。

### U3. 一行工具栏（B7）+ 无预览栏（B8）
**Goal**：wordspace 自己的一行工具栏（文件名 + 页码 + 缩放 + 适应宽度 + 外部打开）。因为是自己的 UI,天然没有 Chromium 的第二行工具栏（B7 解决）+ 没有左侧预览栏（B8 解决）。
**Files**：`src/renderer/shell.js`（工具栏 DOM）、`src/renderer/shell.css`。
**Verify**：只有一行工具栏、无预览栏;e2e 验工具栏按钮 + 无 pdfv-frame iframe。
**难易**：低-中。

### U4. e2e + 清理
**Goal**：e2e 真门（PDF 打开 → PDF.js canvas 渲染 + 一行工具栏 + 缩放 + 页码）;删旧 iframe pdfv-frame 代码/样式。
**Files**：`e2e/*.spec.js`、shell.js/css 清理。
**难易**：低。

## 顺序
U1（验证 worker,**通不过就停下找你**）→ U2（渲染）→ U3（工具栏 B7/B8）→ U4（e2e+清理）。

## 风险
- **worker/CSP**（U1 前置,最大）。若 PDF.js 4.x module worker 在 file:// CSP 下死活加载不了,退路 = PDF.js legacy build（classic worker）或主线程渲染（慢但能跑）。
- 大 PDF 性能（连续渲染所有页 canvas 内存）—— 可后续加按需渲染（可见页才渲），先全渲染跑通。
- 依赖体积（pdfjs-dist ~几 MB）—— 接受（本地 app）。
