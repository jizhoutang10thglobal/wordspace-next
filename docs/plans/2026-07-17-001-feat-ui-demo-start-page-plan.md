---
title: "feat: 默认屏导览页(时间流)——ui-demo 原型"
type: feat
status: active
date: 2026-07-17
---

# feat: 默认屏导览页(时间流)——ui-demo 原型

## Summary

把「一个标签都没开」时的编辑区空态换成浏览器式导览页,按 Colin 选定的**方案 3「时间流」**:
左栏 = 问候语 + 统一 omnibox + 按「今天/昨天/本周/更早」分组的最近文件;右栏 = 收藏网页瓦片 + 开始动作
(新建文档/打开文档/打开文件夹)。ui-demo 先行,Colin 审过后真 app 移植另起计划。

## Problem Frame

Wendi 2026-07-17:「当我没有打开任何标签页的时候……应该像一个浏览器的屏幕一样,同时有一个搜索栏,
同时有一个打开文件或文件夹的按钮」。现状两边都糙:真 app 空态 = 居中标题 + 两按钮 + 裸绝对路径的
recents 列表;ui-demo 空态更差——直接渲染一个无文档的空 Canvas。方向已经过 5 方案 HTML 草图评审,
Colin 拍板方案 3(时间流),并确认三项:搜索栏 = 统一 omnibox;含收藏瓦片;与网页标签的「起始页」
保持两个页面、只统一视觉。

## Requirements

- R1 无激活标签时编辑区渲染导览页(方案 3 布局:左时间流 + 右收藏/动作栏)。
- R2 统一 omnibox:打字即时过滤本地文件(点击/回车打开);输入网址或搜索词回车 → 开网页标签(复用既有浏览器管道)。
- R3 最近文件按 updatedAt 分组(今天/昨天/本周/更早),行 = 文件图标 + 名字 + 所在文件夹 + 时间;绝不显示裸绝对路径。
- R4 收藏瓦片区(书签栏文件夹的收藏,首字彩块图标,点击开网页标签);「开始」动作三连:新建文档(openCreate)/打开文档(openFind)/打开文件夹(openAddFolder)。
- R5 视觉遵守纸方墨圆**保守口径**:卡片/瓦片零阴影(1px 细边+底色差),hover=墨条滑入,omnibox 焦点=墨线划过,问候语用 editorial 大字;深浅色两态。
- R6 全部 chrome 文案走 i18n(t() + zh/en 双词条),过三道门(scan/parity/usage)。

## Key Technical Decisions

- **挂载点** = `MainDocs()` 无 tab 分支(App.tsx):`if (!tab) return <StartPage/>`——不动路由,空态即导览页。
- **omnibox 不复用 ArcSidebar 的 submitOmni**(那是侧栏组件内部闭包),网页导航走 CreateModal.submitUrl 同款
  最小管道:`newBrowserTab()` + `useBrowser.getState().navigate(v)`;本地过滤自己做(docs 按 title 匹配)。
  判定顺序:有候选文件且非 URL 形 → 开文件;否则交给浏览器管道(它自己分 URL/搜索)。
- **时间分组纯函数**独立成 `ui-demo/src/lib/recency.ts`(输入 updatedAt/now,输出组键)——可单测,真 app 移植直接搬。
- **文件夹标签**从 `Doc.localPath` 取倒数第二段(如 `~/Wordspace/团队/员工手册.html` → 团队);无路径的临时文档不进列表。
- 与「起始页」(wordspace://newtab)保持两个 surface;收藏瓦片视觉与它对齐(FavChip 首字彩块惯例)。

## Implementation Units

### U1. recency 纯函数 + 单测

**Goal**: 时间分组逻辑独立可测。
**Files**: `ui-demo/src/lib/recency.ts`(新)、`ui-demo/scripts/test-start-page.mjs`(门,后续单元共用)。
**Approach**: `groupKey(updatedAt, now)` → 'today'|'yesterday'|'week'|'earlier';跨午夜按本地日界。
**Test scenarios**: 今天 00:01/昨天 23:59 边界;7 天整;更早;未来时间(容错归 today)。
**Verification**: node 直跑门脚本绿。

### U2. StartPage 组件 + 样式(方案 3 布局)

**Goal**: 导览页主体。
**Requirements**: R1/R3/R4/R5。
**Dependencies**: U1。
**Files**: `ui-demo/src/components/StartPage.tsx`(新)、`StartPage.css`(新)、`ui-demo/src/App.tsx`(挂载)。
**Approach**: 左栏问候(按小时分早/午/晚)+日期、omnibox、分组列表(fico 纸片小图标惯例);右栏收藏瓦片
(书签栏文件夹,上限 6)+「开始」动作。数据:useStore.docs(有 localPath 的按 updatedAt 排序取前 ~12)、
useBookmarks。空收藏/空最近各有安静空态。保守口径样式(见 R5),路由入场沿用 ws-anim-view。
**Patterns to follow**: ArcSidebar 的 FavChip/墨条 hover;CreateModal 的 stagger 入场;tokens.css。
**Test scenarios**: 无标签渲染导览页/开文档后不渲染;分组标题按数据出现;收藏瓦片点击开网页标签;
三动作按钮各自开对应 modal/palette;最近行点击打开对应文档。
**Verification**: 浏览器烟测 + 目验截图。

### U3. omnibox 行为(过滤 + 网页管道)

**Goal**: R2 的统一语义。
**Dependencies**: U2。
**Files**: `StartPage.tsx`(内聚)。
**Approach**: 受控输入;候选=title 含 query 的 docs(≤6, 高亮命中);↑↓ 选择、Enter 开选中;
无候选或 URL 形输入 → newBrowserTab + navigate。Esc 清空。
**Test scenarios**: 打字出候选并回车开文档;输入 example.com 回车开网页标签;输入中文词无文件命中回车走搜索;Esc 清空。
**Verification**: 烟测覆盖上述四条。

### U4. i18n + 三道门 + spec

**Goal**: R6 + 制度交付物。
**Dependencies**: U2/U3。
**Files**: `ui-demo/src/i18n/zh|en/misc.ts`(或新 start 命名空间)、`docs/features/start-page.md`(新,含真 app 移植欠账)。
**Approach**: 全部文案 t() 化;spec 记行为契约 + 欠账(真 app recents 数据源/home 屏替换/搜索管道对接)。
**Verification**: i18n scan/parity/usage 三门绿;npm run build 绿;全量烟测(既有 test-immersive/test-template-ui 不回归)。

## Scope Boundaries

- 不动真 app(`src/**`)——移植等 Colin 审完 ui-demo 后按 `/align-feature` 另起。
- 不动网页标签「起始页」;不动侧栏。
- 拼写检查/网页搜索建议等 omnibox 高级功能不做(起始页也没有)。

### Deferred to Follow-Up Work

- 真 app 移植(home 屏替换 + recents 模块对接 + 搜索管道)。
- 最近文件的缩略预览卡(方案 2 元素,若 Colin 审后想混搭再加)。

## Verification

`npm run build`;`node scripts/test-start-page.mjs`(U1 纯函数 + U2/U3 浏览器烟测,变异自检:
把空态挂载改回空 Canvas → 门翻红);i18n 三门;截图(浅/深)+ 本地 dev server 给 Colin 目验。

## 实现姿势

实现期加载前端设计 skills(ce-frontend-design;设计正典 docs/style.md 为准绳,冲突时 style.md 赢)——Colin 点名要求。
