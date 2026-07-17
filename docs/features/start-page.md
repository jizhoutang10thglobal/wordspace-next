# 默认屏导览页(时间流) —— 对齐 spec

> 来源:Wendi 2026-07-17「当我没有打开任何标签页的时候……应该像一个浏览器的屏幕一样,同时有一个
> 搜索栏,同时有一个打开文件或文件夹的按钮」。5 方案 HTML 草图评审后 Colin 拍**方案 3「时间流」**,
> 并拍三项:搜索栏=统一 omnibox;含收藏瓦片;与网页标签「起始页」保持两个页面、只统一视觉。
> plan: `docs/plans/2026-07-17-001-feat-ui-demo-start-page-plan.md`。ui-demo-first:本 spec 现状 =
> ui-demo 已实现待 Colin/Wendi 目验,真 app **未移植**。

## 行为契约

**触发**:一个标签都没开(无激活 tab)时,编辑区渲染导览页(不再是空编辑器/裸列表)。

**布局(方案 3)**:左栏 = 问候刊头(按时段早/午/晚/夜)+ 日期 + 统一 omnibox + 最近文件时间流;
右栏 = 收藏瓦片(书签栏收藏,首字彩块,点击开网页标签)+「开始」动作(新建文档/打开文档/打开文件夹)。

**统一 omnibox 语义**:打字即时过滤本地文件(≤6 候选,↑↓ 选择,回车/点击打开);输入网址或搜索词
(无文件候选/URL 形)回车 → 开网页标签走浏览器管道(URL/搜索的判定归浏览器,与地址栏一致);
候选尾部常驻「在网上搜索"{q}"」逃生行;Esc 清空。

**最近文件**:有落盘路径且非临时未保存的文档,按 updatedAt 倒序取前 12,按 今天/昨天/本周/更早
分组(本地日界,纯函数 `recency.ts`);行 = 纸片小图标(md 带角标)+ 文件名 + 所在文件夹 chip
(localPath 倒数第二段)+ 相对时间(relTime)。**绝不显示裸绝对路径**(Wendi 吐槽的原罪)。

**视觉**:纸方墨圆保守口径——卡片/瓦片零阴影(1px 细边+底色差),候选下拉是真浮层允许极淡阴影;
hover=墨条滑入;omnibox 焦点=墨线划过;入场 stagger 落定;深浅色两态;全部文案 i18n(start 命名空间)。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 时间分组纯函数 | `ui-demo/src/lib/recency.ts` | —(移植直接搬) |
| 导览页组件/样式 | `ui-demo/src/components/StartPage.tsx` / `.css` | —(欠账:替换 index.html #home 空态) |
| 挂载点 | `ui-demo/src/App.tsx` MainDocs 无 tab 分支 | —(欠账:shell 空态路由) |
| 文案 | `ui-demo/src/i18n/zh|en/start.ts` | —(真 app i18n Phase 2 已就位,补 start 键) |
| 验证门 | `ui-demo/scripts/test-start-page.mjs`(16 断言;变异自检:撤空态分支翻红) | —(欠账:e2e) |

## 有意分歧

- 演示种子把分页压测文档时间散开(SEED_VERSION 28)让分组可见——纯演示数据,非行为。
- ui-demo 的「打开文档」动作映射到查找文件面板(demo 无系统文件对话框);真 app 映射 pick-file。

## 欠账(真 app 移植硬活)

- **recents 数据源**:真 app 用 `src/main/recents.js` 模块(有真实打开历史),字段对齐(路径→
  文件夹名/时间);ui-demo 用 docs.updatedAt 是演示替身。
- **home 屏替换**:`src/renderer/index.html` #home(.ws-empty)整块换成导览页 DOM + shell.js 渲染;
  裸路径 recent-list 退役。
- **omnibox 管道对接**:本地过滤接 recents+工作区索引;网页走 webtab-navigate(已有);快捷键焦点
  (⌘L 归属侧栏地址栏,导览页 omnibox 聚焦策略移植时定)。
- e2e(Playwright-Electron)+ 深浅色回归;i18n start 键同步进真 app 字典。
