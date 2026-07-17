# 外观模式（浅色/深色/跟随系统）—— 对齐 spec

三态外观模式：浅色 / 深色 / 跟随系统，默认跟随系统。深色覆盖整个界面——编辑器 chrome 走
「纸方墨圆」暗色 token；文档内容区用**视图级智能反色滤镜**变暗（只影响屏显、永不写盘）；
PDF 导出维持文档原生（浅色）。产品拍板与实现 plan：`docs/plans/2026-07-14-002-feat-appearance-dark-mode-plan.md`。

## 行为契约

- **三态**：跟随系统（默认）/ 浅色 / 深色。跟随系统时，OS 深浅切换实时跟随；显式选浅/深无视系统。选择跨重启持久化。
- **入口（三处，状态永远一致，都从主进程查同一真相源）**：
  - 系统菜单栏「Wordspace Next → 外观」三态 radio；
  - 右上 ⋯ 菜单「外观」三选一（当前态显 ✓，与菜单栏同一心智模型）；
  - 设置面「外观 → 主题」下拉。
- **chrome 变暗**：侧栏 / 标签栏 / 顶栏 / 工具条 / 菜单 / 浮层 / 降级条 / 起始页 / 更新面板等一切宿主 UI
  全量走暗色 token，无漏网亮块。切换有一层 120-160ms 短过渡（尊重 `prefers-reduced-motion`）。
  侧栏底部的 wordspace.ai wordmark 是纯灰度 PNG，暗态用 `filter: invert(1)` 反相成白字白框
  （实测色偏=0，反相不串色，省一张白版资源），否则黑字埋在暗底里看不见。
- **文档变暗**：三条渲染路径（合规块编辑 / 非合规基础编辑 / .md）在深色下被反色滤镜变暗——普通浅色文档变暗、
  图片/视频等媒体不反色、本身深色设计的文档不二次反转、无背景声明（透明）的浅色文档也变暗。
  深色下开/切/reload 文档不闪白（导航期遮罩，判完揭开）。
- **网页标签**：不强制反色，只把深色偏好透传给网站（`prefers-color-scheme`），支持深色的网站自动变暗。
- **保真红线**：滤镜只在显示层——深色下任何编辑保存，磁盘字节与浅色态完全一致（零污染）。
- **PDF 导出**：永远输出文档原生浅色形态，与外观模式无关。
- **系统级**：mac 窗框 / 系统菜单 / 原生对话框随主题明暗（`nativeTheme.themeSource`）。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 三态纯逻辑 | `ui-demo/src/appearance.ts`（镜像） | `src/lib/appearance.js`（canonical，CI 门覆盖） |
| 切换 + 持久化 | `ui-demo/src/appearance.ts`（data-theme + localStorage） | `src/main/appearance-store.js` + `src/main/main.js`（nativeTheme + 菜单）+ `src/renderer/appearance-ui.js`（data-theme + 三入口同步） |
| palette | `ui-demo/src/styles/tokens.css`（`:root[data-theme="dark"]`） | `src/renderer/shell.css`（`:root[data-theme="dark"]`） |
| 反色滤镜配方 | `ui-demo/src/docDark.ts`（镜像） | `src/lib/doc-dark-recipe.js`（canonical，UMD）+ `src/renderer/doc-theme.js`（注入/遮罩） |
| 亮度/对比度 | `ui-demo/src/luminanceMirror.ts`（镜像） | `src/lib/luminance.js`（canonical，UMD） |
| 入口 UI | `ui-demo/src/components/Settings.tsx` | `src/renderer/index.html`（⋯菜单）+ `src/renderer/browser.js`（设置面） |
| PDF 恒浅 | —（ui-demo 无真 PDF 导出） | `src/main/pdf-export.js` |
| 验收门 | —（无） | `e2e/appearance.spec.js` + `test/appearance*.test.js` + `test/doc-dark-recipe.test.js` |
| 配对清单 | 共用 | `test/appearance-contrast-pairs.js` |

## 有意分歧

- **切主题机制**：真 app chrome 走 `data-theme` 属性 + `nativeTheme.themeSource`（后者驱动 mac 窗框/系统菜单/
  网页标签）；ui-demo 走 `data-theme` + `matchMedia`（无 nativeTheme）。**两侧都用 data-theme 挂在 documentElement**。
  拍板：Colin，2026-07-15（实测 Electron themeSource 不 live 更新 renderer 的 prefers-color-scheme，故 chrome 不用媒询）。
- **文档变暗方式**：ui-demo 合规文档（Canvas，token-based React DOM）在深色下**随 token 自然变暗**（非反色）；
  非合规文档（BasicEditor iframe，野生 HTML）走反色滤镜。真 app 所有文档都在 iframe 里渲染野生 HTML，
  **一律走反色滤镜**。根因是两侧文档渲染架构不同（React DOM vs iframe），非漂移。拍板：2026-07-15。
- **PDF 导出**：真 app 有；ui-demo 无真 PDF 导出（mock）。恒浅色只在真 app 生效。
- **滤镜挂载元素**：ui-demo 是容器滤镜（Canvas 非根，子树内 fixed 浮层 portal 到 body）；真 app 是根滤镜
  （iframe html，规范豁免包含块）。几何行为不同，配方值一致。拍板：2026-07-15。
- **工具栏色板 swatch**：宿主层显示真色，写入文档后被反色滤镜反转显示——全暗拍板（含文档）的固有 WYSIWYG 代价。记录，2026-07-15。
- **偏离 Schema §0「显示按原生」**：视图级反色是纯显示态、绝不入盘，PDF/浏览器直开仍是文档原生浅色。
  Colin 2026-07-14 拍板「全暗含文档」，显式接受此偏离。

## 对齐锚点

- 两侧同 PR 落地：分支 `feat/appearance-dark-mode`（2026-07-15）。

## 欠账

- 暗色 palette 是**工程初稿**，最终观感待 Wendi 真机验收拍板（R12）。style.md 暗色列标着「初稿」，
  验收后去标注 + 记结论。收编的 24 处 chrome 硬编码色暗态值同样待此轮验收。
- 冷启动 chrome 可能有一帧浅色（appearance-ui 异步挂 data-theme），非切换时的文档遮罩覆盖不到；低优先。
- 「跟随系统」的真 OS 深浅切换实时跟随只做了 host 手动验证路径（CI 不能模拟 OS 切换）。
- 个别野生文档反色翻车（背景图上文字、blend mode、半透明层）的按文档禁用逃生口未做（plan Deferred）。
- Schema baseline 的原生暗色排版变体（真·深色而非反色）——独立 feature（plan Deferred）。
