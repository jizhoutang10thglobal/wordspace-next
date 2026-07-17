# 默认屏导览页(时间流) —— 对齐 spec

> 来源:Wendi 2026-07-17「当我没有打开任何标签页的时候……应该像一个浏览器的屏幕一样,同时有一个
> 搜索栏,同时有一个打开文件或文件夹的按钮」。5 方案 HTML 草图评审后 Colin 拍**方案 3「时间流」**,
> 并拍三项:搜索栏=统一 omnibox;含收藏瓦片;与网页标签「起始页」保持两个页面、只统一视觉。
> plan: `docs/plans/2026-07-17-001-feat-ui-demo-start-page-plan.md`。ui-demo 版已合(#259,Colin
> 目验通过,追加两反馈:右栏=书签/最常访问/开始、关光普通标签回导览页);真 app **已移植**(2026-07-17,
> 分支 feat/app-start-page)。

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
| 时间分组纯函数 | `ui-demo/src/lib/recency.ts` | `src/renderer/start-page.js`(groupKey 同逻辑内联) |
| 导览页组件/样式 | `ui-demo/src/components/StartPage.tsx` / `.css` | `src/renderer/index.html` #home 重构 + `start-page.js`(新)+ `shell.css` .sp-* 段 |
| 挂载点 | `ui-demo/src/App.tsx` MainDocs 无 tab 分支 | #home 显隐契约不动(shell.js prepFrame/showViewer/shellCloseDoc);renderRecents 委托 __startPage.refresh |
| 数据源 | docs.updatedAt(演示替身)/bookmarks/history mock | recents IPC({path,openedAt},MAX 10,openedAt 首次被消费)/bm-state/hist-state+变更推送(自拉镜像,browser.js 闭包读不到) |
| omnibox 网页路 | CreateModal 同管道 | `window.__webOpenInput`(URL/搜索判定在主进程 url-input.js) |
| 最常访问 | 历史按 url 计数 top4 | 同(真 app **新 UI 面**,数据=既有浏览历史,无归一化=与历史页同口径) |
| 文案 | `ui-demo/src/i18n/zh|en/start.ts` | `src/i18n/{zh,en}/start.js` + NAMESPACES 注册(usage 门 readdir↔NAMESPACES 双向锁) |
| 验证门 | `ui-demo/scripts/test-start-page.mjs`(19 断言,含 UX4v3 滚动探针) | `e2e/start-page.spec.js` 4 门(变异自检:撤 script 挂载 4 全红);锚 id #home/#home-open/#home-open-folder 保留守住 30+ 既有位点 |

## 有意分歧

- 演示种子把分页压测文档时间散开(SEED_VERSION 28)让分组可见——纯演示数据,非行为。
- ui-demo 的「打开文档」动作映射到查找文件面板(demo 无系统文件对话框);真 app 映射 pick-file。

## 欠账(剩余)

- omnibox 本地过滤只覆盖 recents(10 条)——工作区全量标题索引待有需求信号再接(侧栏筛选/⌘P 已覆盖树域)。
- recents 无失效清理(文件被删条目仍在,点了走 openDoc 报错兜底)——既有行为,未在本 feature 扩。
- 最常访问的 url 无归一化(尾斜杠/hash 各算一条)——与历史记录同口径,要改一起改。
- 深色态导览页跟 app 主题走(token 全局),未单独截图回归。
