# Team Memory — 跨 session 公告板

> **这是什么**：并行 worktree/session 之间唯一的全局知识 channel。Claude Code 的
> auto-memory 按文件夹路径隔离、跨不了 worktree；这份文件走 git，人人可达。
>
> **读**：任何 session 里调 `/sync-main`（冷启动、长 session 隔段时间、动新改动前都值得跑）。
> **写**：调 `/remember-global`——它把条目经「短命分支 + PR + auto-merge」落到 main（发完即走，
> required checks 绿后约 7 分钟自动合上）。不直推——branch protection 对所有人所有文件生效，
> 曾经的直推特权已废除（Colin 拍板 2026-07-11，见下方同日公告）。
>
> **写什么**：会影响其他 session 的东西——全局教训、规则/门变更、拍板决策、流程变化。
> 只对单个 feature 有效的知识别写这。条目要写「是什么 + 怎么 apply + 来源」，别只写「改了 X」。
> **沉淀**：时效已过的条目可清理；升格为硬规则的移进 `CLAUDE.md`。

<!-- 新条目插在这行下面（倒序，最新在最上） -->

## 2026-07-13 — 侧栏收藏区 header 口径变更：栏标化 + 对齐网格，两侧已同步（spec §4.3 已更新）

**是什么**：Wendi 反馈收藏区「视觉乱」，根因 = 收藏 header 穿「文件夹行」的衣服（行首 caret +
accent 星标 + 中灰粗体），与同级栏标（置顶/标签页/文档）语言不一致，且列内多套左缘各自为政。
新口径：header 用 editorial 栏标语言（mono/fs-xs/宽字距/text-3），星标撤出 header（☆ 只留地址栏），
caret 移行尾常显、展开原地旋转；对齐网格 = 栏标与内容各一条左缘。正本 `docs/browser-feature-spec.md`
§4.3 / 图标清单 / 验收清单 / ASCII 图已全部更新。
**怎么 apply**：ui-demo（PR #170）与真 app（PR #173）已按新口径同步落地，锚点已记账
（`docs/features/browser.md`），此项无欠账。之后动侧栏收藏区、写相关 e2e、或做移植的 session
一律按 spec §4.3 新口径来——别参考旧截图，也别参考旧分支（如 `wordspace-next-browser` 的
feat/browser-tabs 旧实现）。
**来源**：PR #170 / #173，spec §4.3（2026-07-13），Wendi 反馈 + Colin 拍板。


## 2026-07-12 — 分页文档已进真 app（PR #164 合 main），feature 全链路收官

**是什么**：分页文档完成 ui-demo（PR #151）→ 真 app（PR #164）全链路：V4 引擎/页面设置/@page 入盘/
分页导出+页码，宿主实测屏显与 PDF 一致（6 页 A4 + 页脚页码）。两侧对齐锚点已更新
（docs/features/paged-doc.md）。
**怎么 apply**：动分页相关代码前先读 spec；改动必须过 e2e/paged.spec.js（真 app）/
scripts/verify-paged-v4.mjs（ui-demo）两道门。遗留小项（pre 收编 Schema 后激活块内切分、
页间点击路由语义统一）在 spec 欠账。worktree `wordspace-next-schema2` 的旧分支 feat/schema-2-paped
已删除，勿再引用。
**来源**：PR #164 / docs/features/paged-doc.md


## 2026-07-11 — 「打开大文件夹/桌面特别卡」根因 = .app 等 macOS 包被递归；文件树加三档忽略

**是什么**：Wendi「打开 Wordspace 特别卡」真根因（视频实测）：她把桌面当工作区，桌面里有 Minecraft.app——
macOS 的 .app/.framework/.photoslibrary 等是「包」（Finder 当单个文件），但 readTree 原来把它当普通文件夹**递归钻进去**，
内部上万框架/资源文件把 readTree 卡死。**又一次不是云盘**（桌面是本地盘）。修法 PR #162：文件树三档忽略——
A macOS 包（20 种后缀）显示成单节点不递归；B 依赖/构建/缓存目录（node_modules/.git/bower_components/__pycache__/
Pods/DerivedData/venv）完全隐藏；C 隐藏文件（点开头）原 skip 已覆盖。实测 demo 10002 文件→只 2 文件进树、7ms。
**怎么 apply**：遇「打开某文件夹卡」先查里面有没有 .app 或 node_modules 这类包/依赖目录被递归（别再先怀疑云盘）；
忽略规则在 src/main/workspace.js（IGNORE / BUNDLE_EXTS / walk），加新类型往这两个 set 加。契约见 docs/features/workspace-file-tree.md。
**来源**：PR #162。


## 2026-07-11 — 浏览器真 app 移植 PR #160 已开：动了共享核心，动 sidebar/shell/tabs/ipc 前看一眼

**是什么**：浏览器 feature 按唯一契约 `docs/browser-feature-spec.md` §14 全量移植进真 app
（`feat/browser-port`，PR #160，等 Colin review）。改动横跨共享核心：`src/renderer/sidebar.js`
（web 第三身份类/循环切换/⌘⇧T 重开栈/⌘T 二合一 modal）、`src/renderer/shell.js`（web view
摘挂钩子/菜单 web 态拦截）、`src/lib/tabs.js`（web: 前缀/updateEntry/关闭栈）、
`src/main/{ipc,main}.js`（浏览器 IPC 面/菜单项）+ 新模块一批。附赠两条通用硬教训：
① Electron `findInPage` 显式传 `findNext:false` 会让 `found-in-page` **静默不发**（首次请求
必须省略 findNext）；② `git add -A` 会把 worktree 里陈年未跟踪产物扫进历史（本次 `release-smoke/`
整个 .app 几百 MB 进了 6 个 commit，push「网络挂死」查半天其实是巨型包——filter-branch 剔掉才推动）。
**怎么 apply**：并行 session 近期动上述共享文件前先看 PR #160 的 diff 防撞车；它合进 main 后记得
rebase。commit 前扫一眼 `git log --name-only` 的顶层路径，别让打包产物进历史。浏览器行为的改动
一律改 spec 正本 + 同 PR 更 `docs/features/browser.md`（欠账清单也在那）。
**来源**：PR #160（feat/browser-port）；spec=docs/browser-feature-spec.md；worktree wordspace-next-browser。

## 2026-07-11 — 文档 back/forward 归到浏览器统一导航移植里做（别单独建两套）

**是什么**：真 app 的「文档向前向后 / 导航历史」决定挂到**浏览器 feature 的统一导航移植**上做，不在
doc-linking 或别处单独在 doc-header 建一套（Colin 2026-07-11 拍板）。原因：浏览器 feature
（`docs/browser-feature-spec.md`）在真 app 要建侧栏导航 chrome（网页 back/forward），而 ui-demo 已把
「网页 + 文档」的前进后退**统一在侧栏箭头**上（按当前标签类型分派：web→浏览器历史 / doc→文档导航历史，
见 PR #146 `ui-demo/src/mock/nav.ts`）。两者抢同一块地盘，分开建 = 两套 back/forward UI = 分裂。
**怎么 apply**：**谁做浏览器真 app 移植**（按 `docs/browser-feature-spec.md` 建 app 级导航 chrome）——请
**一并建统一的前进后退（网页 + 文档共用一套历史栈 + 一对箭头）**，照 ui-demo 模型；文档侧的导航历史
（记录 openDoc/showViewer 两个导航终点）作为 doc 分支接进去。**doc-linking 这条不单独做真 app 版**
back/forward（移交文档 `docs/doc-linking-feature-spec.md` §4.2 已把 doc-header 独立版标为兜底）。眼下
文档「回上一篇」靠标签页兜（上一篇的标签还开着，点它回去）。
**来源**：Colin 2026-07-11 拍板；ui-demo 版 PR #146；`docs/doc-linking-feature-spec.md` §4.2 +
`docs/features/doc-linking.md` 欠账 N1。

## 2026-07-10 — 真 app 加了隐藏性能诊断模式 + 「云盘不是 perf 元凶」实测教训

**是什么**：v0.6.5 起，真 app 菜单「Wordspace Next→性能诊断…」（或 Cmd+Shift+D）开隐藏诊断面板，显示每根 readTree 耗时/文件数/watcher 触发次数/云盘徽章 + 渲染耗时 + 主线程长任务(>50ms 卡帧) + JS 内存，并可「录制 5 秒 CPU Profile」存桌面。普通用户零感知（默认不显示）。**硬教训**：Wendi 报「桌面+谷歌网盘两文件夹贼卡」，但云盘 stat 不慢（dataless 只是内容不在本地、元数据本地缓存）、readTree 不比本地慢（OneDrive 24k 文件 759ms vs 本地 20k 186ms 同量级）、空闲云盘 40 秒零 watcher 事件——三次实测全推翻「云盘慢」这个纯代码脑补。真实成本是文件数→readTree 线性涨，默认折叠时渲染很便宜。
**怎么 apply**：做 perf 别从代码猜「云盘慢」；要判断就用这个诊断面板、且在代表性大文件夹上量（本地合成小文件夹会给假绿、骗过我们一次）。工具已在 src/main/perf-diag.js + src/main/workspace.js readTree 埋点。
**来源**：PR #147（已合 main、发版 v0.6.5），worktree 已清。


## 2026-07-11 — /remember-global 落账方式定案：PR + auto-merge，直推特权废除

**是什么**：Colin 拍板（方案 B）：保留 main 的全部保护门（must-PR + required test/e2e，含管理员），
`/remember-global` 改走「短命分支 + PR + `gh pr merge --auto`」；仓库已开 Allow auto-merge。
skill 文档已同步改写（含标记行前缀匹配、jizhoutang10thglobal 账号 push 等实操坑）。
**怎么 apply**：写 team-memory 一律按新版 skill 步骤走，发完即走不等 CI（约 7 分钟后自动上 main）。
任何「直推 main」的念头都打消——对所有人所有文件都不存在这条路。
**来源**：PR（本条目所在）+ 仓库设置 allow_auto_merge=true（2026-07-11 API 实开）


## 2026-07-10 — 浏览器 feature 规格定稿 + 六项拍板合 main；真 app 移植的唯一契约就位

**是什么**：浏览器 feature（标签上网/地址栏+自动补全/侧栏折叠收藏/历史/右键菜单/快捷键/会话恢复）在
ui-demo 定稿并合 main（PR #150）。完整规格=`docs/browser-feature-spec.md`（正本，~460 行：每功能三层
「交互契约 → ui-demo 参考实现 → 真 app 后端设计(WebContentsView/IPC/存储)」，含安全不变式与验收清单）
+ `docs/features/browser.md`（features 注册表薄指针+欠账）。Colin 六项拍板已落地：真 app 默认引擎=Bing；
删「主页」设置；点收藏=已开则聚焦；收藏折叠态持久化；新标签瓦片=书签栏前 N 个收藏；导入重名文件夹
加后缀不合并+toast 报净新增。同日更早定稿：收藏=左侧栏折叠区（置顶上方、默认收起）、网页态无网页头、
砍剪藏/下载/阅读模式（§12，别加回来）。
**怎么 apply**：做真 app 浏览器移植的 session：唯一契约是 `docs/browser-feature-spec.md`（§14 验收清单
逐项打勾、§11 安全不变式一条不许松）。⚠ worktree `wordspace-next-browser`（feat/browser-tabs，PR #132）
停在多轮 UX 定稿之前——web-tabs.js 地基可复用，但其网页头/旧收藏形态不要照搬。ui-demo 侧改浏览器
行为 → 改正本 + 同 PR 落实进 ui-demo（正本=可执行定义）。
**来源**：PR #150（docs/browser-spec-v2）、docs/browser-feature-spec.md §13/§15、Colin 拍板 2026-07-10


## 2026-07-10 — 分页文档 ui-demo 定型合 main；真 app 移植契约在 docs/features/paged-doc.md，schema2 worktree 旧实现作废

**是什么**：分页文档（Word 式：统一 A4 页高、超高块带留白分页、可编辑表格/代码、编辑稳定）在 ui-demo
定型并合 main（PR #151）。经历多轮翻车后定型的 V4 实现有四条铁则（回车分裂继承推挤样式→清理必须
选择器全量扫荡；灰缝锚定实测推挤位置而非几何网格；同帧扫荡→测量→重推；覆盖层坐标原点=纸 padding 盒），
全部写进 docs/features/paged-doc.md（行为契约+文件映射+欠账）。
**怎么 apply**：要做真 app 分页移植的 session：唯一契约是 docs/features/paged-doc.md。⚠ worktree
`wordspace-next-schema2`（分支 feat/schema-2-paged）里的真 app 实现是旧口径（独立 Schema 2 + 画线、
无留白），已作废——移植前必须按 spec 改造：删 schema-2 descriptor（分页=Schema 1 可选版式设置，
Colin+Wendi 拍板）、分页引擎按 V4 铁则重写。别直接续用旧 worktree 代码。验证抄
ui-demo/scripts/verify-paged-v4.mjs 的断言口径（页界真空带/页高统一/编辑不累积/数据零污染）。
**来源**：PR #151（feat/ui-demo-paged-gaps）、docs/features/paged-doc.md

## 2026-07-10 — ⚠ /remember-global 的「直推 main」路径已被分支保护封死

**是什么**：main 的 branch protection 现在含「Changes must be made through a pull request」，管理员
账号直推也被拒（GH006）。/remember-global skill 文档里「唯一允许直推 main」的特权路径实际不可用。
**怎么 apply**：写 team-memory 暂时走「短命分支 + PR + CI + merge」；skill 文档与保护规则的冲突
待 Colin 拍板（要么给 bypass、要么改 skill 文档）。
**来源**：本条目落账过程实测（2026-07-10）


## 2026-07-10 — 跨 session 对齐体系上线（本文件 + 3 个 skill）

**是什么**：新增 `docs/team-memory.md`（本文件）、`docs/features/` 对齐 spec 体系、三个仓库级
skill：`/sync-main`（拉取并消化 main 增量）、`/remember-global`（写公告到这里）、
`/align-feature`（ui-demo ↔ 真 app 按 feature audit/port）。
**怎么 apply**：各 session 从此用 `/sync-main` 替代「人肉转述 main 有什么新东西」；发现全局教训用
`/remember-global` 落账；直改真 app UI/交互时必须同 PR 更新 `docs/features/` 对应 spec 或记欠账
（规则已进 CLAUDE.md）。存量分支要 rebase 到 main 之后才有这三个 skill。
**来源**：`feat/alignment-skills`，需求文档 `docs/brainstorms/2026-07-10-session-alignment-system-requirements.md`。
