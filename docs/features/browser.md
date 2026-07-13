# 浏览器（标签上网 / 收藏 / 历史 / 右键菜单）—— 对齐 spec

> **正本在 [`../browser-feature-spec.md`](../browser-feature-spec.md)**（本模式的先例，留在原位；
> 完整规格：每功能三层 = 交互契约 → ui-demo 参考实现 → 真 app 后端设计）。
> 本文件是 features/ 注册表里的**薄指针**——防两份规格漂移（本仓防漂移教训：绝不写变体）。
> 改浏览器行为 → 改正本；本文件只维护锚点与欠账。

## 行为契约

见正本 §1–§9：心智模型、数据模型、侧栏布局（收藏折叠区在置顶上方）、地址栏+自动补全、
标签系统、⌘T 新建 modal、起始页、**网页态无网页头**、页内查找、缩放、右键菜单六分节、
历史、收藏管理页 + Netscape 互通、设置、normalize/resolve 管线、快捷键全表、会话恢复。
六项拍板结果（默认引擎 Bing / 删主页设置 / 点收藏聚焦已开 / 折叠态持久化 / 新标签瓦片取书签栏 /
导入重名文件夹加后缀不合并）在正本 §13。

## 文件映射

| 子模块 | ui-demo | 真 app |
|---|---|---|
| 交互总览 | 见正本 §16 源码索引 | 下面各行 |
| view 生命周期/安全边界/原生右键/导航事件 | mock（§13 差异表） | `src/main/web-tabs.js` |
| IPC 面 + 导入导出对话框 | 无 | `src/main/browser-ipc.js`（spec §10.3） |
| 收藏/历史/设置持久化 | zustand persist | `src/main/browser-store.js`（`userData/browser-*.json`，防抖原子写） |
| 收藏纯逻辑 + Netscape 互通 | `ui-demo/src/mock/bookmarks.ts` | `src/lib/bookmarks.js` |
| 历史纯逻辑（60s 合并/cap500） | `ui-demo/src/mock/history.ts` | `src/lib/web-history.js` |
| 右键菜单 builder（双胞胎） | `ui-demo/src/lib/webCtxMenu.ts` | `src/lib/web-context-menu.js` |
| omnibox 输入判定 / 引擎表 | `ui-demo/src/mock/browser.ts` / `browserSettings.ts` | `src/lib/url-input.js` + `tld-set.js` / `search-engines.js` |
| 决策纯逻辑（权限/scheme/缩放步进） | 散在组件里 | `src/lib/web-tabs-policy.js` |
| 标签模型的 web 身份类 | `ui-demo/src/mock/store.ts` | `src/lib/tabs.js`（`web:` 前缀 / updateEntry / 关闭栈） |
| 侧栏导航条/omnibox/收藏区/起始页/历史页/收藏页/设置页/查找条 | `ArcSidebar/WebView/NewTab/HistoryPage/BookmarksPage/Settings` | `src/renderer/browser.js` + `browser.css` + `index.html`（DOM）+ `sidebar.js`/`shell.js` 接线 |
| 测试 | —— | `test/{bookmarks,web-history,web-context-menu,web-tabs-policy,url-input,tabs}.test.js` + `e2e/browser.spec.js`（本地 http server 真加载 + attach/bounds/像素三件套强断言） |
| 默认浏览器（系统集成,正本 §10.6） | 无（网页 mock 没有系统集成面） | `package.json` `build.protocols`/`fileAssociations` + `src/main/main.js`（open-url 路由/冷启动队列/WS2_OPEN_URL seam）+ `src/main/browser-ipc.js`（set-default IPC）+ `src/renderer/browser.js`（设置页行）+ `e2e/default-browser.spec.js` + `test/default-browser-config.test.js` |

## 有意分歧

见正本 §13「刻意差异表」（mock 渲染方式 / DOM vs 原生菜单 / 缩放全局 vs 每标签 /
关标签焦点 / 历史触发点 / favicon / 默认引擎 glass vs Bing / 新标签瓦片演示位 vs 书签栏前 N /
normalize TLD 真验证 / 权限 default-deny 白名单 / ⌘/ 面板暂缺），
均为拍板差异，日期与拍板人在正本 §15 决策日志。不在该表里的行为差异都算漂移。
另：**默认浏览器为真 app 独有**（正本 §10.6，2026-07-13）——ui-demo 不移植，不算漂移。

## 对齐锚点

- ui-demo 侧：PR #150 合入 main 的 commit（2026-07-10，正本定稿 + 六项拍板落地）
- app 侧：`feat/browser-port` 分支（2026-07-11，按正本 §14 验收清单全量移植；合 main 后以 merge commit 为准）
- 2026-07-13 收藏区 header 重样式（栏标化 + 对齐网格，正本 §4.3 已更新，Wendi「视觉乱」反馈）：
  ui-demo PR #170 + app PR `fix/app-sidebar-fav-align`，两侧同步落地，此项无欠账。

## 欠账

- **打包冒烟 / Windows 未验**（正本 §13「仍开放」；dev 态 mac 全绿，签名打包后的 WebContentsView/
  持久化路径未实测）。
- **默认浏览器仅 macOS**（正本 §10.6）：Windows/Linux 未做（Win 要安装器注册表 + `second-instance`
  argv 的 URL 解析，现只解析文件路径）。plist 声明已在本地未签名包字节级实证（CFBundleURLTypes
  http/https）；**签名发版后需真机闭环**：装新版 → 系统设置把默认浏览器切成 Wordspace → 从别的 app
  点链接验热/冷两路。
- **⌘/ 快捷键面板**：ui-demo 有、真 app 暂无（app 本无快捷键面板，独立小 feature）。
- **文档标签的后退/前进**：导航条按钮对文档标签恒灰——文档区导航历史是另一个 feature
  （ui-demo #146，尚未移植真 app），移植后接进 §4.1 的分派。
- **favicon 磁盘缓存**（正本 §10.4 的 `favicons/`）：现为内存 data:URL + 收藏落库时随存；
  重启后标签行 favicon 回落地球图标（视觉可接受），有需要再补磁盘缓存。
- **tld-set 快照有个别假 TLD**（如 `web`/`git` 未委派）：地址栏输 `foo.git` 会当网址走死路错误页
  而非搜索。tld-set 是刻意近似快照,正确修法是从 IANA 根区脚本重新生成,别手删（怕误删真 TLD）。
- **P3 图标/文案细节**（bug sweep 2026-07-12 记账,非阻塞）：补全下拉「开着的标签」图标应 Globe2 现 Globe；
  标签行 web 图标 Globe/14 应 Globe2/13；⌘⇧= 未触发放大（仅 ⌘=）；空地址栏回车应回起始页现 no-op。
  以及**每标签独立缩放**：Electron zoom 按 host 在 session 内传播（同站两标签互相带动、重启保留），
  真正隔离要给每标签独立 session,代价大,暂受此限（正本 §4.6/§13 的「每标签」是意图,实现有此约束）。

## bug sweep 记录（2026-07-12）

5 路对抗审查（主进程/renderer 状态机/sidebar-shell 集成/纯逻辑库/spec 契约漂移）+ Colin 实测报的
「加载中闪回文档」。修了 ~25 个确认项（含 6 个 P1，两路交叉确认的丢数据/状态分裂），
新增回归门（闪回真断言 + lib 7 条 + policy/tabs）。详见 commit `adf711d`→`b997c22`。
